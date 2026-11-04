# Dashboard Screen drill-down: developer verification

Branch: `codex/darshan-product-ui-redesign-20261103`. This is developer verification on the isolated local QA stack, not production or independent human acceptance.

## Mismatch and change

The real Dashboard's Total Screens card called an `ACTIVE`, `ONLINE` Screen “Inactive.” The Screens overview response does not send the optional `is_active` property the card had used. The same card showed an ended publish as if it were the current schedule and displayed an empty booking as “Booked until Never.” Both Total and Online dialogs rendered the playback source `UNKNOWN` as an unexplained code.

Total Screens now reads `status` for the Inactive badge, uses active/upcoming schedule items for current booking language, and labels a retained publish “Latest published schedule.” With no current/upcoming items it says “No current or upcoming booking.” Both dialogs translate an unknown or absent player source to “No playback reported.” A fresh heartbeat is still shown separately; it is not presented as proof of playback.

## Verification

| Check | Result |
| --- | --- |
| CMS production build and bundle budget | Passed |
| CMS unit suite | 287/287 passed, including the source-label helper |
| Dashboard Screen browser files | 13/13 passed at one worker; new case covers an active/online Screen with ended-only publish, absent `is_active`, stale past booking and unknown playback source |
| Focused ESLint on changed CMS files | Passed |
| Matched isolated Docker CMS | The signed-in Total Screens dialog showed Online, “No playback reported,” “Latest published schedule,” and “No current or upcoming booking,” without an Inactive badge. Online Screens showed its recent heartbeat and “No playback reported,” without raw `UNKNOWN`. |
| Activated CMS build | Source and mounted `index.html` SHA-256 both `c6edc4e65e1cceaa46984fd146f6ff5a0531b39fa63ac271597013c6b91f5680` |

## Limits and remaining QA

- The real local Screen has an ended-only publish; active and upcoming-only schedule states were tested with browser fixtures. Repeat them through CMS scheduling, at the actual boundary, with the packaged player.
- Recheck the Dashboard KPI versus readable drill-down distinction for a restricted custom role, permission withdrawal, stale heartbeat and reconnect. A player heartbeat or source label is a report, not observation of visible pixels or audio.
- The isolated CMS is local at `https://localhost:18443`; no production deployment, `release-01` merge or push occurred.
