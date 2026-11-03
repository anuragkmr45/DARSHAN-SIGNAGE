# Webhooks interface: developer verification

Branch: `codex/darshan-product-ui-redesign-20261103`, based on `release-01` at `1697249`.

Status: fixture-backed running-CMS and focused database-route developer verification. No automatic event delivery exists in the current server; only the explicit Test action sends an HTTP request.

## Contract and interface result

The page now uses a compact endpoint list with saved target, selected events, enabled/paused state, and the **latest manual test** result. It does not call a successful Test “Healthy,” which could imply ongoing delivery. A visible note states the automatic-dispatch limitation. Effective create/update/delete grants govern the controls, and delete requires confirmation. Create rejects non-HTTP(S) or URL-embedded credentials before request; the server remains authoritative for the Test destination allowlist. All mutation retries are explicit to avoid duplicate requests to external receivers.

The server strips stored webhook secret and custom headers from list and update responses. Create still returns the one-time generated secret. A non-2xx Test retains the precise `FAILED_HTTP_<status>` record instead of being overwritten by a generic failure.

## Verification

- New `webhooks-ui.e2e.spec.ts`: **4/4** fixture browser cases passed for URL validation/create, explicit Test and delete confirmation, read-only/list failure/Retry, HTTP 503 without automatic retry, and 390/820/1440 CSS pixels plus dark phone.
- Existing admin stabilization suite: **4/4** browser cases passed after its webhook row selector and status label were updated.
- Focused `admin-ops-contracts.test.ts`: **3/3** database route cases passed against the dedicated 64-migration test DB. The webhook case verifies no list/update secret or custom headers, a successful manual delivery, and persisted HTTP 503 failure status.
- CMS and server production builds passed; bundle budget passed. CMS unit suite and focused lint are run before this packet is committed.

Fixture captures: [phone](product-ui-webhooks/webhooks-390.png), [tablet](product-ui-webhooks/webhooks-820.png), [desktop](product-ui-webhooks/webhooks-1440.png), [dark phone](product-ui-webhooks/webhooks-dark-390.png).

## Open checks

- Decide whether automatic event dispatch and request signing are in release scope. The stored secret is not currently used by the Test sender, and CMS does not show the one-time create secret.
- Real internal HTTP/HTTPS receiver, allowlist and DNS rebinding safeguards, TLS, redirect policy, timeout, inactive endpoint and network partition behavior remain environment QA.
- Enable/Pause mutation failure, delete failure, long URLs, 200% zoom, five accent presets, physical mobile browsers and screen reader remain open.
