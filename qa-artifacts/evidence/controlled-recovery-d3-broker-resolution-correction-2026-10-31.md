# D3 broker dependency-resolution P2 correction — 2026-10-31

Status: **STATIC REVIEW HANDOFF; NO LIVE ACCEPTANCE**. Only the dependency-resolution P2 was changed. No broker/activator/native utility process, socket/listener, Docker/DB/S3/job, seed/encryption/capture/backup/restore/stop, installation or commit was run. Compilers and deterministic test runners performed static verification. Retained source resources, private keys and receipts were untouched. Broker launch, environment, PIDFD, socket, scope, protocol and settlement implementations are unchanged.

The original inventory pinned canonical Zod bytes but did not prove that a built module's bare import would select those bytes. A nearer package or new package scope could redirect Node before it reached the enrolled tree. The corrected strict dependency receipt adds four AST-derived importer/specifier bindings, each with canonical package root, resolved entrypoint and package/entry SHA-256. Verification freshly parses all 14 built modules' static imports and export-from declarations and re-resolves every allowed bare import before dispatch; unsupported bare forms, dynamic import and require remain rejected. It still verifies the complete 614-file closure, including every file in the 596-file Zod tree.

The filesystem-only resolver implements the admitted bounded Node20 ESM subset: nearest package scope/self-reference, nearest `node_modules` package search and insertion-ordered matching `import` export conditions. It requires the canonical Zod root and `index.js` entrypoint, realpaths and enrolled bytes. New `dist/backups/package.json` or `dist/package.json` scopes are refused even when they appear harmless. Root/package import maps, root self-reference exports, nearer shadow packages at either level, symlink/alternate paths, missing canonical package, changed export target and unsupported export shapes fail closed. It never searches beyond the canonical root or substitutes CommonJS require conditions. Fixed launcher argv/env excludes custom conditions/loaders/NODE_OPTIONS. The [enrolled Node20.20.2 ESM resolution specification](https://nodejs.org/download/release/v20.20.2/docs/api/esm.html#resolution-algorithm-specification) is the algorithm reference.

Bounds remain explicit: at most 14 module/importer records, 128 KiB module source, 1024 file records, 64 KiB package metadata, three package search levels, eight conditional-export levels and 32 keys per conditional object. Existing file hashing is streaming and bounded. Package metadata and entry bytes are checked against the enrolled inventory; canonical realpaths, regular/single-link files, ownership/mode and stable metadata checks remain enforced. Resolution reads filesystem metadata/JSON only; target broker and package modules are not imported/evaluated. The existing TypeScript parser reads source as AST text.

Exactly four real built modules import Zod: `backup-broker-journal.js`, `backup-broker-protocol.js`, `configuration-capsule-policy.js`, and `repository-mutation-authority.js`. Actual static observation rederives the entire current receipt, including these four bindings, and matches enrollment exactly. The server rebuild leaves all 614 executable/module/package file bytes unchanged.

## Verification

The new 25 tests cover canonical import/export-from success and actual receipt rederivation; both nearer shadow-package levels; both intervening scope levels with type/self-export/import-map subcases; root self-export/import-map redirection; changed ordered import/node/default exports, arrays, escape and patterns; five symlink/alias forms; missing canonical package with a higher ancestor package present; unsupported `#`/subpath/dynamic/require imports; and canonical entrypoint byte drift. Temporary package entrypoints throw if evaluated, so canonical success also proves resolution does not execute them. Negative cases run through the broker preparation enrollment seam and assert no admitted continuation callback, admission/operation lock, protected publication/keyring effect or spawn.

All tests used `NODE_OPTIONS=--max-old-space-size=1024`, the unit config and a single fork. Results:

| Suite/check | Result |
|---|---|
| Broker lifecycle/resolution/env/storage/fake child | 103 passed |
| Broker production client/WorkerAdapter over fake transports | 27 passed |
| Reservation | 49 passed |
| D1 readiness / D2 / D3 / D4 tools | 12 / 4 / 16 / 8 passed |
| D3 execution / source state / ledger / pg client | 35 / 14 / 39 / 9 passed |
| Production worker adapter validation | 4 passed |
| Filtered D3 foundation | 29 passed; one deliberate native OpenSSL case skipped |
| **Distinct total** | **349 passed across 13 suites** |
| Scripts / recovery-test / app typechecks | PASS |
| Server build (`tsc && tsc-alias`) | PASS |
| Focused broker ESLint, zero warnings | PASS |
| `git diff --check` | PASS |
| Packet/runtime/templates/dependency byte audit | 74 / 9 / 21 / 614 PASS |
| Current correction inventory | 134 files PASS |

The 12-suite predecessor run passed 320 tests; filtered foundation passed 29. The focused two-suite run passed 130. Repeated runs are not added to the distinct total. The deliberately excluded foundation case invokes native OpenSSL; actual disabled foundation wiring is covered with only its fixed version-process transport replaced. Real filesystem-listener and live SQL suites remain excluded by this packet's no-live instruction. No unresolved failure remains.

## Enrollment and scope

The exact ten correction files (eight existing files plus this evidence and its index) and 134 current/historical file hashes are in [the correction inventory](controlled-recovery-d3-broker-resolution-correction-hashes-2026-10-31.json), SHA-256 `fc0a8b3ce6d1991514dc1fa62578a02e113c8242019ca95c900ac98bc0f9fb72`. The prior 132-file broker inventory reports precisely the eight intended changed files: enrollment module, broker unit test, dependency JSON, broker profile/schema, D3 activation, broker runbook and checklist. Prior evidence/inventory remain immutable historical files and are included in this correction's hash inventory.

| Current authority | SHA-256 |
|---|---|
| Broker enrollment module | `ee33a48641768738f822a4575b05561f76b5ce909f8e974281428373c26cb711` |
| Dependency receipt file, 614 files + 4 resolution bindings | `f69a5179fe506f2fe09f2d4d9d0a277258b0702b76bada38bb5a493b19925758` |
| Unsigned dependency inventory digest | `f0b49defdf297cdd063a85bbec4facaf9a64a93f78b75631298004d09f8fe045` |
| Disabled broker profile | `19f5c9c73cb80b6b6c229a0c166ff9ef220456f366cf8547497023144be2495f` |
| Broker profile schema | `a8eb2c1a69146c3422c543f934f268e76c7f67298a781224ce563b350764e7cd` |
| D3 activation, 74 packet assets | `072c1ad08fd7e35f914a5ddcd3c99d48f8349b5cca7abe3921b251128a5ac022` |

Only the broker profile's dependency-receipt binding changes legitimately. Source `1deb808f54ec122f85280b0e5b446913a8db78075b6505b7d77b6beba0278632`, data `33a2b270c55739e839dca7403034f49f24c39db5d8a8a93a413114bbf4d4176b`, capsule `5ff0dcaf1c6c6f0c6588143bb1f24ec39f2a772efd360d72bc596e2232e5c1e7`, and reservation `b557f180307dfa7ada44d9574ca99385d001104ad3b6b7201bfdc6b44ca14707` profile hashes are unchanged. Scope enrollment remains null; installed broker loader rejects. D2/capsule/live-capsule/reservation/broker/capture/whole-run remain false; selectively enrolled live-seed remains true. Missing live receipts and positive enrolled controller scope remain blockers. No live go command is provided.

Static review command from `/home/hexmon/Desktop/DARSHAN-SIGNAGE/darshan-server`:

```bash
NODE_OPTIONS=--max-old-space-size=1024 ./node_modules/.bin/vitest run --config vitest.unit.config.ts scripts/development/controlled-recovery-d3-broker.unit.test.ts scripts/development/controlled-recovery-d3-broker-protocol.unit.test.ts --pool=forks --poolOptions.forks.singleFork=true --testTimeout=60000 --hookTimeout=60000
```

The [broker runbook](../../docs/runbooks/controlled-recovery-d3-broker-static.md) and checklist record this correction. Production broker code, native recovery and all prior security contracts remain unchanged.
