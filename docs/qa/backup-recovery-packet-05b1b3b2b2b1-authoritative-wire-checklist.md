# Packet 05B1b3b2b2b1 authoritative wire/backend QA checklist

## Authoritative contracts

- [x] Command-v4 and inspection-v4 use one domain-separated, fixed-order,
  bounded line encoding in TypeScript and C with strict parse/re-encode.
- [x] Semantic and executed-wire digests are distinct; all installation, site,
  host, operation, target, generation, acquired request, profile, admission,
  credential receipt/use, authority, challenge, command nonce, materialization,
  deadline, and installed-asset bindings are carried.
- [x] Action `commandNonce` must differ from the acquired authority challenge.
- [x] Accepted v3 parsers/bytes remain unchanged and no START operation was
  added to v3 or v4.
- [x] TypeScript remains a consumer of native wire/projection records; it does
  not publish a JSON materialization chain.

## Credential and installed-asset admission

- [x] The additive read-only admitted-use API retains the exact active acquired
  session and original nonrenewable credential deadline, rechecks protected
  directory state, fixed credential form, private HMAC commitment, physical
  descriptor, and public historical admission.
- [x] Credential context opening retains the already parsed and verified
  installation, site and host identities. A genuine context -> admitted-use ->
  backend-open regression succeeds; substitution of any identity fails.
- [x] The admitted-use witness exposes only a public opaque digest and physical
  descriptors; values, private commitments, and HMAC key bytes are absent.
- [x] `installed-engine-assets-v1` binds a fixed protected root, Docker ELF,
  client config, local Unix socket/API, pinned preloaded PostgreSQL/MinIO image
  content, bootstrap/config/probe assets, numeric users/userns mapping, and
  effective security/resource/logging/quiescence policies.
- [x] The complete asset enumeration rejects reordered, duplicated, aliased,
  missing, unstable, or self-hash-invalid entries.
- [x] Execution-profile-v4 and backend-resource-admission-v3 bind historical
  profile-v2, credential profile-v3/resource-admission-v2, fresh credential
  use, physical allocation, installed assets, daemon compatibility, and
  effective policy while remaining `UNAVAILABLE`, selector-free, and disabled.

## Fixed backend and observation

- [x] The backend accepts only validated authority, credential-use, fixed role
  handles, fixed digests, and command-v4. It has no caller path, argv, env,
  daemon URL, raw endpoint, flags, tags, Compose/context, pull/build, generic
  exec, remove/prune/network-delete, or PURGE surface.
- [x] Every command-v4 field is exact-bound to the admitted execution context,
  active authority, fresh credential use, original deadline, assets and
  materialization head before launch. Expired and cross-context substitutions
  fail, and all 22 handles must be distinct exact enrolled identities.
- [x] Production `execute_fixed` rejects with `ENOTSUP`; only a compile-gated
  fixture can consume a harmless synthetic daemon transcript.
- [x] Observation independently parses bounded raw daemon fields, rejects
  incomplete enumeration, duplicates, contradictions, trailing bytes, and
  daemon/image/network/owner/config mismatches, then derives projection hashes
  from observed fields rather than caller-expected hashes.
- [x] Observation binds both exact enrolled consumer identities and their exact
  consumer-set digest, and a successful backend inspection contains the exact
  command semantic digest and is canonically encodable.
- [x] Active authority and credential-use witnesses are checked before and
  after fixture observation. Context close refuses an active operation.
- [x] The compile-gated harmless backend probe uses descriptor `execveat`, fixed
  argv, a fresh locale-only environment, a dedicated process group, affirmative
  exit-zero, join, and negative group liveness; accepted executor regressions
  retain TERM/KILL/cancel/deadline/signal/descendant coverage.
- [x] Production helper remains `UnavailableRecoveryTargetEngine` and no
  backend selector or actual Docker lifecycle is installed.

## Developer verification and deferred gates

- [x] Strict C production objects and compile-gated native fixture build with
  `-std=c11 -O2 -Wall -Wextra -Werror`.
- [x] Focused C/TypeScript golden, old-version, reorder, trailing, oversize,
  binding, nonce-alias, raw observation, and mismatch checks pass.
- [x] C accepts canonical `absence_reliable=true` and `false`; shared golden
  bytes parse and re-encode identically to the TypeScript inspection format.
- [x] Fresh credential use re-reads the protected journal/admission/receipt at
  every use boundary and rejects same-inode/same-size receipt corruption.
- [x] Accepted credential/authority/executor suites and recovery regression are
  rerun without changing their accepted wire formats.
- [x] Independent final re-review accepted and froze this local native
  foundation with no open P1/P2 findings. Genuine authority -> credential
  context -> admitted-use -> backend-open succeeds, and independent
  installation/site/host substitutions fail.
- [ ] Actual root-owned asset installation/signing/service selection (b4).
- [ ] Actual Docker daemon/image/auth/readiness/start/stop lifecycle.
- [ ] Decrypt/import/restore/application/promotion/rollback rehearsal.
- [ ] Representative topology, permissions, quota, mounts/cgroups, crash,
  capacity, load/soak, fleet, RPO/RTO evidence.

## Fast-release hardening backlog (P3, explicitly deferred)

- [ ] Align the target-handle maximum: C accepts 120 characters; TypeScript
  accepts 119 characters.
- [ ] Harden operation/role encoders beyond the existing parser and exact
  operation-role validation.
- [ ] Add TypeScript semantic prevalidation before hashing invalid command
  objects, rather than relying on the strict encoder/parser boundary.

The developer fixture uses only temporary files and synthetic transcripts. It
does not use Docker, live services, network/SSH, real credentials or keys,
decryption, import, or restore.
