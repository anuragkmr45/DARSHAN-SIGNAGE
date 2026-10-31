# Packet 05B1b3b0 acyclic target identity QA checklist

- [ ] Build four signed stable evidence-v2 envelopes without target-set,
  specification, plan, attestation, operation, or generation backreferences.
- [ ] Build capacity-evidence-v2 after the four full signed-envelope digests;
  require operation, generation, release/logical target, and all four digests.
- [ ] Build target-specification-v2 after capacity; require exact
  stable/capacity envelope digests and no target-set, plan, or attestation.
- [ ] Recompute targetSetId-v2 from the canonical specification-v2 digest plus
  operation, generation, and host; prove each identity change diverges.
- [ ] Verify signed operation-attestation-v1 binds the target set,
  specification, all five evidence envelopes, operation/generation/host,
  release/logical target, and site.
- [ ] Require plan-v4, targetPreparation-v2, admission-v2, and outer-envelope-v2
  to bind the attestation and final plan digest.
- [ ] Load evidence only by protected `<sha256>.json` names and hash the full
  signed envelope. Reject renamed/tampered/expired/revoked/wrong-kind content.
- [ ] Reject every binding-family mutation before journal creation or adapter
  invocation.
- [ ] Reject v1/v2 and v3/v4 cross-mixes. Keep v1 evidence and plan-v3 readable,
  while installed identity-v2 rejects INSPECT and PREPARE with
  `RECOVERY_TARGET_EFFECT_INELIGIBLE`.
- [ ] Prove only the complete v2/v4 chain constructs the locked verified
  storage context supplied to the deterministic fake adapter.
- [ ] Bind ACTIVE, QUARANTINE, POOL, and CONTROL inventory path identities to
  the four installed root identities; bind plan/spec topology exactly to
  policy and installed host mode; require every inventory filesystem to be in
  `allowedFilesystems`.
- [ ] Recheck authorization, attestation, evidence validity, cancellation, and
  the action deadline after evidence loading and immediately before dispatch.
- [ ] During ambiguous reconciliation, recheck after the awaited inspection and
  again before any retry effect; expiry/cancellation must leave the retained
  journal unchanged and emit no second mutation.
- [ ] For callers omitting a deadline, compute one effective default deadline
  once and pass that exact value through screening, lock checks, timer,
  reconciliation, dispatch, and engine context.
- [ ] Confirm production still uses `UnavailableRecoveryTargetEngine` and no
  Docker, live network/SSH, production private key, decrypt, import, or restore.
