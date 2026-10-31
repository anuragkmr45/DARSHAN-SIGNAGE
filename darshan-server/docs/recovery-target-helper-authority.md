# Recovery target helper authority (Packet 05B1b2a)

## Installed process boundary

`recovery-target-helper-listener` is the only process allowed to create or
rename the Data-host helper socket. It takes no arguments and all paths,
identities, policy identity, pinned Node path, and compiled worker path are
compile/install-time constants. Its socket parent is root-owned,
`root:<bridge-group>` mode `0710`; the socket is `root:<bridge-group>` mode
`0660`. A connection is admitted only when `SO_PEERCRED.uid` is the dedicated
bridge uid. Backlog and live children are both bounded to four.

For each accepted connection the supervisor forks once, maps that stream to
stdin/stdout, closes all other descriptors, clears supplementary groups,
drops to the dedicated helper uid/gid, sets no-new-privileges, and execs the
pinned Node binary plus the compiled one-shot worker. No request can select a
path, program, argument, environment variable, engine, credential, or command.
The worker accepts exactly one canonical envelope terminated by newline and
EOF, applies the five-second first-byte framing deadline and a separate fixed
connection/action deadline, writes at most one 128 KiB newline response, and
exits. Errors exposed on stderr are fixed and contain no raw exception or
secret.

`recovery-target-stdio` is a separate unprivileged no-argument bridge. It reads
one bounded stdin frame before connecting to its compiled local socket, copies
one bounded response, and has fixed timeout and exit-code behavior. It is a
future forced-command building block only. Packet 05B1b2a installs no SSH
configuration, authorized key, forwarding, PTY, remote command, or network
relay.

## Lifetime and crash authority

Before binding, the supervisor opens the canonical protected authority
directory with `openat2(RESOLVE_NO_SYMLINKS|RESOLVE_NO_MAGICLINKS)` and takes a
nonblocking open-file-description write lock on its single-link mode-0600
authority file. The descriptor remains open until all accepted children have
drained or been boundedly terminated and the exact socket has been preserved.
The fsynced record binds the random instance token, site, installation, policy
digest, listener digest, boot id, pid, and kernel process-start ticks. Age and
pid are never used to steal this authority.

The helper journal lock optionally carries that 256-bit authority token.
Production construction requires it; historical unit fixtures remain
compatible without it. While holding the exclusive kernel authority and before
accepting, the native supervisor may reconcile only the exact global
`.target-helper.lock`: it must be a helper-owned single-link regular mode-0600
file on the protected journal device, have the strict canonical token-bound
schema, match the prior durable authority token, and name no live process. The
entry is retained with `renameat2(RENAME_NOREPLACE)` as `.stale.<token>` and the
directory is fsynced. Missing binding, legacy schema, live pid, symlink,
unknown file type, metadata mismatch, collision, or unprovable state stops
startup. No scan deletes a lock.

On ordinary shutdown, TERM/INT remain blocked in the parent and are consumed
synchronously. Accept work is bounded per turn, new admission stops, children
receive a five-second drain window followed by bounded TERM/KILL and reap, and
the exact socket inode is renamed without clobber to `.closed.<token>.<n>`.
The supervisor never unlinks a socket pathname. A replacement or crash orphan
is left as fail-closed evidence for privileged reconciliation.

## Deliberate checkpoint limits

The only engine shipped at this checkpoint is the deterministic test fake.
Production uses `UnavailableRecoveryTargetEngine` and returns the stable
`TARGET_NOT_INSTALLED` result before target effects. No Docker daemon, target
filesystem/volume/network adapter, credentials, secret injection, decrypt,
import, restore, application reconciliation, validation, promotion, rollback,
or successful-restore hold release exists here.

An effectful production adapter must not be installed until its methods accept
the worker's deadline/cancellation signal and prove bounded abort-and-join
before process completion. The production gateway factory has no engine
injection argument at this checkpoint; its fixed unavailable adapter therefore
cannot outlive a response deadline with a target effect.

The installed identity also enrolls `specificationRootSha256`. The Backend
controller derives the same domain-separated identity from its fixed canonical
specification-root path and carries it in the strict public envelope; the Data
host checks it during both authorization passes. This is an enrollment
identity, not yet a digest of directory contents. Signed bundle assembly and
verification of the installed root's content digest remains Packet 05B1b4.

Packet 05B1b2b owns the Backend-to-Data-host SSH/forced-command relay. Packet
05B1b3 owns real Docker/engine and target resource effects. Packet 05B1b4 owns
signed-role/source-free bundle integration, systemd installation, and final
binary-digest generation. Live topology, RPO/RTO, load/stress/soak, failover,
and production rehearsal remain release gates.
