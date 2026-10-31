# Backup/recovery Packet 3 developer verification — 2026-10-28

## Scope and evidence boundary

This is bounded developer evidence from the current uncommitted `release-01`
worktree. It is **not** a human-QA result, a release approval, a production backup,
a retention proof, or a restore/recovery rehearsal. QA must record the frozen commit,
build and deployment policy separately.

Packet 3 implements and exercises the local encrypted-publication building blocks:
strict configuration-capsule intake, deterministic component inventories and packages,
pinned native `age` encryption, a signed manifest contract, atomic filesystem
publication/read-back, PostgreSQL publication fencing, restart reconciliation and
offline repository discovery. The production worker now composes a pinned, narrow
host-helper client at startup and injects the configuration contract, manifest
signer/verifier and publication inspector. It does not yet provide the deployable
privileged host-helper service/executable or an exact cross-role configuration-capsule
producer, retention, restore, promotion, player recovery or the final operator UI.

## Review-found defects corrected

1. Configuration-capsule validation now rejects undeclared files, directories,
   symlinks and special entries instead of validating only declared leaf files.
2. An oversized helper response now terminates the entire helper process group with
   bounded TERM/KILL escalation, including a child that ignores SIGTERM.
3. Publication fencing now reads the database clock after waiting for the authority
   row lock, preventing stale lease/deadline decisions under contention.
4. Capsule and publication staging permissions are restricted to `0700` directories
   and `0600` files.
5. Capacity planning reserves raw capture, every package and the largest in-flight
   ciphertext, and native `age` ENOSPC/EDQUOT is a stable non-retryable prerequisite.
6. Legacy archive garbage collection protects the canonical archive prefix of an
   active backup instead of deleting bytes needed by that run.
7. restart reconciliation and execution use the same per-site PostgreSQL advisory
   lock, preventing inspection/adoption from racing a live publisher.
8. Settings-route coverage uses a test-only database URL and confirms local
   repository history cannot be downloaded or deleted before retention protection is
   implemented.

## Automated developer results

- Server TypeScript build: passed.
- Backup unit suite: 15 files, 53/53 tests passed.
- Disposable PostgreSQL integration and route/GC coverage: 32/32 tests passed
  (coordination 12, publication store 5, settings routes 11, garbage collection 4).
- Native pinned `age v1.3.2`: a 2 MiB input encrypted and decrypted with identical
  SHA-256 output.
- Native wrong-private-key decryption: rejected; no accepted plaintext output.
- Native truncated-ciphertext decryption: rejected; no accepted plaintext output.
- `git diff --check`: passed for the reviewed worktree state.
- The disposable PostgreSQL container, test image and temporary workspaces used by
  these checks were removed after execution.

### Runtime-composition refresh

After the original primitive-only review, the current worker composition was added
and independently rechecked on 2026-10-28:

- Server TypeScript build: passed.
- Focused `src/backups` unit suite: 16 files, 60/60 tests passed.
- `git diff --check`: passed.
- The worker now negotiates one pinned helper policy and injects its configuration
  contract, manifest signer/verifier and publication inspector.
- Manifest signing accepts only the canonical unsigned manifest for the configured
  site/run/attempt; helper output, duration and process termination are bounded.
- Publication-boundary failure preserves the immutable attempt/publication identity
  for fenced reconciliation. Transient repository/helper/database failures are
  preserved for retry rather than classified as corrupt or absent.

These are focused developer checks. No API/CMS/player application stack, production
PostgreSQL/MinIO topology, real privileged helper, power-loss boundary or restore was
started for this refresh.

## Production deployment remains incomplete and fail-closed

- `runFullBackup` requires injected `signer`, `verifier` and
  `configurationContract` dependencies for `LOCAL_FILESYSTEM`; the worker now injects
  these through `createLocalBackupWorkerRuntime`, and recurring reconciliation injects
  the matching publication inspector.
- Worker startup fails visibly when the configured pinned helper cannot negotiate the
  expected site/version/policy. This prevents unsigned publication, but the repository
  still does not ship the actual privileged helper/service required by production.
- No deployed service currently gathers the versioned recovery configuration from all
  required VM roles. A Backend-only process cannot truthfully reconstruct Data, CMS,
  Valkey and Observability secrets/configuration by itself.
- The current helper contract lists logical name/required/max bytes only; it does not
  yet bind exact source identity, deployment generation, expected owner/mode or a
  retained manifest-verification key set for production rotation/recovery.
- The worker currently owns the writable repository path. A compromised worker could
  therefore delete prior local backups unless publication/retention is moved behind a
  narrower host-side authority.

## Confirmed architecture and remaining deployment inputs

The confirmed requirement is a narrow deployment/host helper on the Backend VM; the
API must not receive unrestricted host or Docker access. The production design should
use a root-owned, narrow Unix-socket broker or an equivalently isolated fixed-operation
helper. It should
accept structured site/run/attempt/capture identities and a schema-validated manifest,
not arbitrary commands, paths or signing payloads. It should own the repository
publication and retention operations and hold a dedicated Ed25519 manifest-signing key.
The worker should receive only the manifest-verification public key, the public `age`
recipient and restricted socket access. The private `age` recovery identity should stay
outside the application VMs. This manifest key must be distinct from release-signing,
recovery-attestation and encryption keys.

The deployment process should stage one versioned, encrypted cross-VM configuration
capsule whose exact file allowlist, modes, identities and checksums are part of the
signed policy. An independent encrypted copy outside the Backend VM/shared site is
required when the deployment promises recovery from shared-host/shared-disk/whole-site
loss; the local repository covers Data-VM loss only while the Backend backup disk
survives.

The remaining inputs are deployment evidence, not an unresolved product choice:
repository path/device/owner/capacity, site/repository IDs, daily time/timezone, age
recipient/key ID, manifest trust/key rotation, the exact cross-role configuration
inventory and source locations, and the failure domains promised by that site.

## QA and release gates still open

QA must execute the new `BKP-21..30` cases on the frozen build after the production
helper/capsule implementation and site-specific trust inputs are wired. Developer
evidence does not prove a real
PostgreSQL+MinIO+configuration full run through the production worker, a restart at
every publication boundary, retention expiry, clean restore, service promotion,
measured RPO/RTO, whole-site loss recovery, Windows/physical-display behavior,
production load/stress/soak or a full multi-VM deployment rehearsal.

## Protocol-v2 broker bounded slice (later 2026-10-28 refresh)

The repository now also contains a strict protocol-v2 Unix-socket broker,
bounded client, signed exact capsule-policy schema, dependency-free executable
bridge and broker image entrypoint. This refresh does not supersede the
integration boundary above: the existing worker remains on v1/repository-owned
publication even though the spool adapter and durable broker journal now exist.
The production worker and generated Compose have not been switched, so there is
no silent downgrade or premature production activation.

Focused developer evidence:

- `npm run build`: passed.
- `npm run build:production`: passed.
- `npx vitest run --config vitest.unit.config.ts src/backups/backup-broker-protocol.unit.test.ts`:
  22/22 passed.
- `npx vitest run --config vitest.unit.config.ts src/backups/backup-broker-protocol.unit.test.ts src/backups/backup-host-helper.unit.test.ts src/backups/configuration-capsule.unit.test.ts`:
  29/29 passed.
- `npx vitest run src/backups --config vitest.unit.config.ts`:
  89/89 passed across 18 backup test files.
- Covered duplicate/unknown/oversized request rejection; socket `0660`; exact
  site/repository/policy/capsule-generation binding; real Ed25519 prepare
  signatures; retained old verification key; exact replay and changed-digest
  conflict; and broker cancellation after client disconnect.
- Node's standard Unix socket API has no `SO_PEERCRED`; private socket
  owner/group/mode is implemented, while per-peer kernel credential inspection
  remains a named hardening gate.
- Generated bundle service/mount wiring, worker spool integration, a real
  deployment capsule and Docker topology execution remain pending. No retention,
  delete or restore API was added.

Security-review follow-up replaced the original broad `.key`/`.pem` capsule
exclusion with explicit backup-authority exclusions, so required encrypted TLS
private keys remain eligible. PREPARE no longer signs an arbitrary digest: it
strictly parses, canonicalizes, identity/policy/artifact-binds and directly signs
the canonical unsigned manifest. Negative coverage proves malformed,
noncanonical, unknown-field, wrong site/run/attempt/capture/generation,
repository/release/age-key and capsule-artifact manifests receive no signature.
The final review pass additionally requires the exact three database, objects
and configuration artifacts, derives and validates the capsule inventory digest,
checks actual capsule size/digest, preserves a live broker socket when a second
listener starts, guards stale-socket removal with the socket device/inode
identity to prevent a replacement race, and uses UTF-8 byte ordering rather
than locale-sensitive JSON key sorting.

## Durable broker journal and spool adapter refresh

The broker now persists bounded replay evidence and monotonic publication claims
in a strict repository-owned journal using file fsync, same-filesystem atomic
rename and directory fsync. Responses up to one MiB are stored directly; larger
immutable capsule responses retain request/response digests and must reconstruct
byte-identically on replay. It distinguishes unsigned canonical-manifest digest
from final signed-manifest digest, fences one run id to one attempt/capture,
rejects mismatched INSPECT digests, and never revives committed/quarantined
state. Framing now waits for exactly one newline frame plus write EOF with an
`allowHalfOpen` server before async work.

The new repository adapter verifies deterministic read-only spool ciphertext,
copies into broker-owned incomplete storage, supplies the active encrypted
capsule, and reuses the existing signed-manifest, intent, atomic rename,
read-back and receipt formats. Focused developer result: `npm run build` passed;
the broker protocol/journal, spool adapter, legacy helper/capsule and repository
publication suites passed 32/32. Generated compose/worker spool integration,
real multi-container execution and exhaustive crash fault injection remain open.
The complete focused `src/backups` unit run passed 80/80 across 18 files after
this refresh.

Primary-review correction subsequently bounded large immutable SELECT replay to
compact request/response digests, made prepared attempt paths deterministic and
restart-reconcilable, and made COMMIT reconcile exact published repository truth
before relying on an incomplete attempt path. Tests inject the after-prepare and
after-publish/before-journal boundaries. Destination copies now loop on partial
writes, journal failures remove temporary files before rename, and broker startup
strictly parses numeric identities/owners/capacity while deriving spool device
identity from the validated spool root.
Final focused backup result after these corrections: 85/85 tests passed across
18 files; the server TypeScript build and scoped diff check also passed.

The next prerequisite hardening keeps DESCRIBE/SELECT/INSPECT polling out of the
durable replay journal, separates 60-second read deadlines from immutable
mutation deadlines up to four hours, bounds spool input before streaming with
nonblocking/no-follow leaf opens, and makes receipt repair abort-safe before
completion evidence creation. COMMIT and repository-backed INSPECT now expose
canonical signed-manifest, intent, receipt, verified read-back and relative-path
evidence; journal/repository disagreement fails closed. Tests also cover health
polling journal size, mutation/control deadline separation, FIFO and oversize
spool inputs, abort during receipt repair, repository tampering, and preservation
of uncertain deterministic prepared evidence.
After this pass, both normal and production TypeScript builds passed, the full
focused backup suite passed 89/89 across 18 files, and the scoped diff check
passed. The receipt-abort test injects cancellation immediately before repair
write; it does not claim every possible kernel-level abort timing.

## Worker protocol-v2 spool integration refresh

The production code now has an explicit `V2_BROKER` worker path that receives a
protected public manifest keyring, a private ciphertext spool and the broker
socket, without opening the backup repository or invoking the protocol-v1
capsule helper. Protocol selection is explicit and has no fallback. The worker
validates DESCRIBE policy/capability identity, the selected encrypted capsule,
the broker manifest signature and both manifest digest domains.

The brokered orchestrator preserves the capture barrier for database/object
capture, releases it before packaging and encryption, fsyncs the ciphertext
handoff, and follows PREPARE -> migration-0051 database intent -> COMMIT ->
repository-evidence validation -> conditional database completion. Broker
PREPARE supplies the exact incomplete and published repository-relative paths;
the worker no longer invents a private broker path. Mutating request IDs and the
authoritative attempt deadline are fsynced in the owned spool and reused
byte-identically after restart. Unknown or cancelled COMMIT outcomes are marked
`UNCERTAIN`; plaintext is removed only from a positively owned spool tree while
ciphertext evidence is preserved.

Developer verification after the correction pass:

- `npx vitest run src/backups src/config/production-policy.unit.test.ts src/utils/backup-runs-v2-isolation.unit.test.ts --config vitest.unit.config.ts`:
  114/114 passed across 24 files.
- `npm run build`: passed.
- `npm run build:production`: passed.
- `git diff --check`: passed.

Coverage includes exact restart request replay, changed-deadline rejection,
broker-authoritative publication paths, fsync-before-PREPARE ordering, keyring
and capsule mismatch, corrupted evidence, successful/unknown/cancelled COMMIT,
missing-SQL PREPARED/COMMITTED inconsistencies, and explicit v2 isolation from
the repository and v1 helper.

The generated production bundle has not been switched yet. Broker service
mount isolation, deployment policy/capsule/key production, an actual
PostgreSQL+MinIO+worker+broker run, power-loss fault injection, successor retry
after quarantine and operator health presentation remain open Packet-3 gates.

## Public capsule descriptor publication binding

Brokered manifest v2 now binds the externally trusted public capsule descriptor
SHA-256, capsule generation and encrypted-inventory SHA-256. The descriptor is
intentionally limited to public identities, ciphertext size/hash, production
contract id, generation compatibility, exact deployed roles and the encrypted
inventory digest; secret paths, per-secret hashes and restore metadata remain
inside `configuration.tar.age`.

The broker writes the canonical signed descriptor as
`configuration-policy.json` into broker-owned prepared storage and publishes it
atomically with the run. It remains metadata, not a fourth artifact: the signed
manifest and publication intent still contain exactly the database, objects and
configuration ciphertext artifacts. Repository-backed COMMIT/INSPECT opens the
descriptor and manifest with no-follow bounded protected reads, verifies exact
descriptor bytes/digest against the trusted startup descriptor, checks manifest
identity and policy binding, and verifies the configuration artifact size/hash.
Missing, tampered or externally mismatched descriptor metadata fails closed.
Publication evidence now returns the canonical descriptor and its bound digest
identities alongside the canonical signed manifest, intent and receipt.

Immutable DESCRIBE and SELECT requests now bypass the durable journal mutation
queue, so a long ciphertext copy cannot make the broker health endpoint wait
behind PREPARE/COMMIT. INSPECT remains serialized because it reconciles journal
and repository truth. A blocked-PREPARE regression proves DESCRIBE completes
without creating or growing journal state.

Developer verification for this correction:

- `npx vitest run --config vitest.unit.config.ts src/backups`: 107/107 passed
  across 23 files.
- `npm run build`: passed.
- `npm run build:production`: passed.
- Focused descriptor, manifest, broker and worker evidence suites: 37/37 passed
  before the full backup run (the manifest suite subsequently gained one v2
  compatibility test included in the 107 total).

## Low-resource live Docker publication smoke

A final isolated live smoke used the current `dist-production` mounted
read-only into local `node:20-bookworm` containers. It did not start PostgreSQL,
MinIO, the API, the full worker or any browser container. The broker and each
short-lived client ran as uid/gid `1000:1000`, with `--network none`, read-only
root filesystem, `--cap-drop ALL`, a no-exec tmpfs and explicit CPU, memory and
PID limits. Docker inspection confirmed the broker limit set was 0.50 CPU,
256 MiB memory with no additional swap, and 64 PIDs.

The successful serial lifecycle was:

1. Create a disposable repository, broker socket directory, read-only worker
   spool, real Ed25519 policy/manifest keys, signed public capsule descriptor,
   synthetic encrypted capsule, and small database/object ciphertext files.
2. Start the broker and issue a real canonical manifest-v2 PREPARE over its Unix
   socket. The unsigned digest was
   `6d1c011d0ecefbacd6fd18fe9c8d31ab0048aab30fe8575fa2dafe785b0219fb`;
   the resulting signed-manifest digest was
   `e6d7a66907997d0e9b548c0b323be6d913f33d73e5b910f843e66589c9f7ea41`.
3. Stop and remove the broker at the PREPARED boundary, restart it against the
   same repository, and replay the exact PREPARE request id, deadline and bytes.
   The response was byte-for-byte canonical-JSON identical.
4. COMMIT and repository-backed INSPECT succeeded. The public descriptor digest
   was `4013516fe2f57099f7bca31bfa6f873e62c9b507454fc0f126d218abd6e934f7`.
   The client verified the manifest Ed25519 signature and exact three-artifact
   evidence. Direct read-back found exactly:
   `configuration-policy.json`, `configuration.tar.age`, `database.tar.age`,
   `manifest.json`, `objects.tar.age`, `publication-intent.json`, and
   `publication-receipt.json`; every ciphertext was a mode-0600 regular file
   with the signed size and SHA-256.
5. After one byte of the published descriptor was changed, INSPECT failed closed
   with `BROKER_REPOSITORY_TRUTH_MISMATCH`. A separate hardened broker launch
   with the protected input mount omitted exited status 1 with the bounded
   startup-failure path.

Sampled broker usage was `12.85 MiB / 256 MiB`, 11 PIDs and 0.00% CPU after
PREPARE, and `13.93 MiB / 256 MiB`, 11 PIDs and 0.00% CPU after COMMIT. Host
headroom was approximately 2.9 GiB available RAM and 335 GiB free disk before
and after. All disposable containers, fixture directories and the temporary
smoke harness were removed; no Packet-3 smoke container remained. No product
defect or source change was required. The first harness execution reached all
functional assertions but used an incorrect expectation that Docker exposes an
empty network map for `--network none`; Docker exposes the `none` network entry.
The assertion was corrected in the disposable harness and the entire lifecycle
was rerun from a fresh repository to obtain the successful result above.

## Production capsule, bundle and primary-review acceptance refresh

This later section supersedes earlier statements in this evidence file that the
cross-role producer and generated v2 bundle were not wired. The production bundle
now explicitly supports `V2_BROKER`; v1 and legacy off-host policies remain separate
and there is no automatic fallback.

The current producer uses a finite, versioned five-role contract for Backend, Data,
CMS, Valkey and Observability runtime environment, configuration, TLS material and
durable runtime secrets. The three self-referential Backend capsule/policy overlay
fields are excluded from the encrypted base environment and are derived from the
outer signed descriptor. The active manifest signing key is supplied from protected
deployment custody, must match the retained public keyring and is encrypted as a
recovery secret; retained older public keys are preserved. Release-signing,
capsule-policy-signing, old manifest private and private age recovery keys are not
included.

The public signed capsule descriptor contains only non-secret identity, ciphertext,
contract and encrypted-inventory bindings. Exact paths, modes, owners, size limits and
content hashes are held in canonical `capsule-inventory.json` inside the age-encrypted
capsule. Decrypt-time validation rejects missing/unexpected files, symlinks,
hardlinks, special files, wrong modes, oversize files, digest mismatches and an
inventory that does not exactly match the compiled production contract. Policy trust
and manifest keyrings accept only canonical Ed25519 public SPKI PEM; private PEM or a
different algorithm is rejected before any public worker mount is created.

Generated Compose runs the broker as uid/gid 1000 with no network, a read-only root,
all capabilities dropped, no application environment, no Docker socket/host PID and
explicit CPU/memory/PID limits. Every required v2 broker/worker input uses long bind
syntax with `create_host_path: false`. Only the broker receives repository write
authority and the active signing key; the worker receives the ciphertext spool,
socket and public keyring; the API receives none of these mounts.

Primary-agent verification on 2026-10-28:

- Production config contract: 16/16 passed.
- Final focused backup suite, including the encrypted-inventory canonical-order
  regression: 109/109 passed across 24 files.
- `npm run typecheck:scripts`: passed.
- `npm run build:production`: passed.
- `git diff --check`: passed.
- Full source-free acceptance for explicit v1, legacy off-host and produced v2,
  across internal-CA and provided-TLS modes: passed after one observed defect was
  corrected.
- The v2 acceptance uses the pinned, SHA-256-verified age v1.3.2 binary; correct-key
  decryption and exact decrypted-inventory validation pass, while wrong-key,
  ciphertext tampering, decrypted-content tampering and a missing inventory fail.
- Generated v2 Compose parses successfully. No Docker container was started by this
  acceptance run and its disposable workspace was removed.

Observed-and-fixed loop-3 defect: the first independent source-free run decrypted the
capsule but rejected `backend/.env.production` because restore-owner validation relied
on JSON property order (`uid,gid`) while canonical JSON sorts it as (`gid,uid`). The
validator now checks the exact owner property set and numeric values without depending
on insertion order, and the new unit regression exercises the canonical serialized
form.

Packet 3 is **developer-complete for its bounded repository/encryption acceptance**,
but this is not a QA or release pass. The separate live Docker section records the
successful PREPARE/restart/replay/COMMIT/INSPECT lifecycle, missing-mount failure and
tamper rejection. Full PostgreSQL+MinIO application backup/restore, operator-facing
recovery application of the decrypted capsule, destructive power-loss testing and
production sizing remain later developer, Packet-5 or representative-environment
QA/release gates as stated in the goal.

