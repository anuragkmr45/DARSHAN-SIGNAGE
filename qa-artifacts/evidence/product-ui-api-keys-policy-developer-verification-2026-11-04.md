# API Keys issuance hold: developer verification

Branch: `codex/darshan-product-ui-redesign-20261103`. User decision: hide API-key creation until request authentication is designed, 2026-11-04.

## Current release behavior

The backend has no inbound API-key authentication consumer. The CMS therefore presents retained records as Stored/Expired/Revoked, explains that they cannot authenticate requests, and offers Refresh and permitted Revoke only. Create and Rotate are absent even when the actor has those grants. The authenticated API returns `409` with reason `API_KEY_AUTH_UNAVAILABLE` for create and rotate before changing any record. Existing records remain listable and revocable with the prior authorization checks. List/revoke responses omit the stored hash and raw secret.

## Verification

- CMS browser: four API Keys cases and four affected admin browser cases passed together (8/8). The grant-bearing browser case confirms create/rotate controls and calls are absent. The revoke case covers cancel, failed response, retry, and success. The API Keys responsive case checks 390/820/1440 CSS pixels and dark phone.
- Server: `admin-ops-contracts.test.ts` passed 3/3 against dedicated `darshan_users_ui_test`. The API-key case checks both `409` responses, unchanged retained prefix after denied rotation, list secrecy, and revoke.
- CMS and server production builds and the CMS bundle budget passed. Focused CMS/server lint passed. The CMS unit suite passed 42 files, 272/272 tests.

Rendered fixture captures: [phone](product-ui-api-keys-policy/api-keys-390.png), [tablet](product-ui-api-keys-policy/api-keys-820.png), [desktop](product-ui-api-keys-policy/api-keys-1440.png), [dark phone](product-ui-api-keys-policy/api-keys-dark-390.png). They contain no raw key secrets.

## Remaining validation

The browser uses fixture data. Confirm the disabled issuance and retained-record Revoke in a real running CMS/API. A future API-key design must specify consumer route scope, credential presentation, storage, audit, expiration, rotation and revocation before enabling issuance. List pagination beyond 100, screen reader and permission withdrawal remain open.
