# Layouts list interface: developer verification

Branch: `codex/darshan-product-ui-redesign-20261103`, based on `release-01` at `1697249`.

Status: fixture-backed running-CMS verification. Real layout save, publication, player geometry, and referenced-layout deletion remain separate release QA.

## Operator task and result

An operator can find a layout by name or aspect ratio, inspect its slots, and edit or delete it where authorized. The index uses a compact toolbar and a table at desktop width; phone and tablet show accessible cards with visible View and Edit actions. Creation follows the effective `create Layout` grant, while record permissions still govern Edit and Delete. Delete requires typing the exact name. A portrait preview stays inside the phone viewport.

The list distinguishes initial load failure from an empty result and provides Retry. A failed refresh of an already loaded list keeps the last list and states that it may be stale. Refresh no longer shows an unconditional success toast. Filters start at page 1 and out-of-range page correction waits for current-query data.

## Browser evidence

The combined affected Playwright run passed **15/15** cases with one worker: five new `layouts-list-ui.e2e.spec.ts` cases, three existing Layout editor cases, and seven owned-content cases. The new cases cover failure/Retry and true empty state, server search/ratio/paging, read-only phone portrait preview, exact-name mobile deletion, and responsive rendering. The existing ownership case initially had a strict selector collision because table and card markup both contain ownership labels. After scoping that assertion to the desktop table, the full combined run passed.

Rendered fixture captures: [phone](product-ui-layouts-list/layouts-390.png), [tablet](product-ui-layouts-list/layouts-820.png), [desktop](product-ui-layouts-list/layouts-1440.png), [dark phone](product-ui-layouts-list/layouts-dark-390.png). These show synthetic layouts, not saved records from the local service.

## Build and limits

- CMS production build and bundle budget: passed; entry JavaScript 207.0 KiB (66.4 KiB gzip).
- CMS unit suite: 42 files, 271/271 passed.
- Focused ESLint and `git diff --check`: passed.
- Real-service create, save, reopen, preview against player output, referenced-layout deletion blocker, permission withdrawal during an open dialog, and network interruption remain open.
- Long names/descriptions, 200% text zoom, five accent presets, actual mobile browsers, keyboard-only dialog/focus, and screen-reader review remain open.
