# D3 capsule recovery continuation04 — CAPSULE_READY

Exactly one separately authorized bounded installed `capsule` continuation ran as UID:GID1000:1000 from `darshan-server`, with the unchanged runbook command/clean environment and no concurrent operation, code/gate/profile change or manual cleanup. Handle90415 exited **0 / VERIFIED**, stage **CAPSULE_READY**. Surrounding clock observations were2026-10-31 04:39:36–04:42:27UTC, not fabricated process timestamps. No capsule-status, reservation, broker, capture, seed, backup, restore, stop, retry or other live command followed. Post-result evidence collection used only bounded fixed filesystem/public-record reads; no additional Docker/tool/DB/S3/Valkey dispatch occurred.

```sh
/usr/bin/timeout --signal=TERM --kill-after=30s 300s env -i PATH=/home/hexmon/.nvm/versions/node/v20.20.2/bin:/usr/bin:/bin HOME=/nonexistent LANG=C LC_ALL=C NODE_ENV=production /home/hexmon/.nvm/versions/node/v20.20.2/bin/node --import tsx scripts/controlled-recovery-d3-source.ts capsule
```

The preceding [single read-only preflight](controlled-recovery-d3-capsule-recovery-preflight-02-2026-10-31.md) returned READY with exact retained resources, ownership reobserved, no pending roles and SEEDED_AND_SEALED. Before this continuation, read-only protected-file checks required existing165096-byte ciphertext SHA `1b38979c127acb0144448a04a6a7560c23f6b1bccebd26848a60a3c6c66f5a1a`, capsule receipt `861ee4e36b59a1276352915aba937d415c9121c7df0a53fe79290e54056d68f8`, legacy completion `51b1773ff0f4fab210771b4db5d516392f465e15e75cf690d2742712aaffa730` and exact accepted source/data/schema/seal bindings. The unchanged installed command reobserved its own admission/ownership/TLS/data/signature/readback prerequisites; no threshold was waived. The report does not expose numerical headroom or individual TLS probe results, so none are invented here.

The command reports `roundtripReceiptVerified:true`, verification `DURABLE_ENCRYPT_DECRYPT_AND_SIGNED_READBACK_RECEIPT`. It reused the existing durable age settlement/publication and capsule bytes. Post-result full metadata/byte hashes match the pre-existing files: ciphertext inode1836357 and receipt inode1836352 on device2050, both0600/UID:GID1000/nlink1, with identical bytes/mtime/ctime. Ciphertext was not re-encrypted or replaced. Capsule receipt file SHA remains `9e142f910b975910b8317b21da6f23221e5d263d7ef423deaf755e51be6d4d9b`. Age intent/settled/publication receipts, ciphertext, policy, capsule receipt, attempt02 intent/material/crypto-complete and private age metadata are unchanged from [attempt03 retained evidence](controlled-recovery-d3-live-capsule-gate-03-2026-10-31.retained.json). That prior settlement binds the joined encrypt/decrypt byte equality; evidence collection performed no new decrypt.

The new exact `04-CAPSULE_READY.json` receipt is `6844bd24c59764ab0f006c468cef00fde35e62780c35ed5137b1d33731f3db90`, previous stage receipt `26482b77cf2a0f67429cad0c0a31ec9aa7c640e48ff7f89e060cf45999b8b757`, evidence `861ee4e36b59a1276352915aba937d415c9121c7df0a53fe79290e54056d68f8`. Its complete canonical body, exact eight resource identities and file metadata/hash are retained in the public-record artifact. The receipt digest was checked with the production canonical trailing-newline convention. Only the tool-slots directory timestamps and this new stage differ among the71 observed fixed tuples compared with attempt03; the four legacy archived inodes/bytes/hashes/modes/links and all observed public/key metadata remain unchanged.

The accepted report binds:

| Identity | Value |
| --- | --- |
| Capsule receipt | `861ee4e36b59a1276352915aba937d415c9121c7df0a53fe79290e54056d68f8` |
| Ciphertext165096 bytes | `1b38979c127acb0144448a04a6a7560c23f6b1bccebd26848a60a3c6c66f5a1a` |
| Plaintext164864 bytes, retained settlement | `c22acb251720a70c2f410f8a11d7ad5fcb10eed48cdd55437498d9075b74a37b` |
| Inventory62 entries | `8e2608c295abafebf453fc12cc22f6c51c7e82709fb00a743484f0c88d5e980f` |
| Policy | `64fbc56851489cd74a223e01f772022eca4f2e21b7872ff49e4cb01b656c722d` |
| Age public receipt | `a5e908b3fce787c33399e202449fcceff2ed8284cd56af690e278630d4ab76cf` |
| Separate capsule activation | `34fbd94cfe33a11cf34b7f7a103495d2dd4ceec4b1bee6e48848b395c72c508e` |

All four active staging directories are empty; all six fixed age CIDs, age slot, capsule construction lock, controller lock and source command lock are absent. Their uncertainty/quarantine paths remain absent. The completed legacy archive and its receipts are unchanged. No private key bytes were read and no plaintext bytes were printed during evidence collection; archived legacy plaintext reads were bounded to hash verification. No broad process/container scan or extra Docker inspect was run, so filesystem absence is not relabeled as a fresh daemon observation.

Exact output was captured losslessly from the completed handle. The1441-byte combined stream is the430-byte SDK Node-version warning plus1011-byte canonical report. The informational warning was neither suppressed nor treated as failure.

| Artifact | Bytes | SHA-256 |
| --- | --- | --- |
| [Exact combined stream](controlled-recovery-d3-live-capsule-gate-04-2026-10-31.stdout-stderr.txt) |1441|`17cafd2101653b4d0d647f553141d50d0a0852d6b69801b9b66c4c000624834f`|
| [Exact warning](controlled-recovery-d3-live-capsule-gate-04-2026-10-31.sdk-warning.txt) |430|`9c1dd89e8fc8468f2525048bb663a14d8f4bc588ad91dd72ee3d2639264a9b3f`|
| [Exact JSON report](controlled-recovery-d3-live-capsule-gate-04-2026-10-31.json) |1011|`8982a2ae038e8575c76dfc0addf551937da4957d3935427efe383526d1134f46`|
| [Fixed retained-state proof](controlled-recovery-d3-live-capsule-gate-04-2026-10-31.retained.json) |19460|`8aa9fcf374dc1abfbd7fbe1ed080f29f82e0dcd758e18892411066cfccc687ea`|

All six accepted profiles and91-asset D3 activation are unchanged. Capsule activation/live_seed remain true. Backup worker availability, reservation/broker/capture/D2/whole-run remain false. The generic nextAction `REVIEW_RESERVATION_BOUNDARY` is recorded, not executed. The [289-file public inventory](controlled-recovery-d3-live-capsule-gate-04-hashes-2026-10-31.json) extends attempt03 evidence with its inventory, intervening preflight and this result; it excludes itself to avoid a hash cycle. No source/config/enrollment change or static rerun was required for these evidence-only additions.

Evidence naming correction: the intervening preflight initially reused historical generic preflight names. Its exact new result is now preserved under unique `capsule-recovery-preflight-02` names (JSON SHA `332b3d9390ea823a7bf318735e69ed3a43224a5d69b63befcbcbe1101ec58c18`, MD SHA `b83d76005b7f24849d022836b24b21e66cfa1ac97f291df8988fbd31d89f4b52`). The historical generic JSON was restored losslessly from its untouched1440-byte merged-stream artifact, SHA `939ed7c20ee3c0a9c4cec9b1916b9897cde3b97ee5d85e904a8a20403541084f`. Its3584-byte MD was restored from the exact retained original apply_patch tool input (session21-43-39, line16979), SHA `14065c613fc79bd58363095926823c9631b06ea1eb7e8e98282a8942fdc7df62`. Neither historical content was reconstructed or guessed, and no old inventory was changed. The final audit requires all281 prior indexed files byte-identical before sealing this new inventory. This evidence-only correction did not affect runtime acceptance.

Stop at this accepted command boundary. A separately authorized fresh-process capsule-status is still outstanding. No reservation, backup-worker authority, broker/capture/backup/restore/application/promotion/rollback acceptance follows from CAPSULE_READY.
