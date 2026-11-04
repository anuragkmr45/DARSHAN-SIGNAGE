# Screen booking and playback language: developer verification

Branch: `codex/darshan-product-ui-redesign-20261103`. This is local developer verification of the isolated QA build, not production or physical-display acceptance.

## Observed mismatch and correction

The real isolated CMS showed an Online, Standby Screen with zero active and zero upcoming items, but its list said “Awaiting scheduled playback.” Its detail view called an ended publish the “Current schedule” and displayed the past item end under “Booked until.” The Screen route had a second local timeline calculation that kept historical item ends, while the shared Screen/Group calculation was separate.

The route now uses the shared timeline builder. `booked_until` is the latest end among current and upcoming items, or `null` if only historical items remain. Publish history and immutable snapshot data are unchanged. The CMS list distinguishes no current/upcoming schedule, an upcoming-only schedule and an active schedule window without calling assignment confirmed playback. The detail inspector labels historical metadata “Latest published schedule,” shows “No current or upcoming booking” for an ended window, and calls the current-state panel “Playback now.”

## Verification

| Check | Result |
|---|---|
| Server TypeScript build | Passed |
| Database-backed `screens.test.ts` | 24/24 passed, including a historical-only publish through both availability and now-playing endpoints |
| Related `screen-groups.test.ts` | 2/2 passed after the shared timeline change |
| CMS production build and bundle budget | Passed |
| CMS unit suite | 287/287 passed; Screen label unit cases cover active, upcoming and ended states |
| Complete `screens.e2e.spec.ts` browser file | 22/22 passed at one worker; added ended and upcoming-only cases |
| Running isolated Docker CMS/API | API readiness `true`; one Screen Online and Standby with a server heartbeat 29 seconds old at inspection; list showed no active playback/current or upcoming schedule; Overview showed no current/upcoming booking and the historical publish name; Now Playing showed “Playback now,” no active window and the latest published schedule |
| Activated build identity | SHA-256 matched source build versus mounted CMS `index.html`, server `screens/playback.js` and `routes/screens.js` |

The dedicated `darshan_live_vitest_20261103_test` database was two additive migrations behind. Its managed ledger reported only `0062_group_member_screen_lookup.sql` and `0063_proof_of_play_completion_outcome.sql` pending; those were reviewed and applied there before the final 24/24 suite. The isolated application database was not changed by that migration step. Previous isolated CMS/server build directories were copied to ignored `.local/product-ui/screen-timeline-previous-build-20261104` before activation for local rollback.

## Limits and open QA

- The active and upcoming-only CMS cases used server-shaped browser fixtures; the real Docker journey exercised a historical-only publish and live player heartbeat. Repeat active/upcoming boundaries through CMS scheduling with a packaged player and proof-of-play.
- A healthy heartbeat proves receipt, not visible pixels or audio. Native package installation, Windows, physical display, offline transitions and independent operator acceptance remain separate gates.
- The isolated CMS at `https://localhost:18443` is a local QA build; no production deployment or `release-01` merge/push occurred.
