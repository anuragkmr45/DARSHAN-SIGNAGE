# Webpage cookie and fallback developer verification — 2026-11-02

This is developer evidence from a controlled local Docker CMS/API/PostgreSQL/MinIO stack and a paired Ubuntu Electron player. It is not production or physical-display QA.

## Reproduced before the fix

- Public HTTP page: server capture `READY`, CMS screenshot visible, and the player loaded live JavaScript content.
- Cookie-protected `/private`: a separate operator browser could sign in, but the fresh capture and player showed `/login`. The worker marked the login screenshot `READY` and rewrote `source_url` from `/private` to `/login`. Credentials in a URL were rejected with `WEBPAGE_CREDENTIALS_BLOCKED`; HTTP Basic auth capture failed.
- Anonymous `/cookie-gate` issued a first-party cookie and redirected to `/cookie-content`. Capture showed `COOKIE CONTENT OK`, but the worker rewrote `source_url` to `/cookie-content`. On a fresh player session that direct request returned HTTP `403`; the content probe treated the error text as healthy and hid the good screenshot.
- A same-host redirect to a public page succeeded. A redirect to an unapproved port failed. An HTTP `503` during refresh kept Media `READY` with its prior preview revision. Restarting the player while the origin was unavailable displayed the cached screenshot.

## Correction and checks

- The capture worker now retains the submitted `source_url` after initial capture and refresh. The player treats a main-frame HTTP `4xx` or `5xx` as a live-view failure and keeps its saved preview visible.
- Focused server policy/job tests: 17 passed. Focused player webpage tests: 15 passed, including HTTP error fallback and subsequent successful reload. Full player unit suite: 399 passed. Player fault suite: 14 passed. CMS webpage-preview browser test: 1 passed.
- Server and player production builds passed. In a post-change replay, a new cookie-redirect Media item reached `READY` while retaining `/cookie-gate` as its source. A freshly restarted paired player followed the redirect and displayed `COOKIE CONTENT OK` as live content. After assigning a legacy direct `/cookie-content` item and restarting again, the live request returned `403`; the player kept the cached preview visible with the “USING CACHED WEBPAGE PREVIEW” label.
- The temporary HTTP/CIDR allowlists, test default assignment, and fixture service were removed after testing. Synthetic Media was soft-deleted, leaving the original active Media count at 22. The original local API container and paired player were restored; the player returned to `PAIRED_RUNTIME`.

## Remaining QA

Repeat with site-approved HTTPS and HTTP destinations on the five-VM network, including player reachability, DNS changes, certificate errors, 200-status login pages, resource policies, and physical-display visibility. Login automation and importing CMS/browser cookies are excluded by BQ-011.
