# Player Blocker Triage

Date: 2026-06-18

## Player Lint

Command:

```bash
cd darshan-player && npm run lint
```

Result: blocked.

Exact blocker:

```text
ESLint: 9.39.2
ESLint couldn't find an eslint.config.(js|mjs|cjs) file.
From ESLint v9.0.0, the default configuration file is now eslint.config.js.
```

Assessment: this is an existing ESLint v9 flat-config migration issue. It is not caused by the OTP HTML/CSS redesign.

## Full Unit Suite

Command:

```bash
cd darshan-player && npm run test:unit
```

Result: failed with 234 passing, 12 failing.

Failing groups:

- `Default Media Player helpers`: 4 failures caused by module resolution for `src/renderer/pdf-playback` imported from `src/renderer/default-media-player.ts`.
- `Player layout helpers`: 8 failures caused by `ReferenceError: require is not defined in ES module scope` at `src/renderer/webpage-playback.ts:2`.

Assessment: these are renderer module-loader/test-infrastructure failures. The redesigned file is `src/renderer/index.html`; the failures are in renderer TypeScript module loading and do not reference the OTP HTML changes.

## Targeted Player Regression Tests

Command:

```bash
cd darshan-player && npx mocha --config .mocharc.json --spec test/unit/main/cli.test.ts --spec test/unit/main/operator-tools.test.ts --spec test/unit/services/player-flow.test.ts --spec test/unit/services/heartbeat.test.ts
```

Result: passed, 37 tests.

## Live Electron Verification

Command:

```bash
cd darshan-player && DARSHAN_RUNTIME_ROOT=/tmp/darshan-player-final-qa npm run start:dev
```

Result: blocked before window creation.

Exact blocker:

```text
TypeError: Cannot read properties of undefined (reading 'requestSingleInstanceLock')
at dist/main/main/index.js:66
```

Assessment: live Electron OTP was not verified. DOM-only OTP rendering was captured from the built renderer output.

