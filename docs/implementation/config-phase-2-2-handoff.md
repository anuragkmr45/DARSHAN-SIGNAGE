# CONFIG-2.2 Handoff: Player Diagnostics and Log URL Redaction

## Summary

CONFIG-2.2 centralized player-side URL redaction for diagnostics and logs. Runtime API/WebSocket URLs still use the original configured values for network calls. Independent verification later marked CONFIG-2.2 as `NEEDS_FIX` because raw URL emission remained in log-shipper upload URL logs, renderer webpage logs, renderer-to-main log forwarding, and request-queue byte accounting. CONFIG-2.3 supersedes this handoff for final player URL emission closure.

## Scope Implemented

- Moved URL redaction into `darshan-player/src/common/redaction.ts`.
- Kept the existing `file-config` redaction export compatible.
- Redacted player pairing diagnostics `apiBase`.
- Defensively redacted doctor output and support-bundle network diagnostics.
- Redacted HTTP client initialization logs and connectivity diagnostic `baseURL`.
- Redacted WebSocket initialization/connect logs.
- Redacted startup backend configuration and backend parse-failure logs.
- Redacted request-queue URL logs and log-shipping URL logs.
- Added targeted regression tests for helper behavior, pairing diagnostics, doctor output, and HTTP connectivity diagnostics.

CONFIG-2.2 was not the final closure after independent verification. See `docs/implementation/config-phase-2-3-handoff.md`.

## Files Changed

- `darshan-player/src/common/redaction.ts`
- `darshan-player/src/common/file-config.ts`
- `darshan-player/src/main/index.ts`
- `darshan-player/src/main/services/pairing-service.ts`
- `darshan-player/src/main/services/operator-tools.ts`
- `darshan-player/src/main/services/network/http-client.ts`
- `darshan-player/src/main/services/network/websocket-client.ts`
- `darshan-player/src/main/services/network/request-queue.ts`
- `darshan-player/src/main/services/log-shipper.ts`
- `darshan-player/test/unit/common/redaction.test.ts`
- `darshan-player/test/unit/common/file-config.test.ts`
- `darshan-player/test/unit/services/pairing-service.test.ts`
- `darshan-player/test/unit/services/http-client.test.ts`
- `darshan-player/test/unit/main/operator-tools.test.ts`
- CONFIG docs and risk docs

## URL Emission Paths Reviewed

- Config summary diagnostics: redacted.
- Pairing service network diagnostics: redacted.
- Operator doctor output: redacted.
- Support-bundle diagnostics JSON: redacted.
- HTTP client initialization logs: redacted.
- HTTP connectivity diagnostic `baseURL`: redacted.
- WebSocket initialization/connect logs: redacted.
- Main startup backend configuration and parse-failure logs: redacted.
- Request queue URL logs: partially redacted in CONFIG-2.2; byte accounting and remaining log paths were corrected in CONFIG-2.3.
- Log shipper uploaded URL logs: partially redacted in CONFIG-2.2; remaining `uploadUrl` emission was corrected in CONFIG-2.3.
- Renderer webpage logs and renderer-to-main forwarding: not fully covered until CONFIG-2.3.

## Tests Run

```bash
cd darshan-player && npm run build
cd darshan-player && npx mocha --config .mocharc.json --spec test/unit/common/redaction.test.ts
cd darshan-player && npx mocha --config .mocharc.json --spec test/unit/common/file-config.test.ts
cd darshan-player && npx mocha --config .mocharc.json --spec test/unit/services/pairing-service.test.ts
cd darshan-player && npx mocha --config .mocharc.json --spec test/unit/services/http-client.test.ts
cd darshan-player && npx mocha --config .mocharc.json --spec test/unit/main/operator-tools.test.ts
cd darshan-player && npx mocha --config .mocharc.json --spec test/unit/main/cli.test.ts
cd darshan-player && npx mocha --config .mocharc.json --spec test/unit/services/player-flow.test.ts
cd darshan-player && npx mocha --config .mocharc.json --spec test/unit/services/heartbeat.test.ts
```

## Test Results

- `npm run build`: passed.
- `test/unit/common/redaction.test.ts`: 5 passing.
- `test/unit/common/file-config.test.ts`: 12 passing.
- `test/unit/services/pairing-service.test.ts`: 2 passing.
- `test/unit/services/http-client.test.ts`: 2 passing.
- `test/unit/main/operator-tools.test.ts`: 6 passing.
- `test/unit/main/cli.test.ts`: 7 passing.
- `test/unit/services/player-flow.test.ts`: 21 passing.
- `test/unit/services/heartbeat.test.ts`: 2 passing.

## Failed Tests

None in the CONFIG-2.2 targeted tests, but independent review found missing coverage and remaining raw URL emission paths. CONFIG-2.2 status is superseded by CONFIG-2.3.

## Blocked Tests

- Node 20 validation remains blocked in this workspace.
- Browser/on-prem runtime evidence remains blocked.
- Packaged player smoke remains blocked.

## Security Review

The redaction helper removes URL userinfo, all query strings, and fragments. Invalid URL input returns `[invalid-url-redacted]` and does not echo the raw string. Relative request paths are preserved only as paths with query strings/fragments removed. Committed config examples must remain non-credentialed, and credentialed URLs should still be treated as sensitive even though diagnostic/log output is redacted.

## Runtime URL Behavior

Runtime URL behavior is unchanged. Axios/WebSocket clients still receive the original configured URL values for network connections. Redaction is applied only when values are logged, serialized into diagnostics, printed by operator tooling, or written into support diagnostics.

## Runtime Evidence Status

BLOCKED_BY_ENV. CONFIG-2.2 is local code/test evidence only and does not claim browser, packaged player, or on-prem runtime validation.

## Rollback Plan

Revert CONFIG-2.2 code and docs. Runtime connection behavior is not changed by this phase, so rollback affects only emitted diagnostics/log redaction and tests.

## Next Phase Readiness

CONFIG-3 may start only after independent CONFIG-2.3 verification. Production readiness remains blocked by Node 20 validation and on-prem/browser/packaged runtime evidence.

## Recommendation

NEEDS_FIX
