# Reports and Audit Logs interface: developer verification

Branch: `codex/darshan-product-ui-redesign-20261103`, based on `release-01` at `1697249`.

Status: fixture-backed running-CMS browser checks and focused database-backed PDF route verification. This is developer evidence, not a production availability or human QA pass.

## Contract and interface result

The page now separates Player availability and Audit Logs. Availability retains server-received heartbeat evidence, the 90-second estimated outage threshold, unknown backend/pre-first-heartbeat time, known-time uptime percentage and Never-seen Screen state. Fleet durations add time across Screens. The current snapshot PDF is explicitly independent of the selected availability period.

Audit-only and Report-only actors see only permitted views. Recent playback preview and CSV require `read ProofOfPlay` in addition to the Reports view; the old page requested PoP data for any Report reader and could show a 403 as a generic report failure. The preview now shows current names and actual Completed/Incomplete/Unknown player outcomes rather than a generic “Played” badge. Audit PDF export uses the values currently typed into both filters.

The server snapshot PDF accepts `read Report` or `read Dashboard`; the previous Dashboard-only check made the Reports page's export fail for Report-only actors. Its Emergency section now requires `manage Emergency`, and its PoP section requires `read ProofOfPlay`. A denied role still receives 403. PDF counts are labeled as stored Media records and Screen status flags, rather than current playback confirmation.

## Verification

- New `reports-ui.e2e.spec.ts`: **4/4** fixture-backed browser cases passed for Report-only, Audit-only, load failure/Retry, conditional PoP and responsive views. Existing `admin-stabilization.e2e.spec.ts`: **4/4** affected browser cases passed. One worker was used.
- `reports-export.test.ts`: **3/3** passed on a fresh dedicated `darshan_reports_ui_test` database with **65 migrations**. The test extracts text from actual generated PDFs to verify privileged sections appear for an administrator and are omitted for a Report-only role; an unrelated role receives 403.
- CMS and server builds passed. CMS bundle budget passed; the CMS unit suite passed **271/271**. Focused CMS lint had no findings. Server lint had no errors and two pre-existing `any` warnings outside the changed PDF code.
- Captures retained: [phone availability](product-ui-reports/reports-390.png), [tablet availability](product-ui-reports/reports-820.png), [desktop availability](product-ui-reports/reports-1440.png), [dark phone audit](product-ui-reports/audit-dark-390.png). Phone and desktop availability, and dark-phone audit, were visually inspected after the final browser run; no horizontal overflow at 390/820/1440 CSS pixels.

## Open checks

- Run real heartbeat loss/recovery around the 90-second boundary and backend-readiness gaps. Compare report values with database evidence and a connected player. Confirm long/short periods and Asia/Kolkata midnight.
- Run Report-only, Audit-only and PoP-only sessions against the live server; revoke permissions while open. Verify filtered Audit PDF and snapshot PDF visually, including long names, missing fields, and multiple pages.
- Measure 500-player availability query and large audit/PDF export memory and latency. Check 200% zoom, five accents, keyboard and screen reader, and physical mobile browsers.
