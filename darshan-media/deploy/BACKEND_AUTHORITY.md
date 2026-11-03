# Backend authority transport

This configures the media side of the live runtime protocol. Enable it only
after the matching Backend authority/outbox, normal player, host watchdog,
restore reconciliation and network controls have been verified together.
The default `prototype` mode continues to require loopback HTTP interfaces.

## Private inputs

Mount a bounded private regular JSON file, owned by root or the media UID and
mode 0600 (no symlinks or hardlinks), outside PostgreSQL and source/artifacts:

```json
{"version":1,"epoch_id":"<restore-authority-UUID>","authority_secret":"<32-random-bytes-as-canonical-base64url>"}
```

The same epoch/authority secret is independently provisioned to the Backend.
The secret is exactly 43 base64url characters without padding. It is distinct
from the media control secret, LiveKit signing secret and any host death-witness
secret. The latter must not be mounted into the media container. Files containing
private keys or control secrets have the same private ownership/mode policy.
Certificate/CA files may be readable but must not be group/world writable.

```text
DARSHAN_MEDIA_AUTHORITY_MODE=backend
DARSHAN_MEDIA_AUTHORITY_FILE=/private/live-authority.json
DARSHAN_MEDIA_BACKEND_AUTHORITY_URL=https://<trusted-backend-host>/api/v1/internal/live-authority
DARSHAN_MEDIA_BACKEND_CA_FILE=/private/site-ca.pem     optional if system trust suffices
DARSHAN_MEDIA_CONTROL_SECRET_FILE=/private/media-control-secret
DARSHAN_MEDIA_TLS_CERT_FILE=/private/media-fullchain.pem
DARSHAN_MEDIA_TLS_KEY_FILE=/private/media-key.pem
DARSHAN_MEDIA_SIGNAL_URL=wss://<trusted-media-host>:<signal-port>
DARSHAN_MEDIA_CONTROL_HOST=<explicit-numeric-interface>
DARSHAN_MEDIA_CONTROL_PORT=<explicit-control-port>
DARSHAN_MEDIA_SIGNAL_HOST=<explicit-numeric-interface>
DARSHAN_MEDIA_SIGNAL_PORT=<explicit-signal-port>
DARSHAN_MEDIA_ALLOWED_ORIGINS=https://<cms-origin>,null,file://
DARSHAN_MEDIA_HOST_LEASE_FILE=/run/darshan-media-host-lease/lease.json
```

Use the existing supervisor/SFU/watchdog inputs documented in
[Linux preparation](LINUX_MEDIA_NODE.md). The supervisor creates
`DARSHAN_MEDIA_AUTHORITY_INSTANCE_ID` in the child's private environment; do not
set/reuse it as deployment configuration. `DARSHAN_MEDIA_NODE_INSTANCE_ID`
remains the managed host/container label UUID. Every supervisor process creates
a fresh authority UUID before launching either child. The configured state file
must be on a private host-readable tmpfs bind. Backend mode refuses standalone
startup without supervisor IPC, distinct valid identities and that state path.

Backend mode also requires an independently host-written readiness pulse on a
**separate root-owned read-only tmpfs bind mount**. The host lease directory and
all ancestors must be root-owned without group/world write access; the regular
bounded JSON file is root-owned, normally mode 0644, never symlinked/hardlinked
or group/world writable. The media UID must not own or write this mount. Linux
`/proc/self/mountinfo` proves the deepest matching mount is read-only tmpfs;
conflicting stacked mounts fail closed. Do not reuse the media-owned RW
supervisor heartbeat directory. Example pulse (no host witness key is present):

```json
{"version":1,"node_instance_id":"<fresh-supervisor-authority-UUID>","managed_instance_id":"<managed-label-UUID>","sequence":1,"ready":true}
```

The host watchdog emits this pulse only while its independently supervised death
witness and verified pinned media process are ready. Both controller and
supervisor independently require two advancing exact-identity pulses before
arming. Until then, authenticated health returns 503/`starting` with boot metadata
for host discovery and all grants are denied. After arming, any invalid/missing
pulse, wrong boot/managed identity, sequence regression, or more than 1000 ms with
no observed advancement permanently isolates/kills the old SFU. New pulses
cannot re-arm it. Clock freshness is measured on each Node process's monotonic
clock, never from timestamps in the host file. A stalled Node process cannot
accept a fresh replacement pulse to hide its missed enforcement interval. The
controller checks before **and after** each asynchronous Backend authority call;
the separate supervisor polls even if the controller is stuck. The 100 ms polling
and existing process-kill bounds remain additional measured runtime obligations.
Prototype and explicitly injected strict test authority remain ungated. Tests
with injected root file metadata are not actual Docker/host file-ACL proof.

Both control and signal listeners use the provided TLS certificate/key, with
TLS 1.2 minimum. The certificate must be currently valid and cover the advertised
WSS hostname/IP. Backend mode permits explicitly configured nonloopback numeric
interfaces only with TLS. Firewall control ingress to Backend hosts, expose
only the required WSS/media paths to presenters/players, and keep the SFU HTTP
listener numeric loopback inside its private network namespace. The supervisor's
actual child-owned LISTEN proof remains required. No hostname/IP is inferred.
There is no certificate bypass or automatic insecure HTTP fallback.

## Authority calls and control evidence

Each CREATE/RENEW/TICKET sends a new HTTPS POST to the fixed authority URL with
header `x-darshan-live-authority-secret` and JSON:

```text
{action,nonce,id,run_id,generation,node_instance_id,authority_epoch,operation_revision}
```

The response is plain JSON (not a generic API success envelope). It must echo
all fields except `action` (optional, but must match if supplied) and return a
boolean `allowed`. `allowed: true` also requires canonical `participant_id`,
`role`, `audio: {microphone,screen_share_audio}`, `lease_ms` and
`window_remaining_ms`. The Backend checks its current frozen policy and session
for every call. CREATE outbox payloads carry no replayable grant. A worker must
discard the initial CREATE ticket; client ticket requests need a fresh check.
Authority transport/response handling is bounded to 1500 ms including the body
(8192-byte maximum); verification consumes the existing maximum ten-second
lease. The 3000 ms early cleanup reserve remains inside that deadline.

All routes require `x-darshan-media-secret` and reject any browser Origin:

```text
GET    /internal/health
POST   /internal/admissions                         {id,run_id,generation,...fences}
POST   /internal/admissions/:id/renew               {run_id,generation,...fences}
POST   /internal/admissions/:id/ticket              {run_id,generation,...fences}
DELETE /internal/admissions/:id                     {run_id,generation,...fences}
GET    /internal/admissions/:id
POST   /internal/runs/:run_id/revoke                 {generation,...fences}
GET    /internal/runs/:run_id?generation=<integer>
```

`fences` means `node_instance_id,authority_epoch,operation_revision`. Responses
include `protocol_version:1,node_instance_id,authority_epoch`; targeted evidence
also includes `run_id,generation` and admission identity. Health additionally
reports `managed_instance_id`, authority mode, readiness/isolation, occupied
runs, pending checks and permanent-state headroom. Only exact pinned old-node,
epoch, run and generation evidence with `teardown_confirmed === true` can release
that node's durable capacity. Logical REVOKED, an unreachable node, requested
isolation or a new node reporting no admission cannot release old occupancy.
Health alone does not prove the external watchdog or physical display works.

The default 10000 retained admission/run keys are never evicted. Health refuses
new runs before exhaustion when fewer than 270 remain; current runs retain
their renewal path. Scheduling must preflight `status=ready`, expected epoch,
`authority_mode=backend`, fresh boot identity and `accepting_new_runs=true`.
The hard limit still isolates. Operators must retire a quiescent node only after
confirmed teardown and start a new supervised instance. This is an explicit
maintenance limitation until production lifecycle automation is verified.

## Restart and recovery

Any read failure or authority-file inode/device/content/permission change
isolates the current node. Configuration and certificates are loaded at startup;
there is no hot authority/certificate reset. Do not replace live files as a
rotation shortcut. Stop and observe old media death first. On database restore,
rotate the external epoch, authority secret and LiveKit signing secret, provision
matching private files, reconcile durable occupied runs, and launch a new
managed container/watchdog with a fresh authority boot UUID. Never auto-resume a
restored admission. Keep host witness credentials outside the media container.

Focused tests use ephemeral locally verified HTTPS certificates and actual
supervisor child processes. They establish TLS/nonce/fence/file-change behavior,
not integrated production Backend authorization, cross-VM firewall correctness,
host-service/LSM permissions, rendered frame/audio cutoff or production capacity.
