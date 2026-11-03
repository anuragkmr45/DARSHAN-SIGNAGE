# Independent media host watchdog

`host-watchdog.py` uses Python 3 standard library and Docker CLI. It runs on the
Linux media host, outside the container and outside the supervisor event loop.
No host Node installation is needed. The systemd template is supplied but is
not installed by the developer tests.

## Fenced runtime configuration

Create a fresh instance UUID and a fresh private heartbeat directory for each
media-node deployment. Run the media container with automatic restart disabled,
its own private PID namespace, and a media service UID/GID that owns the state
directory. The directory must be mode 0700; heartbeat files are atomic mode 0600.
It must be on **tmpfs**, normally
`/run/darshan-media-watchdog/<fresh-instance-UUID>`. The supervisor checks the
actual filesystem before starting either child. The host watchdog independently
checks the host mount before inspecting the target or reporting readiness. A
disk-backed directory is a configuration rejection, not a longer grace period.
Do not reuse a previous instance's state directory or resume previous authority.

Required container configuration:

```text
label com.darshan.media.managed=1
label com.darshan.media.role=media-node
label com.darshan.media.instance=<fresh UUID>
restart policy: no
PID mode: private (default); never host or container:<other ID>
DARSHAN_MEDIA_NODE_INSTANCE_ID=<same fresh UUID>
DARSHAN_MEDIA_SUPERVISOR_STATE_FILE=/run/darshan-media-watchdog/supervisor.json
bind mount <private host directory>:/run/darshan-media-watchdog (read/write)
```

The media UID must own the directory inside and outside the container. A root
container therefore needs a root-owned state directory. A container run as a
dedicated UID needs that UID's private directory. The host watchdog receives the
expected numeric UID explicitly. The older controller-owned
`DARSHAN_MEDIA_SUPERVISOR_HEARTBEAT_FILE` is **not** this watchdog's input.

The systemd template creates the shared `/run/darshan-media-watchdog` parent
(0755) and preserves it across watchdog restarts. Deployment must create a fresh
0700 child owned by the media UID **before** starting the container. The supplied
environment path must name that child; the unit does not invent an instance or
change ownership of an existing media directory. See the
[Linux media-node preparation](LINUX_MEDIA_NODE.md).

Resolve the full 64-character ID of the just-created media container. Start the
watchdog with that exact ID and UUID, not a name, name prefix, image search, or
the first matching container:

```text
python3 /opt/darshan/media/host-watchdog.py
  --container-id <full created container ID>
  --instance-id <fresh UUID>
  --heartbeat <private host directory>/supervisor.json
  --heartbeat-uid <numeric media UID>
  --docker-context default
```

This is a multiline argument description, not a shell script. For production,
place the pinned values in `/etc/darshan/media-watchdog/<instance>.env`, mode
0600, using the variable names in `darshan-media-watchdog@.service`. Start the
matching unit and require its `watchdog_ready` evidence before enabling live
starts. Installing the template, wiring deployment startup/readiness, and
measuring service restart remain deployment acceptance work; this prototype
does not install a system service or automatically enable production live.

## Authority and timing

The supervisor writes its own state before starting either child, then every
100 ms. The controller publishes its first IPC heartbeat before opening its
admission/signaling listeners. Cold-start grace applies only before admission
readiness; ready controllers use the short runtime deadline immediately.

The host checks `/proc/uptime` (CLOCK_BOOTTIME), host boot ID, PID1 process start
ticks, increasing sequence, and the fixed instance. A missing/stale/invalid
heartbeat invokes enforcement. Stale threshold is 1500 ms, polling 100 ms, with
a bounded one-second enforcement budget inside the three-second host cutoff
target. Both the host monitor and supervisor writer reject their own boot-clock
gap over 1500 ms. A fresh write after host sleep cannot hide a missed liveness
interval. Whole-machine suspend/resume is covered by policy units only until an
actual separate-backend rehearsal is performed.

The initial missing-file grace is at most 1500 ms. Long legitimate SFU startup
can continue while fresh STARTING heartbeats arrive; a supervisor that cannot
write its first heartbeat cannot start media children.

The tmpfs rule follows an actual idle-node diagnostic: a disk-backed ext4 run
stalled with PID1 in `folio_wait_bit_common`/`rq_qos_wait`, increasing cgroup I/O
pressure, and unchanged CPU-throttling/memory-event counters. A parity tmpfs run
completed four minutes and deliberate PID1 STOP enforcement. This establishes
the observed I/O wait, not the exact blocked syscall or underlying disk cause.
Using volatile state removes that disk-backed heartbeat path; it does not prove
that every possible host scheduling or I/O fault has been eliminated. The
watchdog continues to fail closed at the same deadlines.

## Safe actuation

Before it can kill anything, the watchdog requires a local Unix Docker endpoint
and freezes its resolved socket inode. SSH/TCP endpoints are rejected. It proves
that Docker's host PID belongs to the full container ID's Linux cgroup and is
PID1 in a private PID namespace. It also verifies labels, instance environment,
the exact private bind mount, restart policy, and process start ticks. Native
Linux Docker Engine is required. Docker Desktop/remote/rootless PID domains
that cannot prove these relationships are rejected rather than guessed.

The watchdog pins a Linux pidfd at initial verification and checks signal
permission without mutating the process. On enforcement it first rechecks the
Docker target and requests SIGKILL by full container ID. If Docker CLI/daemon
is unavailable, it revalidates the original boot ID, cgroup, start ticks and PID
namespace, then signals only the held pidfd. It never reopens a numeric PID or
looks up a replacement by name. Linux private-namespace PID1 death terminates
that namespace's children. A dead pinned handle cannot signal a reused PID.
The periodic Docker identity check reports `DOCKER_OPERATION_UNAVAILABLE` as a
degraded management-plane condition. During that condition the watchdog keeps
checking the immutable pidfd, supervisor heartbeat, its own monitor cadence and
the independent host-witness lease. A dead pidfd ends monitoring immediately;
stale heartbeat, stalled witness or monitor suspension still enforces through
the pinned path. When Docker recovers, the full target identity/start fence is
revalidated before a recovery event is emitted. Invalid identity, response or
fence data is never classified as an outage. This prevents a Docker daemon
restart from terminating healthy media without treating an unpinned process as
trusted. Backend admission renewals remain the media-authorization cutoff and
do not depend on Docker management-plane availability.
If the pidfd signal is denied after a Docker kill request, the watchdog still
observes the held handle until the same original enforcement deadline. A
concurrent confirmed exit is reported as `watchdog_pinned_exit_observed`, not as
successful pidfd actuation. A still-live handle remains unconfirmed.

Unexpected target/label/namespace/endpoint changes prevent destructive Docker
actuation. Unsupported pidfd operations, insufficient privileges, denied LSM
signals, or inability to prove termination produce an explicit unconfirmed
result. There is no unsafe `os.kill(numeric PID)` fallback and no silent success.
An administrator must run the host service as root or with appropriate process
signal/read privileges and an approved LSM context. Docker access is itself a
privileged capability.

## Evidence and limits

Backend-mode schema-1 heartbeats may additionally include
`authority_node_instance_id`, a valid UUID generated fresh by the supervisor for
that process start. Old heartbeats without it remain supported. If present it
must remain identical on every sample; the managed `instance_id` still matches
the pinned Docker label/environment. The optional field does not itself prove
Backend authorization or release old-node capacity and is not a host death
witness. Host witness credentials must remain outside the media container.

Python units cover wrong labels/instance/mounts, local versus remote endpoint,
cgroup/namespace checks, ownership/mode, symlink/hardlink, future/foreign clocks,
sequence replay, long own-monitor gaps, rejected pidfd fences and dead-handle
reuse safety, plus a real delayed child exit after denied signaling and a denied
still-live child. Node units cover atomic supervisor state, unsafe directory refusal,
resume gap refusal and first controller heartbeat/readiness ordering.

The opt-in Docker suite uses only uniquely named test nodes on ports 19780–19784
with 256 MiB and 0.5 CPU. It verifies actual PID1 STOP state, then actual SFU host
process death/listener closure and full namespace termination. One case fails
only that watchdog's private Docker CLI wrapper after verified pinning and then
stalls PID1, proving stale-heartbeat enforcement still uses the pinned path.
Another leaves PID1 healthy during the same isolated Docker-inspection outage,
proves the SFU remains available beyond the former one-second cutoff, restores
inspection, and requires a recovered full-fence event. These tests never stop
the host Docker daemon. Wrong instance input first proves that an
unrelated/falsely identified target is not killed.

Successful Docker-mediated host-stall enforcement has been observed locally.
The initial direct-pidfd experiment from the Codex application's `chatgpt` LSM
context returned EACCES at SIGKILL despite permission-free pinning and signal 0.
That result is unconfirmed enforcement, not a pass. Host-service/LSM permission
and actual direct-pidfd runtime evidence must be assessed in the chosen host
context; an altered test-container profile cannot establish the production
profile's permission. Preserve this distinction in QA evidence.

The watchdog process itself must be supervised. The supplied unit restarts
unexpected failures after 250 ms and refuses to restart known configuration
errors. It uses `Wants=docker.service` with `After=`, so an explicit Docker stop
does not stop the watchdog and disable its independent pidfd fallback.
Watchdog death/systemd restart and host scheduling under production load
have not been rehearsed by merely testing the Python process. Stop the watchdog
only after the pinned media node has stopped. No service installation or full
production host-watchdog sign-off is claimed.
