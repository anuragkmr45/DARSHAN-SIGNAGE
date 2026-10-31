# D3 capsule independent-review P2 corrections

This is a separate static correction of the two reviewed capsule defects. The [base packet evidence](controlled-recovery-d3-capsule-static-2026-10-31.md), SHA-256 `0ca72c6ee983e0ea978208c492ba66d16fd64c92001400a4fb9b8c7af1ad73a8`, and its historical hash inventory remain unchanged. **No Docker/live source/data command, real age encryption, SQL/S3 connection, service mutation, host installation or commit occurred.** Retained source resources, journals, private age/UI/source identities and receipt history were untouched. Unit verification uses temporary protected files, fake Docker/data/age transports and enrolled offline OpenSSL only.

## Retained CID ownership

`ProtectedD3ExecutionStorage` now inspects the exact five age components (`age-version`, `age-keygen`, `age-recipient`, `age-encrypt`, `age-decrypt`) while the newly acquired outer transaction lock is held, before the callback can publish plaintext or invoke tools. Any retained/unsafe CID blocks; its bytes/inode/link/mode are preserved. The outer transaction releases only its lock directory and never releases a component CID merely because it acquired the shared slot.

Borrowed invocations check their CID before preflight and immediately before dispatch. A pre-dispatch name/output/enrollment/cancellation/spawn refusal cannot delete a CID for which this invocation has no ownership proof. CID release requires actual dispatch plus exact observed full container ID/name/image/labels and safe settlement using the existing fixed runner. A container already absent without observed ownership remains uncertain for a borrowed invocation; the CID/outer lock stay retained. Before unlink, the protected file must still contain the exact settled ID with stable inode/link/size/mtime/ctime. Failure retains the outer authority and returns settlement uncertainty. Ordinary fixed runner argv, image/config/caps, clean environment, no-shell/stdin policy and `rm --volumes` behavior are unchanged.

Regression cases use real protected CID bytes/inodes for all five components and prove no callback/plaintext/tool effect. Additional cases preserve real CID evidence on pre-dispatch output/name refusal, reject a changed settled ID without unlink, and retain ownership for post-dispatch absence without proof. Existing abort/timeout/overflow/spawn/nonzero/name/label/cleanup uncertainty, serialization and ignored-inner-rejection coverage remains green.

## Truthful archived backend role

The production worker contract was traced through `src/config/index.ts`, `src/utils/backup-runs.ts` and `src/backups/encryption.ts`. `AGE_PATH`, `AGE_VERSION` and `AGE_SHA256` identify a native executable that is hashed and invoked with ordinary age arguments. Current D4 authority pins an immutable container image/config and a wrapper which requires an additional absolute tool argument. Its image/wrapper hashes are not the native age binary SHA, and its wrapper argv contract is incompatible with direct worker age argv. Substituting those values would fabricate authority; no production validator was changed to accept them.

The authorized fallback is explicit: the archived backend declares `DARSHAN_PROCESS_ROLE=api`, `DARSHAN_D3_BACKUP_WORKER_AVAILABLE=false` and blocker `NATIVE_PINNED_AGE_AUTHORITY_NOT_ENROLLED`. The strict capsule profile/schema bind the same declarations. No `AGE_*` pin is fabricated or archived. The backend remains self-contained mapped env/file credentials without an unarchived `backend.json` selector.

`composeD3CapsuleBackendEnv()` accepts exactly the original three derived overlay fields and rejects extra/age/role substitution. The renderer also rejects an unsupported worker role or any substituted age authority. The integrated regression composes the actual archived base env plus exact overlay, models its fixed secret/certificate mount namespace using temporary canonical capsule files, and invokes the **unchanged real production config loader/validator**. API validation passes with `configFile.configured:false/loaded:false`; production worker validation rejects missing native age metadata and changed invalid age SHA. Even syntactically valid container image metadata cannot be injected as an authorized age pin through capsule composition. No jobs, app or network clients are started.

## Enrollment and continuity

Only five existing asset entries rotate: `d3-execution`, `d3-capsule-profile`, `d3-capsule-profile-json`, `d3-capsule-schema`, `d3-capsule-render`. Asset roles remain exactly **54**. The backend template legitimately changes role/availability declarations, so its pinned template digest and the separate capsule profile/schema change. Source/data profile identities, D2, tools image/config/wrapper and private age identity/history do not rotate. The accepted derived-overlay set remains exactly three fields. No source CLI, production/native boundary, migration, seed, broker, capture or restore behavior is changed.

| Authority | SHA-256 |
| --- | --- |
| Source runtime profile, unchanged | `1deb808f54ec122f85280b0e5b446913a8db78075b6505b7d77b6beba0278632` |
| Data profile, unchanged | `33a2b270c55739e839dca7403034f49f24c39db5d8a8a93a413114bbf4d4176b` |
| Corrected capsule profile | `5ff0dcaf1c6c6f0c6588143bb1f24ec39f2a772efd360d72bc596e2232e5c1e7` |
| Corrected D3 activation | `a14b411cf474194abaecbc090a183e3a85716eb6c369c78baf2d891861e63c73` |

The separate [current correction hash inventory](controlled-recovery-d3-capsule-static-p2-hashes-2026-10-31.json) records all 54 assets, 21 templates and relevant implementation/test/profile/runbook/QA files. The earlier inventory remains a historical record. `live_seed_enabled:true` is preserved; capsule/live-capsule/capture/D2/whole-run remain false. Installed capsule construction remains unavailable, and the source journal is not advanced.

## Static verification

The focused combined run passed **90 tests**, four files, **114.76 s**. A final exact settled-CID binding check added one regression; the affected executor suite then passed **30/30 in 5.72 s**, for **91 distinct focused cases**: executor 30, capsule provider 21, file/profile 24, age staging 16. The unchanged production config policy and D1/D2/D3/D4/foundation/production capsule predecessors passed **87 tests**, eight files, **12.24 s**. Current correction total: **178 distinct tests passed**, 12 files. All runs used one fork. The base packet's broader source suites remain historical verification; they are not represented as rerun in this narrower correction.

| Check | Final result |
| --- | --- |
| Focused capsule/CID/staging suites | **91 distinct passed**, four files, as described above |
| Affected D1/D2/D3/D4/foundation/production config/capsule predecessors | **87 passed**, eight files, **12.24 s** |
| `tsc --noEmit -p tsconfig.scripts.json` | passed |
| `tsc --noEmit -p tsconfig.recovery-tests.json` | passed after a test-only temporary-root literal type assertion correction |
| `tsc --noEmit -p tsconfig.json` | passed |
| `npm run build` | passed (`tsc && tsc-alias`); no app/service started |
| Focused ESLint for all changed TS implementation/test files | passed, zero warnings |
| Diff/new-file whitespace and exact asset/template/runtime/gate audits | passed |

Heavy checks ran serially with `NODE_OPTIONS=--max-old-space-size=1024` for compiler/build commands. The first recovery-test typecheck found only a temporary-root test fixture's literal authority type; its explicit test-scope type assertion was corrected, preserving fixed production root validation. Final checks verify **54/54 asset digests, 21/21 template digests, all nine post-build runtime file digests, both unchanged source/data profile digests and every unchanged live gate**. Only the backend env template changed among the 21 template inputs. The current machine-readable correction inventory contains **89** files, including QA status; its exact digest is supplied in the final handoff. No failing or deferred check is represented as passing.

The fixed static review command remains the four-suite single-fork command in [the runbook](../../docs/runbooks/controlled-recovery-d3-capsule-static.md), with 30-second per-test/hook bounds. No installed/live capsule command is offered by this packet.

## Remaining boundaries

Independent review, successful real source seed/schema/seal acceptance, unchanged host/source admission and a separately enrolled fixed installed capsule command remain necessary before bounded live capsule acceptance. Real encryption and capsule acceptance are not inferred from unit fixtures. A backup worker specifically remains unavailable until compatible genuine native executable authority is separately enrolled/reviewed; container image or wrapper hashes cannot waive it. Broker/capture/backup/restore/application/promotion/rollback and exact retained-resource cleanup remain unaccepted. Do not delete retained CID evidence or uncertain locks/staging to make a retry pass.
