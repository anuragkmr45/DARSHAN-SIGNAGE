# Backup recovery Packet 05B1b3b1b developer verification — 2026-10-29

## Result and exact safety boundary

Implemented the additive constrained lifecycle layer and protected engine
journal for explicit fake-only construction. Production remains unavailable:
the production worker, native listener, adapter factory/selector, signed-role
packaging, and install wiring were not changed. No Docker/Podman/Compose,
live/network/SSH service, production private key, target credential value,
decrypt, import, or restore operation was invoked.

The scripted lifecycle authority is still unmistakably test-only and requires
`TEST_ONLY_DO_NOT_USE_IN_PRODUCTION`. The implementation provides no arbitrary
path, argv, daemon endpoint, environment, secret, generic exec, remove,
quarantine, or PURGE authority.

## Implemented contracts and lifecycle

- Four strict canonical bounded v1 contracts cover existing resource
  admission, fixed lifecycle commands, sanitized command results, and complete
  authoritative resource observation. Every contract binds the v2 request and
  canonical outer-envelope digest, authorization, enrollment, profile,
  protected inventory, operation/site/host/plan/target/generation/specification
  identity.
- The scoped authority lock contains enrolled profile/inventory reads,
  allocation/credential admission, engine-journal locking, fake commands, and
  authoritative observations. The order is outer helper -> lifecycle authority
  -> engine journal. Cancellation/deadline freshness is checked after awaited
  boundaries and immediately before the fake effect call.
- The engine journal uses canonical bounded INTENT/RECEIPT records, a strict
  action/step transition table, contiguous content-addressed filenames, a
  SHA-256 previous-record chain, owner-only stable reads, and no-clobber
  hard-link publication with file and directory fsync. Exact duplicates are
  idempotent; differing duplicate or pending intent is rejected.
- PREPARE admits the existing allocation/data/credential references and then
  permits only internal network, create PostgreSQL, create MinIO, start
  PostgreSQL, start MinIO, and verify READY. READY additionally passes the
  accepted complete two-container effective-inspection validator.
- This packet does not prove database initialization, shellless readiness, or
  authenticated PostgreSQL/MinIO application readiness; those remain b3b2.
- INSPECT does not create or append journal state. It reports READY or
  STOPPED_RETAINED only when current complete authority truth matches the
  durable terminal receipt. Reliable wholly absent truth can report ABSENT only
  before any engine record; every other mismatch is reconciliation-required.
- STOP_RETAIN permits only MinIO stop, PostgreSQL stop, then retained-state
  verification. RETIRE throws a definite pre-effect error and has no stop,
  removal, quarantine, or PURGE path.
- Pending INTENT reconciliation adopts an exact owned effect after observation,
  retries only from reliable absence, and remains ambiguous for incomplete,
  foreign, configuration-mismatched, unknown-result, or possibly effected
  states. A whole-operation definite failure is used only before any prior or
  possible mutation.

## Developer verification

### Independent-review correction pass

The prior independent review supplied eight executable reproducers covering
seven P2 findings. All eight were first rerun against the prior implementation,
then adapted into repository regression coverage with corrected expectations.
The correction binds helper pending observation to the original signed
PREPARE/STOP_RETAIN context without weakening standalone INSPECT; recomputes
caller identity from the canonical signed request and verified installed and
storage identities; carries a gateway-produced signed-freshness callback across
every awaited engine boundary; persists and verifies lifecycle resource
identity provenance; enforces one immutable request/envelope/auth binding per
action group and exact INTENT/RECEIPT command/admission matching; treats
post-effect admission/binding failure as ambiguous; and makes journal reads and
INSPECT non-mutating. Same-inode pending/final evidence remains visible during
read and is reconciled only while holding the mutation path.

The correction also publishes a boot-id/process-start-time diagnostic owner
record from an already identified private inode. Portable tests perform real
inode, size, mtime, and ctime changes between `fstat` snapshots. Automatic
JavaScript stale-owner recovery explored during review was subsequently removed
by the final fail-closed boundary documented below.

### Second independent rereview correction

The second rereview confirmed the original eight reproducers closed and added
four P2 findings. Late START_MINIO and STOP_POSTGRES lost-response replay now
uses an internal mutation-only reconciliation method: it appends the exact
pending step receipt, then appends VERIFY_READY or VERIFY_STOPPED_RETAINED
intent and receipt before helper success. Standalone INSPECT remains readonly
and cannot infer a terminal state from physical truth without that durable
terminal receipt. `resourceAdmissionSha256` is now pinned across every record
in one action group, while the later STOP_RETAIN group retains its separately
signed binding.

The reviewed intermediate design distinguished reliable process absence from
uncertain `/proc` results, but its automatic JavaScript reclaim path is no
longer present. A unique owner inode is opened and immediately identified
before any boot/process read, write, or sync. The complete owner record is fsynced before
hard-link publication to the fixed lock name. Initialization failures remove
only that exact inode and prepublication process death cannot strand the fixed
name. A fully published lock left by process death now deliberately remains a
fail-closed lock.

### Final fail-closed lock correction

The third review exposed a pathname-unlink race in automatic stale reclaim.
The final ultra lock decision removes that recovery design entirely for this
fake-only checkpoint: there is no owner-staleness decision, reclaim hook,
claim-link protocol, or automatic deletion of an existing fixed lock or owner
artifact. Any existing `.engine.lock` returns `RECOVERY_LOCK_HELD` without
mutation, and a publication `EEXIST` is handled the same way without retry.
`unlinkExact` remains only defensive same-invocation cleanup and is explicitly
not treated as an atomic conditional unlink. Tests preserve bytes, device,
inode, and link count for dead-PID, wrong-boot/start, malformed, multi-link and
abandoned-owner fixtures; cover concurrent existing-lock attempts; and prove
one absent-lock publisher wins while its contender leaves the winner inode
unchanged. Normal return, callback failure, and lock-initialization faults
clean only the invocation's own inode. A native OFD lock is a prerequisite for
enabling a production/native lifecycle in Packet 05B1b3b2; process-death locks
remain intentionally fail-closed here.

- `target-engine-foundation.unit.test.ts`: **23/23 passed** (accepted b3b1a).
- `target-engine-journal.unit.test.ts` and
  `target-constrained-engine.unit.test.ts`: **47/47 passed across 2/2 files**.
  The journal suite covers canonical append/hash-chain/replay, retained
  pending/final same-inode publication, conflicting pending evidence, record
  bounds, unsafe roots/files/links/modes/metadata and injected stability
  failures. The engine suite covers direct PREPARE/readonly INSPECT/replay and
  STOP_RETAIN; every lifecycle step's retained INTENT/RECEIPT, effect/lost
  response and post-effect observation windows; authoritative adoption versus
  reliable-absence retry; stale or changed bindings; contradictory terminal
  truth; cancellation/deadline rechecks; whole-operation ambiguity; pre-effect
  RETIRE rejection; and secret-sentinel exclusion.
- The engine suite builds disposable Ed25519 evidence, attestation and
  authorization keys and sends a complete content-addressed
  evidence-v2/capacity-v2/specification-v2/targetSet-v2/attestation-v1/
  plan-v4/admission-v2/outer-v2 request through the real protected loader,
  gateway and helper. STOP_RETAIN and RETIRE use signed disposition-v2 input
  derived from the actual PREPARE response digest and helper sequence.
- Full serialized recovery regression: **345/345 passed across 21/21 files**.
- Accepted b3b1a target-engine foundation: **23/23 passed**.
- Explicit focused-test TypeScript no-emit via
  `tsconfig.recovery-tests.json`: **passed**.
- App, scripts and production-CLI TypeScript no-emit: **passed**.
- Touched ESLint with `--max-warnings=0`: **passed**.
- Backend `npm run build`: **passed**.
- Touched whitespace scan, secret/private-key sentinel scan, production
  worker/native-listener static no-diff check, and accepted-evidence SHA-256
  comparison: **passed**.

Developer QA exposed and corrected three implementation defects before this
evidence was closed: intermediate lifecycle observations could not advance,
an exact not-applied pending later-step INTENT could not retry, and direct
engine calls were not bound to the exact helper operation. A final lint pass
also removed one unused test import. The focused and full serialized suites
were rerun after those corrections.

This is developer evidence for the bounded scripted-authority scope. It does
not claim that Docker, image compatibility, target credential materialization,
PostgreSQL/MinIO readiness, decryption/import or production recovery has run.

### Independent acceptance rereview

A fresh GPT-6.1 Sol ultra read-only review accepted the final fake-only
checkpoint with **no open P1/P2 correctness findings**. Its focused run passed
**70/70** tests across the constrained engine, journal and accepted foundation;
its full serialized recovery run independently passed **345/345 across 21/21
files**. The review confirmed that existing locks and publication races fail
closed without stale-owner cleanup, normal cleanup is restricted to the
invocation's captured inode, all lifecycle/binding/freshness corrections remain
in force, production still constructs the unavailable adapter, and all six
recorded predecessor evidence digests remain unchanged.

Packet 05B1b3b1b is therefore accepted only for this bounded scripted-authority
checkpoint. It is not evidence of a live restore or production-ready engine.

## Remaining gates

Packet 05B1b3b2 remains responsible for decrypt/import, authenticated
application readiness, restored-data reconciliation and validation, and
promotion/rollback. Packet 05B1b4 remains responsible for signed-role,
source-free packaging and installation/trust wiring. Privileged filesystem and
quota proof, real credential materialization, live container/network topology,
load/stress/soak, RPO/RTO, failover, hold release, and production rehearsal are
not claimed.

