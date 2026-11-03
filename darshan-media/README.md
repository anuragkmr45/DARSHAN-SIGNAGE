# DARSHAN media admission prototype

This package is the first media/security gate for scheduled live broadcasts. It
does not implement scheduling, approval, user permissions, persistent run state,
or the production player receiver. The caller must resolve those decisions from
PostgreSQL and issue only current authority. The controller keeps short-lived
enforcement state in memory and never stores video or recording data.

The candidate SFU is `livekit/livekit-server:v1.13.11`; the server SDK is pinned
to `2.19.2`. The browser prototype uses client `2.23.0` separately.

The [strict authority protocol](STRICT_AUTHORITY.md) adds fresh authorization,
node/epoch/revision fences, revocation tombstones and explicit teardown evidence.
An explicit Backend mode now supplies verified HTTPS authority/control and WSS;
its required private inputs and integration gates are described in
[Backend configuration](deploy/BACKEND_AUTHORITY.md). The default remains the
loopback prototype. This package alone does not make the integrated product
ready for production admissions.

## Private interfaces

The default prototype control HTTP server binds **loopback only**, default `127.0.0.1:18784`.
Every route requires `x-darshan-media-secret` (minimum 32 characters). Requests
with a browser `Origin` are rejected. Explicit Backend mode requires direct TLS
and permits configured numeric interfaces; firewall control to Backend hosts.
The public signaling server does not expose the control routes.

```text
POST /internal/admissions
  { id, run_id, generation, participant_id,
    role: "presenter" | "receiver",
    lease_ms: 3001..10000, window_remaining_ms: integer greater than 3000,
    audio: { microphone: boolean, screen_share_audio: boolean } }
  -> 201 { admission_id, run_id, generation, state, ticket,
           signal_url, lease_ms, window_remaining_ms, requested_lease_ms,
           enforcement_starts_in_ms, cleanup_budget_ms }

POST /internal/admissions/:id/renew
  { generation, lease_ms, window_remaining_ms }
  -> 200 { admission_id, run_id, generation, state,
           lease_ms, window_remaining_ms }

POST /internal/admissions/:id/ticket
  { generation }
  -> 200 { admission_id, run_id, generation, state, ticket,
           signal_url, lease_ms, window_remaining_ms }

GET    /internal/admissions/:id
DELETE /internal/admissions/:id
GET    /internal/runs/:id?generation=positive-integer
POST   /internal/runs/:id/revoke { generation }
GET    /internal/health
```

IDs must be opaque ASCII IDs containing only letters, digits, `_.:-`, at most
128 characters. A generation is a positive safe integer. The room name is
derived from run and generation. A room admits one presenter and at most 25
receivers; at most ten rooms can hold authority on one controller.

Creation with an existing admission ID returns `ADMISSION_EXISTS`. A lost create
response can be recovered using the ticket endpoint: it invalidates an unused
ticket and returns a replacement. Active/connecting participants cannot obtain
a replacement ticket. Disconnect cleanup must confirm SFU removal first.
Revocation is permanent for an admission; participant identities are never
reused. A newer run generation cannot be admitted until the old generation's
participants have been removed. Earlier generations remain rejected afterward.
Deleting an unknown admission now records a permanent tombstone and returns
200 with `teardown_confirmed: true` and `ADMISSION_NEVER_CREATED`. A later create
cannot resurrect it. Run revocation tombstones the exact run/generation even
when no admission exists yet. Older cleanup cannot stop a replacement generation.

`teardown_confirmed` is separate from logical `REVOKED`. It remains false during
pending SFU removal or incomplete/failed node isolation; those entries retain
their occupied run count. An unknown tombstone proves no admission was created
in this controller, assuming the required fresh SFU startup. Never infer that
another node/process is dead from this local result.

The original approved window is a hard monotonic deadline. Renewal can shorten
it but cannot extend it. A **3000 ms cleanup reserve is inside** the shorter of
the requested lease and remaining schedule window. For a ten-second requested
lease, unrenewed enforcement starts after seven seconds: up to 500 ms for an
inflight join to settle, 1500 ms for participant removal, and the remaining time
for sweep/IPC/SFU kill.
Normal three-second renewals refresh this early cutoff. Once early removal
starts, renewal or ticket issuance cannot revive the admission.

`requested_lease_ms` records the latest requested duration, `lease_ms` is the
remaining full client-authority duration, `enforcement_starts_in_ms` is the time
until early removal starts, and `cleanup_budget_ms` is always 3000. Returning a
positive full lease does not make a REMOVING/REVOKED admission usable. Clients
must subtract request duration and impose their own schedule boundary; showing
fallback earlier is safe. A lease never exceeds ten seconds. Creation rejects
leases or windows at or below the cleanup reserve. A renewal that shortens the
window into that reserve immediately revokes. Actual media termination within
the full original deadline still requires measured SFU/container runtime proof.
This conservative prototype can stop live playback up to three seconds before
the approved window ends and use its fallback until the actual boundary.
Production optimization is pending; it must preserve the maximum cutoff bound.

## Signaling and media enforcement

The signaling server defaults to `127.0.0.1:18780`. Connect the LiveKit browser
client to `signal_url`, passing the returned **opaque ticket** as its token.
Only `/rtc` and `/rtc/v1` WebSocket upgrades are forwarded. SDK `2.23.0` uses v1
with a compressed `join_request` by default. Each ticket is consumed before
asynchronous work. The gateway substitutes a tightly scoped internal JWT; raw,
replayed, or SDK-refreshed JWTs are rejected at the gateway.

`GET /rtc/validate` and `/rtc/v1/validate` validate an unused current ticket
without consuming it and never forward credentials upstream. They return CORS
only for an explicitly allowed exact origin. Packaged Electron's observed
`null` or `file://` origin must be explicitly configured; neither is a wildcard.

The SFU HTTP/signaling endpoint must bind loopback and be unreachable from client
networks. Its media ports remain reachable as configured. Public production
signaling must use trusted TLS termination and an explicit origin allowlist.
The explicit Backend mode supplies direct Node HTTPS/WSS with a validated
certificate/key; the default prototype remains loopback HTTP. No mode disables
certificate checks.

Before treating an SFU upgrade as connected, the adapter confirms that the
participant actually exists through the SFU control API. HTTP 101 alone is not
enough. Normal connection preparation retries transient read failures for up to
two seconds to tolerate a cold CPU-limited SFU. This does not extend authority or
the separate 500 ms cleanup barrier. If a client cancels while its upstream join is inflight, its admission
stays occupied until the join settles and final participant removal completes.
A `not_found` response before participant registration cannot free the slot.
An uncertain join after 500 ms forces node isolation to prevent late admission.
Half-closed sockets trigger the same cleanup as closed sockets.

Lease expiry runs independently of WebSocket connection state. Revocation and
expiry call the SFU RemoveParticipant API; closing signaling alone is not treated
as stopping media. Management requests time out after 1500 ms. Any removal
failure isolates the entire controller and invokes a required SFU isolation
command with a 750 ms timeout in standalone mode. The combined supervisor uses
private IPC and confirms actual SFU death instead. Isolation rejects all future admissions,
invalidates every ticket, and closes all signaling connections. Failure to run
the isolation command leaves health at `isolated` with
`isolation_complete: false`; it never reports successful enforcement.

Use the combined media-node Docker image for actual fault testing. Its separate
Node PID1 supervisor starts the SFU, waits for loopback readiness, and forks the
gateway/controller. The controller sends an increasing private IPC heartbeat
every 100 ms. The internal heartbeat expiry is 1800 ms, reserving 200 ms for
polling and process termination inside the external two-second target.
Controller exit, lost IPC, heartbeat expiry,
SFU exit, or an isolation request makes the supervisor **SIGKILL the SFU** and
terminate the controller. SIGTERM is insufficient for enforcement because
LiveKit normally drains existing rooms. No Docker socket is mounted. Stopping
the container/PID1 also removes its child processes through Docker.

The supervisor gives controller startup ten seconds before enforcing heartbeat
expiry only while no admission listener can exist. The controller emits its
first IPC heartbeat before listening; a ready controller immediately uses the
short deadline. Runtime faults never auto-restart a node into previous authority.
Run the SFU fresh on controller startup/restart; do not reuse an SFU that might
still carry media from a previous process. This package's in-process expiry loop
cannot enforce anything while its own process is dead. The independent Python
[host watchdog](deploy/HOST_WATCHDOG.md) enforces a pinned container when PID1
stalls. Its deployment/service/LSM permissions and restart rehearsal remain
explicit production gates.

The Linux supervisor keeps the gateway closed until the configured SFU TCP
listener's socket inode belongs to its actual spawned child, with the same
process start identity and network namespace. A foreign endpoint merely
answering TCP cannot establish readiness or become isolation evidence. Wildcard
and non-loopback listeners on the SFU service port are rejected. Missing required,
unreadable or unsupported `/proc` ownership proof refuses startup; do not relax
container security profiles to bypass that failure. Private network/PID
namespaces are preferred over host networking. Permission handling and alternate
Linux security profiles still require deployment verification.

## Runtime configuration

```text
LIVEKIT_API_KEY                     private SFU API key
LIVEKIT_API_SECRET                  private SFU signing secret
DARSHAN_MEDIA_CONTROL_SECRET_FILE   preferred private secret file
DARSHAN_MEDIA_CONTROL_SECRET        alternative process environment secret
DARSHAN_MEDIA_ISOLATE_COMMAND       standalone mode only: JSON argv, no shell
DARSHAN_MEDIA_SFU_CONFIG_FILE       combined container: private mounted SFU YAML
DARSHAN_MEDIA_SFU_URL               default http://127.0.0.1:18781
DARSHAN_MEDIA_SIGNAL_HOST           default 127.0.0.1
DARSHAN_MEDIA_SIGNAL_PORT           default 18780
DARSHAN_MEDIA_SIGNAL_URL            client URL, default ws://127.0.0.1:18780
DARSHAN_MEDIA_CONTROL_HOST          127.0.0.1 or ::1 only
DARSHAN_MEDIA_CONTROL_PORT          default 18784
DARSHAN_MEDIA_ALLOWED_ORIGINS       exact comma-separated presenter/player origins
DARSHAN_MEDIA_SUPERVISOR_HEARTBEAT_FILE  private runtime path outside source tree
DARSHAN_MEDIA_SUPERVISOR_STATE_FILE  supervisor-owned host-watchdog bindmount file
DARSHAN_MEDIA_HOST_LEASE_FILE        backend-only separate root-owned RO tmpfs host-readiness pulse
DARSHAN_MEDIA_NODE_INSTANCE_ID       fresh UUID matching media container labels
DARSHAN_MEDIA_AUTHORITY_MODE         prototype default; backend explicitly configured
```

The loopback control-host restriction above applies to the default prototype.
Backend mode's TLS, external authority and origin settings are mandatory; see
[Backend configuration](deploy/BACKEND_AUTHORITY.md). Its authority boot UUID is
generated by the supervisor separately from the managed container label UUID.

The supervisor-owned host-watchdog directory must be private mode 0700 on
**tmpfs** (production: `/run/darshan-media-watchdog/<fresh-instance-UUID>`), bound
read/write into the container. Both the Node supervisor and independent host
watchdog reject disk-backed state before media startup/readiness. Do not use a
repository directory, persistent volume, or ordinary disk-backed `/tmp` for
this runtime evidence. A container-only tmpfs without the host-readable bind
does not provide host supervision. See [Linux preparation](deploy/LINUX_MEDIA_NODE.md).

The optional supervisor heartbeat file is atomically replaced every 100 ms while healthy. It
contains only PID and monotonic elapsed time. The independent supervisor must
validate process ownership and file freshness; this file alone is not a security
boundary. The combined container uses private IPC instead of this file. Use a private runtime directory. Runtime secrets, certificates,
generated configuration and heartbeat files must never be committed.

## Verification

```sh
npm ci --ignore-scripts
npm run check
npm test
# Optional actual-SFU RPC/race checks: point to an existing private env file, never commit it.
# DARSHAN_MEDIA_REAL_SFU_ENV_FILE=/private/path/node.env node --test test/sfu-runtime.test.js
# Opt-in independent Docker fault nodes, sequential, alternate ports, no application fixtures:
# DARSHAN_MEDIA_DOCKER_FAULT_TESTS=1 node --test test/docker-fault-runtime.test.js
# Separately approved, bounded new-image protocol/SFU fixture (Linux media UID1000):
# DARSHAN_MEDIA_PROTOCOL_DOCKER_TESTS=1 \
# DARSHAN_MEDIA_PROTOCOL_BASE_IMAGE_ID=sha256:<verified-local-media-image-ID> \
# node test/run-protocol-runtime.mjs
# Combined container entrypoint; all credentials/configuration must be supplied privately:
npm run supervise
```

Tests exercise ticket replay, simultaneous ticket use, generation fencing,
monotonic expiry including the cleanup reserve and failed removal, immutable
window caps, v1 validation, explicit Electron origins, disconnect cleanup, teardown capacity,
participant limits, exact SDK grants, management timeout, isolation failure,
private control authorization and real local HTTP/WebSocket forwarding. Separate
process tests kill and suspend the controller and verify that the supervisor
kills the actual SFU child, including its explicit isolation IPC path.
Additional strict tests cover stop-before-create/check completion, stale
node/epoch/operation commands, canonical backend policy, delayed and hung fresh
checks, ticket reauthorization, explicit denial and retained teardown capacity.
Actual local HTTP tests exercise the same private control routes and late-grant
race. Real local verified HTTPS tests cover wrong CA/hostname, nonce/fence and
nonboolean decision rejection, total body timeout, control/WSS origin/ticket
handling and file-change isolation through an actual supervised child. These
do not establish cross-VM authorization or rendered cutoff timing.

The optional `sfu-runtime.test.js` suite uses unique temporary rooms on an
already-running loopback SFU. It delays actual upstream joining, cancels the
client midjoin, confirms the real participant and its permissions, performs a
final SDK removal, and verifies the room is empty. It also verifies actual SFU
presenter source grants and rejects a real internal JWT through the gateway.
It never stops the shared SFU or creates application/database fixtures. This
establishes RPC/signaling evidence, not video/audio media-cutoff timing.

The optional Docker fault suite uses the existing prototype image with current
source mounted read-only. Each case starts one uniquely named node at ports
19780–19784 with 256 MiB memory and 0.5 CPU, its own generated private keys and
configuration, and no internet dependency. It verifies controller SIGSTOP,
controller crash, and SFU management timeout/isolation against an actual SFU
participant. Host-watchdog cases additionally verify wrong-instance rejection,
healthy-Docker PID1 stall enforcement, stale-heartbeat enforcement while only
the watchdog's Docker wrapper is unavailable, and a healthy pinned namespace
surviving that isolated management outage before full-fence recovery. Direct
pidfd signaling may remain an explicit open gate when the invoking host/LSM
context denies it. The observer checks the actual host SFU process and listener,
validates the host/container monotonic clock domain, rejects OOM as enforcement
evidence, and writes sanitized timing/image/source hashes under `.local`.
It cleans only its own generated container and private directory. Native Linux
Docker Engine and `/proc` access are required for process evidence. These checks
do not claim rendered video/audio cutoff, production systemd/LSM coverage or
production capacity.

These tests are developer checks. Real SFU forwarding, media termination,
refreshed-token replay, presenter background behavior, capture/audio, packaged
Electron behavior, and supervisor failure require the running prototype. They
are not established by a mocked adapter or successful signaling handshake.

The package is not independently production-ready: admissions and tombstones
live in memory, scheduler authorization remains authoritative in the Backend,
and integrated durable outbox/reconciliation, production artifact deployment
and node admission rotation require their complete product paths and QA.

`run-protocol-runtime.mjs` is an opt-in developer verification runner. It checks
the local UNIX Docker endpoint and a supplied existing base image ID, builds an
offline source/test overlay (not a canonical production image), and starts only
its uniquely labelled 256 MiB/1 CPU node. The container uses private network/PID
namespaces, UID1000, a read-only root and a private tmpfs watchdog bind; it maps
no host ports. Image/package/source hashes and container identity are checked
before probes or fault injection. Its test-only strict verifier performs a real
loopback HTTP nonce exchange; it does not authenticate production database policy.
Actual SFU participant/permission/removal and replacement checks precede a
healthy-Docker host-watchdog PID1 STOP measurement. Sanitized evidence lives
under ignored `.local/live-broadcast`; private fixture credentials/state and only
the owned container/base alias are cleaned. The new developer image is retained
for inspection. Direct pidfd actuation permissions, rendered frames/audio and
physical displays remain separate gates. Do not run it without coordinating
the machine's build/test resource window.
