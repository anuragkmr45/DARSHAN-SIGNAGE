# D3 recovery-prefix — second separately authorized live gate

Outcome: **BLOCKED, exit5, migration prefix NOT accepted**. Exactly one invocation ran under this new authorization, after independent review of the [static pending-directory correction](controlled-recovery-d3-prefix-pending-correction-2026-10-31.md). It is separate from the earlier [pending-directory failure](controlled-recovery-d3-recovery-prefix-live-gate-2026-10-31.md); neither is overwritten or promoted to acceptance.

UID:GID was verified1000:1000. Cwd was `/home/hexmon/Desktop/DARSHAN-SIGNAGE/darshan-server`. The clock read immediately before invocation was `2026-10-31 01:10:01 UTC`; the post-completion clock read was `2026-10-31 01:10:22 UTC`. These bound observation timing and do not claim exact process duration. The exact runbook command was:

```bash
/usr/bin/timeout --signal=TERM --kill-after=30s 180s env -i PATH=/home/hexmon/.nvm/versions/node/v20.20.2/bin:/usr/bin:/bin HOME=/nonexistent LANG=C LC_ALL=C NODE_ENV=production /home/hexmon/.nvm/versions/node/v20.20.2/bin/node --import tsx scripts/controlled-recovery-d3-source.ts recovery-prefix
```

The full captured output was this347-byte canonical report (including its newline), with no other captured output:

```json
{"captureEnabled":false,"codes":["CONTROLLED_RECOVERY_D3_SOURCE_HEADROOM_UNSAFE"],"diagnostics":[{"comparison":"MAXIMUM","kind":"headroom","observed":"3229138944","resource":"SWAP_BYTES","threshold":"3221225472"}],"format":"darshan-d3-source-provider-report-v1","nextAction":"REVIEW_RETAINED_RESOURCES","status":"BLOCKED","wholeRunEnabled":false}
```

The validated bounded diagnostic preserves the exact admission failure: swap used3,229,138,944 bytes exceeds the unchanged maximum3,221,225,472 bytes by7,913,472 bytes. No threshold, cap, classification or gate was waived or changed. Canonical report-only SHA-256, without trailing newline, is `5bb9e6de6b53019f3b77b8f4ebc3ae7a973362b66dc419ab61c06fbe28a51e88`. [Complete canonical evidence](controlled-recovery-d3-recovery-prefix-live-gate-02-2026-10-31.json) SHA-256 is `41183a2d0902ed101659d50479fe835129a3a296b6258a328b6d24d0f95d0cf7`.

The report does not provide retained resource IDs/ownership, positive/negative TLS, UI/age continuity, pending-directory acceptance, migration ledger/empty-table/role/schema/object observations or a full prefix result. Those are NOT REPORTED, not accepted. In particular this admission failure is not proof that the pending-directory correction has passed a live prefix check. No seed continuation decision is supported.

Stopped after this single failure. No retry, preflight, status, data-status, seed, repair, cleanup, stop, backup/capture/capsule/restore or other live command ran. No concurrent operational command, code/profile/gate edit or commit was performed. No retained-resource repair or mutation was attempted; no additional daemon/DB/S3 or retained-state inspection followed. The invocation handle completed and no running invocation remains.

Static source/data/activation input hashes were rechecked without service access: source `1deb808f54ec122f85280b0e5b446913a8db78075b6505b7d77b6beba0278632`, data `33a2b270c55739e839dca7403034f49f24c39db5d8a8a93a413114bbf4d4176b`, activation `2890e9090bafe73c46933c6638f8e47dd6db147ca30e1becd74e9bc48cbf0899`. The correction evidence remains SHA-256 `64cb4f666923b061e6b4c3f5d9434f9351df1db70be7ac9838221600f49b27e7`. Live-seed remains enrolled and later gates remain false. This packet adds only these two evidence files; no enrollment or static suite rerun is needed for evidence-only additions. Further live action requires separate authorization.
