# Strict media authority prerequisite

Status: implemented injectable protocol and focused developer checks only.
The ordinary entrypoint still runs the existing prototype mode. Setting
`DARSHAN_MEDIA_AUTHORITY_MODE` to anything except `prototype` refuses startup
before opening listeners. No production Backend verifier, cross-VM transport,
durable server run/outbox, or normal-player integration is supplied here.

## Injection and trusted boundary

`AdmissionController` accepts an optional configuration:

```js
strictAuthority: {
  nodeInstanceId,       // fresh externally configured media-instance identity
  authorityEpoch,       // external restore authority, never inferred from an operation
  verifyAuthority,      // async fresh Backend check; not a cached/durable grant
  verificationTimeoutMs: 1500 // positive integer, at most 1500
}
```

`createAuthorized`, `renewAuthorized` and `issueTicketAuthorized` are the only
strict grant paths. Direct prototype `create`, `renew` and `issueTicket` calls
are rejected in strict mode. The gateway uses the authorized paths in both
modes. Existing prototype bodies and synchronous controller methods remain
compatible when no strict configuration is supplied.

Control remains loopback-only, requires the existing private secret and rejects
browser Origin headers. Public `/rtc` paths do not expose control APIs. Adding
strict configuration is not permission to bind management publicly. Production
still needs an authenticated private cross-VM path and current database policy.

## Commands and fresh checks

Every strict mutation includes `node_instance_id`, `authority_epoch` and a
positive safe-integer `operation_revision`. Admission operations also include
`run_id` and `generation`; create supplies `id`, while other operations target
the URL admission ID. An optional body `id` must match that path.

Revision high-water state is per admission. Run revoke uses a separate
run/generation scope. A wrong node or epoch is rejected before state is reserved
or a tombstone installed. The identity/high-water revision is reserved before
awaiting authorization. Lower or duplicate grant revisions conflict without
rotating a ticket; duplicate matching revokes are safe and idempotent. After a
failed grant, a fresh retry needs a newer revision. New attempts use unique run
UUIDs; generation remains an additional lineage fence.

For CREATE, RENEW and TICKET, the injected verifier receives a frozen object:

```text
{ action, nonce, id, run_id, generation,
  node_instance_id, authority_epoch, operation_revision, signal }
```

`signal` is an AbortSignal. The callback must perform a fresh authenticated
Backend check of current run, presenter/device session, permissions, membership,
approved frozen policy and window. It must not replay a durable authorization
response or treat the caller's desired operation as permission. Credentials
belong in the verifier closure; no credentials or tickets belong in diagnostics.

An allowed response requires the boolean `allowed: true`, echoes every
target/fence field and the fresh nonce, and supplies canonical `participant_id`, `role`, `audio`, `lease_ms` and
`window_remaining_ms`. Caller-provided participant, role, audio and duration
cannot override these fields. Renew/ticket canonical identity and audio must
also match the existing admission. A matching response with `allowed: false`
explicitly denies and revokes that admission. Missing or non-boolean decisions
are rejected without allocating, extending or rotating authority. Transport failure/timeouts do not
extend an existing lease. Reconnect ticket issuance always performs a fresh
check, and never evicts or extends a connected participant merely to replace
its ticket.

The controller anchors monotonic time **before** invoking the verifier. Its
deadline is that anchor plus the shorter canonical lease/window, retaining the
existing 3000 ms cleanup reserve inside the deadline. Thus verification latency
consumes authority rather than renewing it from response-arrival time. A late
response cannot revive an admission whose old cleanup boundary passed. The
nonce, high-water operation, tombstones and current node are checked again
before any returned grant is applied. Hung checks are bounded to 1500 ms and
superseded/stopped checks are cancelled even if the callback ignores its signal.
Clients must still subtract their own request time. Whole-machine suspension
and physical media enforcement retain their independent supervisor/watchdog and
runtime verification requirements.

## Stops, evidence and bounded memory

`DELETE /internal/admissions/:id` installs a permanent admission tombstone,
including unknown IDs. Strict deletion requires the same fenced JSON body.
Prototype deletion remains body-optional. Unknown deletion returns 200 with
`teardown_confirmed: true` and `teardown_reason: ADMISSION_NEVER_CREATED`.
GET of that ID returns the tombstone. A pending fresh create is fenced/cancelled
and can never publish afterward.

`POST /internal/runs/:run_id/revoke` accepts `generation` and, in strict mode,
the fence fields. It tombstones that exact run/generation before awaiting all
matching admission removals. `GET /internal/runs/:run_id?generation=N` returns
its current local evidence. Older-generation cleanup cannot revoke a newer
generation. Strict SFU room names include epoch and node instance too.

`teardown_confirmed` remains false during SFU removal or unresolved/failed node
isolation, even when logical state already says REVOKED. Occupied run counts
include such admissions. Only confirmed removal or successful isolation makes
it true. The isolation hook must resolve only after actual SFU death; a timeout,
requested kill, or unavailable node is not confirmation. Unknown-ID evidence is
local to this fresh controller plus its fresh SFU; it says nothing about a
previous process/node. Durable server capacity must retain that distinction.

By default the controller tracks at most 10000 distinct admission/run keys and
512 pending fresh checks. Completed identities, operation high-water marks and
tombstones are never silently evicted or expired. Exhaustion isolates the node
and rejects new authority. Existing in-flight cleanup remains required. Rotate
to a new instance only after old media teardown/isolation is observed; fresh
instance/epoch fences reject delayed old commands. These are bounded-memory
safety limits, not measured production throughput or retention guarantees.
