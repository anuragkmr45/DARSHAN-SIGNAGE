# Runtime Validation — PDF Page Selection And Video Looping

Date: 2026-10-15 (Asia/Kolkata)

Scope: disposable local Linux validation of the `release-01` working tree. This is execution evidence for the PDF selected-page and video-loop changes; it is not a full release sign-off or a substitute for the Windows/physical-display matrix.

## Isolated Environment

- CMS: Vite development server on loopback port `15173`.
- API: development API on loopback port `13000`.
- Player: real Electron renderer/main processes with a disposable player data directory and DevTools control on loopback.
- Dependencies: disposable PostgreSQL, Valkey and RustFS containers with project/name prefix `darshan-runtime-qa`.
- Data: synthetic 19-page PDF, two short H.264 videos (one with audio and one muted), one intentionally corrupt video, disposable layouts, presentation, schedule, player and PoP rows.
- The test used no production endpoint, credential, database, object store, player identity or user data.

## Executed Results

| Area | Observed result | Evidence |
| --- | --- | --- |
| CMS video loop | Loop control was shown for a video, persisted as `loop_enabled: true`, restored in the authored assignment and shown in review. The preview completed three cycles without a console/page error. | `cms-assignment-loop-pages.png`, `cms-review-loop-pages.png` |
| CMS PDF page selection | The same PDF was assigned more than once with pages 10 and 19. Assignment/review showed the selected pages, and page 1/page 10 canvas hashes differed. | `cms-assignment-loop-pages.png`, `cms-review-loop-pages.png` |
| Player loop on | A 3.018594-second audio video completed three native wraps in about 8.59 seconds. The same video DOM node remained mounted, `loop` stayed true, audio stayed enabled, and no media error occurred. | `player-single-loop.png` |
| Player loop off | The video played once, reached `ended: true`, remained paused at its decoded duration and was not remounted or restarted. | `player-non-loop-hold.png` |
| Multiple items | The slot advanced audio video → PDF page 10 → muted video → repeat at the configured approximately 8/5/7-second occurrence boundaries. The looped videos completed five and three native wraps respectively; no browser error was observed. | `player-multi-item-final.png` |
| Simultaneous slots | Two videos looped independently on stable nodes for 12 seconds. The audio video wrapped four times and the muted video six times, with their mute states preserved. | `player-two-simultaneous-loops.png` |
| Corrupt media recovery | An intentionally corrupt video produced a visible unavailable state and FFmpeg diagnostic; the slot then advanced to PDF page 19 and continued its cycle. | `player-corrupt-recovery-pdf19.png` |
| Player PDF pages | Pages 1, 10 and 19 produced three distinct canvas hashes and cycled in the expected six-second sequence; the first hash repeated when page 1 returned. | `player-pdf-selected-pages.png` |
| Schedule boundary | At the scheduled end, the active PDF was removed and default/no-content was visible approximately 105 ms after the expected boundary. | Electron state observation; scenario log |
| Offline cached restart | With the API intentionally unavailable, a previously validated player entered `OFFLINE_USING_LAST_VALID_PAIRING`, retained the same cached video node and completed four wraps in 12 seconds. After API restoration it returned to `PAIRED_RUNTIME`. | `player-offline-cached-restart.png` |
| Take-down | Taking down the disposable schedule cleared scheduled playback to no-content/default state. | Electron state observation; API response |
| Proof of play | The disposable DB contained 33 PoP rows and 33 distinct idempotency keys at inspection time. PDF rows retained page 1, 10 or 19, and multi-item/simultaneous scenarios were present. | Disposable PostgreSQL query |

## Defects Found And Corrected During Runtime

1. CMS PDF preview cleanup could destroy both the PDF document proxy and its loading task, causing an uncaught `Worker was terminated` error. Cleanup now destroys exactly the owned object; the final browser flow completed without that error.
2. Axios request timeout code `ECONNABORTED` was not classified as a transient network error, causing offline startup to enter recovery instead of cached playback. It is now classified as transient.
3. A background bootstrap retry while already in `OFFLINE_USING_LAST_VALID_PAIRING` temporarily entered `BOOTSTRAP_AUTH` and cleared visible cached playback. The retry now preserves the offline playback state until connectivity is actually restored.

Regression tests were added for the two offline-player defects and the full player suite passed after the fixes.

## Automated And Build Gates

| Component | Result |
| --- | --- |
| CMS unit tests | PASS — 23 files, 110 tests |
| CMS build and bundle budget | PASS — entry 216.8 KiB / 68.6 KiB gzip |
| CMS lint | PASS with 4 warnings and 0 errors |
| Server focused page/loop tests | PASS — 9 tests against a freshly migrated dedicated test DB |
| Server build | PASS |
| Server feature-scope lint | PASS with 85 pre-existing-style `no-explicit-any` warnings and 0 errors |
| Player unit tests | PASS — 352 tests |
| Player integration tests | PASS — 5 tests |
| Player fault-injection tests | PASS — 14 tests |
| Player build | PASS |
| Linux packages | PASS — AppImage and amd64 `.deb` created |

Package outputs produced by the run:

| Package | Bytes | SHA-256 |
| --- | ---: | --- |
| `DARSHAN-Player-1.0.0.AppImage` | 150046469 | `d151574ada94e9d0ba45707bb03702d0e95310bf78a552f7af0efc304b446913` |
| `darshan-player_1.0.0_amd64.deb` | 94785360 | `26bb4725d88f7d7baccc919555d717e18919fdd2bb5b0ec75900ad1f8d47af26` |

## Remaining Release Gates

- Windows x64 package/install, kiosk, GPU/display, restart and playback validation was not possible on this Ubuntu host.
- The Linux packages were built but were not installed into a fresh representative Ubuntu machine and reboot-tested.
- Long-duration CPU/GPU/RAM/handle/decoder soak and approved numeric performance thresholds remain untested.
- Accessibility/keyboard/screen-reader behavior, mixed old/new player capability rollout, two-minute security lock/cache purge, emergency takeover, hostile concurrency and production-like recovery remain separate planned cases.
- Repository-wide server lint is not green because `darshan-server/src/jobs/index.ts:211` has an unrelated `prefer-const` error, plus legacy warnings. Feature-scope lint has no errors; the unrelated baseline error remains a release-hygiene blocker until dispositioned.

Conclusion: the requested behavior is demonstrated end to end in the disposable Linux runtime, including failure and offline-restart paths. The build is not yet eligible for an unconditional production release because the platform, soak, security and baseline-lint gates above remain open.
