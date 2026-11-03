# Strict media authority prerequisite

Status: implemented injectable protocol and an explicitly configured Backend
HTTPS transport, with focused developer checks. The default remains the
existing loopback prototype. `DARSHAN_MEDIA_AUTHORITY_MODE=backend` requires
the combined supervisor, a private pinned external authority file and verified
HTTPS/WSS configuration; any other mode refuses startup. This package alone
does not establish integrated Backend/player authorization, deployment readiness
or production acceptance. See [Backend configuration](deploy/BACKEND_AUTHORITY.md).

## Injection and trusted boundary

`AdmissionController` accepts an optional configuration:

```js
strictAuthority: {
  nodeInstanceId,       // fresh supervisor-generated authority boot identity
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

Default prototype control remains loopback-only. Explicit Backend mode may bind
configured numeric interfaces only with validated TLS; it requires a distinct
control secret and rejects every browser Origin header. Public `/rtc` paths do
not expose control APIs. Firewall control to the Backend VM. Backend mode sends
every fresh check to the configured, certificate-verified HTTPS authority route;
the current database policy remains that route's responsibility.

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

The network verifier accepts only a fixed HTTPS authority endpoint without URL
credentials/query/fragment. Its 1500 ms total timeout includes receiving the
bounded response body. Redirects, invalid certificates, malformed/nonboolean
decisions and mismatched echoes fail closed. A configured private CA is validated;
omitting it uses Node's ordinary verified trust. There is no TLS bypass.

Both processes pin the external restore epoch; the media verifier additionally
pins its authority file's inode/device, permissions and exact bytes. A changed
or unreadable file isolates the current node. Atomic replacement with identical
contents is also a change. No hot epoch/secret reset is supported. Responses do
not contain credentials, and transport errors use static diagnostic codes.

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

Backend health exposes `tracked_remaining`, `required_start_headroom` (270 by
default), `accepting_new_runs` and `maintenance_reason`. Before exhaustion, a
new run is refused while an existing occupied or pending run may still admit
members and renew. Backend scheduling must check this headroom before a start;
the hard bound still isolates if any operation exceeds it. An orderly idle node
rotation requires observed old teardown and a new boot identity, never eviction.

Strict health and evidence include `protocol_version: 1`, `node_instance_id`
and `authority_epoch`; admission/run evidence also includes `run_id` and
`generation`. The authority boot UUID is generated on every supervisor start,
even if Docker accidentally reuses a managed label/environment. The existing
host-watchdog `instance_id` remains the managed deployment UUID. An optional
`authority_node_instance_id` heartbeat field binds these identities; it is
immutable within that supervisor process. A new node's local absence is never
evidence that the old node stopped. Host death witnesses remain an independent
trusted host responsibility and must not share media-container credentials.
