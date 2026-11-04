# Users and invitations: developer verification — 2026-11-04

Branch: `codex/darshan-product-ui-redesign-20261103`. This packet includes CMS and server behavior changes. The repository has no outbound invitation email sender. The user confirmed manual one-time code handoff for this on-prem release on 2026-11-04.

## Contract and result

Users and Invitations are compact working lists with server totals, server-side search, action-specific User grants, and explicit loading/failure/Retry. Create/edit forms retain role and primary/additional department controls. A custom role with a matching User grant can reach a permitted account action; the backend remains the target-policy authority.

Before this packet, CMS said an email was sent but discarded the created invite token; the server created an active user with a temporary password. Now a new invitation creates an inactive account with an unknown random password. Its code appears only in the create response and a CMS dialog until dismissal. Pending or expired codes can be renewed, invalidating the previous code. List responses omit codes. The recipient enters the code and new password on the public `/activate` page. The server uses an expiry check and conditional update so only one activation can consume it.

## Developer checks

| Check | Result |
| --- | --- |
| Server TypeScript build | Passed |
| CMS production build and bundle budget | Passed |
| CMS unit suite | 272/272 passed |
| Dedicated `darshan_users_ui_test` database | 65 migrations applied; invite/activation route 6/6 passed |
| Browser regression | 20/20 passed: Users 6, activation 4, multi-department 6, admin 4 |
| Focused ESLint and diff check | Passed |
| Responsive widths | No horizontal overflow at 390/820/1440 CSS pixels in fixture browser |

Database cases include inactive creation, list-token redaction, expiry display and renewal, old-code rejection, replay rejection, two concurrent activation attempts yielding one success, and own-department renewal with cross-department denial. Browser cases cover permission controls, invitation creation/renewal handoff, failure/Retry, activation success and invalid/policy responses. Browser APIs were mocked; this is not a complete CMS-to-server journey.

Rendered captures: [Users phone](product-ui-users/phone-light.png), [Users dark phone](product-ui-users/phone-dark.png), [Users desktop](product-ui-users/desktop-light.png), [activation phone](product-ui-users/activation-phone.png). No captured image contains an invitation code.

## Required real-system and human QA

- [x] Through separate administrator and recipient browsers against a migrated isolated site, create an invitation, activate, and sign in. Confirm inactive sign-in denial before activation and old/new code behavior after renewal. See the matched-build check below. The handoff itself was simulated between local QA browser contexts; no external message was sent.
- Test expired-code renewal, create-response loss, simultaneous renewal, two activation requests, configurable password policy, account deletion while code is open, scoped managers, permission withdrawal and hidden cross-department invitations.
- Test clipboard denial/manual selection, closing the code before copying, long emails, 100+ users/roles/invitations, zoom, keyboard, screen reader and all accent presets.
- No SMTP delivery, bounce tracking, resend email or deliverability claim exists. An automatic email choice would require service configuration, queue/retry and delivery evidence.

## Isolated runtime check and version boundary, 2026-11-04

The current CMS build at `https://localhost:18445` showed the manual-code invitation dialog and removed the code from view after dismissal. A second browser run reached the renewal control, but no replacement-code dialog appeared. Inspection showed the isolated API container is pinned to an older 2026-11-03 server `dist` bundle, while the CMS serves this branch's current `dist`. That older API created the two test invitations as active accounts and did not provide the new renewal behavior. Both test accounts were removed through the CMS after the check. **This older-build run is not evidence of the current server's invitation journey.** The matched-build check below completed that journey. No invitation codes or passwords were saved in this artifact.

## Matched-build real CMS and API check, 2026-11-04

A separate temporary CMS proxy and API process used this branch's CMS and server `dist`, a fresh dedicated `darshan_ui_users_20261104_test` database with all 65 migrations, and isolated administrator and recipient browser contexts. This left the earlier live-broadcast stack unchanged. Focused current-source server suites passed **9/9** (`users-invite.test.ts` 6, `admin-ops-contracts.test.ts` 3).

Through CMS controls, the administrator signed in, created an OPERATOR invitation, saw the code in a one-time dialog, dismissed it, and renewed it. Read-only API inspection confirmed the new account was inactive before activation. In a separate browser context, sign-in was denied before activation; the original code was rejected; the replacement activated the account; and the recipient signed in successfully. The administrator deleted the test account through the CMS afterward, and read-only database inspection found **zero** remaining active `current-invite-` QA accounts. No activation code or password was printed or saved. This is developer verification of one happy path and renewal invalidation; the broader human QA cases above remain open.
