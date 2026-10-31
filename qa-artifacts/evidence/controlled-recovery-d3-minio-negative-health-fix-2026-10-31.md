# D3 MinIO raw negative TLS probe correction — static handoff

Status: **STATIC ONLY; NO LIVE RETRY OR ACCEPTANCE**. This packet corrects only the raw negative MinIO health transport diagnosed after recovery-prefix gate03. No source/prefix/status/data-status/seed command, live Docker/container/DB/S3/Valkey/network operation, repair, encryption, backup/restore/stop, installation or commit was run. Retained services, source journals, secrets, keys and receipts were not accessed or changed by this packet. Temporary unit fixtures and fake transports provide the new verification boundary.

The [read-only diagnosis](controlled-recovery-d3-health-gate03-diagnosis-2026-10-31.md) reproduced a second-round unauthenticated403 response on a pooled global-agent socket with no new handshake callback, leaving the former per-request callback-only certificate digest null. The observed defect was socket reuse; TLS session resumption was not observed. That evidence and [blocked gate03](controlled-recovery-d3-recovery-prefix-live-gate-03-2026-10-31.md) remain immutable history. This static correction does not turn either into migration-prefix acceptance.

Every raw HTTPS negative request now owns a fresh Agent with keepAlive=false, maxCachedSessions=0, maxSockets=1 and maxTotalSockets=1. Plaintext negative requests also use a fresh nonpooled owned HTTP Agent. The same CA, fixed SNI, rejectUnauthorized=true, TLS minimum, certificate fingerprint and request timeout are retained. The installed request deadline remains666ms (the unchanged2000ms three-probe group divided by three); a separate fixed250ms teardown deadline bounds close proof. No admission/resource threshold or health meaning changed.

The transport independently examines the actual request/response TLSSocket at headers and completed body: it must be encrypted, authorized=true, have no authorizationError, match the fixed hostname and exact raw-certificate SHA-256, and retain exact socket identity. A successful handshake callback is no substitute. Unexpected reusedSocket or session resumption still undergoes the actual authorization/pin check and is then rejected. The owned request Agent identity is checked. Status, canonical optional Content-Length, completed body and8192-byte body bounds are enforced; the existing unauthenticated403 AccessDenied and plaintext400 TLS_REQUIRED contracts remain unchanged. Authenticated S3 remains on the original SDK ListBuckets branch; PostgreSQL, Valkey, protected layout/target observers and production modules were not changed.

Completion, error, abort and timeout destroy the tracked request, response, socket and owned Agent. Success requires observed close for every tracked resource, no leftover active/free/queued Agent resources and no cancellation. Failure to join within250ms returns the same nonsecret failed health result. Request/response/socket/Agent error listeners and abandoned drain rejection handlers remain observed after teardown; raw exception text, credentials, response bodies and private paths are never returned. An already-aborted caller creates no request.

## Static verification

The new fake-only health suite passes **33/33**. It models the former global pool skipping the second callback, proves two rounds obtain distinct owned sockets and independent actual-peer observations, and checks missing/wrong peer/name, unauthorized/error state, skipped callback, unexpected reuse/resumption, late peer/auth/socket drift, retained Agent resources, malformed status/length/body/incomplete response, request/body/socket/factory errors, exact666ms timeout, stalled body/request/response/socket joins, abort before/during dispatch, late error/unhandled-rejection observation, secret redaction, timer cleanup and the unchanged authenticated SDK branch. No native socket is opened by that suite.

The affected single-fork run passes **420 tests across four suites**, with16 deliberate native-fixture exclusions: health33, recovery-prefix257, installed-source101 and foundation29. The exclusions are15 installed native retained-layout cases and one foundation real-enrollment case; no live acceptance or rerun of unrelated predecessor suites is claimed. Exact command from darshan-server:

```sh
NODE_OPTIONS=--max-old-space-size=1024 ./node_modules/.bin/vitest run --config vitest.unit.config.ts scripts/development/controlled-recovery-d3-source-health.unit.test.ts scripts/development/controlled-recovery-d3-recovery-prefix.unit.test.ts scripts/development/controlled-recovery-d3-source-installed.unit.test.ts scripts/development/controlled-recovery-d3-foundation.unit.test.ts --testNamePattern='^(?!.*loads a real strict tiny runtime enrollment)(?!.*revalidates .*file/volume receipt against actual retained layout)(?!.*Populated installed status).*' --pool=forks --poolOptions.forks.singleFork=true --testTimeout=20000
```

Recovery-test, scripts and app typechecks, plain server build (`tsc && tsc-alias`), focused zero-warning lint and git diff--check passed. The first recovery-test typecheck exposed four Node20 declaration/test-fixture typing errors; narrow Agent observation casts and an explicit test-only resource-map cast corrected them without weakening runtime validation or suppressing lint rules. All final checks exit0. No verification handle remains running. Static commands used a1024MiB Node heap, with heavyweight checks serialized:

```sh
NODE_OPTIONS=--max-old-space-size=1024 ./node_modules/.bin/tsc --noEmit -p tsconfig.recovery-tests.json
NODE_OPTIONS=--max-old-space-size=1024 npm run typecheck:scripts
NODE_OPTIONS=--max-old-space-size=1024 ./node_modules/.bin/tsc --noEmit -p tsconfig.json
NODE_OPTIONS=--max-old-space-size=1024 npm run build
NODE_OPTIONS=--max-old-space-size=1024 ./node_modules/.bin/eslint scripts/development/controlled-recovery-d3-source-health.ts scripts/development/controlled-recovery-d3-source-health.unit.test.ts --max-warnings=0
```

Post-build byte audits pass for87 packet assets,9 runtime assets,21 templates and614 broker dependency files; broker size/owner/mode metadata also remains exact. All614 broker dependency bytes and all six profile identities remain unchanged. The new unit/evidence files also pass explicit trailing-whitespace/newline checks. The public inventory below provides the reproducible file list and expected digests for the final audit.

| Changed authority | SHA-256 |
|---|---|
| Source health implementation | `6e49fcb146ab03bc8918e987ca8f1e7b13cd92e015f1d80e19fa858195aeb9b1` |
| Pure health suite | `9164cd7666c1382e58967a0b4df3c3712752cfcba888f370517470403c3f5860` |
| Recovery-test tsconfig | `20db554c6153f2a854f3d78140984ae841e83ca8bb7aa623364416e3cb5ab0f7` |
| D3 activation, only source-health asset refreshed | `f9982f5286f16f6c9b19e9660024cd216a7c4fa4ed107912a0fc05e0a1d58387` |
| Recovery-prefix runbook | `7bb4ab7d3a12c988441a656542d14d04672741302492b391d565797412bd3c33` |

All six profile identities remain unchanged: source `1deb808f54ec122f85280b0e5b446913a8db78075b6505b7d77b6beba0278632`, data `33a2b270c55739e839dca7403034f49f24c39db5d8a8a93a413114bbf4d4176b`, capsule `5ff0dcaf1c6c6f0c6588143bb1f24ec39f2a772efd360d72bc596e2232e5c1e7`, reservation `b557f180307dfa7ada44d9574ca99385d001104ad3b6b7201bfdc6b44ca14707`, broker `19f5c9c73cb80b6b6c229a0c166ff9ef220456f366cf8547497023144be2495f`, capture `dc18e51dafe7c7e2e074f6c64da25704df7bf8818af841e24473c237a1dabdd0`. Live seed remains enrolled; capsule/reservation/broker/capture/D2/whole-run remain false and broker scope null. No template, image, private age identity or production contract changed.

The [new public hash inventory](controlled-recovery-d3-minio-negative-health-fix-hashes-2026-10-31.json) includes the prior232-file capture-settlement inventory, its immutable index, gate03 and diagnosis evidence pairs, the new health test and this evidence; it excludes itself to avoid a digest cycle. Exactly four previously indexed files change: source health, recovery-test tsconfig, the single asset enrollment and the runbook. The test, evidence and new index complete a seven-file correction packet. A separately reviewed and explicitly authorized live gate is still required; no live command is authorized by this evidence.
