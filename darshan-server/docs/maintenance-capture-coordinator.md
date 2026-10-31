# Maintenance capture coordinator and Packet 2 integrations

Migration `0050_maintenance_capture_barrier.sql` introduces the PostgreSQL-authoritative
capture barrier. The API, worker, controlled upload gateway, telemetry persistence, and
raw backup capture now share that authority.

## State and authority

- `maintenance_site_state` is the per-site linearization row and points to the current
  capture. Admission, capture start, drain, seal, expiry, abort, and emergency preemption
  take a short `FOR UPDATE` lock on this row. `backup_captures` keeps every prior capture,
  including sealed inventory digests, instead of overwriting history.
- Capture history follows a database-enforced state machine. Once a capture is terminal,
  its status, digest, seal time, and reopen time cannot be changed. Backup-run deletion
  returns `BACKUP_CAPTURE_HISTORY_PROTECTED` before deleting archive or storage records
  whenever this history exists.
- Starting capture closes ordinary admission, increments the generation, and creates a
  deadline exactly 300 seconds after `clock_timestamp()`. A database constraint and
  immutability trigger enforce the start/deadline relationship. There is no renewal API.
- A seal succeeds only for the exact site, capture, generation, backup run, current
  attempt, and owner while the attempt is active, uncancelled, in `COPYING`, and before
  the database deadline. It records `SEALED` and a lowercase SHA-256 staging inventory
  digest while reopening admission in the same transaction.
- Emergency preemption is exposed as a caller-transaction operation. The emergency
  transition and durable command-outbox write now commit atomically with capture
  revocation and backup-attempt fencing on `BACKUP_SITE_ID` (or `local`). Authorized
  trigger, clear, and database-clock natural expiry take this path. Invalid,
  unauthorized, idempotent-trigger replay, and repeated-clear requests do not preempt.
  The superseded attempt enters `RETRY_WAIT` with no current attempt identity when its
  run row is immediately available; otherwise capture authority is still revoked and
  lease reconciliation settles run bookkeeping after the competing transaction. The
  whole run is not cancelled. Preemption does not wait for physical capture work to exit,
  and command/playback reconciliation remains unchanged.
- A committed active emergency prevents a new capture from acquiring authority. Capture
  admission checks active state with `clock_timestamp()` after locking the maintenance
  site. A concurrent emergency transition must acquire the same row, so either seal wins
  first or emergency preemption permanently fences the stale capture identity.
- The watchdog and admission path both lazily expire overdue barriers. Expiry reopens
  admission, fences the exact attempt into reconciliation, and leaves stale capture work
  permanently unable to seal.
- Packet 1 attempt authority timestamps use PostgreSQL `timestamptz`. Migration 0050
  fences live attempts created by the earlier current-release draft before normalizing
  its UTC wall-clock values, preventing timezone reinterpretation from extending a lease.

## Ordinary operation permits

Every admitted mutation has a durable `maintenance_operations` row. Its status is one
of `ACTIVE`, `COMPLETED`, or `UNCERTAIN`. Lease expiry is converted to `UNCERTAIN`; it is
never treated as completion. `UNCERTAIN` rows block the transition from `DRAINING` to
`COPYING` until an operator/reconciler calls the explicit resolution API with a decision
and note.

`MaintenanceOperationScope` reuses an already-owned permit for a nested lexical scope,
including when the nested boundary was constructed by another runtime surface in the same
process. Only the outer scope completes it. The active-lifetime fence prevents detached
continuations from inheriting a settled permit. It renews the permit before one third of the lease and
provides an `AbortSignal` when ownership is lost. A normally awaited success or business
error has a known outcome and completes the permit. Callers use `markOutcomeUncertain()`
or throw `MaintenanceOutcomeUncertainError` only when database/object-storage completion
is genuinely ambiguous; those operations remain `UNCERTAIN` for explicit reconciliation.

Stable errors are represented by `MaintenanceCoordinatorError`. In particular,
`MAINTENANCE_ADMISSION_CLOSED` is retryable; fencing, lost attempt authority, and stale
operation ownership are not.

## HTTP admission

`http-admission.ts` classifies every Fastify route when it is registered and wraps the
complete awaited handler in `MaintenanceOperationScope`. Ordinary `POST`, `PUT`, `PATCH`,
and `DELETE` handlers are gated by default. `GET /api/v1/media/uploads/:sessionId` is also
gated because it can expire an upload session and update its media record. This explicit
hidden-writer classification prevents an apparently read-only method from bypassing the
barrier.

The exact mutation exemptions are intentionally narrow:

- login/logout and device heartbeat, proof-of-play, screenshot upload, cache reporting,
  and command acknowledgement remain operational;
- emergency trigger/clear remain available for the preemptive path;
- manual backup creation remains available as the coordinator entry point, so it cannot
  deadlock behind the barrier it coordinates.

Pairing mutations, CMS-authored device commands, emergency-type administration, backup
policy changes, and all other CMS mutations remain ordinary gated operations. Reads and
protocol `OPTIONS` requests remain available. An unsupported HTTP method fails route
registration until it receives an explicit policy.

Closed admission returns HTTP `503` with stable code `MAINTENANCE_ADMISSION_CLOSED`, a
stable maintenance message, `{ "retryable": true }`, and a `Retry-After` header derived
from the database capture deadline. The API owns a shared coordinator for
`BACKUP_SITE_ID` (or `local` outside configured deployments) and starts/stops the
independent expiry watchdog with the Fastify lifecycle.

## Hidden writes in allowed read and realtime paths

Read and delivery paths remain available without changing capture contents. Lazy
notification-counter reconciliation, lazy screen-display-state creation, and schedule
reservation expiry each attempt a nested content-mutation permit. If capture has already
closed admission, the callback is not started: notification counts come from the source
rows, a missing display state is represented by its normal default response, and expired
reservations are excluded by timestamps without persisting their terminal state. The next
read after admission reopens retries the awaited mutation and converges durable state.
These boundaries reuse an active outer permit through the process-global
`MaintenanceOperationScope` context and never schedule detached writes.

Notification and screen subscribe/sync delivery therefore remain live during capture.
Chat subscribe and typing delivery also remain live, while `chat:read` is an ordinary
gated mutation. A blocked `chat:read` acknowledgement uses the stable
`MAINTENANCE_ADMISSION_CLOSED` code, the common maintenance message, and
`retryable: true`; no read marker is changed.

## Integrated raw capture and remaining later-packet boundary

Non-HTTP callers must place the permit around the complete logical mutation, including
database commit and required object-storage completion. HTTP handlers receive this
boundary automatically, but any intentionally detached work must obtain its own scope.
Emergency transitions use the coordinator's caller-owned transaction API. Backup code
must retain the returned capture identity and present it unchanged for drain, seal, or
abort.

Packet 2 raw capture performs its capacity check before closing admission, drains owned
operations, copies PostgreSQL and durable object bytes into a mode-0700 staging area,
computes a deterministic inventory digest, and seals/reopens admission before archive
compression and publication. Final backup completion re-locks the run and verifies the
matching sealed capture using a fresh database timestamp. Emergency/expiry fencing makes
stale physical work unable to publish. Repository encryption, atomic durable publication,
retention, recovery, promotion, and full CMS monitoring remain later packets.
