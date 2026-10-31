# Backup recovery Packet 05B1b3b1a developer verification — 2026-10-29

## Result and safety boundary

Implemented only the strict private-authority and Docker execution/inspection
contract foundation. Production worker, native listener, engine adapter
factory, and runtime installation wiring were not changed. Production remains
hard-wired to `UnavailableRecoveryTargetEngine`; no environment selector was
added. The current v2/v4 production path remains
`RECOVERY_TARGET_EFFECT_INELIGIBLE` at the deferred evidence/attestation wiring
gate, and no READY, STOPPED_RETAINED, or RETIRED effect was enabled.

Verification used in-memory canonical JSON, an unmistakably test-only scripted
authority, source inspection, and existing deterministic fake-engine fixtures.
It did not invoke Docker/Podman, Compose, pull/build, a live service, network,
SSH, a native listener, production private key, target credential, decrypt,
import, or restore.

## Implemented foundation

- Execution-profile-v1 binds the exact complete signed ENGINE_PROFILE-v2
  envelope digest. Protected-Docker-inventory-v1 binds the exact complete
  signed PROTECTION_INVENTORY-v2 envelope digest. A downstream private
  enrollment binds both canonical record digests and both upstream envelope
  digests without changing or feeding back into evidence-v2, specification-v2,
  targetSetId-v2, attestation-v1, plan-v4, or authorization-v2.
- The canonical bounded profile fixes Docker binary path/content digest,
  protected config directory, Unix daemon/socket/API identities, immutable
  PostgreSQL/MinIO images and image configs, linux/amd64, no declared volumes,
  direct entrypoint/argv/workdir, numeric uid/gid, fresh exact environment,
  opaque credential file handles, read-only rootfs, exact tmpfs, cap-drop ALL,
  NNP, pinned seccomp/LSM, private namespaces, no devices/groups, bounded
  resources, local logging, restart=no, autoremove=false, direct health policy,
  fixed internal network, no ports, and opaque bind-source handles.
- Protected inventory covers production containers, networks, volumes, bind
  roots, repository/release/config/control/socket identities with dev/inode/
  mount identity, consumer lists, and ancestor/alias relationships. Every list
  is bounded, canonical, unique, and explicitly complete.
- The private `TargetResourceAuthority` has read-profile, read-inventory, and
  sanitized-inspect operations by opaque handle only. It has no caller path,
  argv, endpoint, credential, generic exec, or lifecycle mutation API. The only
  implementation is `TestOnlyScriptedTargetResourceAuthority`, which requires
  a literal non-production marker and exact call script.
- The pure command planner emits only fixed operations/roles and opaque handles.
  The sanitized effective-inspect parser is strict and bounded, validates every
  reviewed effective field, requires complete enumeration, rejects protected
  overlap and foreign consumers, and returns hashes/opaque identities only.

## Independent-review correction closeout

All four P2 and four P3 findings were reproduced and corrected. The exported
validator canonically encodes and reparses typed profiles and inventories
before use, so mutated casts cannot bypass strict fields or literal completeness
flags. Memory/swap/CPU/shares/PIDs/shm limits are strictly positive; memory and
CPU coherence checks reject zero and inverted bounds.

Every protected container, network, volume, and bind root carries a bounded
canonical consumer list. Consumers must name enrolled protected container IDs;
expected target CIDs and unknown/foreign CIDs fail closed. Target CIDs and the
target network ID are also compared directly with protected production IDs.
Relationship endpoints now have strict PROTECTED/CANDIDATE domains and role
enums. Protected endpoints must be enrolled at that exact role; candidate
endpoints must equal the exact profile network/container/bind handle.
Protected-to-candidate ANCESTOR, candidate-to-protected ALIAS, direct overlap,
wrong-role handles, and unknown candidate handles all reject.

Enrollment, profile, and inventory records are strictly reparsed at their
boundaries. The Docker socket digest must equal the protected DAEMON_SOCKET
identity. Credential file references bind an opaque content identity, fixed
destination, numeric owner/group, and mode, all verified in effective mounts.
Enrollment tests now construct complete ENGINE_PROFILE-v2 and
PROTECTION_INVENTORY-v2 bodies, sign their domain-separated canonical payloads
with a disposable Ed25519 key, and bind SHA-256 of each full signed envelope.
No invented digest or partial evidence cast remains in the binding test.

The final identity-alias rereview found that distinct opaque handles could hide
an equal physical identity when no relationship was declared. The validator
now independently compares every candidate data-bind `sourceIdentitySha256`
and credential `credentialIdentitySha256` against protected enrolled-root,
bind-root, and volume physical identity digests. Exact equality rejects before
effective-state acceptance. Canonical reproducers cover repository-root versus
PostgreSQL data, protected bind and volume versus MinIO/PostgreSQL data, and
config-root/protected-bind versus credential identities, all with distinct
handles. A genuinely disjoint inventory still passes. Non-equal ancestor and
alias cases remain explicitly authority-provided relationships; container,
image, network, and unrelated content hashes are not treated as physical-path
identities.

The final credential-handle rereview is also closed. Every credential authority
handle is now included in direct protected-handle overlap detection. Candidate
relationship roles distinguish PostgreSQL password, MinIO root-password, and
MinIO root-user credentials, and each role maps to exactly one enrolled profile
handle. Canonical reproducers reject credential handles equal to protected
CONFIG_ROOT, bind-root, and volume handles even with disjoint physical digests;
protected-to-credential ANCESTOR and credential-to-protected ALIAS edges; and a
PostgreSQL role paired with a MinIO credential handle. The disjoint profile and
inventory continue to pass.

## Adversarial coverage

The focused suite rejects one-field profile changes for unknown shell fields,
mutable image tags, a `SECRET_SENTINEL` password field, and writable rootfs;
duplicate keys; incomplete/unknown inventory fields including a raw Docker
endpoint; planner role/path injection; scripted-authority handle/order
substitution; one-field effective CID, privilege, health, published-port, and
foreign-consumer changes; and protected bind overlap. The normal case validates
the complete profile/inventory/enrollment and a complete two-container internal
network inspection, returning no environment or credential destination.

The production-invariant regression reads the actual worker source, requires
`new UnavailableRecoveryTargetEngine()`, rejects selector/install names, and
proves the unavailable adapter still fails with `TargetEngineNotInstalledError`.

## Commands and exact results

- Focused corrected foundation:
  `npx vitest run --config vitest.unit.config.ts src/recovery/target-engine-foundation.unit.test.ts --pool=forks --poolOptions.forks.singleFork=true`
  — **23/23 passed**, **1/1 file**.
- Foundation plus accepted b3a/b3b0 chain:
  `npx vitest run --config vitest.unit.config.ts src/recovery/target-acyclic-identity.unit.test.ts src/recovery/target-storage-authority.unit.test.ts src/recovery/target-engine-foundation.unit.test.ts --pool=forks --poolOptions.forks.singleFork=true`
  — **58/58 passed**, **3/3 files** (v2/v4 chain **28/28**, storage authority
  **7/7**, corrected foundation **23/23**).
- Full serialized recovery regression:
  `npx vitest run --config vitest.unit.config.ts src/recovery --pool=forks --poolOptions.forks.singleFork=true`
  — **298/298 passed**, **19/19 files**.
- App no-emit (`tsconfig.json`), scripts no-emit (`tsconfig.scripts.json`), and
  production-cli no-emit (`tsconfig.production-cli.json`): **passed**.
- Touched TypeScript ESLint with `--max-warnings=0`: **passed**.
- `npm run build`: **passed**.
- Touched-file whitespace scan, tracked diff check, and accepted-evidence
  SHA-256 comparison: **passed**.

Accepted evidence bytes remain unchanged at the pre-edit digests:

- 05B1a: `81d83a487627bfcbe21c193b77004dc69826a9cdb5db0c34351df1a944acae06`
- 05B1b1: `f4510808fc8e7e949048eeab114eb4dc892860152d9592be7832fe374f144ccf`
- 05B1b2a: `997d991f7555307e4b4252fd0b253d76c2166c313bc257842959910e6e775f8e`
- 05B1b2b: `309ca639511a75acd9dd924f0ca1707e2fd34e807d073271cae0a97dd091e9b3`
- 05B1b3a: `41a596e60c2a1fce78a14f1e19fe42752b2b5164d2de902494c56fc48bf55115`
- 05B1b3b0: `0890dde083320677c42050162c7182b2ac9a3be532136ed2ae144d677b5e0fd0`

## Explicit deferrals and open findings

Packet 05B1b3b1b remains open for an enrolled effectful engine and resource
admission. Packet 05B1b3b2 remains open for lifecycle/journal effects and
post-engine validation integration. Packet 05B1b4 remains open for signed-role,
source-free packaging, installed evidence/attestation trust and service wiring.
No old native quarantine authority was reinterpreted or enabled.

Live Docker/container/network effects, credential materialization, privileged
filesystem/quota and mount-race proof, decrypt/import/restore, application
reconciliation, restored-data validation, promotion/rollback, successful hold
release, live topology, RPO/RTO, load/stress/soak, failover and production
rehearsal remain release gates. No Packet 05B1b3b1a implementation finding is
open; these deferred scopes are intentionally not claimed.
