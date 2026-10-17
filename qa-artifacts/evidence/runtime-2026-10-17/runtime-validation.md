# Requirements 1-18 Developer Runtime Validation

Date: 2026-10-17 (Asia/Kolkata)

Branch: `release-01`

Source baseline: uncommitted working tree based on `c680c0a`
Result: **17 expected behaviours passed; requirement 18 failed**

This is bounded developer runtime evidence. It is not independent QA, a full
security assessment, physical-display acceptance, a soak test, or release
approval.

## Environment and execution

- Current compiled server API ran on `127.0.0.1:13000` against a freshly
  migrated disposable PostgreSQL 15 database.
- Valkey 7 and S3-compatible RustFS backed the API/worker flow.
- The current compiled worker ran in the dependency-complete
  `darshan-server-preqa-current:20261016` image with the working-tree `dist`
  mounted into it. Real Playwright Chromium captured controlled webpages.
- A controlled HTTP server supplied ordinary, Basic-auth, same-host redirect,
  disallowed-host redirect, changing-content and HTTP 503 responses.
- The current compiled player renderer ran in headless Chromium for visible
  fallback assertions. This was the real renderer bundle, but not the Electron
  main process or a physical signage display.
- Test users, departments, roles, screens, groups, media, emergencies and
  settings were created only in the disposable database.

The executable harnesses and machine-readable results are retained beside this
report:

- `access-policy-runtime-check.mjs` and `access-policy-runtime-result.json`
- `webpage-fixture-server.mjs`, `webpage-runtime-check.mjs` and
  `webpage-runtime-result.json`
- `player-renderer-runtime-check.mjs` and
  `player-renderer-runtime-result.json`

## Result matrix

| # | Required behaviour | Result | Runtime observation |
| --- | --- | --- | --- |
| 1 | Protect the last active SUPER_ADMIN | PASS | Removing one of two active SUPER_ADMIN accounts by delete, disable or demote returned `200`. Repeating each operation against the last active account returned `409 LAST_ACTIVE_SUPER_ADMIN`. |
| 2 | Operator directory is same-department only | PASS | The operator list returned only the two active Operations users; a direct lookup of the Sales user returned `404`. |
| 3 | Media: department read, creator/admin mutation | PASS | Same-department peer read returned `200`, peer delete `403`, creator delete `200`, and cross-department read was denied. |
| 4 | Layout: department read, creator/admin mutation | PASS | Same-department peer read returned `200`, peer update `403`, creator update `200`, and cross-department read was denied. |
| 5 | Presentation ownership boundary | PASS | Same-department permitted and administrator reads returned `200`; peer mutation returned `403`; cross-department read was denied. |
| 6 | Schedule same-department management | PASS | A permitted same-department user read and updated the Schedule; an administrator read it; a cross-department user was denied. |
| 7 | ADMIN shared; SUPER_ADMIN private | PASS | ADMIN-created Media, Layout, Presentation and Schedule were `ORGANIZATION` and department-readable. SUPER_ADMIN-created equivalents were `RESTRICTED` and denied. |
| 8 | Custom roles use permissions, not names | PASS | A custom role with an arbitrary display name created all four content types using granted abilities. A missing `User.read` grant returned `403`. |
| 9 | Emergency scope | PASS | A delegate triggered an allowed direct Screen (`201`) but other Screen, Group and Global targets returned `403`; ADMIN Group and SUPER_ADMIN Global triggers returned `201`. |
| 10 | Delegate clear scope | PASS | The delegate cleared its allowed Screen emergency (`200`). Clearing an unassigned Screen emergency returned `403`, and that emergency stayed active. |
| 11 | General Requests disabled | PASS | Three general Requests probes returned `404`; Schedule Requests remained available with `200`. |
| 12 | Immediate session removal | PASS | Old sessions returned `401` immediately after disable, password reset and permission removal. Login with the new password succeeded. |
| 13 | Ordinary HTTP webpages | PASS | An approved `http://` URL was accepted and captured by real Chromium, reaching `READY` with a stored revision and SHA-256. |
| 14 | Login-required webpages unsupported | PASS | A URL containing credentials returned `400 WEBPAGE_CREDENTIALS_BLOCKED`. A Basic-auth challenge failed without sending an Authorization header. |
| 15 | Redirects stay on approved hosts | PASS | A relative same-host redirect reached `READY`. A redirect to an unapproved hostname failed, and the controlled destination received zero requests. |
| 16 | Failed webpage uses latest preview | PASS | A successful refresh changed revision/checksum. A later HTTP 503 kept the Media `READY`, retained that exact revision/checksum, and the player loaded the retained PNG. |
| 17 | Explicit group priority survives edits | PASS | For one Screen in two Groups, priority 90 beat 10. A Group rename and assignment update that omitted priority preserved 90 and the winning default. |
| 18 | No schedule/default shows company image | **FAIL** | With Screen, Group, aspect and global defaults cleared, the API returned `source: NONE`, `media_id: null`, `media: null`. The player displayed `DARSHAN No content assigned yet.` and contained zero image elements. |

## Defect and diagnostic findings

### Release blocker: missing standard company fallback

Requirement 18 is not implemented end to end. The resolver returns `NONE`, and
the renderer uses a text-only idle card. Before this feature can be accepted,
the product needs an approved bundled or configured company image and a
deterministic server/player contract for using it when no Schedule or eligible
default exists. This is tracked as BR-102, R-38 and DEF-04.

### Redirect error classification

The security result for requirement 15 passed: the prohibited redirect target
received no request. The stored failure reason was `WEBPAGE_UNREACHABLE`, not
the more precise `WEBPAGE_REDIRECT_BLOCKED`. This is a diagnostic-quality gap,
not evidence of a redirect escape.

## What remains for QA

QA must repeat these behaviours on a frozen commit and approved packages. The
developer run did not cover every permission action/condition, inherited-role
combination, guessed-ID and pagination variant, concurrent last-admin removal,
multi-node socket invalidation, DNS rebinding, all redirect/resource chains,
automatic 24-hour refresh, two-client stale-save conflict, Electron main
process, Windows, physical displays, long soak, penetration testing, backup or
upgrade rehearsal. Requirement 18 must be fixed or explicitly waived before a
complete-software handoff can be called release-ready.

## Cleanup

Seven objects under the validated disposable Media UUID prefixes were removed
from test object storage. The disposable database/role, controlled fixture,
test network and processes were removed or stopped after evidence capture. No
production database, account or object was used.
