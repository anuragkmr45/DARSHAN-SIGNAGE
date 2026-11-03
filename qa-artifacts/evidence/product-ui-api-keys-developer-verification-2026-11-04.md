# API Keys interface: developer verification

Branch: `codex/darshan-product-ui-redesign-20261103`, based on `release-01` at `1697249`.

Status: fixture-backed running-CMS and focused database-route developer verification. This is not proof that a generated key can authenticate a backend request: no such inbound path exists in the current server.

## Contract and UI changes

The old page displayed a key ID as if it were a revealable and copyable secret after the one-time response was gone. It also stored a newly generated secret in the session-persisted Redux auth slice, attached that secret as `X-API-Key` to subsequent key-management requests, used `revoked_at` even though the server returns `is_revoked`, and offered create/rotate/revoke without checking each action grant. The server sent its stored `secret_hash` in management responses.

The page now lists only stored token prefixes and metadata. Create/rotate show the raw secret once in a focused, in-memory dialog, then clear it when closed. Copy failure has a visible message. Create uses the submitted scopes without an arbitrary hardcoded `ADMIN` role. Current effective grants gate each action. Rotate and revoke require consequence confirmation; automatic mutation retries are disabled to avoid repeated create/rotate after an uncertain response. The server strips `secret_hash` from create, list, rotate and revoke responses.

## Verification

- Browser: four new API Keys cases passed for one-time secret close/reload/session isolation, revoke cancellation/failure/manual retry, read-only/list-failure/empty states, and 390/820/1440 CSS pixels plus dark phone. The existing admin stabilization suite passed 3/3. All used one browser worker and fixture API responses.
- Server: `admin-ops-contracts.test.ts` passed 3/3 against fresh dedicated `darshan_apikey_ui_test` with 64 migrations. Its API-key case asserts that responses never include `secret_hash` and list records never include a raw secret.
- CMS unit suite: 42 files, 271/271 passed. CMS production build and bundle budget passed; entry JavaScript 207.0 KiB (66.4 KiB gzip). Server build and focused lint passed.
- A first run against a reused test database returned 401 before the response checks because role grants in that fixture had drifted. A fresh dedicated database passed. No production database was modified.

Rendered fixture captures (no raw secrets): [phone](product-ui-api-keys/api-keys-390.png), [tablet](product-ui-api-keys/api-keys-820.png), [desktop](product-ui-api-keys/api-keys-1440.png), [dark phone](product-ui-api-keys/api-keys-dark-390.png).

## Open product and release checks

- Backend API-key authentication is absent. The page currently manages stored records only; whether to implement scoped access or hide creation is an explicit product decision.
- The server list is fixed at 100 records with no page query, so additional keys are not reachable from this page. Large-list paging is unverified.
- Real consumer authentication/cutoff, rotation under an interrupted response, cross-role permissions, clipboard denial, 200% zoom, screen reader, and physical mobile browser checks remain open.
