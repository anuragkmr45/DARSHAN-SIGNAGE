# Backup recovery Packet 05A2c1 developer verification — 2026-10-29

## Scope and safety boundary

Implemented only the pure compiled recovery runtime/import/cancellation half of
Packet 5A2c. The current eight pre-import CLI commands are unchanged. No live
service, Docker container, database, object store, recovery-only broker
listener, target, private age identity, decrypt, import, restore, promotion,
rollback, hold release, or lock reclamation was started or performed.

Packet 5A2c2 remains responsible for the dedicated recovery-only broker
listener, the pre-Node `env -i` host launcher, and generated Compose mount
profiles. Target preparation, decrypt/import, reconciliation, validation,
promotion/rollback, successful-restore release, and an isolated recovery drill
remain Packet 5B.

## Implemented boundary

- Extracted migration manifest/baseline types, stable `MigrationLedgerError`,
  loaders, and fingerprint functions into pure
  `src/deployment/migration-manifest.ts`. `migration-ledger.ts` retains
  compatible re-exports and runtime error identity. Recovery compatibility and
  target loading no longer value-import PostgreSQL, advisory locks, or drizzle.
- Added the compiled `darshan-recovery-runtime-v1` entrypoint. It sets umask
  `0077` before writes, accepts only Linux/x64, exact Node 20, effective
  `1000:1000`, the eight reviewed commands, exact minimal locale/path/private
  home/tmp environment, and canonical owner-only fixed scratch at
  `/var/tmp/darshan-recovery-runtime` with bounded free capacity. Scratch,
  home, and tmp are existing directories; the runtime does not create them.
- Runtime validation rejects Node execution flags, unexpected environment
  fields (including application, database, PG, AWS/S3, proxy, `NODE_OPTIONS`,
  `NODE_PATH`, and loader variables), private-key/decrypt/executable options,
  unsupported commands, unsafe ownership/modes/symlinks, read-only/full
  scratch, and identity swaps. Values are never echoed. Argument rejection is
  option-aware, so a legitimate file path containing `decrypt` is not rejected.
- The CLI is dynamically imported only after the runtime contract succeeds.
  Clean help and missing-config runs keep their existing output/exit contracts,
  perform no network startup, and create no recovery journal/scratch entry.
- One per-invocation `AbortSignal` now propagates through CLI dispatch,
  preflight, protected operator/plan/review/journal/repository reads, retained
  source verification, workflow, and broker client transport. First
  `SIGINT`/`SIGTERM` aborts; a second signal or five-second grace expiry
  fail-stops with exit 130. Pre-dispatch cancellation is definite. Dispatched
  mutation cancellation retains durable intent as ambiguous and requires
  supported status/resume reconciliation. Nothing auto-releases holds or
  reclaims locks.
- Production compilation includes the runtime wrapper but intentionally exposes
  no npm production-runtime aliases: npm injects environment fields outside the
  exact runtime contract. Direct native invocation under the reviewed
  six-variable environment is the only c1 production boundary; the pre-Node
  `env -i` launcher remains 5A2c2. Production compilation
  emits a canonical `dist-cli/recovery-runtime-manifest.json` generated from
  the compiled target/runtime constants and fresh assets. It binds release,
  target, compatibility, terminal migration/fingerprint, Linux/x64/Node/uid/gid,
  entrypoint hash, every compiled-output-confined import-closure hash, exact
  builtin set, the sole bare runtime dependency (`zod`) with immutable reviewed
  version/package/tree identity, strict package-lock identity, and all migration
  SQL plus reviewed Drizzle metadata hashes. The AST gate covers side-effect,
  static, re-export, and dynamic imports and rejects nonliteral dynamics,
  unknown builtins/packages, relative escapes, symlinks/hardlinks, and
  application/effect modules. The verifier independently recomputes the full
  canonical identity and assets.
- The native verifier runs the freshly compiled wrapper under Node 20 with an
  `env -i`-equivalent six-variable child environment, explicit 15-second
  timeout, 512-KiB output cap, and identity-anchored cleanup of only scratch it
  created. Existing unsafe/symlink scratch is never chmodded, traversed, or
  mutated. It verifies help,
  missing-config, poison rejection/redaction, no scratch/journal creation,
  manifest hashes, and a JavaScript-only closure with no tsx/source, dotenv,
  app config, PostgreSQL/pg/drizzle, AWS/S3, API/server, jobs, or realtime
  startup import.

JavaScript cannot undo `NODE_OPTIONS`, `LD_PRELOAD`, or another loader already
applied before Node begins. Therefore the 5A2c2 pre-Node `env -i` launcher is a
mandatory defense, not replaced by the in-process allowlist.
Loader-variable smoke uses only a non-secret invalid path because the platform
loader may echo its value before JavaScript begins; no pre-Node redaction claim
is made in c1.

## Observed defects and fixes

1. Recovery target/compatibility imported the DB-backed migration ledger. The
   pure module extraction removed that closure while preserving the legacy
   exported class identity and codes used by production migration commands.
2. The first runtime draft used only an environment blacklist. Review found
   that unknown loader/startup variables would remain possible. It now requires
   the exact six-field environment and exact values.
3. The first argument guard scanned values and could reject an ordinary path
   containing `decrypt`. It now rejects forbidden option names only; the CLI's
   strict per-command allowlist still rejects unknown flags.
4. The first fixed scratch proposal was `/app/...`, which is image-local and
   cannot support the required fresh Backend-host smoke without privileged
   setup. The fixed boundary is now `/var/tmp/darshan-recovery-runtime`, with
   exact protected metadata and a future 5A2c2 bind-mount/launcher contract.
5. Moving only manifest functions would have changed `instanceof
   MigrationLedgerError` behavior in existing production migration error
   handling. The shared error class and complete code union now live in the
   pure module and are re-exported by the ledger; the regression is tested.
6. Review found that the initial regex/recorded-hash manifest could miss
   side-effect imports and accept regenerated tampered assets. The manifest is
   now AST-derived, confined to compiled output, pinned to reviewed dependency,
   package-lock and migration/meta bytes, written without following output
   symlinks, and independently recomputed by verification.
7. Review found the native smoke could recursively create/chmod through an
   existing fixed scratch symlink and clean up only on success. It now validates
   before any write, creates through an open canonical parent, tracks exact
   created inodes, and cleans them in `finally` without mutating preexisting
   scratch.
8. An aborted CLI signal originally overrode every classified workflow error.
   That could turn a dispatched broker mutation with
   `RECOVERY_BROKER_EFFECT_AMBIGUOUS` into exit 130. Classified non-cancellation
   recovery errors now remain authoritative; only actual/unclassified aborts
   normalize to `RECOVERY_CANCELLED`. Read-only inspection aborts and definite
   pre-dispatch mutation aborts map to cancellation, while post-dispatch
   mutation aborts retain durable ambiguous intent and exit 7.
9. Review found a scratch-root/child swap window after the initial checks.
   Runtime validation now compares stable before/after identities for both
   private children and performs a final root identity/realpath check after all
   child validation.
10. Review found that npm itself injects `npm_*`, `INIT_CWD`, and related
    fields, making proposed `production:recovery*` aliases incompatible with
    the exact environment contract. Those aliases were removed. c1 ships the
    compiled entrypoint and manifest only; c2 still owns the fixed pre-Node
    launcher.
11. Review found the parent verifier directly imported production recovery
    exports under ambient environment with no timeout. Both export probes now
    run in a bounded Node 20 subprocess with the exact six-variable environment,
    output cap, and active-handle timeout regression. Loader poison uses a
    non-secret path because `ld.so` may echo it before JavaScript can redact it.
12. Review found that dependency bytes could be changed and a new manifest
    generated. The gate now pins exact `zod` version, package JSON digest,
    complete installed-tree digest/file count, full package-lock digest, and
    strict lock entry/root-dependency coherence.

## Three bounded verification loops

1. Independent focused runtime/import/signal/migration review loop: **10 files,
   85/85 tests passed**.
2. Copied-output/filesystem/native adversarial loop, serial: **21/21 probes
   passed** in 34.97 seconds. It covered side-effect/unknown/builtin/nonliteral
   and forbidden relative imports, compiled-output escape, closure/output
   symlinks, regenerated dependency/version drift, lock/migration/meta/closure
   tampering, missing manifest evidence, unsafe scratch roots, failure cleanup,
   bounded hanging import, and ambient canary exclusion.
3. Final affected recovery/package loop in one low-RAM fork: **15 files,
   133/133 tests passed** in 3.41 seconds.

An initial broader final-loop command accidentally included the database-backed
`migration-ledger.test.ts`; its 10 tests failed at setup with
`ECONNREFUSED 127.0.0.1:5432` because no PostgreSQL service was started. This
packet explicitly prohibited live service/database operation. The bounded
non-database affected set was then rerun once and passed 133/133. No database
schema or live state was touched.

Additional gates:

- `npx tsc --noEmit -p tsconfig.json`: passed.
- `npx tsc --noEmit -p tsconfig.scripts.json`: passed.
- Strict ESLint on touched production and test TypeScript with
  `--max-warnings=0`: passed after replacing one test-only explicit `any` with
  an exact fixture shape.
- JavaScript syntax checks for both runtime build/native verifier scripts:
  passed.
- `npm run build`: passed.
- `npm run build:production`: passed; emitted the strict runtime manifest.
- `node scripts/verify-recovery-runtime-manifest.mjs`: passed with
  `recovery-runtime-manifest-ok`.
- Fresh direct `/usr/bin/env -i` invocation using Node **20.20.2**, exact
  PATH/LANG/LC_ALL/TZ/HOME/TMPDIR, and no npm/tsx: passed with
  `recovery-native-import-ok`.
- Compiled closure audit: **29 hashed JS files**, only `zod`, **57 migration
  SQL assets**, **5 reviewed migration metadata assets**, exact reviewed six
  Node builtins, no forbidden import category. `zod` is 3.25.76 with 596 hashed
  files; package-lock SHA-256 is
  `23bd7e38efe5c0a9ecc4589e4a539e88990d082f2998341fa1d2cd78dcb944e0`.
- Scratch absence after all probes, package JSON parse, `git diff --check`, and
  whitespace checks: passed.

This is source/developer build evidence only. It is explicitly not live restore,
decrypt/import, production-topology, broker-listener, recovery-target, RPO, or
RTO evidence.
