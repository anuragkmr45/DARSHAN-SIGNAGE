# Audit language: developer verification

Branch: `codex/darshan-product-ui-redesign-20261103`. Isolated local QA only.

## Observed problem and contract

The real `/reports` → Audit Logs list displayed server event codes such as `USER_DELETED` and `LIVE_SESSION_UPDATE` as its main row labels. The API returns the exact action code and filters it by exact match. Those codes are necessary for audit and filtering, but were hard to scan as ordinary operator text. No server action or stored audit record was changed.

## Change

- The row now presents a readable action label, with the resource label shown only when it adds information. The exact original action code remains in the expanded details.
- The filter is labeled **Action code (exact match)** and gives a real code example, so an operator does not mistake a partial word for a search the server supports.
- Unknown or newly added action codes receive a readable fallback rather than a made-up event meaning.

## Verification

- CMS production build and bundle budget passed; all **285/285** unit tests passed; focused ESLint passed.
- Focused Reports browser suite passed **4/4** after a duplicate-text test selector was corrected. It covers report-only and audit-only permissions, readable action/detail, paging, filters, export request, failure/Retry, dark mode and 390/820/1440 layouts with fixture API responses.
- Frozen CMS build `15264a0a-5087-4836-a5ea-860ab2a847f1` activated successfully in the existing isolated Docker stack; previous CMS container was retained. Through the real signed-in CMS, Audit Logs showed `User deleted`, `Live broadcast deleted`, `Live broadcast updated`, and `Live broadcast created`. Expanding the updated row showed exact code `LIVE_SESSION_UPDATE`; entering that code in the filter returned **1 log**. The rendered desktop row and detail were visually inspected.
- The fixture-backed [390px dark Audit Logs capture](product-ui-audit-language/audit-dark-390.png) shows the readable row headings and exact-code filter without horizontal clipping. It does not depict the real Docker data.

This is developer verification of the named workflow. Independent human wording review, keyboard/screen-reader review, PDF export wording, other event families, and production data remain open.
