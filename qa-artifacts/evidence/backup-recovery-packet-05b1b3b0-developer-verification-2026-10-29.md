# Backup recovery Packet 05B1b3b0 developer verification — 2026-10-29

## Result

Packet 05B1b3b0 adds an acyclic versioned prerequisite chain without changing
the meaning of accepted v1 evidence, plan-v3, authorization-v1, or outer-v1
bytes. Installed helpers admit target inspection or mutation only through
stable evidence-v2, capacity-v2, specification-v2, targetSetId-v2, signed
operation-attestation-v1, plan-v4, authorization-v2, and outer-envelope-v2.

Production remains fail-before-effect and still constructs
`UnavailableRecoveryTargetEngine`; no production target engine was enabled.
The production worker does not yet install `evidenceLoaderV2` or
`attestationKeys`, so a v2 envelope currently stops earlier with
`RECOVERY_TARGET_EFFECT_INELIGIBLE`, not `TARGET_NOT_INSTALLED`. Installing
that content/trust wiring remains Packet 05B1b4 scope.

## Dependency order and acceptance

Four independently signed stable evidence-v2 envelopes contain no operation,
generation, target-set, specification, attestation, or plan backreference.
Capacity-v2 then binds operation/generation and their four full signed-envelope
digests. Specification-v2 binds operation/generation/host/topology,
release/logical target, and all five evidence envelopes. targetSetId-v2 is
domain-separated over the canonical specification digest plus
operation/generation/host only. The signed operation attestation binds that
target set and every upstream digest. Plan-v4 records the derivation version
and full attestation-envelope digest; authorization-v2 binds the final plan.

The first acceptance test generates disposable Ed25519 evidence, attestation,
and authorization keys and computes every digest/signature in dependency order,
without repeated placeholder hashes. It loads owner-only content-addressed
temporary files through the production gateway/helper service and reaches only
the deterministic fake adapter with a locked verified storage context.

The suite rejects stable/capacity content, content-addressed name,
specification, target-set, attestation, plan, admission, request, and outer
mutations before journal/effect. It rejects outer-v1/spec-v1/plan-v3/
admission-v1 cross-mixes. Re-derivation proves operation, generation, host, and
specification changes diverge. Signed evidence-v1 and plan-v3 remain readable;
an installed identity-v2 rejects their INSPECT and PREPARE requests with
`RECOVERY_TARGET_EFFECT_INELIGIBLE`, zero engine calls, and no journal.

Independent-review corrections add semantic checks using fully re-signed and
newly content-addressed chains, rather than corrupt-signature shortcuts. All
four inventory path identities must equal the installed ACTIVE, QUARANTINE,
POOL, and CONTROL roots. Specification topology must exactly equal signed host
policy and installed host mode. Every inventory filesystem must be explicitly
listed by host policy. Each mismatch fails before journal/effect. Authorization,
attestation, all evidence validity windows, cancellation, and the execution
deadline are rechecked after asynchronous evidence loading and again under the
helper lock immediately before adapter inspection/effect.

The reconciliation rereview is also closed. An ambiguous retained PREPARE is
inspected under the existing helper lock, then freshness is checked after that
await and checked once more immediately before a safe retry could invoke the
adapter. Genuine signed-chain tests advance time past the authorization,
attestation, evidence, and deadline boundary during inspection, and separately
cancel during inspection. Both retain the exact pre-reconcile journal and emit
no second PREPARE call.

The helper service now computes one effective deadline at request entry. That
same `Date` and its deadline-driven AbortSignal are supplied to public screening,
locked verification, post-load checks, reconciliation, before-dispatch checks,
and engine context. The internal timer is armed from that deadline and cleared
on every exit. A direct caller omitting `execution.deadline` uses an injected
default-deadline/clock fixture and proves exact object identity across screen,
lock, dispatch, and engine without waiting.

## Commands and results

- `npx vitest run --config vitest.unit.config.ts src/recovery/target-acyclic-identity.unit.test.ts --pool=forks --poolOptions.forks.singleFork=true`
  — **28/28 passed**.
- `npx vitest run --config vitest.unit.config.ts src/recovery/target-storage-authority.unit.test.ts src/recovery/plan-file.unit.test.ts src/recovery/plan.unit.test.ts --pool=forks --poolOptions.forks.singleFork=true`
  — **17/17 passed across 3/3 files**.
- `npx vitest run --config vitest.unit.config.ts src/recovery/target-foundation.unit.test.ts src/recovery/target-transport-auth.unit.test.ts --pool=forks --poolOptions.forks.singleFork=true`
  — **95/95 passed across 2/2 files**.
- The final combined form of those six focused files, with the same single-fork
  options, passed **140/140 tests across 6/6 files**.
- `npx tsc --noEmit -p tsconfig.json --pretty false` — **passed**.
- `npx tsc --noEmit -p tsconfig.scripts.json --pretty false` — **passed**.
- touched-file ESLint with `--max-warnings=0` — **passed**.
- `npm run build` — **passed**.

All Vitest runs were serialized. Verification used ordinary temporary
directories and disposable test keys only—no Docker/Podman, live network, SSH,
production private key, decryption, import, or restore.

## Remaining gates

Packet 05B1b3b1 and Packet 05B1b3b2 remain the next engine/resource-authority
and runtime-effect scopes. Packet 05B1b4 remains signed-role, source-free
packaging, and installed-content integration. Privileged filesystem/quota and
mount-race coverage, live topology, load/soak, failover, RPO/RTO,
decrypt/import/restore, reconciliation, validation, promotion/rollback, hold
release, and production rehearsal remain release gates.
