# Backup recovery Packet 05B1b3b2b2a developer verification — 2026-10-29

## Result and exact boundary

Implemented the additive credential provisioning/admission checkpoint. The
production helper remains `UnavailableRecoveryTargetEngine` and contains no
credential/native selector. No Docker daemon, live service, network/SSH,
production key, real credential, decrypt, import, restore, START, bootstrap,
readiness, STOP, RETIRE, or promotion operation was used.

The native fixture is compile-gated and uses only temporary owner-only
directories, synthetic non-secret identities, local descriptor/socket pairs,
and ephemeral random fixture credentials that are removed with the temporary
directory. The TypeScript admission/store is test-only. This is not real-host
enrollment or application recovery evidence.

## Implemented controls

- Canonical credential-provision-scope-v1, credential-provision-journal-v1,
  credential-admission-v1, profile-v3, and resource-admission-v2 were added
  without changing accepted v1/v2 contracts or materialization bytes.
- Ed25519 PREPARE verification and the acquired native authority bind the
  recomputed semantic encoding and full domain-separated executed-wire digest
  to the exact immutable PREPARE request digest, expiry, operation/target/generation,
  profile/template, allocation/ledger, request/authorization/envelope, policy,
  challenge, authority instance, supervisor generation, and exact fixed roles.
- The native context validates signed-authority/session and protected-root
  evidence before acquiring its fixed `F_OFD_SETLK` provisioning scope. It
  retains the authority and peer descriptors and requires a bounded live
  acquired-session witness: creator PID, random lease proof, authority
  identity, kernel peer cookie, exact session fields, and an independent lock
  probe. Released/reopened, copied, forked, peer-replaced, unlocked, and wrong
  live OFDs reject before the anchor. Release/peer-death cleanup atomically
  claims that exact registry witness and locking OFD before closing; stale
  copies cannot close a newer lease after natural descriptor reuse. Registry
  PID/entry/fork-reset state uses one synchronized discipline. Peer death
  cancels the scope.
- Directory scans use independent open descriptions and reject foreign names,
  unsafe modes, symlinks, non-regular entries, hard-link aliases, changed
  device/inode/mount identity, stale heads, and scope contention. Credential
  and journal roots must be physically distinct. Existing topology and exact
  journal records/transitions are validated before any credential is created.
- Kernel `getrandom` creates exactly PostgreSQL password, MinIO root password,
  and MinIO root user with fixed encoding/length, numeric ownership, and mode
  `0400`. No caller path/filename/owner/group/mode/value/policy string exists.
- Exclusive descriptor-relative publication uses complete bounded writes,
  protected provenance, file fsync, no-clobber link, parent fsync, and exact
  replay. The monotonic state is `ABSENT -> INTENT -> FILES_DURABLE -> ADMITTED`.
  A linked partial role is adopted only by exact protected provenance after
  reopening, file fsync, physical-identity recheck, directory fsync, and parent
  revalidation. It is never rotated, overwritten, truncated, unlinked, or
  regenerated. Nanosecond realtime plus a fixed monotonic deadline is checked
  at every boundary without retry reset. A protected scope xattr holds a native
  random HMAC key; protected role xattrs hold raw HMAC-SHA256 commitments.
  Replay checks fixed content length/encoding and the keyed commitment before
  and after durability operations. Anchor creation and every existing-anchor
  replay validate the exact anchor/xattr/identity, fsync the anchor and journal
  directory, and reverify both before the key may be used.
- Admission contains only opaque handles, exact physical descriptor identities,
  numeric owner/mode, and durable binding digests. Credential values and
  value-derived commitments do not enter public return data, errors, logs,
  journal/admission records, argv, environment, or evidence. The private key
  and commitments exist only in protected xattrs. Core dumps are disabled and
  transient buffers are wiped.
- Profile-v3/resource-admission-v2 distinguish unavailable from fully enrolled
  while keeping dispatch/materialization/lifecycle false. Profile-v2 remains
  `UNAVAILABLE`, `valuePresent:false`, and `dispatchEnabled:false`.

## Developer verification commands and results

- `npm run test:recovery-target-credential-native`: **1/1 Node subtest**, with
  **73/73 native checks**, passed under
  `-std=c11 -O2 -Wall -Wextra -Werror`.
- `DATABASE_URL=postgresql://test:test@127.0.0.1:1/darshan_test npx
  vitest run src/recovery/target-credential-admission.unit.test.ts
  --pool=forks --maxWorkers=1`: **5/5 passed**. The non-routable dedicated
  test URL only satisfies the repository safety guard; this unit file opens no
  database connection.
- `DATABASE_URL=postgresql://test:test@127.0.0.1:1/darshan_test npx vitest
  run --config vitest.unit.config.ts src/recovery
  scripts/recovery-target-relay-worker.unit.test.ts --pool=forks
  --poolOptions.forks.singleFork=true`: **403/403 across 25/25 files passed**.
- Native predecessors passed: executor/materialization **41/41** (1/1 Node),
  engine authority **46/46** (1/1 Node), helper/subreaper **18/18**, storage authority
  **1/1**, and relay **6/6**. Relay TypeScript passed **14/14**.
- `npx tsc --noEmit` for `tsconfig.json`, `tsconfig.scripts.json`,
  `tsconfig.production-cli.json`, and `tsconfig.recovery-tests.json`: passed.
- Touched TypeScript ESLint with `--max-warnings=0`: passed.
- Strict standalone test and non-test authority/credential C compilation:
  passed.
- `npm run build`: passed.
- Touched `git diff --check`, private-key/credential-surface scan,
  no-unlink/no-generic-exec scan, and production-Unavailable selector scan:
  passed.
- The supplied `/tmp/credential-rereview-native-bvzw_owd/test.c`, rebuilt
  against the corrected sources, reported aliased roots `open=-1` with anchor
  absent, orphan journal `open=-1` with zero credentials, and released-session
  ordinary-FD replay `open=-1`.
- The supplied `/tmp/credential-rereview-reconcile-vhebzq6m/test.c`, rebuilt
  with its harmless fsync wrapper, reported same-inode truncated content
  `read=-1 state=1` and peer-death reconciliation `read=-1 freshness=-1
  errno=125` (`ECANCELED`).
- `npx tsx /tmp/credential-ts-rereview.mts` rejected unrelated/wrong request
  digests, duplicate handles, wrong owner, and wrong descriptor hash; its exact
  wire-bound positive case was accepted.
- The supplied `/tmp/credential-anchor-review-aiwoxgp9/test.c`, rebuilt with
  its harmless fsync wrapper, reported `first=-1 retry=0 provision=0 state=3`
  with `anchor_fsync_attempts=2 real_anchor_fsyncs=1`: the failed creation was
  retained, and replay performed a real anchor fsync before admission.
- The supplied `/tmp/authority-witness-final-i9odppob/test.c` naturally reused
  both authority and peer FD numbers, then reported stale release `-1`, newer
  session validation `0`, and competing acquire `-1`; the stale copy did not
  close the newer lease.
- The supplied `/tmp/authority-registry-tsan-2q6llbb0/test.c` compiled with
  `-fsanitize=thread`; `TSAN_OPTIONS='halt_on_error=1 exitcode=66'` completed
  `registry parallel stress completed` with exit 0 and no race report.

Accepted predecessor evidence hashes remained unchanged:

- 05B1a `81d83a487627bfcbe21c193b77004dc69826a9cdb5db0c34351df1a944acae06`
- 05B1b1 `f4510808fc8e7e949048eeab114eb4dc892860152d9592be7832fe374f144ccf`
- 05B1b2a `997d991f7555307e4b4252fd0b253d76c2166c313bc257842959910e6e775f8e`
- 05B1b2b `309ca639511a75acd9dd924f0ca1707e2fd34e807d073271cae0a97dd091e9b3`
- 05B1b3a `41a596e60c2a1fce78a14f1e19fe42752b2b5164d2de902494c56fc48bf55115`
- 05B1b3b0 `0890dde083320677c42050162c7182b2ac9a3be532136ed2ae144d677b5e0fd0`
- 05B1b3b1a `81fb223e71bba859e821371400fd817cf32f8a5f6bb540f2547732bd822d6e17`
- 05B1b3b1b `a5c0efc93d9e1985f79395218405792d2ba65c0d9b1502b921e9b5883b20204b`
- 05B1b3b2a `556cd571d18d9710eb470ef147d87955fa11d8fd32c5c6ed4d81f76bde114309`

Accepted v1 engine contract/profile/inspect/journal/constrained-adapter sources
remain `77e67122…`, `2b0d20cd…`, `0251e7dd…`, `a5bb3a30…`, and `0c15a6ec…`.

Second review reopened the native engine-authority implementation predecessor.
The additive internal `rtea_validate_active_session` witness changes the native
implementation/API but does not change lease-v2 wire bytes or meanings. Its new
review baseline is:

- `recovery-target-engine-authority.c`
  `f65743b9eab0fa2e731d246b0d78ddf91a1f8189fd0d592f466b27b351c710ad`
- `recovery-target-engine-authority.h`
  `c96cf4c5e11a5ed805998233ba4f4e61af0e850da604c0fc701a4481b84bae69`

The prior evidence artifact bytes above were not rewritten; their hashes remain
listed for traceability. The authority predecessor was rerun with **46/46**
checks. Independent settled-state re-review accepted this new source baseline
with no open P1/P2/P3 findings. The review also independently passed all **28/28**
native Node subtests and the full **403/403** recovery regression across **25/25**
files.

## Observed defects and corrections

1. The first native fixture attempted to attach protected provenance after the
   temporary inode already had mode `0400`, causing `EACCES`. The inode now
   starts private writable, receives provenance, and only then receives its
   final owner and `0400` mode.
2. The initial partial-publication fault hit journal fsync before credential
   link. A credential-directory-specific post-link fsync fault now proves the
   linked inode is retained and adopted without rotation.
3. The first strict scan used `dup()`, whose shared directory offset could hide
   entries on a later scan. It now opens `.` descriptor-relatively for an
   independent open description; a foreign-entry regression proves rejection.
4. Scope anchor acquisition initially preceded complete authorization/root
   validation. Ordering now validates signed PREPARE and storage/allocation
   bindings first; invalid authorization is proven to leave no scope effect.
5. Final TypeScript audit added exact scan bounds and equality between scope
   role handles, FILES_DURABLE physical descriptors, and admission receipt.
6. Independent review found incomplete effect-field authentication. The native
   boundary now domain-hashes the complete canonical scope wire and requires it
   to equal the verified PREPARE request digest, while separately recomputing
   the semantic digest. Twenty-one per-field substitutions prove zero scope
   effect; the TS/native golden semantic and wire digests are exact.
7. Independent review found that a post-link replay could acknowledge without
   explicitly syncing both objects. Adoption now fsyncs and reverifies the file,
   then fsyncs and reverifies the credential directory. Final-role file-fsync
   and directory-fsync failures prove retryability and stable inode replay.
8. Millisecond/second truncation and weak descriptor checks were replaced with
   nanosecond realtime plus monotonic expiry and retained authority identity,
   file type, and same-OFD lock proof. Regressions reject one-nanosecond-late
   validation and a same-inode ordinary FD before the scope anchor is created.
9. TS admission now begins at the exact signed previous journal head (including
   a positive nonzero-head chain), and TS/native reject aliased role handles.
   Descriptor validation enforces fixed role owner/group/mode and recomputes
   its canonical physical identity digest. A test-only discriminated-tuple
   typing error found by no-emit was corrected without changing runtime logic.
10. Second review proved that self-querying an OFD lock could not distinguish
    own from unlocked. The additive authority witness now requires a live
    process registry entry, creator PID, exact lease proof/session fields,
    kernel peer cookie, own-lock self query, and an independent reopened probe
    that observes the lock. Release zeroes the bounded entry; fork, peer
    replacement, copied proof, wrong OFD with a live lock, and released-session
    replay all reject before the scope anchor.
11. Aliased roots and orphan journal state previously failed only after an
    anchor or credential effect. Root identity disjointness and strict existing
    topology/record/transition reconciliation now precede anchor creation or
    provisioning. The supplied repro reports anchor `0` and credentials `0`.
12. Exact inode metadata did not prove content integrity. Native per-scope HMAC
    keying and protected per-role commitments now validate fixed content form
    without publishing a password-derived digest. Same-inode truncation or
    mutation returns non-admitted.
13. Reconciliation now rechecks live session, peer, deadline, protected roots,
    and scans after each fsync/adoption boundary and before `ADMITTED`. The
    supplied fsync peer-death repro returns `ECANCELED`.
14. TS admission now requires the expected PREPARE request digest to equal the
    exact domain-separated executed scope-wire digest. The unrelated/wrong
    digest repros reject and the wire-bound positive case accepts.
15. Documentation now correctly calls the semantic form a domain-separated
    fixed-line encoding rather than a JSON encoding.
16. Final review found that an existing scope anchor could reuse its protected
    key after a failed creation fsync without proving the anchor and parent
    durable. Creation and replay now both validate, fsync the anchor, fsync the
    parent, and reverify exact identity/xattr before key use. Five permanent
    before/at/after-file and directory-fsync fault cases prove retry and final
    admission without secret rotation or duplication.
17. A stale copied release could close a newer lease after natural FD-number
    reuse. Release now atomically claims and removes the exact live registry
    token, peer cookie, authority identity, and locking OFD before any close;
    peer-death cleanup duplicates only a proven active peer and ends with the
    same exact claim. Natural reuse, wrong-OFD release, concurrent double
    release, stale peer-death, and valid release regressions pass.
18. The registry creator PID previously had an unsynchronized read/write race.
    It is now atomic, registry/session field access is under the registry lock,
    and `pthread_atfork` prepare/parent/child handlers serialize and reset the
    child registry. Concurrent initial registration/release and the supplied
    ThreadSanitizer stress complete without a race report.

## Independent acceptance and residual gates

Independent settled-state review accepted the local credential fixture and the
reopened authority implementation with no open P1/P2/P3 findings. Retained
anchor-durability, natural file-descriptor reuse, ThreadSanitizer concurrency,
root-alias, orphan-journal, released-session, credential-mutation,
reconciliation peer-death, and TypeScript request-digest cases all produced the
required fail-closed result. Lease-v2 wire encoding remained unchanged and the
production worker remained `UnavailableRecoveryTargetEngine`.

Acceptance is limited to temporary local fixtures. Real root-owned host
enrollment, Docker/daemon integration, actual service credentials,
authenticated readiness, restore/import/application validation,
promotion/rollback, topology/fleet, load/stress/soak, failover, RPO/RTO, and
production rehearsal remain explicit later QA/release gates.
