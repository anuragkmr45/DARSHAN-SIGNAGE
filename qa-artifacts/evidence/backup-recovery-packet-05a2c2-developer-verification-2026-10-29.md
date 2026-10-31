# Backup recovery Packet 05A2c2 developer verification — 2026-10-29

## Scope and safety boundary

Implemented the dedicated recovery-only broker transport and generated
Backend-host pre-import container boundary. No Docker daemon, live service,
database, object store, decrypt, import, restore, promotion, rollback, private
age identity, or private-key operation was invoked. The existing generated
root legacy recovery role was not reused or changed into the c2 runner.

Target preparation, decrypt/import, application reconciliation, restored-data
validation, promotion/rollback, successful-restore hold release, and an actual
isolated recovery rehearsal remain Packet 5B. Full production topology,
service-manager signals, real bind mounts/UID mapping, RPO/RTO, load/stress/soak,
fleet, Windows, and physical-display evidence remain QA/release gates.

## Implemented boundary

- One `BackupBrokerService` now optionally owns a second Unix listener while
  retaining one authority, journal, queue, adapter and lifecycle. Its exact
  allowlist is the four restore-hold operations. The gate runs immediately
  after strict parse and before identity, hooks, replay/reconstruction,
  authority, queue or journal access. Main endpoint behavior is unchanged.
- Recovery transport is bounded to 8 KiB, four accepted connections, and a
  five-second absolute incomplete-frame timeout. A native supervisor binds
  both listeners transactionally in root:1000 mode-0710 parents and passes
  listening FDs to the uid-1000 Node broker, which never owns a Unix pathname.
  The supervisor never unlinks; exact sockets are atomically renamed to
  no-clobber `.closed.*` evidence, while replacements and crash orphans fail
  closed for explicit reconciliation.
- Shared repeated close first denies new accepts and drains accepted/in-flight/
  queued work while authority remains held. Only after a successful bounded
  drain are exact owned sockets removed and authority released. Timeout or
  unprovable ownership retains authority/evidence and fails closed.
- Production topology adds a site-owned recovery socket directory mounted RW
  only into the broker and RO into command-specific recovery containers. The
  worker retains only the main socket; no second authority/schema/hash exists.
- A separate canonical `darshan-recovery-container-boundary-v1` manifest binds
  the signed role's immutable Docker image ID, fixed site container name,
  resource/log/tmpfs/free-space ceilings, repository device/owner identity,
  protected roots, and broker timeout. It is separate from the stable c1
  compiled runtime manifest.
- The host runner invokes `/usr/bin/docker` under a fixed scrubbed environment,
  constructs static command profiles, admits an exact 64-hex CID, verifies the
  fixed name resolves to that CID, attaches, and removes only the exact stopped
  CID. An existing fixed-name container is never deleted to admit a run.
- OCI creation explicitly overrides any image entrypoint with `/usr/bin/env`;
  its arguments begin `-i`, exactly the c1 six variables,
  `/usr/local/bin/node`, and `/app/dist-cli/scripts/recovery-runtime.js`. There
  is no npm, tsx, eval, shell, sourced environment, forwarded Docker env,
  arbitrary image/entrypoint/mount/option, Docker socket, network, device, host
  namespace, capability, application secret, signing key, active capsule,
  private recovery identity, target volume, host root, main socket, or spool.
- Every command uses a read-only image, uid/gid `1000:1000`, network `none`,
  `cap_drop=ALL`, `no-new-privileges`, fixed signals and >=10-second stop grace,
  plus bounded noexec/nosuid/nodev scratch/home/tmp tmpfs. Bind mounts use
  Docker `--mount` semantics, which do not create absent host paths.
- Separate recovery policy and manifest public keyrings are installed as 0600
  files in distinct 0700 roots. Online/offline status and disposition profiles
  omit repository/keyrings as required. Bundle configuration supplies every c2
  path, resource, tmpfs, free-space, timeout and output bound explicitly; there
  are no production defaults.

## Observed defects and fixes

1. The original broker close unlinked any socket at its pathname. Exact
   device/inode ownership is now required for both rollback and close.
2. The first c2 runner draft mounted individual protected files into
   Docker-created parent directories. Existing protected readers require 0700
   uid/gid 1000 parents, so config and both public keyrings now mount their
   complete separate protected directories.
3. Status host preflight initially inspected repository/keyring paths even
   though its container profile omitted them. Host validation now follows the
   same command profile, including fully offline status.
4. Image tags are mutable even in an offline bundle. The generator now selects
   the exact signed `IMAGE_MANIFEST.tsv` image ID and the runner creates by ID.
5. The first assembly insertion occurred before role output directories were
   established. It was moved after image/capsule generation and before signed
   operations-policy/role finalization.
6. Recovery tmpfs ceilings were individually positive but could exceed the
   memory ceiling in aggregate. Manifest validation now rejects that
   overcommit.

## Independent-review correction loop

An independent review rejected the first c2 result. The following findings
were reproduced and corrected; this developer evidence does not mark the
packet accepted pending rereview.

1. The first create argv relied on the image entrypoint. The generated Docker
   argv now includes `--entrypoint /usr/bin/env`; tests model a hostile image
   entrypoint and assert the override precedes the immutable image argument.
2. Broker shutdown tracked sockets but not asynchronous request work. Every
   admitted process promise is now retained through disconnect and
   `BackupBrokerJournal.drain()` explicitly fences its serialized queue before
   socket removal or authority release.
3. Node automatically removes its Unix listen pathname on close. The final
   design binds a fixed private name inside the owner-only socket parent,
   publishes the same inode at the public path, and immediately unlinks the
   private name. Close proves that name remains absent before calling Node;
   recreation fails stopped and retains authority/evidence.
4. Shared startup now has explicit `STARTING`, `READY`, `CLOSING`, and failed
   states. Accepted sockets remain unparsed during startup and are destroyed
   with zero effects if the second bind or metadata step fails.
5. Signal handlers are installed before manifest validation/create. Docker
   controls and attached execution have explicit time bounds; first signal
   requests fixed bounded stop, repeated signal escalates to fixed kill, and an
   admission nonce recovers only the exact container from an uncertain create.
6. The source-free role now carries a mode-0750 pinned Node binary. Signed-role
   installation keeps runner assets root:docker and non-group-writable. Host
   preparation requires the packaged uid-1000 docker-group operator, validates
   modes, and executes the runtime to prove Linux x64 Node.js 20 compatibility;
   the runbook no longer requires ambient host Node.
7. Attached stdout and stderr are separately captured and capped. A bounded,
   fsynced evidence record is written before exact stopped-CID cleanup;
   overflow fails closed after cleanup, while unprovable termination records
   evidence and retains the container.
8. Docker uses an exact scrubbed environment with explicit local
   `DOCKER_HOST` and an isolated operator-owned mode-0700 `DOCKER_CONFIG`.
   Ambient contexts and `DOCKER_*` variables are not forwarded.
9. Boundary CPU validation now accepts the same positive decimal range as
   production configuration, including `1.5`.
10. Review P3 hardening was also completed locally: stale-socket probing has a
    one-second fail-closed timeout; the boundary manifest is bounded, canonical,
    single-link, root-owned mode-0640 and docker-group-readable; and it binds SHA-256 digests for
    the launcher, shared library, stable c1 manifest and pinned Node runtime.

## Second independent-review correction loop

The first correction was also rejected pending three further P2 repairs. This
second developer loop remains subject to independent rereview.

1. Fresh signed-role installation changes the role tree to `root:docker`. The
   installer now applies narrowly scoped post-signature modes only to recovery
   runner assets: directories/executables are 0750 and read-only modules and the
   boundary manifest are 0640, all root:docker and never group-writable.
   `prepare-host.sh` requires uid 1000 in the docker group and validates every
   asset before creating its operator-owned Docker config. The manifest reader
   enforces the same root/group/mode policy.
2. Cancellation can race a pending Docker start after an initial stop reports
   the container stopped. The runner now awaits start, re-verifies the exact
   fixed name, CID, admission label and state, and performs another bounded stop
   followed by kill if necessary. Ambiguous convergence is retained in evidence
   and no further start/wait is issued.
3. The private bind hard link alone still allowed Node to unlink a replacement
   at its hidden pathname. The broker now immediately detaches that hidden name
   after public publication and refuses to call `Server.close` if it reappears.
   Close failures are repairable/retryable without releasing authority. Tests
   cover hidden/public file and symlink replacement, second-listener rollback,
   crash-orphan reclamation and Linux Unix-path length rejection.
4. Local P3 corrections replace unrestricted `readFileSync` with an exact
   open/fstat/bounded-read/fstat sequence, store outputs as base64 under a
   derived evidence-size ceiling, bind the Linux/x64/Node-20 host-runtime
   contract, and execute the pinned runtime during host preparation to prove
   target loader/library compatibility.

## Third independent-review correction loop

The second correction was rejected for a remaining pathname TOCTOU and a
pending-attach cancellation gap. This third loop remains subject to independent
rereview and does not mark Packet 5A2c2 accepted.

1. Production no longer asks Node/libuv to bind a filesystem pathname. The
   packaged native `backup-broker-listener` is the sole pathname writer. It
   requires both bind parents to be root:1000 mode 0710, binds both sockets,
   assigns the socket entries to 1000:1000 mode 0660, forks, passes inherited
   FDs 3/4, drops supplementary groups and uid/gid to 1000:1000, then execs the
   one broker process. Its container starts with only CHOWN/SETGID/SETUID after
   dropping all other capabilities. Node's production service rejects missing
   inherited FDs. The supervisor never calls unlink and uses identity-checked
   `renameat2(RENAME_NOREPLACE)` into `.closed.<pid>.<index>` evidence. A
   compile-time-only adversarial hook swaps both public entries after identity
   observation; neither replacement is deleted or overwritten. The same test
   covers second-bind rollback, and separate cases cover unsafe parents and
   Linux path length. Crash orphans remain explicit fail-closed evidence.
2. Cancellation reconciliation now starts concurrently with the pending
   `docker start --attach` subprocess. A signal wakes an independent bounded
   loop that validates exit/timeout/truncation/stdout metadata for the exact
   fixed name, CID, admission nonce and running state, issues two bounded stops
   then bounded kill attempts, and aborts the attach subprocess at its own
   deadline. It converges only after both attachment settlement and a proven
   stopped state. The exact fake-Docker reproduction holds attach pending until
   the first stop completes, then races the container running and requires a
   second stop before runner completion. No run-time wait delays cancellation.
3. Every inspect used for admission or reconciliation now validates subprocess
   exit status, timeout, stdout/stderr truncation and bounded stdout before its
   content is trusted.

## Fourth independent-review correction loop

The inherited-FD architecture was accepted structurally, but integration
rereview found five further P2 defects. This fourth loop remains subject to
independent rereview and does not mark Packet 5A2c2 accepted.

1. The supervisor now applies mode 0660 while root still owns each socket,
   chowns it to 1000:1000 afterward, and verifies final type, device, inode,
   owner and mode. Native tests execute the compiled binary with the exact
   production capability set and no `FOWNER`.
2. Signal handlers are installed before path validation or bind and perform
   only an async-signal-safe flag assignment. The parent forwards pending
   TERM/INT outside the handler, treats only ESRCH as a safe absent-child
   result, and reports other `kill(2)` failures. The generated broker profile
   adds only `KILL` to CHOWN/SETGID/SETUID so the root supervisor can signal its
   uid-1000 child; the child permanently drops groups, uid/gid and all
   capabilities. Exact-capability tests prove TERM and INT reach the child drain
   handler and an early pre-bind signal leaves no socket.
3. Every online recovery command now validates the recovery socket parent as
   root:1000 mode 0710, matching the writer-exclusion boundary. The complete
   online command matrix rejects the former uid-1000/mode-0700 metadata.
4. Cancellation reconciliation is observed immediately. Inspect exit failure,
   timeout, truncation, identity mismatch and invocation rejection abort a
   pending attach without waiting its run timeout. Catch/finally performs a
   bounded attach join, rechecks the exact name/CID/admission label, attempts
   bounded stop/kill only under proven identity, and writes finalization
   evidence. A deliberately non-settling fake attach proves bounded return and
   the fault matrix proves no unhandled rejection.
5. Socket evidence names now combine realtime, kernel random bytes, listener
   index and a 32-attempt no-clobber suffix. Every rename result is checked and
   the preserved entry is re-verified by device/inode/type. Exhaustion or any
   other preservation failure is explicit exit 78, never silent success.
   Repeated fixed-token test runs retain both generations by retrying the
   collision. Protected parents are opened through `openat2` with no-symlink or
   magic-link resolution.

## Fifth independent-review correction loop

The fourth correction was rejected for an unusable broker healthcheck identity
and a remaining signal delivery race. This fifth loop remains subject to
independent rereview and does not mark Packet 5A2c2 accepted.

1. The generated broker healthcheck now enters through the packaged
   `/usr/bin/setpriv`, changes to uid/gid 1000, clears supplementary groups and
   inheritable/ambient capabilities, and sets no-new-privileges before invoking
   the exact Node DESCRIBE probe. The native integration test runs the actual
   production supervisor with capability mask `0xe1`, verifies the healthcheck
   process is uid/gid 1000 with zero effective capabilities, connects to the
   1000:1000 mode-0660 socket, and completes a schema-valid DESCRIBE exchange.
2. TERM/INT are now blocked before setup and fork. The child unblocks them only
   immediately before exec; the parent combines `waitpid(WNOHANG)` with
   `sigtimedwait`, checks forwarding failures, and handles repeated signals
   without a check-to-block gap. A deterministic boundary hook sends TERM and
   INT after the nonblocking reap and before the synchronous wait, proving both
   reach the child and the supervisor reaps it with bounded completion. The
   early pre-child case continues to exit as `128 + signal` without a socket.
3. Supervisor listener paths must be absolute and lexically canonical. Relative
   paths, repeated separators, and `.` or `..` components fail before bind;
   protected parents remain resolved with the existing `openat2` constraints.

## Independent acceptance disposition

The final independent rereview disposition is **ACCEPT** for Packet 5A2c2,
with no open P1 or P2 findings. The independent closeout recorded 11/11 native
supervisor tests, 46/46 focused broker tests, 17/17 production-config/boundary
tests, a passing no-Docker boundary validator and passing touched syntax checks.
The exact-capability PID-1 signal fixture completed in 105 ms.

One P3 operability finding remains open: collision-resistant `.closed.*` socket
evidence is intentionally retained, but the operator retention, archival and
privileged cleanup procedure still needs to be made explicit. This is routed to
the later Packet 5B/release-operability runbook and release-readiness evidence;
Packet 5A2c2 does not add automatic deletion or weaken the fail-closed evidence
boundary.

Acceptance is limited to the reviewed source, developer tests, native fixtures
and fake-Docker boundary. Real Docker execution, seccomp behavior, production
kernel/ABI compatibility, bind-mount and UID mapping, tmpfs enforcement,
service-manager integration, `BKP-31`, `BKP-32`, decrypt, import, restore and all
other Packet 5B/live QA and release gates remain open.

## Bounded developer verification

- Listener/lifecycle focused loop: **46/46 tests passed** in one Vitest fork.
- Generator/runner/config/native loop: **44/44 tests passed** (16 production
  config, 16 boundary/runner adversarial, 1 synthetic boundary generator, and
  11 native inherited-FD capability/signal/healthcheck/TOCTOU/collision tests).
- Serial affected recovery regression loop: **130/130 tests passed** across 13
  Vitest files in one fork.
- No-Docker c2 source validator: `recovery-boundary-ok`.
- Both no-emit TypeScript configurations and strict ESLint on the four touched
  TypeScript files passed.
- The normal build and production build completed successfully. The stable c1
  verifier returned `recovery-runtime-manifest-ok`; the native-import verifier
  returned `recovery-native-import-ok`.
- Shell and touched JavaScript syntax checks passed. Both changed QA CSV files
  have consistent row widths (risk register: 57 data rows/11 columns; test
  cases: 157 data rows/23 columns), and the scoped diff whitespace check passed.

One production-manifest verifier invocation was started before the production
build had finished and therefore reported the not-yet-emitted manifest as
absent. After the bounded build completed, both c1 verifiers passed as recorded
above; this was test ordering, not a source defect.

This evidence is source/developer and fake-Docker evidence only. `BKP-31` and
`BKP-32` remain `Not Tested` for the frozen production host; Packet 5B and live
QA/release gates remain open.

Exact correction-loop commands were:

```text
DATABASE_URL=postgresql://test:test@127.0.0.1:5432/darshan_test npx vitest run src/backups/backup-broker-protocol.unit.test.ts --pool=forks --poolOptions.forks.singleFork=true
node --test scripts/backup-broker-listener.test.mjs
node --test scripts/recovery-container-runner.test.mjs
node --test ../scripts/bundle/production-bundle-config.test.mjs
node --test ../scripts/bundle/recovery-boundary.test.mjs
DATABASE_URL=postgresql://test:test@127.0.0.1:5432/darshan_test npx vitest run src/recovery --pool=forks --poolOptions.forks.singleFork=true
npx tsc -p tsconfig.json --noEmit --pretty false
npx tsc -p tsconfig.production-cli.json --noEmit --pretty false
npx eslint src/backups/backup-broker-protocol.ts src/backups/backup-broker-service.ts src/backups/backup-broker-main.ts src/backups/backup-broker-journal.ts --max-warnings=0
npm run build
npm run build:production
node scripts/verify-recovery-runtime-manifest.mjs
node scripts/verify-recovery-native-import.mjs
node ../scripts/verify/validate-recovery-boundary.mjs --source ..
cc -std=c11 -O2 -Wall -Wextra -Werror -o /tmp/backup-broker-listener src/native/backup-broker-listener.c
sh -n docker/runtime-entrypoint.sh
bash -n ../scripts/bundle/assemble-runtime-bundle.sh ../scripts/verify/validate-source-free-production-bundle.sh
```
