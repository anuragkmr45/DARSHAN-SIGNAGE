# Recovery target restricted SSH relay (Packet 05B1b2b)

## Boundary and fixed trust

The Backend host owns a dedicated native `recovery-target-relay-listener`. It
takes no arguments. Its compiled constants bind the site, Backend installation,
policy, listener and worker digests, protected relay-config digest,
`known_hosts` digest, relay public-key fingerprint, and destination identity.
The listener is the sole writer of its Unix pathname. The canonical socket
parent is `root:<runner-group>` mode `0710`; the socket is
`root:<runner-group>` mode `0660`. Admission requires the exact recovery-runner
UID from `SO_PEERCRED`; backlog and live children are four.

The listener holds an OFD-locked, fsynced authority record from before bind
through bounded child drain/reap and exact socket preservation. Existing
authority is accepted only when its strict bindings and metadata remain exact;
it is never chmod/chown repaired. A live competing lock, corrupt record,
existing pathname, replaced inode, or unsafe ancestor fails closed. Normal
TERM/INT renames the exact socket with `RENAME_NOREPLACE` to `.closed.*` and
fsyncs the parent. Crash-orphan and replacement pathnames remain evidence; the
listener never unlinks them.

Each accepted stream gets one fixed Node worker in a new process group created
on both sides of the fork gate. The native parent is a child subreaper, records
the PGID before releasing the gate, and retains the group slot while any
descendant remains. Before `execve`, the child
closes all unrelated descriptors, clears supplementary groups, drops to the
dedicated relay account (which is neither the application nor Docker account),
clears capability bounding/permitted/effective/inheritable/ambient state, and
sets no-new-privileges. Shutdown signals the whole group, reaps direct and
adopted descendants, and requires a negative group-existence probe before
authority/socket release. If a group somehow survives bounded KILL, the
supervisor fail-stops while retaining authority rather than publishing clean
shutdown evidence. Production executable and worker paths are compiled
constants. Tests can replace the subprocess factory in-process; no production
environment variable can replace `/usr/bin/ssh`.

## One-shot exchange

The worker receives exactly one strict canonical JSON frame, at most 64 KiB,
terminated by one newline and EOF. It buffers and validates the entire frame
under the absolute five-second incomplete-frame timer before creating SSH.
Cancellation before that point creates no SSH process. The installed relay
config is a canonical bounded root-owned, relay-group-readable file beneath a
canonical protected directory. It fixes site and both host installation IDs,
destination, port, user, host-key alias, enrolled host/public-key fingerprints,
known-hosts and identity paths, forced-command contract, host-IP policy, and
connect/action/response deadlines. Unknown fields, metacharacters, relative or
noncanonical paths, unsafe modes, wrong ownership, links, or unstable metadata
are rejected.

SSH uses a scrubbed three-variable environment and the fixed option set:

- `-F /dev/null`, `BatchMode=yes`, `IdentitiesOnly=yes`;
- fixed `IdentityFile`, `UserKnownHostsFile`, `HostKeyAlias`, port, user and
  destination; `GlobalKnownHostsFile=/dev/null`,
  `StrictHostKeyChecking=yes`, and explicit `CheckHostIP=yes|no`;
- password, keyboard-interactive and GSSAPI authentication disabled;
- agent/X11/port forwarding, tunnel and local command disabled;
- no TTY, control master/path, host-key updates, proxy command or proxy jump.

There is deliberately no client command after the destination. The Data-side
stdio bridge rejects every nonempty `SSH_ORIGINAL_COMMAND` before connecting;
unset or empty is the only accepted forced-command state. The dedicated
Data-host account must install this exact authorized-key policy:

```text
restrict,command="/usr/local/lib/darshan-recovery-target/recovery-target-stdio" ssh-ed25519 <enrolled-public-key>
```

Where `restrict` is unavailable, the reviewed equivalent is
`no-pty,no-port-forwarding,no-agent-forwarding,no-X11-forwarding,no-user-rc`
plus the same forced command. No `environment=` option is permitted. The forced
command must reject nonempty `SSH_ORIGINAL_COMMAND`; this relay sends none.

The complete request is written to SSH stdin and stdin is closed. An error
listener exists before the first write, and the outcome becomes uncertain
immediately before that write attempt because bytes may enter the pipe even if
its callback fails. Stdin/action/response/shutdown failures perform bounded
TERM, then KILL, and await child close without clearing the action timer early. The worker
accepts one strict canonical response, at most 128 KiB, then EOF. Stderr is
separately bounded and never returned. Nonzero exit, signal, timeout,
truncation, multiple frames, noncanonical data, or output overflow returns only
the stable local failure. A failure before request bytes are accepted by SSH is
definite pre-dispatch. Once bytes are accepted, timeout, cancellation, exit or
lost response is uncertain: terminating local SSH does not prove absence of a
remote effect, and the caller must replay the exact helper request so the Data
helper journal reconciles it. Runner disconnect after dispatch does not cancel
the accepted SSH exchange; the worker finishes within its bound and discards
the response if the local output is gone.

## Key custody, rotation and later gates

The private key is a dedicated relay-account single-link mode-`0600` file. The
worker validates its metadata but never reads its bytes. `known_hosts` is
root-provisioned, single-link, mode `0440` or `0444`, relay-readable and
nonwritable. There is no `ssh-keyscan`, DNS trust, TOFU, agent, passphrase
prompt, or mutable user SSH config.

Rotation is overlap then cutover: provision the new Data authorized key and
known-host entry, deploy a newly signed role binding the new public/host
fingerprints and file digests, switch the Backend listener/config atomically,
verify the new enrollment, then remove the old key. Replacing the Data host is
a new host-installation enrollment; identities must not be carried forward.
Packet 05B1b4 still owns signed bundle/content verification and final systemd/
authorized-key installation evidence.

This packet runs no real SSH or external network. Packet 05B1b3 still owns the
real engine and target filesystem/volume/network effects. Decrypt/import,
application reconciliation, validation, promotion/rollback, successful hold
release, live topology and production rehearsal remain later gates.
