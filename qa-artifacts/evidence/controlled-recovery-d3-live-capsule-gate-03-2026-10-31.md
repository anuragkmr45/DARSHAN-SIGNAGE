# D3 live capsule retry03 — blocked at final pressure admission

Exactly one separately authorized installed `capsule` command ran as UID:GID1000:1000, with backend cwd and the unchanged clean environment from capsule runbook line34. Handle4214 exited **5 / BLOCKED**. The observed invocation/result window was2026-10-31 04:34:11–04:36:09UTC; these are surrounding clock observations, not fabricated process timestamps. No concurrent operation/code/gate change, retry, capsule-status, preflight, status, data-status, repair, manual cleanup, seed, reservation, broker, capture, backup, restore, stop or commit ran. Post-result evidence collection used only bounded fixed filesystem metadata/public-receipt reads; no additional Docker/tool/process dispatch or DB/S3/Valkey request was performed.

The exact result is `CONTROLLED_RECOVERY_D3_SOURCE_HEADROOM_UNSAFE`: `PRESSURE_MICROS` observed `1450000`, comparison `MAXIMUM`, unchanged threshold `500000`. Admission was not waived. No other numerical headroom/TLS/resource result was emitted, so this evidence does not invent one. `captureEnabled:false`, `wholeRunEnabled:false`, and next action `REVIEW_RETAINED_RESOURCES` are retained exactly in the report.

```sh
/usr/bin/timeout --signal=TERM --kill-after=30s 300s env -i PATH=/home/hexmon/.nvm/versions/node/v20.20.2/bin:/usr/bin:/bin HOME=/nonexistent LANG=C LC_ALL=C NODE_ENV=production /home/hexmon/.nvm/versions/node/v20.20.2/bin/node --import tsx scripts/controlled-recovery-d3-source.ts capsule
```

The command progressed through the exact legacy handoff and normal shared age publication before the later admission rejection. Filesystem evidence shows canonical archive completion, new capsule age intent/settled/publication records, ciphertext, signed policy and signed receipt. The exact source stage remains `SEEDED_AND_SEALED` (receipt `26482b77cf2a0f67429cad0c0a31ec9aa7c640e48ff7f89e060cf45999b8b757`); `04-CAPSULE_READY.json` is absent. In `controlled-recovery-d3-capsule.ts:88`, receipt publication precedes the final `prerequisites()` admission/readback and stage callback. Therefore published files are retained partial progress, **not successful capsule acceptance**. No fresh-process capsule-status was run, no independent final signature verification is claimed by this evidence collection, and no stage was fabricated.

The protected legacy archive contains `intent.json`, `archive.json`, `complete.json` and `files`; quarantine is absent. Intent receipt is `31239d9c6aa205b27800c589cee6431f9e787f0385e34f88f6284ab21da26625`; archive receipt is `557dc842c45b7a3657fe276746720067eef3480d8e2dfafe2eaf712a6dca8918`; completion receipt is `51b1773ff0f4fab210771b4db5d516392f465e15e75cf690d2742712aaffa730`. All four archived files retain device2050, original mode0600, UID:GID1000, one link, exact original inode/bytes/hash:

| Archived slot/file | Inode | Bytes | SHA-256 |
| --- | --- | --- | --- |
| encrypt-input/plain.tar |1836021|65536|`b2797a7998e01b1d4c7e9c0a31a0e1d3982028655eaa53615f50e24ece188773`|
| encrypt-output/artifact.age |1836028|65736|`60c8347dc47293f829c735e27546a98fc3153418bc4b4275e3c48f54b3a19a02`|
| decrypt-input/artifact.age |1836026|65736|`60c8347dc47293f829c735e27546a98fc3153418bc4b4275e3c48f54b3a19a02`|
| decrypt-output/plain.tar |1836030|65536|`b2797a7998e01b1d4c7e9c0a31a0e1d3982028655eaa53615f50e24ece188773`|

This proves preservation/archival of the diagnosed originals rather than regeneration or adoption as capsule data. The legacy source paths are absent and all four active staging directories are empty. The new transaction's settlement records bind a distinct164864-byte capsule plaintext (`c22acb251720a70c2f410f8a11d7ad5fcb10eed48cdd55437498d9075b74a37b`) and165096-byte ciphertext (`1b38979c127acb0144448a04a6a7560c23f6b1bccebd26848a60a3c6c66f5a1a`). Settlement receipt is `9204e44cdd843024c0f9864c20843f9011885c2e8b9bdbab3290d2933e4c158a`; publication receipt is `10b2007113fd70ebae615e1d27d6de0c0b7a444faa8157ef40221c80f58f4468`. These are retained command-generated receipts, not a new decrypt performed during evidence collection.

The retained capsule receipt is `861ee4e36b59a1276352915aba937d415c9121c7df0a53fe79290e54056d68f8`. Inventory has62 entries and SHA `8e2608c295abafebf453fc12cc22f6c51c7e82709fb00a743484f0c88d5e980f`; policy identity is `64fbc56851489cd74a223e01f772022eca4f2e21b7872ff49e4cb01b656c722d`. Policy/release signature bytes and public key IDs are retained losslessly in the public-record evidence. The three authority IDs remain distinct: policy `e2cf8686a858ee5935707a5eb18f23346fbcb5be0027b5de633d2bb3728f10c5`, manifest `440417ab00f2596206c61847338c06d0debe00cf3639863f9370899d778c43d6`, release `0ca0bc1ac09f488632ad391a985c804935b1c1bff1b6bd11f7c53f1b1b543cb5`.

Attempt02 intent remains `b8ffda676f31a3e5e05bb3fb84541207226174cd8e7c536942e20a98535c6a9c`; material remains `03afdab5cb729b762da733f4cb513fff46a2e66c16545c7b8011cc7b462f859f`; capsule binding remains `02133b3cbf1cbe050efc10c379f0f3988174417d2cb9eea9fcee791ac65cbe5b`. The prior metadata/hash tuples for retained capsule intent/crypto/material, source data intent/schema/seal, source SEEDED_AND_SEALED receipt, public keyrings and private age key are unchanged. Private key bytes were not read in evidence collection. Age public receipt remains `a5e908b3fce787c33399e202449fcceff2ed8284cd56af690e278630d4ab76cf`, recipient/key identity `c3917b23a6e14c4a47c0c53e5237817af19e9c1f14192d9f2ef3e9beec856107`, with the unchanged enrolled tools image/config.

All six fixed age CID paths, age slot, capsule construction lock, controller/source command locks and their uncertainty markers are absent. Capsule age quarantine is absent. No broad process/container scan or extra Docker inspect was performed; CID/lock absence is filesystem evidence and is not an invented fresh daemon observation. Source resource IDs are retained from the unchanged stage receipt in the public-record artifact, including PG `59293a90028f1085f53470e81a37cda5fe45a5cf3e3efe1339d2f063ab5bdc47`, MinIO `762ece210166e24e6e8ae2304492433fc50dffd3de038e13bda534355f9e769f`, Valkey `7a830cd163dc5f2860fbf114ceb994db6372cde8d96da4037df88e3d72b3afff`.

Output was retained directly from the completed handle, not reconstructed. The exact775-byte combined stream equals its430-byte SDK warning plus345-byte JSON report. The warning is informational and was not suppressed or treated as the admission failure.

| Artifact | Bytes | SHA-256 |
| --- | --- | --- |
| [Exact combined stdout/stderr](controlled-recovery-d3-live-capsule-gate-03-2026-10-31.stdout-stderr.txt) |775|`9003f55b890e93700cbc9d25e9df97ac84f4df057e2e7d50a084798e6f13ad48`|
| [Exact SDK warning](controlled-recovery-d3-live-capsule-gate-03-2026-10-31.sdk-warning.txt) |430|`33aa7b78e1c813a12967cf6c45ea926324eaa04b778ce0caf181536e1ff086e9`|
| [Exact JSON report](controlled-recovery-d3-live-capsule-gate-03-2026-10-31.json) |345|`5aff8c29dcf0a6bb754b01698115e2b0a032ef8480b6c6d5080635f91878fbc8`|
| [Fixed filesystem/public-receipt evidence](controlled-recovery-d3-live-capsule-gate-03-2026-10-31.retained.json) |31488|`21b9dbde5ad607a9499f81ea6467f9116b36f3a22de085cc47663386d3728f3d`|

The separate capsule activation remains true SHA `34fbd94cfe33a11cf34b7f7a103495d2dd4ceec4b1bee6e48848b395c72c508e`;91-asset D3 activation remains `258705c6d9306a68453edd3c879eeba0fd65c5a45b04d17263383dfb0c713552`. All six accepted profiles and live_seed are unchanged; reservation/broker/capture/D2/whole-run remain false. No application asset/enrollment change or static rerun was needed for these evidence-only additions. A [281-file public inventory](controlled-recovery-d3-live-capsule-gate-03-hashes-2026-10-31.json) binds exact source/config/previous evidence and this result, excluding itself to avoid a hash cycle. No threshold was relaxed.

The authorized attempt is complete and blocked. Preserve the archive, current capsule outputs, all private identities and retained services. A future action requires separate authorization and unchanged fresh admission; no automatic retry, capsule-status, cleanup or stage promotion follows from the presence of receipts.
