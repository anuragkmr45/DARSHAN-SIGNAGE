# CONFIG-2.1 Handoff: Player Diagnostics URL Redaction

## Summary

CONFIG-2.1 fixes player diagnostics URL redaction. `darshan-player --pairing-status` and doctor output now redact URL username/password userinfo, query strings, and fragments from URL-like config fields. Runtime API/socket URL behavior is unchanged.

## Scope Implemented

- Added `redactUrlForDiagnostics` in the player config loader module.
- Applied redaction to player diagnostics summary URL-like fields:
  - `apiBase`
  - `wsUrl`
  - `realtime.wsUrl`
- Added regression tests for credentialed env URLs and malformed URLs.
- Added operator output coverage for `pairing-status` with credentialed env URLs.
- Updated config architecture, reduction plan, runbook, risk, and handoff docs.

## Files Changed

- `darshan-player/src/common/file-config.ts`
- `darshan-player/test/unit/common/file-config.test.ts`
- `darshan-player/test/unit/main/operator-tools.test.ts`
- `docs/architecture/onprem-config-architecture.md`
- `docs/implementation/config-env-reduction-plan.md`
- `docs/implementation/config-phase-2-handoff.md`
- `docs/implementation/config-phase-2-1-handoff.md`
- `docs/implementation/realtime-sync-open-risks.md`
- `docs/runbooks/onprem-config-management.md`

## Tests Run

```bash
cd darshan-player && npm run build
cd darshan-player && npx mocha --config .mocharc.json --spec test/unit/common/file-config.test.ts
cd darshan-player && npx mocha --config .mocharc.json --spec test/unit/main/operator-tools.test.ts
cd darshan-player && npx mocha --config .mocharc.json --spec test/unit/main/cli.test.ts
cd darshan-player && npx mocha --config .mocharc.json --spec test/unit/services/player-flow.test.ts
cd darshan-player && npx mocha --config .mocharc.json --spec test/unit/services/heartbeat.test.ts
```

## Test Results

- `npm run build`: passed.
- `test/unit/common/file-config.test.ts`: 12 passing.
- `test/unit/main/operator-tools.test.ts`: 5 passing.
- `test/unit/main/cli.test.ts`: 7 passing.
- `test/unit/services/player-flow.test.ts`: 21 passing.
- `test/unit/services/heartbeat.test.ts`: 2 passing.

## Failed Tests

None in the CONFIG-2.1 targeted tests.

## Blocked Tests

- Node 20 validation remains blocked in this workspace.
- Browser/on-prem runtime evidence remains blocked.
- Packaged player smoke remains blocked.

## Security Review

Diagnostics now preserve useful protocol/host/port/path details while removing:

- URL username
- URL password
- all URL query strings
- URL fragments

Invalid URLs return `[invalid-url-redacted]` and do not echo raw input. Credentialed URLs remain sensitive and should not be committed to site config examples.

CONFIG-2.2 follow-up: independent verification later found raw URL exposure outside the config summary path. CONFIG-2.2 centralized the helper in `darshan-player/src/common/redaction.ts` and applied redaction to pairing diagnostics, doctor output, support-bundle diagnostics, HTTP/WebSocket startup logs, player startup connectivity logs, request-queue URL logs, and some log-shipping URL logs.

CONFIG-2.3 follow-up: independent CONFIG-2.2 verification found remaining raw URL emission in log-shipper upload URL logs, renderer webpage logs, renderer-to-main log forwarding, and request-queue byte accounting. CONFIG-2.3 patches those emission paths and restores raw request URL use for byte accounting. Runtime API/socket/webpage/upload behavior remains unchanged.

## Runtime Evidence Status

BLOCKED_BY_ENV. CONFIG-2.1 is local code/test evidence only and does not claim browser, packaged player, or on-prem runtime validation.

## Rollback Plan

Revert CONFIG-2.1 changes. The runtime API/socket URL behavior is unaffected by this change, so rollback impacts only diagnostic redaction and tests/docs.

## Next Phase Readiness

CONFIG-3 CMS runtime config can start only after CONFIG-2.3 independent verification passes. Production readiness remains blocked by Node 20 and on-prem runtime evidence.

## Recommendation

APPROVE_WITH_CONDITIONS
