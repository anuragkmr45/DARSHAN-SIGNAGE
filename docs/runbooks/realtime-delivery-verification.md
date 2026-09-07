# Realtime Delivery Verification

## Runtime contract

Socket.IO is a notification/wake channel; REST and the database remain authoritative. Source-free production writes a WebSocket-only backend contract:

- `REALTIME_SOCKET_TRANSPORT=websocket`
- `REALTIME_SOCKET_ALLOW_POLLING=false`
- `REALTIME_SOCKET_REQUIRE_STICKY_SESSIONS=false`

The generated CMS health check performs a TLS-verified Engine.IO WebSocket upgrade through the public CMS gateway. It must pass after every production deployment.

Player delivery behavior is deliberately adaptive:

| State | Delivery work |
|---|---|
| Healthy | acknowledged WSS, fresh heartbeat, notification-triggered REST reconciliation, and five-minute desired-state/command safety checks. |
| Degraded | command REST fallback at the configured short interval; desired-state reconciliation begins at 30 seconds and backs off to at most 60 seconds. |
| Offline | cached playback, exact local schedule evaluation, signed URL renewal, and bounded telemetry queues. |

Snapshot and default-media services no longer operate independent periodic network polls when realtime is enabled. A failed resource fetch never advances the successfully-applied desired-state checkpoint.
Refresh work is generation-guarded: a slow response from an older refresh or cleared pairing may finish, but cannot overwrite current playback, cached snapshot metadata, or default media.

Every normal signed heartbeat now carries a small, non-secret delivery report:

- player release ID and source commit, taken from the verified player artifact manifest;
- backend release ID from the authenticated `HELLO_ACK`; a player/backend mismatch is shown as `version mismatch`;
- `WSS healthy`, `REST fallback`, `offline`, or `version mismatch` state;
- HELLO acknowledgement, last event/reconciliation/fallback timestamps;
- observed/applied desired-state versions and bounded reconnect/failure counters.

The CMS **Screen details → Latest Device Telemetry → Realtime delivery** panel shows this report. It is operational evidence only; it never replaces the desired-state REST response as playback authority.

Prometheus derives bounded fleet signals from the reports without using a device ID, player version, or source commit as a metric label. The deployment includes alerts for missing expected `/device` connections, reconnect storms, more than 25% of recent heartbeats in REST fallback, and player/backend release mismatch. Treat a mismatch as rollout/provenance evidence: inspect the per-screen CMS report for the exact release and source commit instead of adding those high-cardinality values to Prometheus labels.

## Build and release checks

Run on each native build machine before assembling a source-free bundle:

```bash
git status --short
bash scripts/export/package-server.sh --release "$RELEASE_ID"
bash scripts/export/package-cms.sh --release "$RELEASE_ID"
bash scripts/export/package-electron.sh --release "$RELEASE_ID" --platform linux
```

Each component output contains `ARTIFACT_MANIFEST.json`. Assembly rejects missing manifests, checksums, release/component/platform mismatches, or components built from different source commits. Never reuse a player artifact directory from an older release.

The assembled player config receives its `releaseId` and `sourceCommit` from the verified player manifest, rather than the bundle assembler checkout. This makes a native-builder mismatch visible in CMS telemetry after the player’s next heartbeat.

## Required evidence before approval

1. Run `bash scripts/verify/validate-source-free-production-bundle.sh`.
2. Start each generated production role and run its generated `health-check.sh`; CMS health must confirm the public WebSocket upgrade.
3. Use a dedicated database whose name ends in `_test` for backend realtime/outbox tests. The test safety gate intentionally refuses an ordinary `darshan` database.
4. Test publish, take-down, emergency, default media, image, video, PDF, webpage, layout, and timed transition. Confirm a socket wake is followed by authoritative REST fetch; no media body may appear on Socket.IO.
5. Disconnect and reconnect a player; verify one complete reconciliation, no duplicate command effect, and no visible stale transition.
6. Test two CMS users: create/update/approve/reject/cancel/publish/take-down in one session and verify Schedule Queue invalidates and refetches in the other.

## CMS asset and deployment behavior

Authenticated CMS routes are lazy-loaded. The Vite manifest budget check enforces a 350 KiB / 150 KiB gzip entry chunk and a 500 KiB maximum JavaScript chunk. Hashed `/assets/` are immutable for one year; HTML and `/config/app-config.json` are `no-store`. A lazy-chunk deployment mismatch triggers one guarded reload, then an on-screen recovery message instead of an infinite reload loop.
