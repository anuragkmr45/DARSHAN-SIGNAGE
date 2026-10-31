# D3 read-only preflight before capsule recovery

Exactly one separately authorized read-only source `preflight` ran as UID:GID1000:1000 from `darshan-server`, in the unchanged clean environment, bounded by180s plus30s settlement allowance. Handle38319 exited **0 / READY**. Surrounding clock observations were2026-10-31 04:38:30–04:39:07UTC. No capsule, status, data-status, retry, repair, cleanup, service/data mutation, code/gate change or commit followed.

```sh
/usr/bin/timeout --signal=TERM --kill-after=30s 180s env -i PATH=/home/hexmon/.nvm/versions/node/v20.20.2/bin:/usr/bin:/bin HOME=/nonexistent LANG=C LC_ALL=C NODE_ENV=production /home/hexmon/.nvm/versions/node/v20.20.2/bin/node --import tsx scripts/controlled-recovery-d3-source.ts preflight
```

The exact [1437-byte report](controlled-recovery-d3-capsule-recovery-preflight-02-2026-10-31.json) has SHA-256 `332b3d9390ea823a7bf318735e69ed3a43224a5d69b63befcbcbe1101ec58c18`. It records status/sourceStatus READY, ownershipReobserved true, pendingRoles[], stage SEEDED_AND_SEALED, Firefox untouched, capture/whole-run/backupCreated false. All eight role/ID/retired tuples exactly match the prior retained stage receipt, including retired postgres-init. Its generic nextAction is `data-status`; no next action was executed.

Admission evidence is `beba93f26a1c8e628c4371c58d2e6b0909da32b31a0dc237d40989d23b65c571`: available memory3201368064 bytes, required2717908992 bytes, swap used2678095872 bytes, pressureAvg10Micros0. No limit was relaxed. Preflight reobserves ownership/readiness and does not perform or claim the source-status positive/negative TLS health contract.

The preceding capsule attempt's retained archive/ciphertext/receipts remain partial progress; this preflight does not verify capsule acceptance or promote the stage. Capsule activation remains true, later gates false, and profiles/identities are unchanged. Stop after this successful read-only gate; any capsule recovery requires separate authorization.
