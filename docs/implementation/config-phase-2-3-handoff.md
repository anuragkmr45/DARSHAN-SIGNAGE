# CONFIG-2.3 Handoff: Remaining Player URL Emission Redaction

## Summary

CONFIG-2.3 patches the remaining player URL emission paths found during independent CONFIG-2.2 verification. Runtime URLs still remain raw for actual HTTP, WebSocket, webpage, and upload operations. Redaction is applied only to emitted logs, renderer-to-main log payloads, diagnostics, doctor output, and support output.

## Scope Implemented

- Added recursive log payload URL sanitization in the player redaction utility.
- Applied URL-substring redaction to player logger message strings and structured payloads.
- Redacted log-shipper uploaded URL logs while returning the raw upload URL to runtime callers.
- Redacted renderer webpage live URL and navigation drift logs while preserving raw `webview.src` / `loadURL` behavior.
- Sanitized renderer-to-main log payload forwarding.
- Sanitized renderer player log payloads before console/IPC emission.
- Sanitized text log contents before support-bundle collection and log-shipment bundling; compressed historical logs are omitted from those outgoing bundles instead of copied raw.
- Restored request-queue runtime byte accounting to use the raw request URL while keeping emitted URL fields redacted.
- Added regression tests for central redaction, logger output, log shipper output, renderer webpage logging, and request-queue byte accounting.

## Files Changed

- `darshan-player/src/common/redaction.ts`
- `darshan-player/src/common/logger.ts`
- `darshan-player/src/main/index.ts`
- `darshan-player/src/main/services/log-shipper.ts`
- `darshan-player/src/main/services/network/request-queue.ts`
- `darshan-player/src/main/services/operator-tools.ts`
- `darshan-player/src/renderer/player.ts`
- `darshan-player/src/renderer/webpage-playback.ts`
- `darshan-player/test/unit/common/redaction.test.ts`
- `darshan-player/test/unit/common/logger.test.ts`
- `darshan-player/test/unit/services/log-shipper.test.ts`
- `darshan-player/test/unit/services/request-queue.test.ts`
- `darshan-player/test/unit/renderer/webpage-playback.test.ts`
- CONFIG handoff, architecture, reduction plan, runbook, and risk docs

## URL Emission Paths Reviewed

- Config summary diagnostics: already redacted by CONFIG-2.1 / CONFIG-2.2.
- Pairing diagnostics and doctor output: already redacted by CONFIG-2.2 and still covered.
- HTTP/WebSocket/startup URL logs: already redacted by CONFIG-2.2 and still covered.
- Log shipper `uploadUrl` logs: redacted in CONFIG-2.3.
- Log shipper outgoing log bundle contents: sanitized in CONFIG-2.3.
- Support-bundle copied text log contents: sanitized in CONFIG-2.3.
- Renderer webpage `liveUrl`, `expected`, and `actual` logs: redacted in CONFIG-2.3.
- Renderer-to-main log forwarding: sanitized in CONFIG-2.3.
- Renderer player logs: sanitized in CONFIG-2.3.
- Request queue emitted URL fields: remain redacted.
- Request queue byte accounting: restored to raw runtime URL data.

## Tests Run

```bash
cd darshan-player && npm run build
cd darshan-player && npx mocha --config .mocharc.json --spec test/unit/common/redaction.test.ts
cd darshan-player && npx mocha --config .mocharc.json --spec test/unit/common/logger.test.ts
cd darshan-player && npx mocha --config .mocharc.json --spec test/unit/services/log-shipper.test.ts
cd darshan-player && npx mocha --config .mocharc.json --spec test/unit/renderer/webpage-playback.test.ts
cd darshan-player && npx mocha --config .mocharc.json --spec test/unit/common/file-config.test.ts
cd darshan-player && npx mocha --config .mocharc.json --spec test/unit/services/pairing-service.test.ts
cd darshan-player && npx mocha --config .mocharc.json --spec test/unit/services/http-client.test.ts
cd darshan-player && npx mocha --config .mocharc.json --spec test/unit/services/request-queue.test.ts
cd darshan-player && npx mocha --config .mocharc.json --spec test/unit/main/operator-tools.test.ts
cd darshan-player && npx mocha --config .mocharc.json --spec test/unit/main/cli.test.ts
cd darshan-player && npx mocha --config .mocharc.json --spec test/unit/services/player-flow.test.ts
cd darshan-player && npx mocha --config .mocharc.json --spec test/unit/services/heartbeat.test.ts
```

## Test Results

- `npm run build`: passed.
- `test/unit/common/redaction.test.ts`: 9 passing.
- `test/unit/common/logger.test.ts`: 1 passing.
- `test/unit/services/log-shipper.test.ts`: 2 passing.
- `test/unit/renderer/webpage-playback.test.ts`: 4 passing.
- `test/unit/common/file-config.test.ts`: 12 passing.
- `test/unit/services/pairing-service.test.ts`: 2 passing.
- `test/unit/services/http-client.test.ts`: 2 passing.
- `test/unit/services/request-queue.test.ts`: 4 passing.
- `test/unit/main/operator-tools.test.ts`: 7 passing.
- `test/unit/main/cli.test.ts`: 7 passing.
- `test/unit/services/player-flow.test.ts`: 21 passing.
- `test/unit/services/heartbeat.test.ts`: 2 passing.

## Failed Tests

None in the CONFIG-2.3 targeted test set.

## Blocked Tests

- Node 20 validation remains blocked in this workspace; local Node is not the supported `>=20 <21` runtime.
- Browser/on-prem runtime evidence remains blocked.
- Packaged player smoke remains blocked.

## Security Review

CONFIG-2.3 prevents URL username/password userinfo, query strings, fragments, credentialed upload URLs, signed URL query material, and invalid raw URL-like values from being emitted by the patched player diagnostic/log paths. The central logger now sanitizes both structured payloads and message strings. Renderer log payloads are sanitized before IPC forwarding, and webpage playback logs redact `liveUrl`, `expected`, and `actual` URL fields. Outgoing support-bundle text logs and log-shipment bundle text logs are sanitized; compressed historical logs are omitted from those outgoing bundles because they cannot be redacted safely in this phase.

Credentialed URLs remain sensitive. They should stay in env/secrets, not committed site config. Operator screenshots, logs, and support bundles still require review before external sharing.

## Runtime URL Behavior

Runtime URL behavior is unchanged. The player continues to use raw configured URLs for:

- HTTP API calls
- WebSocket connections
- webpage `webview.src` / `loadURL`
- log upload presigned URLs
- request-queue byte accounting

## Runtime Evidence Status

BLOCKED_BY_ENV. CONFIG-2.3 is local code/test evidence only and does not claim browser, packaged player, Node 20, or on-prem runtime validation.

## Rollback Plan

Revert CONFIG-2.3 code and docs. Runtime network behavior is not changed by this phase, so rollback affects emitted diagnostic/log redaction and targeted tests only.

## Next Phase Readiness

CONFIG-3 can start after independent CONFIG-2.3 verification. Production readiness remains blocked by Node 20 validation and real browser/on-prem/packaged runtime evidence.

## Recommendation

APPROVE_WITH_CONDITIONS
