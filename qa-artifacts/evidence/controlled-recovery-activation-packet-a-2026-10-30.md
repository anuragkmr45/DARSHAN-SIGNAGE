# Controlled Recovery Activation Packet A — Developer Evidence

Date: 2026-10-30

Scope is static fixture implementation only. No Docker command, daemon, service, network, SSH, real credential/key, decrypt, import, restore, promotion, acceptance or rollback operation was performed. Production native recovery remains unavailable / `ENOTSUP` and unselected.

## Implemented foundation

- Fixed installed activation path with exact root ownership/mode/link/type/size and canonical JSON checks.
- Disabled-by-default and explicitly non-production tiny-disposable schemas/examples, fixed release-03/0057 ledger/profile/assets/runtime/build identities and source/keyring/broker/recipient/resource/Packet 2 overlay/report authority bindings.
- CLI effect admission consults activation before profile, broker, key or adapter access; journal `status`/`report` remain separate.
- Root-owned fixed asset hashing, typed local Docker runner methods, ambient substitution rejection, bounded execution contract, preloaded image/runtime transcript verification and exact-ID cleanup shapes.
- PostgreSQL `/var/lib/postgresql/data` and MinIO `/data` mount enrollment with exact mount-set/consumer verification.
- Disk descriptors, bounded streams, streaming deterministic tar/PAX extraction and streaming object-store interfaces; existing Buffer fixtures remain unchanged.
- Source-free bundle stages Packet A schemas/examples for release review; no activation is installed or enabled by this change.

## Developer verification

- Focused Activation Packet A plus direct profile/target/archive predecessor: **4 files / 60 tests passed**.
- Production bundle configuration predecessor: **16/16 tests passed**; assembler shell syntax passed.
- Final post-contract recovery regression, after the extractor's explicit USTAR-magic hardening: **31 files / 497 tests passed**.
- Server build passed.
- Recovery-test, production-CLI and script TypeScript no-emit checks passed.
- Focused Activation Packet A lint passed with zero warnings/errors.
- Static private-key/AWS-key/credential-assignment scan returned no findings.
- `git diff --check` passed; new JSON fixtures parsed; QA CSV shapes remained valid; assembler shell syntax passed.

The fixtures cover disabled/noncanonical/mismatched activation; fixed-path/no-override shape; effect admission before profile/adapter access; regular single-link assets; ambient Docker/proxy rejection; absence of a generic runner; exact daemon/image runtime transcript; collisions, foreign mounts, consumers and configuration; fixed PostgreSQL/MinIO destinations; typed argv without pull/build/prune/Compose/SSH; producer root/trailing directory and PAX records; disk-only extracted descriptors; traversal, link, duplicate, checksum, truncation and expansion failures.

## Residual gates

Activation Packet B must implement the real Packet 1 adapter. Activation Packet C must implement Packet 2 effects and pass disposable Docker E2E. Installed root-owned asset verification, actual local daemon/context/image inspection, broker/key authority, real ciphertext streaming/decryption, PostgreSQL/MinIO import, slow-client/cancellation/backpressure, disk-full/ENOSPC, production topology, promotion/rollback, RTO/maintenance and release approval remain explicitly pending. Packet A is not activation or production readiness evidence.

## Independent-review correction addendum

The bounded Activation A/B/C review found that the initial fixture parser used a custom Docker envelope, keyring file modes differed across loaders, and streaming cancellation did not race a pending iterator read. The corrected foundation parses bounded Docker `context inspect`, `info`, image-inspect and mixed resource-inspect JSON/error output, separately proves the enrolled local Unix context and daemon identity, distinguishes a wholly absent target set from partial/foreign state, uses one root-owned `0600` single-link keyring contract, and closes stalled iterators before the decrypt process authority is released. Realistic focused fixtures passed as part of **6 files / 82 tests**. The initial post-correction full regression passed **33 files / 519 tests**; a final behavior-changing publication-settlement correction was then made and the permitted repeat also passed **33/519**. No Docker executable, daemon, decrypt process, key, network or service was used. Installed-host identity, real Docker error-version coverage, cancellation/ENOSPC and activation enrollment remain pending.

### Final two-P2 verification

Raw Docker container inspection now rejects every non-volume mount and any `HostConfig.Binds` or `HostConfig.Tmpfs` declaration before producing the normalized target model; realistic exact-volume, expected-volume-plus-host-bind and tmpfs fixtures prove the distinction. Archive cancellation now starts and bounds decrypt-process termination/join before awaiting the iterator's queued `return()`, then bounds iterator cleanup as a separate step. A real async generator stalled on its second `next()` proves cancellation settles in `terminate-and-join → generator-finally` order, with no unhandled rejection; a malformed extraction fixture proves `FAILED` process cleanup as well. Final focused results are **6 files / 83 tests**, direct predecessors **4/11**, and the single post-stability full recovery regression **33 files / 520 tests**. Build, recovery/scripts/production-CLI typechecks and focused lint passed. This remains injected/static evidence; no Docker or decrypt process ran.
