# Sixth Media VM: offline deployment and recovery

This optional role adds the on-prem WebRTC media VM to the existing Data,
Valkey, Backend, CMS and Observability VMs. The ordinary desktop player remains
the installed player. Media is transported by the on-prem SFU; PostgreSQL and
immutable approved schedule policy remain authoritative. No Internet/CDN,
public STUN or public TURN service is configured.

The artifact contains a signed Docker image archive and host scripts. It does
not contain authority epochs, live signing/control/witness credentials, TLS
private keys or runtime state. Successful packaging does not close load,
cross-VM, physical display/audio, Windows, restore or host LSM acceptance gates.

## Build and transfer

Use the canonical private `deploy/production/bundle.env` input and set:

```dotenv
INCLUDE_LIVE_MEDIA=true
EXPORT_MEDIA=true
MEDIA_PRIVATE_HOST=media.site.example
MEDIA_BIND_ADDRESS=192.168.128.60
MEDIA_CONTROL_PORT=18784
MEDIA_SIGNAL_PORT=18780
MEDIA_RTC_TCP_PORT=18782
MEDIA_RTC_UDP_PORT=18783
MEDIA_CPU_LIMIT=4
MEDIA_MEMORY_LIMIT=4g
MEDIA_PIDS_LIMIT=512
MEDIA_MIN_FREE_DISK_BYTES=10737418240
```

These addresses/resource values are examples, not measured sizing. Replace
them with the six real VM addresses, DNS and approved site resource policy.
The 10 simultaneous broadcasts ×25 players target still requires measured QA.
`MEDIA_PACKAGE_DIR` defaults to `out/<release>/media`; `EXPORT_MEDIA=false`
consumes an already exported package. Media and Backend packages must have the
same clean source commit. The exporter builds the repository Dockerfile with
digest-pinned Node20 and SFU1.13.11 bases, saves its exact image and records
source/lockfile/archive provenance. The ordinary signed image loader checks the
archive, Docker configuration digest, architecture and OS; no pull occurs on
the target. `--skip-docker` output is deliberately not deployable.

The output adds `production/media/` and signed
`transfer/<site>-<release>-media.tgz`. Install it with the existing pinned-key
`install-signed-role.sh --role media`; transfer verification and extraction
rules are the same as other roles. The Recovery role remains a stateless
utility and does not require a seventh always-running VM.

## Prepare target-only private files

Install native Linux Docker Engine, Compose, Python3, OpenSSL, curl, jq,
systemd and standard util-linux tools before entering the air-gapped network.
Use the approved normal host security profile. Do not disable AppArmor/LSM or
container isolation to obtain a passing result.

On Backend, from its new signed role directory:

```bash
sudo python3 ./provision-live-private.py backend --metadata ./LIVE_RUNTIME.json
```

It creates `authority.json`, `control-secret` and `witness-secret` under
`/etc/darshan/sites/<site>/live/backend`. It never overwrites an existing role
directory or rotates a live epoch. Install `site-ca.crt` there as mode0600 owned
by the **effective Backend process UID**. The exported production entrypoint
starts root then drops API/worker to node UID1000. A custom/direct local image
may instead remain UID0: inspect it and provision a separate correct-owner
copy. Never weaken the strict private-file guard to share a wrong-owner file.

Securely copy the three generated inputs to root-owned mode0600 import files
on Media using an approved private transport. The authority JSON/control secret
are independent byte copies of the same logical values, not a shared filesystem.
Never paste them into chat, tracked `.env`, source or artifact folders.

On Media, from the installed role directory:

```bash
sudo ./prepare-host.sh
sudo python3 ./provision-private.py media --metadata ./role.json \
  --authority-import /secure/import/authority.json \
  --control-import /secure/import/control-secret \
  --witness-import /secure/import/witness-secret
```

The Media container runs UID1000. Its authority/control/signing/TLS inputs live
under `.../live/media`, private UID1000 mode0600. The host witness secret and
persistent proof outbox live under separate `.../live/host`, root-only mode0700;
that directory is **never** mounted in the container. Provisioning generates a
new Media TLS key/CSR and LiveKit signing secret on the target. Issue the CSR
with the existing site CA and install `media.crt` covering the actual advertised
hostname/IP, plus `site-ca.crt`, in the Media input directory, UID1000 mode0600.
Install an independent root-owned mode0600 CA copy in the host directory for
witness HTTPS. Do not create a self-signed fallback or regenerate the site CA.
Verify the certificate/key public keys match and certificate lifetime/SANs.
Keep imports protected according to site secret retention policy.

## Start and activate

```bash
sudo ./load-images.sh
sudo ./start.sh
sudo ./health-check.sh
```

Preparation installs the updated watchdog parser **before** backend-mode
heartbeats are used. Startup creates a fresh managed UUID, private UID1000
tmpfs heartbeat child and a separate root-owned tmpfs readiness child. The
container has private PID/network namespaces and restart policy `no`; SFU
HTTP18781 stays loopback-only inside it. Host units pin the exact full Docker
ID, image digest, host PID/start ticks, boot and authority boot UUID.

The host witness arms a pidfd and validates authenticated HTTPS boot metadata
against the protected supervisor heartbeat. Its advancing root marker is
checked by the independently pinned watchdog. Only then does the watchdog
emit advancing readiness leases into a root-owned directory mounted read-only
by Media. Before a fresh host lease, health is not ready and no grant is issued.
The Node side measures sequence progress on its own monotonic clock. A stalled
or lost host lease isolates the node permanently; restarting an old watchdog
does not revive its admissions. Neither wall-clock rollback nor a static marker
can renew authority. Stop the exact old node and create a new instance.

The watchdog also revalidates Docker identity periodically. Docker CLI/daemon
unavailability is a degraded management-plane condition while the immutable
pinned pidfd, fresh supervisor heartbeat and independent root witness continue
to prove the same process. Pinned-process death, stale heartbeat, host-loop
failure or Backend admission-renewal loss remains fail-closed. On Docker
recovery the watchdog revalidates the full identity and start fence. Treat
long-lived or repeated
`watchdog_docker_inspection_degraded` events as a Media VM health incident even
when a matching `watchdog_docker_inspection_recovered` follows. The packaged
Media health check fails while the latest ordered watchdog state has an
unmatched degradation and returns healthy only after full-fence recovery or a
freshly pinned `watchdog_ready` service invocation.

Backend live runtime is default OFF. After verifying the host security profile,
TLS/firewall, signed image, player rollout and release acceptance, explicitly:

```bash
# Backend role directory; uses the optional signed Compose overlay.
sudo ./live-runtime.sh enable
```

Both API and worker receive identical epoch/control files in the same model.
`./live-runtime.sh disable` recreates them using the ordinary default-OFF model.
An ordinary `./start.sh` also uses that OFF model; reactivation is deliberate.
Disabling Backend cannot immediately prove old Media stopped: its bounded
renewal leases still fail closed, and durable slots remain held until observed
teardown or an authenticated host death witness. Never manually free slots.

## Durable media boot and death ordering

The Backend durably registers every verified Media health sample, even while
there is no live run. The record binds node UUID, managed-instance UUID,
authority epoch and the configured control-endpoint fingerprint. Health
registration and death-witness acceptance use the same node-scoped database
lock, so neither can race past the other's fence checks.

The host witness may legitimately report the pinned process exit before the
Backend's first health poll. When its credential, epoch and boot metadata are
valid, the Backend records that node as already dead and acknowledges the
proof. A later health response with that UUID is rejected; operators must
prepare a fresh node and managed-instance UUID. Never reuse an observed-dead
UUID, change an existing UUID's endpoint or managed identity, or treat an old-
epoch witness as proof for the current authority.

## Network policy

Allow only the site networks that actually need each path:

| Direction | Port/path | Purpose |
|---|---|---|
| Backend→Media | HTTPS TCP18784 | fixed control/health, shared control credential |
| Media→Backend | HTTPS API port, `/api/v1/internal/live-authority` | fresh nonce grant checks |
| Media host→Backend | HTTPS API port, `/api/v1/internal/live-media-witness` | host-only proof upload |
| CMS browsers/players→Media | WSS TCP18780 | signaling |
| CMS browsers/players↔Media | UDP18783 and TCP18782 | encrypted WebRTC media/ICE fallback |

Block control18784 from player/browser subnets. Do not publish SFU HTTP18781,
Docker API, host witness files or its key. Docker-published ports can bypass
ordinary UFW rules: enforce and verify equivalent upstream/DOCKER-USER rules,
IPv4/IPv6 and return paths. RTC ports must be preserved end to end. Explicit
`node_ip` is the real on-prem Media address, `use_external_ip:false`, STUN and
TURN lists empty. The pinned SFU configuration guidance is derived from its
[official sample](https://github.com/livekit/livekit/blob/v1.13.11/config-sample.yaml).
Validate candidate routing from every player VLAN; no external discovery is
silently enabled when routing fails.

## Planned stop, update and durable death proof

Use `sudo ./stop.sh` while the witness is armed. It stops only the pinned full
container ID, verifies Docker stopped, then stops its watchdog. The separate
witness remains alive to observe its held PID1 handle's exit and persist one
immutable proof UUID/body. A root-only timer retries bounded verified HTTPS if
Backend is unavailable. ACK metadata is separate; retries preserve the original
run boot/epoch and proof, even after restore. The Backend matches the recorded
old boot and never releases a replacement node because an old proof arrived.
Logical REVOKED, missed heartbeat, a new node's empty state, daemon failure and
an unproven/reused PID never constitute physical death. Failed witnesses retain
occupied capacity and report pending evidence.

For an upgrade: stop old Media with its armed host witness, retain its logs,
root-only outbox and exact image metadata, install the new signed role, install
the updated watchdog before starting it, then start a new managed UUID. Do not
overwrite private credentials or the site CA. Do not prune old evidence or use
`docker compose down -v`. A native host reboot requires fresh volatile tmpfs
instance state; an old unresolved boot remains held pending valid evidence or
an approved recovery procedure. Do not auto-resume restored admissions.

## Database restore and rollback

Before restoring, stop and observe old Media namespace death and retain its
host evidence. Keep Backend live runtime OFF. Restore PostgreSQL and immutable
fallback objects using the approved independent rehearsal. Generate a **new**
external epoch, authority secret and LiveKit signing secret on protected target
paths, provision independent matching Backend/Media copies with proper owners,
and restart both Backend processes and a fresh Media instance. Existing file
changes fence old processes; there is no hot-reset shortcut. Reconcile old
durable slots using their matching old-node teardown/death proof; old-epoch
pending Start/Stop/Enable and admissions must be rejected. Confirm with real
players that no old ticket/frame survives and ordinary fallback still works.

Before a DB migration, an old prepared image can be selected after compatibility
review. After migration, follow the approved database/object recovery plan;
starting an old image is not a schema rollback. During any failed media update,
leave live runtime OFF, stop the exact new node, preserve evidence and keep
approved ordinary player fallback. Missing/corrupt fallback displays Content
unavailable for the approved live window.

Host watchdog Docker-mediated death evidence can be verified locally. Direct
pidfd SIGKILL under the chosen systemd/LSM profile remains an explicit release
gate until measured; the Codex desktop AppArmor denial is not a passing host
actuation result. Host suspend/resume, watchdog service death/restart, actual
frame/audio cutoff, monthly/pre-release restore and10×25 sustained capacity
still require integrated QA. Documentation and unit tests do not close them.
