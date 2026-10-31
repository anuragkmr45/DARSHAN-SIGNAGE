# Backup recovery Packet 05B1b2b developer verification — 2026-10-29

## Scope and safety boundary

Implemented the Backend-local restricted SSH relay boundary using only compiled
temporary native fixtures and child-process fake SSH programs. No real SSH
client/server exchange, external network, Docker, live/systemd service,
decrypt/import/restore, production private key, or privileged installation was
run.

## Implemented boundary

- `recovery-target-relay-listener` is a no-argument native supervisor and sole
  socket-path writer. It verifies canonical protected parents, creates the
  root/runner-group `0660` socket beneath a `0710` directory, admits only the
  exact runner UID through `SO_PEERCRED`, and bounds backlog/live children to
  four.
- A strict OFD-locked authority record binds site, Backend installation,
  policy, listener, worker, config, known-hosts, enrolled public-key and
  destination identities. Existing records/metadata are validated without
  repair. TERM/INT use pre/post-fork admission fences, bounded drain and
  TERM/KILL/reap. Exact sockets are retained with no-clobber `.closed.*` rename;
  crash or replacement pathnames remain fail-closed evidence.
- Every worker owns a new process group established by both fork sides before
  gate release. The native parent is a subreaper, retains group authority after
  direct-child exit, signals negative PGIDs, reaps adopted descendants, and
  requires group absence before socket/authority release. Children close
  unrelated descriptors, clear supplementary groups, drop to a
  dedicated relay uid/gid, clear capability sets, set NNP, and exec fixed Node
  plus the fixed one-shot worker with a minimal environment.
- The worker reads and canonical-validates exactly one bounded request plus EOF
  before creating SSH. Production always uses `/usr/bin/ssh`; fake subprocess
  injection is an in-process test factory and is not an environment/config
  option.
- The canonical protected config fixes site/installations, destination, port,
  user, alias, enrolled fingerprints, known-hosts/key paths, forced-command
  contract, host-IP policy, and deadlines. Private-key bytes are never read;
  only strict single-link owner/mode/path metadata is checked. Known hosts is
  root-provisioned relay-readable and nonwritable.
- SSH receives a scrubbed environment, `/dev/null` config and fixed strict-host,
  identity-only, noninteractive, no-forwarding/no-tunnel/no-TTY/no-control/no-
  proxy/no-local-command options. There is no client command, allowing only the
  documented Data-side authorized-key forced command with empty original
  command.
- SSH stdin has an error listener before the first write, and dispatch becomes
  uncertain immediately before that write attempt. Full/partial accepted write,
  callback/end/asynchronous errors, action/response timeout and TERM/INT all
  perform bounded SSH TERM/KILL and await close without dropping the action
  timer. SSH stdin otherwise receives the exact buffered frame then EOF. Stdout must be one
  canonical response plus EOF within 128 KiB; stderr is independently bounded
  and never returned. Action/response/output deadlines are bounded. Failure
  before request acceptance is definite; once bytes are accepted it is
  uncertain and exact helper-journal replay owns reconciliation. A local runner
  output failure after dispatch no longer kills or invalidates the exchange.
- The default config-v3 controller client verifies canonical parent/socket
  root/runner ownership, `0710`/`0660`, socket type and stable inode before it
  writes request bytes. Callers cannot supply SSH host/user/port/options,
  command, key or environment through the recovery request.

## Verification results

- Strict native compile (`C11 -O2 -Wall -Wextra -Werror`): **passed**.
- New native relay adversarial fixtures: **6/6 passed** (round trip and socket
  evidence, peer rejection, four-child bound, OFD/corrupt authority, crash
  orphan/restart fail-closed, process-group/subreaper TERM-resistant descendant
  removal and negative group probe).
- New fake-SSH worker fixtures: **14/14 passed** with no unhandled errors (argv/
  env/stdin, stderr/nonzero/hang/oversize/truncation/multiframe/noncanonical,
  invalid/pre-cancel request no-spawn, post-dispatch cancellation/output loss,
  config/path/metadata, definite-before/uncertain-after classification,
  full/partial/end/asynchronous stdin failures, TERM/INT with TERM-resistant
  SSH, bounded close/no surviving child, and no-command checks).
- Existing target transport/authorization suite with protected client socket
  metadata: **50/50 passed**.
- Accepted Data native helper/stdio regression: **14/14 passed**, including
  unset/empty original-command acceptance and nonempty rejection.
- Full serialized recovery regression after the correction: **240/240**,
  **16/16 files**.
- Backend and scripts TypeScript no-emit, touched ESLint, backend build,
  compiled recovery-runtime build/manifest, strict final C compile and tracked
  diff whitespace check: **passed**.

## Independent-review correction loop

The first review found two P2 process-lifecycle gaps and one P3 forced-command
hardening gap. The corrected result remains subject to independent rereview.

- The supervisor no longer treats direct-worker exit as process-tree exit. It
  establishes and records a dedicated PGID before gate release, acts as a
  subreaper, retains the group slot, signals the negative PGID, reaps adopted
  descendants and verifies `kill(-pgid, 0)` returns `ESRCH` before releasing
  authority or preserving the socket. A surviving post-KILL group fail-stops
  with authority retained. A TERM-resistant fake SSH descendant is
  proven absent with its direct worker after supervisor shutdown.
- The worker installs stdin error handling before writing and marks the outcome
  uncertain immediately before the first write attempt. Full and partial
  accepted writes, write callback failure, end failure, asynchronous stream
  error, action/response deadlines and worker TERM/INT all retain bounded
  cleanup: TERM, bounded wait, KILL, awaited close. TERM-resistant fixtures
  leave no child and produce no unhandled event/rejection.
- The Data-side stdio forced-command entry rejects nonempty
  `SSH_ORIGINAL_COMMAND` before socket connection. Both unset and explicitly
  empty states retain the accepted exchange behavior.

## Explicit untested branches and live gates

Local fixtures do not prove a real root-to-distinct-relay uid/gid transition,
all supplementary-group/capability permutations, fork/exec/pipe allocation
failure, kernel `openat2`/OFD/fsync/getrandom/close-range/rename failure,
authority or socket mount replacement, all signal instruction interleavings,
sustained accept flood/fairness, D-state subprocess termination, PID-1/service-
manager behavior, or privileged evidence retention/cleanup.

No real OpenSSH version compatibility, daemon forced-command behavior,
authorized-key option support, host-key mismatch,
revocation, DNS/address behavior, route/firewall, network partition, private-key
custody/passphrase/HSM, real backpressure, rotation overlap/cutover, replacement
Data-host enrollment, or production topology was exercised. Installed
known-host/config/key content digest verification and final authorized-key/
systemd packaging remain Packet 05B1b4 gates.

Packet 05B1b3 still owns real Docker/engine and target filesystem, volume and
network effects. Decrypt/import, application reconciliation, validation,
promotion/rollback, successful hold release, live RPO/RTO, load/stress/soak,
failover and production rehearsal remain later gates.

## Independent acceptance closeout

Independent rereview **ACCEPTED** Packet 05B1b2b with no open P1 or P2
findings. The accepted local evidence is:

- native relay listener/process-group fixtures: **6/6**;
- one-shot relay worker/fake-SSH fixtures: **14/14**;
- Data helper/forced-command stdio fixtures: **14/14**.

Both correction reproducers are closed. The native supervisor creates and
records a worker process group before gate release, retains it across direct
worker exit, signals the negative PGID, reaps subreaper descendants and proves
the group absent before authority/socket release. The one-shot worker treats
the first stdin write attempt as uncertain, handles callback/end/asynchronous
stream failures without an unhandled event, and performs bounded TERM/KILL plus
awaited child close on shutdown and deadline paths. The Data forced-command
bridge now rejects every nonempty `SSH_ORIGINAL_COMMAND`; unset and empty
values retain the accepted exchange.

Remaining P3 coverage is explicitly open for privileged root-to-distinct-user
execution, kernel and allocation failure branches, exhaustive signal ordering,
sustained accept-flood fairness, D-state process behavior, and retained socket
evidence operations. Packet 05B1b3 remains open for real engine and target
resource effects. Packet 05B1b4 remains open for signed-role/source-free
bundle, installed-content digest, systemd, authorized-key and privileged
installation verification. Real SSH/network topology, key custody and
rotation, live load/failover, decrypt/import/reconciliation, validation,
promotion/rollback, successful hold release and production rehearsal remain
release gates.
