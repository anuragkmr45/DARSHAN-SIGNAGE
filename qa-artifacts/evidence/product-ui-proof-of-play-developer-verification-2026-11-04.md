# Proof of Play interface: developer verification

Branch: `codex/darshan-product-ui-redesign-20261103`, based on `release-01` at `1697249`.

Status: focused database-backed API/ingest tests and fixture-backed running-CMS browser checks. This is developer evidence; packaged-player and independent human QA remain open.

## Contract and interface result

The prior CMS inferred “Completed” from `ended_at`, although an interrupted player event can have an end timestamp. The telemetry worker now persists the player's `completed` value. The database column is nullable so pre-migration rows remain **Outcome unknown**. API status filters use that stored value; CSV includes it. The list includes current Screen and Media names with their stable IDs. A renamed item can show its new name; deleted item names are unavailable. The page states that a player report is not evidence that a person saw the display.

The route and API both require `read ProofOfPlay`; `read Report` alone no longer opens the page. Date filters refer to server receipt time, with browser-local day boundaries converted to UTC. The list uses the server total and 50 rows per page; it preserves the selected PDF page, validates optional UUID filters, and shows loading, retry and stale-refresh states.

## Verification

- Fresh dedicated `darshan_pop_ui_test` database with **65 migrations**: focused proof route, telemetry worker, and device-ingest suites **10/10 passed**. These verify true/false/null outcomes, filtered totals, current-name lookup, page number and CSV header.
- New `proof-of-play-ui.e2e.spec.ts`: **4/4 passed** at one browser worker. Covered 52-row paging, unknown and interrupted outcomes, invalid filters, failure/Retry, Report-only denial, and 390/820/1440 CSS pixels plus dark phone. No horizontal overflow at those widths.
- CMS production build and bundle budget passed. Server TypeScript build passed. CMS unit suite **271/271 passed**; focused lint passed.
- The 820-pixel and dark-phone captures were visually inspected after the name enrichment. All four captures are retained here: [phone](product-ui-proof-of-play/proof-of-play-390.png), [tablet](product-ui-proof-of-play/proof-of-play-820.png), [desktop](product-ui-proof-of-play/proof-of-play-1440.png), [dark phone](product-ui-proof-of-play/proof-of-play-dark-390.png).

## Open checks

- Run a packaged player through completed, interrupted, crash, offline spool and replay journeys, then inspect actual database, CMS and CSV records. Confirm the source event's selected PDF page and `completed` value survive every hop. Player reports do not establish physical-display observation.
- Test real renamed/deleted Screen and Media labels, timezone boundaries around midnight, stale refresh/network loss, permission withdrawal, 200% zoom, all accents, physical mobile and screen reader.
- CSV export currently materializes all matching rows in server memory. Measure and bound production-size exports before claiming large-fleet readiness.
