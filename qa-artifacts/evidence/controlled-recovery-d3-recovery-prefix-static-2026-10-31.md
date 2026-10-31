# D3 retained migration-prefix observer — static handoff

Status: **STATIC ONLY; NO LIVE PREFIX ACCEPTANCE**. This packet implements the fixed read-only `recovery-prefix` command that was missing from the preceding [status/data-status gate](controlled-recovery-d3-readonly-status-data-gate-2026-10-31.md). Existing data-status still refuses SERVICES_READY before SQL/S3 observation. No live command, Docker/DB/S3 effect, native utility, socket/listener, seed/encryption/capture/backup/restore/stop, installation or commit ran in this packet. Verification used fake transports and temporary protected files. Static filesystem reads were limited to checked-in inputs, the existing public age receipt, and opaque retained key metadata; private age bytes and real UI password bytes were not read or printed during implementation.

The implementation is three new modules (contract/enrollment, guarded clients, protected continuity/observer), a focused suite, a separate public continuity JSON/schema and installed source-provider wiring. The exact 20 packet files and 206 source/history/input hashes are in [the inventory](controlled-recovery-d3-recovery-prefix-static-hashes-2026-10-31.json), SHA-256 `9e847053f40443b55089af25e23c842a659cc2f212c8025f99e26798cc18755f`. The inventory includes all 59 migration sources and the pinned production baseline/historical failure evidence. Older evidence and inventories remain immutable.

## Closed read-only contract

The command accepts exactly one fixed word and no endpoints/paths/IDs/SQL. It requires the already enrolled live-seed gate, exact source/data profiles, exactly LAYOUT_READY→SERVICES_READY, complete exact owned resources/materialization and the retained intent/layout/resource/manifest/seed-plan identities. Separate enrollment pins only public UI file hashes, public age recipient/key ID/receipt and protected key metadata. The age metadata digest `9ce941b0a7fd4a4f561159b8de5b910f98554b215c7605ba012c95f45ff76527` was obtained by stat only; no key derivation, private-byte hashing or key rotation occurred.

Installed read-only D1/headroom/swap/pressure/Firefox admission, ownership and all positive/negative PostgreSQL/MinIO/Valkey TLS contracts run before and after observation. Protected source/run/keys/age-history trees and command inactivity are rechecked before success. UI/intent/key/certificate/receipt temporary or hardlink windows, unsafe modes/ownership, conflicting public history, stop/schema/seal receipts, pending roles and operation/seed locks block without recovery, unlink, overwrite or regeneration. Existing generic protected-file helpers and production validation are unchanged.

The dedicated frozen branded client exposes fixed query IDs only. There are 95 exact pre-authored IDs/bodies, including transaction controls and 84 constant table-count queries. SQL text, query objects, parameters, callbacks, arbitrary SELECT/function execution, SET/DDL/DML and advisory-lock acquisition have no admitted capability. PostgreSQL startup defaults to read-only, followed by explicit `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY`; the first query proves both settings on, TLS and fixed database/user/session/application identity. Only its own client may exist and database advisory locks must be zero. Normal read-transaction locks are not misrepresented as absent. The real pg checkout/error/abort/settlement guard is reused; closes coalesce and uncertain settlement fails closed.

The real production baseline defines 66 tables; its real incremental migrations add 19, giving exactly 85 ordinary public tables. Every one of the 84 non-ledger tables, including operational/backup tables, must have literal count 0. There are no business exclusions. No pgboss/darshan_d3/darshan_d3_control/drizzle or other app schema is allowed. The complete 59-row ledger is verified by the existing production-compatible D3 validator with exact IDs/order/checksums/release-03/null approval/terminal 0057, plus exact first 38 BASELINED/BASELINED and next 21 APPLIED/SUCCEEDED provenance. No migration planner/writer, fake ledger insertion or pg-boss construction runs.

Role identity is exact: darshan bootstrap OID 10/attributes plus 14 named [PostgreSQL 16 predefined roles](https://www.postgresql.org/docs/16/predefined-roles.html), no postgres/seed/other role. Exactly three normalized pg_monitor memberships are allowed: pg_read_all_settings/stats/stat_scan_tables, grantor darshan, admin false/inherit true/set true. Password bytes and dynamic membership OIDs are not selected/pinned. Built-in role OIDs are not individually pinned.

S3 exposes only the fixed read-only ListBuckets GET, with explicit retained credentials and CA/SNI/certificate pin. HTTP 200, an explicit complete empty bucket array and no pagination/prefix/truncation/unknown marker are required. Zero buckets entails zero objects. Any bucket, ambiguous listing or pagination blocks; create/put/delete and all unadmitted commands are refused before SDK send. Response bytes are capped at 16 KiB before deserialization, with fixed connection/request bounds and no retries. The ordinary mutable data client is rejected.

Success is bounded canonical nonsecret `VERIFIED_NO_SEED_PREFIX` output only: public continuity/digests, ledger counts, empty tables/objects/references, receipt/lock absence and readiness. It does not append SCHEMA_READY, create a seal, seed, enqueue, publish backup authority or grant seed permission. Source/data/capsule/reservation/broker profiles and all existing flags are unchanged.

## Static verification

All Vitest runs used `NODE_OPTIONS=--max-old-space-size=1024`, unit config and one fork. Results are distinct counts, not sums of repeated runs:

| Suite | Passing |
|---|---:|
| New recovery-prefix suite | 195 |
| Safe installed source-provider predecessors | 101 |
| Broker lifecycle/resolution / protocol | 103 / 27 |
| Reservation | 49 |
| D1 readiness / D2 / D3 / D4 | 12 / 4 / 16 / 8 |
| D3 execution / source state / ledger / pg client | 35 / 14 / 39 / 9 |
| Foundation, filtered native case | 29 |
| Production worker-adapter validation | 4 |
| **Total across 15 suites** | **645** |

Sixteen native OpenSSL cases were deliberately excluded: one foundation default-version case and 15 populated-layout installed-provider cases. No native or real filesystem-listener/SQL suite is claimed as a fresh pass. Their relevant wiring is covered with only the fixed native-version transport replaced; actual protected state and read-only provider behavior use fake Docker/network transports. The new suite includes actual pg client/pool lifecycle over a fake Duplex wire that never connects. Tests independently derive the 85-table list from pinned baseline/incremental SQL, reject one row in every 84 non-ledger table, cover ledger/method/role/grantor/OID/schema/catalog drift, non-read-only capabilities/query IDs, S3 ambiguity/pagination/overflow, cancellation/disconnect/settlement, protected link/pending/key replacement/mode/conflict windows and byte/inode/link/path preservation. Existing data-status refusal remains tested before any SQL/S3 client opens.

Completed (exit 0): scripts/recovery-test/app typechecks; plain server build (`tsc && tsc-alias`); focused ESLint across prefix/source-installed/activation files with zero warnings; `git diff --check`; 79 packet/ 9 runtime/21 template/614 broker dependency byte audits. The build leaves all 614 broker dependency bytes unchanged. Initial two implicit-any parameters and two test-only unused identifiers were corrected; no unresolved verification failure remains.

The prior 134-file broker inventory shows exactly eight intended existing-file changes: activation registry, source-installed implementation/test, recovery-test tsconfig, README, D3 activation/schema and D3 runbook. Other predecessor hashes are unchanged. New prefix modules/config/tests/docs and updated source-data/provider runbooks are separately enumerated in the current 206-file index. No production module changed.

## Exact enrollment / review boundary

| Authority | SHA-256 |
|---|---|
| Prefix continuity JSON | `88d8aeb6750bfd52063c68471361541f72972dc2b5a4b596c0b8d264a5d7ad8b` |
| Prefix JSON schema | `a66b72bc5c106eb9994a07028715adc4b4cd5dff50234058b1205ab651ce8af4` |
| Prefix contract | `1b647e5d96fbeed1f3db3ce92b66b60de10085bcab18f562a4e70322fda3d0c7` |
| Prefix clients | `e9332ef0295bc0ca014ec75a24030dbd9c02a83daccdef29c3e66a556e79278f` |
| Prefix observer | `e2663c09ceff9f274ed679d3fcb61706da39b0fe2eb7baa01405107a5b427ae2` |
| Installed source provider | `52d8c053e0c20207c27ccbb0aee1f512a67d9b50d5dbae659e33f2e9092e2ccc` |
| D3 activation, 79 exact assets | `0b6419e1a42c9594e26d8b5fc9f0fa8860600aa27dfafb6e650260e837eee9f6` |

Unchanged profiles: source `1deb808f54ec122f85280b0e5b446913a8db78075b6505b7d77b6beba0278632`; data `33a2b270c55739e839dca7403034f49f24c39db5d8a8a93a413114bbf4d4176b`; capsule `5ff0dcaf1c6c6f0c6588143bb1f24ec39f2a772efd360d72bc596e2232e5c1e7`; reservation `b557f180307dfa7ada44d9574ca99385d001104ad3b6b7201bfdc6b44ca14707`; broker `19f5c9c73cb80b6b6c229a0c166ff9ef220456f366cf8547497023144be2495f`. Live-seed remains true; capsule/live-capsule/reservation/broker/capture/D2/whole-run remain false; broker scope remains null. Operation d200…0001 and distinct repository d300…0002 are unchanged.

The new command has not observed the retained live DB/S3 prefix. The previous data-status refusal is not promoted into fresh ledger/empty-prefix acceptance. Independent static review and a separately authorized bounded prefix invocation remain necessary before any new seed-continuation decision. Exact future clean-env command, static review command and preservation procedure are in [the runbook](../../docs/runbooks/controlled-recovery-d3-recovery-prefix.md). Do not run seed, repair, cleanup or stop from this static handoff.
