# Webpage Media retirement

Webpage Media is retired for the QA candidate. This file records the replacement contract so older links do not imply that webpage capture or player playback still exists.

- CMS cannot create or refresh webpage Media. Historical rows remain visible in the Media library as retired records, without a playable preview.
- The API returns `410 WEBPAGE_RETIRED` for new webpage Media and restore requests. New presentation, schedule, emergency, default, and live fallback references are rejected. The old preview refresh route is absent.
- The worker no longer captures or refreshes webpages. The backend image does not install Playwright Chromium.
- Players reject webpage and URL schedule items and show a controlled unavailable state. They never load the URL or a cached webpage preview.
- Database enum values and historical columns are retained to avoid destructive migration. Existing history is not proof of a supported media type.
- Reports and Audit Logs PDF exports use LibreOffice. Site acceptance must inspect representative exported PDFs and check that their contents remain legible.

Use [live broadcasts](live-broadcast.md) for scheduled real time content.
