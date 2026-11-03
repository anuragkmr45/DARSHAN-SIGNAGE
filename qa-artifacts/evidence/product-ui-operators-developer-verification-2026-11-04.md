# Operators redesign: developer verification — 2026-11-04

Branch: `codex/darshan-product-ui-redesign-20261103`. This packet changes the CMS Operators surface only. Browser cases use mocked API responses and are not real-service or independent human QA.

## Task and result

An operator manager needs to find an account, understand its primary/additional membership, perform only actions they are allowed to perform, and keep a generated reset password long enough to transfer it safely. The roster now uses compact rows, keeps IDs behind Technical ID, exposes Search/Refresh and Retry, gates New/Edit/Activate/Reset/Delete separately, and holds a reset password in memory only until its dialog closes. The server retains final target/department and reset authority.

## Developer checks

| Check | Result |
| --- | --- |
| CMS production build and bundle budget | Passed |
| CMS unit suite | 271/271 passed |
| New Operators browser suite | 6/6 passed: read-only, update-only/reset, create-only, delete-only, initial failure/Retry, responsive light/dark |
| Existing multi-department browser suite | 6/6 passed: primary/additional editing, stale 409, department roster, later-page search, role change |
| Focused ESLint | Passed |
| 390, 820, 1440 CSS pixel overflow check | Passed in fixture browser |

Rendered captures: [phone light](product-ui-operators/phone-light.png), [phone dark](product-ui-operators/phone-dark.png), [desktop light](product-ui-operators/desktop-light.png). These show the read-only fixture and contain no reset credential.

## Required real-system and human QA

- Perform create/edit/activate/reset/delete through the running CMS against isolated services, then verify database and sign-in/session outcomes. A fixture response does not establish this end-to-end behavior.
- Verify target-role and cross-department denial, stale permission withdrawal, deletion tombstone/history, reset timeout/network failure, clipboard denial, and the actual one-time password handoff.
- Verify 100+ operators and 100+ roles, long names/emails, zoom, keyboard and screen reader operation, all accent presets, and a second browser session.
- The password-reset response is intentionally not persisted or logged by the CMS. Clipboard contents remain under the operator's device control after Copy.
