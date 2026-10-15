# Video Loop Playback — Architecture And Simulation Review

Review date: 2026-10-15

Baseline: `release-01` at `8e0bb6f5b93b230c2f08fe377cb52f8eccf729e2`, plus the uncommitted video-loop reliability working tree.

Method: repeated source data-flow review, production builds, lint, deterministic tests and event/timer simulation, followed by a disposable local CMS/API/database/object-store/browser/Linux Electron run with real H.264 media. Detailed execution evidence is in `runtime-2026-10-15/runtime-validation.md`. No Windows, fresh-machine package install, physical-display or long soak run was performed.

## Confirmed behavior

For a video occurrence with **Loop video** enabled, normal playback must not stop after the first media end. The video repeats complete native media cycles while that occurrence remains active. A single video occurrence remains mounted until the schedule window ends. In a multi-item slot, looping applies only while that occurrence owns its configured item interval; the slot then advances normally. Schedule end, emergency/default takeover, secure lock, snapshot replacement, scene replacement, or cleanup is a hard stop boundary.

For a late start or restart inside an active window, the player aligns a looping video by reducing wall-clock elapsed time modulo the decoded media duration. This preserves schedule synchronization rather than always restarting at frame zero.

## End-to-end flow traced in source

1. Schedule Creator exposes **Loop video** only for video media, keeps it occurrence-specific, includes it in the draft/sync fingerprint, persists it as `loop_enabled`, and displays it in assignment, review, preview, and request detail.
2. The presentations API accepts the boolean for video only. Reads, atomic replacement, legacy POST, publish resolution, and immutable snapshot all normalize non-video over-posting or legacy contamination to `false`. Explicit duplicate order within one slot is rejected.
3. Snapshot parsing carries `loop_enabled` into the player `TimelineItem.loop` value only for video media and only when the supplied value is the boolean `true`; malformed strings and non-video contamination resolve to `false`.
4. The renderer creates one video element with native `video.loop`, `autoplay`, `playsInline`, and `preload=auto`. It does not manually handle `ended` by rewinding and replaying, and it does not remount a successful single-item slot on each configured display-duration tick.
5. Initial media readiness has a 15-second timeout. Rejected `play()` calls receive bounded retries after 250 ms and 1 second. A loop-only `waiting`/`stalled` watchdog reports failure after 10 seconds without progress. Late media errors and an unexpected `ended` event while native looping is enabled become visible runtime failures.
6. A failed single-item slot shows a placeholder and retries the occurrence after a bounded 1-30 second delay. A failed item in a multi-item slot remains visible as a placeholder until the already-defined item boundary, then the slot continues.
7. Renderer and main-process schedule-end paths both clear the scene. The main-process scene item now preserves the actual remaining schedule milliseconds, including sub-second windows, instead of extending them to a one-second minimum. Timers, media listeners, video source, progress reporter, and active slot state are disposed idempotently. Internal native loop cycles retain one mounted element and one active playback UUID; they are not treated as new schedule occurrences.

## Static corner-case simulation

| Case | Source-predicted result | Runtime status |
| --- | --- | --- |
| One short valid video; loop on; schedule longer than video | One element starts once; browser repeats complete media cycles until schedule end | Runtime observed: 3 wraps, stable node |
| Loop off | Video plays once and holds its completed state; it does not restart merely because the schedule remains active | Runtime observed: one play, ended and held |
| Single loop video where configured display duration is shorter/longer than decoded duration | Successful element is not remounted at the display-duration boundary; native decoded-media boundaries drive repeats | Not Tested |
| Multi-item slot with a loop video | Video may repeat while its configured occurrence interval is active; slot advances at that interval and preserves other items | Runtime observed with video/PDF/video cycle |
| Multiple frames/slots with independent loop videos | Each slot owns independent media, timer, failure, cleanup, fit and audio state | Runtime observed: 4 and 6 wraps in 12 seconds |
| Late join/restart in active schedule | Seek is `elapsed % decoded duration`; stale persisted `completed=true` is ignored for a loop occurrence | Not Tested |
| Unknown, zero, infinite, or not-yet-decoded media duration | Loop seek falls back to zero; readiness/error timeout prevents an indefinite blank promise | Not Tested |
| First/second `play()` rejection | Bounded retries; success resolves once without creating a manual replay loop | Not Tested |
| All `play()` attempts fail | Visible failure after bounded retries; single item later retries through slot recovery | Not Tested |
| Network/decode error before ready | Initial render rejects and shows a placeholder | Runtime observed with corrupt video and PDF recovery |
| Error after playback begins | Active video is torn down, placeholder is shown, diagnostic is reported, and recovery follows slot cardinality | Not Tested |
| Loop video stalls/waits then progresses | Watchdog is armed and canceled on `playing` or `timeupdate` | Not Tested |
| Loop video remains stalled for 10 seconds | Runtime failure is reported once and failed element is disposed | Not Tested |
| Native loop unexpectedly emits `ended` | Treated as a runtime failure; no unbounded manual `ended -> play()` recursion | Not Tested |
| Schedule ends during load, retry, seek, stall, fade, or recovery timer | Scene cleanup cancels outstanding callbacks; stale async completion cannot append media | Normal boundary observed at approximately +105 ms; pending-fault variants open |
| Emergency/default/secure-lock/snapshot takeover | Existing scene cleanup stops and removes hidden video/audio before the new authority renders | Not Tested |
| Non-video payload sends `loop_enabled=true` | API/publish response and snapshot normalize it to `false` | DB-backed/deterministic test passed |
| Legacy row/draft omits loop value | Defaults to `false`; only an explicit video `true` restores as enabled | Deterministic CMS/server test passed |
| Same video occurs twice with different loop values | Each occurrence preserves its own setting and ordering | Not Tested |
| Video loop beside selected PDF page | Video repeats independently; PDF stays on the chosen static page; both clear at the schedule boundary | Runtime observed in mixed and simultaneous scenarios |
| Legacy/malformed snapshot has no usable layout slots | Parser falls back to the older direct timeline. Native video looping still applies, but that legacy scheduler can remount at the configured display interval; current Schedule Creator produces layout scenes. Characterize any required legacy support before release rather than assuming scene behavior. | Not Tested |

## Static verification performed

- Player production build/bundle: passed.
- Player full unit suite: 352 passed; full integration suite: 5 passed; fault-injection suite: 14 passed. The focused loop/snapshot simulation covered three native wraps without replay, decoded-duration modulo seeking, invalid duration, bounded play exhaustion, two independent lifecycles, stall recovery, disposal during retry/seek, strict snapshot normalization, a 100 ms remaining scene boundary, transient Axios timeout handling and offline retry state preservation.
- Player lint: passed with 280 repository warnings and no errors.
- CMS full unit suite: 110 passed; production build and bundle budget: passed. Source-connected state tests cover occurrence-specific toggling, stale-occurrence safety, legacy/default restoration, payload generation, video/PDF preview options, Loop On/Off approval labels, duplicate video independence, and non-video normalization.
- CMS lint: passed with four existing warnings and no errors.
- Server production/CLI build: passed.
- Server database-free unit suite: 25 passed, including four video-loop tests covering type normalization, duplicate occurrence resolution, non-video contamination, and immutable snapshot serialization, plus the existing document-page tests.
- Server-wide lint: not clean because of one existing `prefer-const` error in `darshan-server/src/jobs/index.ts` plus existing warnings; the video-loop files introduced no reported lint error.
- The focused server route/normalization suites passed 9 tests against a freshly migrated dedicated `_test` database.

Latest reproducible commands from the repository root, all exit code 0 unless the note says otherwise:

- `cd darshan-player && npm run build`
- `cd darshan-player && npm run test:unit -- --reporter dot` — 352 passed
- `cd darshan-player && npm run test:integration` — 5 passed
- `cd darshan-player && npm run test:fault` — 14 passed
- `cd darshan-player && npm run lint` — 0 errors, 280 existing warnings
- `cd darshan-cms && npm run test:unit -- --reporter=dot` — 110 passed
- `cd darshan-cms && npm run build` — build and bundle budget passed; entry JavaScript 216.8 KiB / 68.6 KiB gzip
- `cd darshan-cms && npm run lint` — 0 errors, 4 existing warnings
- `cd darshan-server && npm run build:production`
- `cd darshan-server && npm run test:unit` — 25 passed
- `cd darshan-server && npx eslint src/routes/presentations.ts src/routes/schedule-publish-helper.ts src/utils/video-loop.ts src/utils/video-loop.unit.test.ts --ext .ts` — 0 errors, 85 existing warnings in the two established route/helper files

The player unit suite briefly opens localhost-only health-server fixtures and closes them during teardown. Separately, the targeted runtime run used disposable loopback services, containers and a real Electron application with synthetic media; see the dated runtime report.

The targeted run additionally demonstrates Chromium/Electron native looping, real audio/mute state, schedule-boundary timing, API/database persistence, PoP, corrupt-media recovery and offline cached restart on this Linux host. It does not prove Windows/other GPU/display combinations, fresh installed packages, every takeover/fault race or long-run resource stability.

## Remaining execution gates

Complete the open portions of `UI-06`, `API-07`, `PLAYER-11`, `PLAYER-12`, `OBS-04`, and `PERF-06` on approved target hardware. In particular, capture a fresh-package Windows and Ubuntu physical-display run, accessibility, emergency/secure-lock takeover, controlled play rejection/stall, offline spool/export, long-duration CPU/GPU/RAM/handle trends and approved boundary tolerances. The broad cases remain `Partially Tested` until their full matrices pass.
