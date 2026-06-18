# DARSHAN Design Discovery Screenshot Index

Capture date: 2026-06-18  
Capture mode: Playwright Chromium against local CMS Vite dev server and static player renderer HTML.  
CMS runtime used: `http://127.0.0.1:5173` with API base pointed at the local backend `http://192.168.0.7:3000`.  
Security note: no password visibility was toggled, bearer tokens were not captured, and screenshots do not include secret values.

## Screenshots

| File | Page or State | Evidence Notes |
|---|---|---|
| `docs/design-discovery/screenshots/cms-login.png` | CMS login | Actual login route. Form includes local-dev defaults in source, but password is rendered as a password field and was not exposed. |
| `docs/design-discovery/screenshots/cms-dashboard.png` | Dashboard | Authenticated page. Shows current sidebar, disabled global search, KPI cards, observability, pending requests, and system health. |
| `docs/design-discovery/screenshots/cms-sidebar-collapsed.png` | Collapsed sidebar | Authenticated shell after sidebar toggle. Used to evaluate collapse behavior and icon-only state. |
| `docs/design-discovery/screenshots/cms-media-library.png` | Media Library | Authenticated media page. Shows filters, upload/webpage actions, counts, and empty/loading-ready states for the local dataset. |
| `docs/design-discovery/screenshots/cms-schedule-queue.png` | Schedule Queue | Authenticated schedule queue. Shows filters, status tabs, emergency button, and published device schedule panel. |
| `docs/design-discovery/screenshots/cms-schedule-creator.png` | Schedule Creator | Authenticated creation wizard. Captured on layout selection step. |
| `docs/design-discovery/screenshots/cms-layouts.png` | Layouts | Authenticated layout list/editor entry page. |
| `docs/design-discovery/screenshots/cms-screens.png` | Screens | Authenticated screens page. Shows Pairing Health panel and screen/group list shell. |
| `docs/design-discovery/screenshots/cms-pair-device-modal.png` | Pair Device modal | Actual modal opened from Screens page. Used for pairing flow redesign notes. |
| `docs/design-discovery/screenshots/cms-requests.png` | Requests Workboard | Authenticated request Kanban/workboard page. |
| `docs/design-discovery/screenshots/cms-notifications.png` | Notifications | Authenticated notification page. No page `h1` was present in capture. |
| `docs/design-discovery/screenshots/cms-chat.png` | Conversations | Authenticated chat page. Captured empty/select-conversation state. |
| `docs/design-discovery/screenshots/cms-settings.png` | Site Settings | Authenticated settings page. Captured general settings tab. |
| `docs/design-discovery/screenshots/cms-settings-default-media.png` | Settings - Default Media | Actual Default Media tab opened from settings. |
| `docs/design-discovery/screenshots/cms-reports.png` | Reports & Logs | Authenticated reports/audit/proof-of-play summary page. |
| `docs/design-discovery/screenshots/cms-proof-of-play.png` | Proof of Play | Authenticated proof-of-play page with filters and table area. |
| `docs/design-discovery/screenshots/player-pairing-static.png` | Player OTP/pairing screen | Static renderer HTML loaded in Chromium with DOM-only pairing state injected for visual discovery. This is not live Electron runtime evidence. |

## Runtime Notes

- The existing nginx CMS container at `http://192.168.0.7:8080` served the built app root but returned an nginx 404 for direct `/login?redirect=%2F` navigation. Vite dev was used for route screenshots.
- Vite served a fallback HTML response for `/config/app-config.json`, causing a console warning that runtime config JSON failed to parse. The app fell back to build-time env values and still worked with explicit `VITE_API_BASE_URL` and `VITE_WS_BASE_URL`.
- Backend health at `http://192.168.0.7:3000/api/v1/health` returned OK.
- The player screenshot is suitable for visual audit only. It does not prove pairing, backend validation, or Electron runtime behavior.
