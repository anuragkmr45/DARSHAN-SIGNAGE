# Linux media-node runtime preparation

This is preparation for the sixth VM's media prototype. It does not install or
enable a production service, implement the production artifact bundle, or close
the deployment acceptance gates.

Use native Linux Docker Engine, the pinned media image, and a fresh node instance
UUID. The host and container must share the native PID/boot clock domain. Keep
API credentials and SFU configuration in private persistent files; keep
supervision evidence on a separate **tmpfs** runtime directory.

Before starting the media container:

1. Verify `/run` is mounted as tmpfs. A path name alone is insufficient; both
   supervisor and host watchdog check the actual filesystem.
2. Prepare `/run/darshan-media-watchdog` as a root-owned 0755 parent. Create a
   fresh UUID-named child, mode 0700, owned by the dedicated media UID/GID used
   by the container. Do not reuse old child directories after a node restart.
3. Bind that exact child read/write to `/run/darshan-media-watchdog` inside the
   container. Set `DARSHAN_MEDIA_SUPERVISOR_STATE_FILE` to
   `/run/darshan-media-watchdog/supervisor.json` and
   `DARSHAN_MEDIA_NODE_INSTANCE_ID` to the new UUID. The media container must
   have a private PID namespace and restart policy `no`.
4. Pin the created full container ID and same UUID in the host-watchdog unit's
   private environment file. Set `DARSHAN_MEDIA_HOST_HEARTBEAT_FILE` to the
   **host** path `/run/darshan-media-watchdog/<UUID>/supervisor.json` and set
   `DARSHAN_MEDIA_HOST_HEARTBEAT_UID` to the numeric media UID.
5. Start the watchdog and require its `watchdog_ready` event before enabling
   live starts. If either component rejects the filesystem or ownership, fix
   deployment configuration. Do not lengthen the stale threshold or disable
   the check.

The supplied watchdog unit creates/preserves the shared runtime parent through
`RuntimeDirectory=darshan-media-watchdog`; deployment still prepares the private
instance child before the container starts. The unit takes its heartbeat path
from the environment file. It neither guesses a container nor creates a usable
media instance. A separately mounted tmpfs only inside Docker cannot be read by
the host watchdog and is insufficient.

The runtime directory is intentionally volatile. After reboot, start a new
instance, generate fresh authority, and prepare a new directory; never recover
admissions from heartbeat files. Stop the pinned media node before stopping its
watchdog. Remove only that retired instance's directory after verifying the node
is stopped. Do not remove the shared parent while other instances exist.

Trusted HTTPS/WSS, firewall/media ports, local-only SFU signaling, exact origin
allowlists, offline image packaging, root/systemd/LSM pidfd permissions, watchdog
restart, and representative load/fault measurements remain deployment work.
The local diagnostic directly observed disk I/O wait on a disk-backed heartbeat
path; tmpfs removes that known path without relaxing fail-closed deadlines or
claiming that all host stalls are impossible.
