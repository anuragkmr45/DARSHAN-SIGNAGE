# Emergency Video Loop Developer Verification — 2026-10-27

## Scope and baseline

- Branch: `release-01`
- Starting revision: `db137152cdb8eda7ecf1f836df33e0373b9fc278`
- Working-tree policy: preserve the substantial earlier authorized changes and isolate this correction to the emergency snapshot contract, player contract/tests, CMS operator wording/tests, product contract docs and QA artifacts.
- Independent QA fields remain unchanged; `PLAYER-17` is still `Not Tested`.

## Implemented correction

- `darshan-server/src/screens/playback.ts::getActiveEmergencyForScreen` derives `loop_enabled=true` only for a resolved READY `VIDEO`; non-video/unavailable/message emergency payloads are false.
- `darshan-server/src/routes/device-telemetry.ts` includes that derived value in the snapshot representation hash, invalidating pre-fix cached ETags once without destabilizing later equivalent refreshes.
- No request field, persistence column or migration was added. Emergency looping is authority behavior, not an operator or Schedule-occurrence choice.
- `darshan-player/src/common/types.ts::DeviceSnapshot.emergency` declares the derived boolean. Existing strict parsing, timeline hold, playlist fingerprint and native lifecycle paths remain the only loop implementation.
- `darshan-cms/src/components/requests/EmergencyTakeoverModal.tsx` previews only the selected emergency video as a native loop and explains that it repeats until clear/expiry. Grid thumbnails remain non-looping to avoid concurrent decoders. The trigger payload does not send a loop field.

## Added focused coverage

- Server: resolved video versus image snapshot loop contract.
- Player parser: emergency video maps to loop true; malformed non-video request remains false.
- Snapshot manager: video emergency stays loop-enabled until expiry and restores default content.
- Playback authority: equivalent snapshot/presigned-URL refresh does not restart; emergency-version change does.
- Existing native lifecycle: one mounted element, three modeled wraps, bounded start/stall failures, disposal and stale-callback cleanup.
- CMS browser contract: video behavior copy is visible, selected media is submitted, and no loop field is over-posted.

## Resource gate and execution log

Goal start gate: at least 2.7 GiB `MemAvailable` and 1.2 GiB free swap. Stop gate: below 1.5 GiB `MemAvailable` or 1 GiB free swap. Node cap: 768 MiB. Tests/builds must run serially.

| Phase | Resource reading | Result |
|---|---|---|
| Initial static pass | approximately 3.2 GiB available RAM / 1.3 GiB free swap (`free -h`) | Static inspection allowed |
| Pre-player focused-test gate | 3.37 GiB available RAM / 1.17 GiB free swap (raw bytes) | Not started: free swap was below 1.2 GiB |
| Later recheck | 3.72 GiB available RAM / 0.84 GiB free swap | Still not started |
| Continuation recheck | 3.70 GiB available RAM / 0.74 GiB free swap | Still not started; same swap blocker |
| Third authoritative recheck | 3.69 GiB available RAM / 0.76 GiB free swap | Same blocker repeated; goal marked blocked without starting tests |
| Resume after cleanup | 3.15 GiB available RAM / 1.66 GiB free swap | Start gate passed |
| After focused player tests and build | 3.18 GiB available RAM / 1.67 GiB free swap | Continue gate passed |
| After disposable-database server tests and build | 3.13 GiB available RAM / 1.70 GiB free swap | Continue gate passed; test container removed |
| After CMS build and one-worker Chromium flow | 3.21 GiB available RAM / 1.70 GiB free swap | Continue/cleanup gate passed; Vite and Chromium exited |
| Container baseline/cleanup | Docker Desktop stopped; native Docker daemon retained without a desktop UI. The capped task-owned PostgreSQL container was removed after testing; unrelated stopped containers were untouched. | No task-owned service remains |

One bounded Vite/Chromium CMS journey was started and exited. No Electron player or complete product topology was started. Independent QA remains `Not Tested`.

## Executed developer checks

| Command | Result |
|---|---|
| `NODE_OPTIONS=--max-old-space-size=768 ./node_modules/.bin/mocha --config .mocharc.json --timeout 30000 --spec test/unit/services/snapshot-parser.test.ts --spec test/unit/services/snapshot-manager.test.ts --spec test/unit/services/playback-engine.test.ts --spec test/unit/services/timeline-scheduler.test.ts --spec test/unit/renderer/scheduled-video-lifecycle.test.ts` | PASS — 63 tests in approximately 9 seconds. Covers strict video-only loop parsing, emergency expiry/default restoration, equivalent-refresh continuity, emergency-version replacement, scheduled Loop On/Off regression, one mounted native loop with three modeled wraps, boundary cleanup, failures and stale-callback disposal. |
| `NODE_OPTIONS=--max-old-space-size=768 npm run build` (`darshan-player`) | PASS — main and renderer TypeScript compilation, renderer bundle and asset copy completed in approximately 10 seconds. |
| `NODE_OPTIONS=--max-old-space-size=768 TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:<ephemeral>/darshan_emergency_loop_test npm run test:integration -- src/routes/emergency.test.ts --maxWorkers=1` | Initial run: 7 passed, 1 failed because the new fixture mocked URL signing but not the preceding storage-object existence check. After adding the missing `headObject` boundary mock and resetting the 50-migration disposable database: PASS — 8 tests in approximately 7 seconds. |
| `NODE_OPTIONS=--max-old-space-size=768 npm run build` (`darshan-server`) | Initial run found an unrelated pre-existing inference mismatch in the modified command-lifecycle work. After explicitly typing the UUID lookup as `Map<string, CreateDeviceCommandInput>` (compile-time only): PASS — `tsc && tsc-alias` in approximately 18 seconds. |
| `NODE_OPTIONS=--max-old-space-size=768 npm run build` (`darshan-cms`) | PASS — production Vite build and bundle-budget check in approximately 11 seconds. Informational browser-baseline/caniuse metadata warnings remain. |
| `NODE_OPTIONS=--max-old-space-size=768 npx playwright test tests/scheduling-emergency.e2e.spec.ts --grep "emergency modal triggers and clears audited emergencies without native randomUUID" --workers=1` | PASS — 1 real Chromium journey in approximately 15 seconds. It rendered the emergency dialog, selected `Hero Loop`, exposed the implicit repeat copy and native loop preview, submitted the selected media without over-posting a loop field, and completed trigger/clear behavior. |

## Remaining QA runtime gate

Run only after the start gate passes, one phase at a time with `NODE_OPTIONS=--max-old-space-size=768`:

1. Run the packaged Linux/Windows physical-player journey with at least three real decoded wraps and all authority boundaries on the larger QA host. It was not forced locally: Electron plus API, database, object storage and media decoding would overlap the exact heavyweight topology deferred by the approved low-resource plan, and prior kernel evidence records headless-browser OOM at approximately 2.4–2.9 GiB RSS.

## Current conclusion

Static implementation and QA synchronization are complete. Focused player automation, all player/server/CMS builds, disposable-database server integration coverage and the real CMS Chromium journey pass. Packaged physical-player decoding/audio/authority-boundary evidence remains pending on the larger QA host, so independent runtime behavior remains unproven and BR-109/R-46/PLAYER-17 must not be closed from this developer file alone.
