# Backup recovery Packet 05B1b3b2b2b1 developer verification — 2026-10-29

## Result and boundary

Implemented an additive authoritative command-v4/inspection-v4 wire, installed
asset and execution-profile contract, narrow read-only credential-use witness,
and fixed Docker backend/observation interfaces. Production remains
`UnavailableRecoveryTargetEngine`, selector-free, and effect-disabled. The
backend production build rejects execution with `ENOTSUP`.

The developer fixture uses temporary owner-only files, Linux local hash APIs,
and a bounded synthetic daemon transcript. It does not contact Docker or any
live service, open a network/SSH connection, use a real credential/key,
decrypt, import, restore, start/stop a service, or publish materialization.

## Fast-release independent-review correction — 2026-10-30

The amended fast-release goal froze further native architecture and required
only the six release-blocking P2 corrections from independent review. All six
were reproduced as permanent focused regressions and corrected without adding
a production backend or changing `UnavailableRecoveryTargetEngine`:

1. Backend admission now exact-binds every command-v4 authorizing field to the
   validated command admission, active authority, credential admission/use,
   original deadline and installed assets. Nineteen cross-context field
   substitutions and an already-expired context fail before the fixture probe.
   All 22 role handles must be distinct and must exactly equal the enrolled
   handle and physical identity for that role; aliases and unrelated identities
   fail before launch.
   Final integration review also found that credential context opening retained
   only the acquired request digest, leaving the already verified installation,
   site and host identities empty. `rtca_open_context` now retains those three
   parsed identities without changing scope or wire bytes. A genuine authority
   acquisition -> credential context -> admitted use -> backend open regression
   passes, while independent substitutions of each retained identity fail.
2. Resource-admission-v3 now also requires exact equality with profile-v4 for
   physical allocation identity, allocation ledger head, daemon compatibility
   and effective policy. Each regression recomputes a canonical self-hash after
   substitution so rejection proves cross-object binding, not only stale-hash
   detection.
3. Every admitted credential use re-reads and validates the exact protected
   journal, admission receipt and credential state before and after descriptor
   checks, then rechecks the original realtime and monotonic deadlines. A
   same-inode/same-size receipt byte corruption is permanently rejected while
   the witness remains secret-free.
4. Observation now derives the exact command semantic digest. Backend success
   verifies that digest and every echoed command identity, adds the exact wire
   digest, and proves the inspection can encode, parse and re-encode.
5. Observation now requires the complete exact enrolled PostgreSQL and MinIO
   consumer identities plus their exact consumer-set digest. Foreign one-byte,
   incomplete/count and multiple-consumer substitutions fail closed.
6. The C inspection parser accepts both canonical `absence_reliable=false` and
   `absence_reliable=true`; shared TypeScript-format golden bytes round-trip
   byte-for-byte in C for both values.

Correction verification is exact and local-only:

- wire/backend: **1/1 Node subtest**, **61/61 native inner checks**;
- credential authority/backend integration: **1/1 Node subtest**, **78/78
  native inner checks**;
- direct authority and executor/materialization predecessors: **1/1** each,
  retaining **46/46** and **41/41** native inner baselines;
- focused TypeScript wire/assets/profile: **26/26 across 2/2 files**;
- the final integration-correction full recovery regression, run exactly once
  after the bounded fix stabilized: **429/429 across 27/27 files** in **63.99s**;
- four no-emit configurations, touched ESLint with zero warnings, backend
  build, strict production/test C compilation, touched whitespace, secret,
  generic-exec, production-Unavailable, source and evidence scans: **passed**.

Strict production C initially found one compile-only warning: the new
post-observation verifier was fixture-only but visible as an unused production
function. Moving it under the existing test compile gate corrected the warning
without changing production or fixture behavior.

The independent P3 backlog is explicitly deferred under the fast-release
amendment: C accepts 120 characters; TypeScript accepts 119. Operation/role
encoder hardening and TypeScript semantic prevalidation are also deferred.
Advanced native bootstrap,
lifecycle, signed installation/trust selection and every-effect automation also
remain deferred; production execution continues to return `ENOTSUP` and the
installed helper remains unavailable.

Independent final re-review accepted and froze Packet 05B1b3b2b2b1 with no
open P1/P2 findings. The reviewer independently confirmed the genuine
authority -> credential context -> admitted-use -> backend-open boundary,
verified that each installation/site/host substitution fails, and reran the
focused **78/78** credential/integration and **61/61** wire/backend native
checks. The production and deferred-live boundaries above remain unchanged.

## Implemented controls

- TypeScript and C share exact command-v4 and inspection-v4 field order,
  grammar, bounds, parse/re-encode, and domain-separated wire hashes. Semantic
  authorization and executed-wire identity are distinct.
- Command-v4 binds the complete installation/site/host/operation/target,
  acquired request, execution profile/admission, exact historical credential
  receipt, fresh credential-use witness, authority instance/generation and
  challenge, distinct action nonce, materialization head, deadline, and exact
  installed manifest.
- The additive admitted-use API neither creates, reconciles, rotates, repairs,
  publishes, nor extends provisioning. It retains the active acquired session
  and original realtime/monotonic deadline and revalidates protected roots,
  content form, private HMAC commitment, physical descriptors, and admission.
- Installed-assets-v1 gives exact complete descriptor/image enumeration for the
  fixed Docker ELF, client config, Unix daemon/API, immutable preloaded images,
  config/bootstrap/probe assets, numeric users/userns mapping, and policy
  digests. Missing or unproved evidence remains unavailable.
- Execution-profile-v4/resource-admission-v3 bind all historical credential and
  allocation evidence plus fresh use/assets/daemon/effective policy while
  keeping dispatch, materialization, and lifecycle false.
- Backend entry points are `open_context`, `validate`, `execute_fixed`,
  `observe`, `cancel_join`, and `close`. The handle map is complete and bounded.
  There is no generic command surface, implicit pull, ambient context/proxy,
  auth-helper/plugin, deletion, purge, or caller-selected endpoint.
- The compile-gated backend opens and verifies its harmless test ELF descriptor,
  executes it by descriptor with fixed argv and a fresh `LANG`/`LC_ALL`-only
  environment, creates a process group, requires affirmative direct-child exit
  zero, joins, and proves negative group liveness. The accepted executor suite
  remains the deeper cancel/deadline/signal/descendant boundary.
- Observation parses synthetic raw daemon fields independently and derives
  projections from actual observed fields. Exact enumeration, daemon, image,
  network, configuration, owner, duplicate, contradiction, truncation, and
  trailing-byte conditions fail closed.

## Developer verification

- New C/TypeScript wire/backend golden fixture: **1/1 Node subtest**, **61/61 native
  inner checks**, strict `-std=c11 -O2 -Wall -Wextra -Werror`.
- Focused TypeScript wire-v4 and installed-assets/profile matrices: **26/26
  passed** across **2/2 files**.
- Strict production object compilation for wire, backend, observation, and
  updated credential authority: **passed**.
- Accepted credential authority, reopened engine authority, and executor /
  materialization native suites: **passed** (accepted inner baselines **78/78**,
  **46/46**, and **41/41** respectively).
- Full serialized recovery regression: **429/429 passed across 27/27 files**.
- The prior accepted all-native baseline remains **29/29**. Under the amended
  focused cadence, the changed wire/backend and credential suites plus their
  direct authority/executor predecessors were rerun; their current inner counts
  are **61/61**, **78/78**, **46/46**, and **41/41** respectively.
- Four TypeScript no-emit configurations, touched lint with zero warnings,
  backend build, strict production/test C compilation, touched whitespace,
  private-key/secret, generic-exec/materialization, and production-Unavailable
  selector scans: **passed**.

Final source hashes:

- `recovery-target-engine-wire-v4.c` `d94e2bcc112880b2e39a1f870478179e543964f5d4e79fabaffc39012e24e9d7`
- `recovery-target-engine-wire-v4.h` `fc1d90f793ede5e671660cef950386d9477f22e7b2e5a0cd3bc5742e8f5097bb`
- `recovery-target-docker-backend.c` `897291845e1a34668ecefe0b0d7991a3177f8bcbbc0a4c49eecda2620062df35`
- `recovery-target-docker-backend.h` `8cbb40090b75d52801742e973e7a21178d63aae8583cc57d401c2f3595290039`
- `recovery-target-docker-observation.c` `19c59a08be7256122be08fde7d6da9965174792a63c4a95e6d525914c125ffce`
- `recovery-target-docker-observation.h` `3049c07702e58d39f9fcefbea7383864f290cc45a2f4de1248498a5d634608fa`
- `target-native-engine-wire-v4.ts` `4fc42882b575a92be8e25d7af1b27969e745c2173cc04b71010f38e40ccd28cd`
- `target-native-engine-execution-profile-v4.ts` `5e4064300e23da8d766d00bd79fd8dee24a940d76078525f5c3be9453e94966b`
- `target-native-engine-asset-manifest.ts` `3c6dd306ad7e08027da742a80a68bf9e8136125299d131d77d16b0515aae0f08`

The additive admitted-use API establishes a new credential-authority source
baseline without changing credential scope/profile-v3/admission-v2 bytes:

- `recovery-target-credential-authority.c` `2615732add7e9bb5bd12ff7151c4b06d96c0d2d318e33690adc014a6f85b0bdb`
- `recovery-target-credential-authority.h` `2086c7f20cc67ab820b9942277e14d041bf6b53713f88a37d2ce808a5384786b`

The accepted lease-v2 active-session implementation remains exactly
`f65743b9…` / `c96cf4c5…` for authority C/header.

## Observed defects and corrections

1. The first strict C fixture lacked the feature-test macro for `O_CLOEXEC` and
   had two misleading one-line conditionals. The macro and statement boundaries
   were corrected; strict warnings-as-errors compilation passes.
2. Negative parser cases zero the destination structure by design. The fixture
   now reparses the canonical command before observation, avoiding reuse of a
   rejected parse result.
3. A first focused Vitest invocation combined a configured worker floor with a
   conflicting CLI maximum. It performed no tests; the serialized single-fork
   invocation was used and passed 7/7.
4. The first observation parser validated configuration/owner digest grammar
   but did not compare those values with enrollment. Exact PostgreSQL/MinIO
   configuration and owner bindings were added; the permanent mutations fail.
5. The first harmless backend probe used `O_NOFOLLOW` on `/proc/self/exe`, which
   correctly rejected the procfs link. The compile-gated probe now opens the
   fixed procfs identity and immediately verifies the resulting regular ELF
   descriptor before `execveat`; production remains `ENOTSUP`.

## Bounded implementation loops

1. Contract loop: implemented TS/C wire, assets/profile, credential-use, and
   backend/observation, then passed strict compilation and focused goldens.
2. Adversarial loop: expanded to 32 native and 26 TypeScript cases, found and
   fixed missing configuration/owner equality plus the procfs fixture open
   defect, and reran only the affected focused suites.
3. Regression loop: passed 429 recovery tests, all 29 native Node subtests,
   four no-emit configurations, lint, build, static scans, and final hashes.

No unchanged loop was rerun after its settled passing checkpoint.

## Residual release gates

Actual installed Docker ELF/image/rootfs identity, daemon compatibility,
permissions, user namespace, quota/cgroup/mount policy, authenticated readiness,
service lifecycle, crash behavior, signed-role installation/selection, restore,
application validation, promotion/rollback, topology/fleet, capacity/load/soak,
failover, and RPO/RTO evidence are deliberately deferred. No developer fixture
result in this packet is represented as those release gates.
