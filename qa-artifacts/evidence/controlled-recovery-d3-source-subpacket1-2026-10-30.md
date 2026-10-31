# D3 source and encrypted backup — subpacket 1 developer evidence

Latest correction: [independent-review P2 evidence](controlled-recovery-d3-source-subpacket1-p2-corrections-2026-10-30.md) supersedes the initial consumer/cancellation/mixed-stop implementation and hashes below.

Scope: static/source code and temporary filesystem/fake-Docker tests only. No Docker, application/service, source database migration, seed, TLS/key generation, capsule, backup/reservation/capture/encryption/publication, restore, promotion or rollback effect was executed. No package was installed and no commit was made. The existing retained age key/receipt/ciphertext and unrelated dirty worktree were preserved.

Completed: strict disabled `source_backup` runtime profile/schema; exact fixed command/stage catalogs; protected immutable stage/resource/stop journal and command lock; nonzero/overflow-safe fixed Docker calls; exact internal-network/named-volume/container plans and strict ownership/configuration parsing; subnet-collision and foreign-consumer rejection; PG init/stop/join/numeric-runtime sequencing; typed protected volume/layout and authenticated TLS/negative-probe contracts; a fixed command coordinator that prepares only the first two stages with supplied providers and refuses all missing data/capsule/broker/capture work. The foundation exposes the journal component, not an installed source or whole-run driver. D2, source activation and whole-run effects remain disabled/unavailable.

The creation journal records intent before create and returned ID before start. No same-name resource is adopted after ambiguous create or without its retained ID. Partial topology, changed IDs/configuration, unsafe journal mode/link/chain/profile, foreign consumers and overlapping subnets fail closed. Stage history alone cannot certify SQL/object/repository state. Interrupted source stop retains its prefix and a separate stop receipt rather than manufacturing later successful stages.

Verification: new suites initially passed **38/38**. After adding cross-controller command serialization, the final source suites passed **40/40** (26 protected-file/fake-Docker integration cases plus 14 source-state/profile/command cases); with D3/foundation predecessors the final affected run passed **86/86 across four files** in **20.90 seconds**. The separate direct predecessor D1–D4/foundation/executor run passed **84/84 across six files** in **10.31 seconds**. These represent **124 distinct cases** across eight files, with overlapping predecessor checks rerun after the source boundary change. Recovery-tests no-emit typecheck, scripts typecheck, server compilation build and focused lint passed. An initial lint check caught an explicit throw inside a cleanup `finally`; cleanup validation was moved into its own awaited release helper without changing semantics, then the source-state suite/lint were rerun. No full shared recovery regression was repeated because production/shared recovery runtime was unchanged.

The integration suite uses the real protected filesystem journal and real development Docker parser/command builder against a fake Docker API. It proves durable IDs before start, official PG init join before numeric runtime, refusal of nonzero stderr without secret leakage, no name adoption after ambiguous create, fixed args/caps, network collision, foreign consumers, missing/changed resources, invalid auth/TLS/peer/negative probes, explicit stop, command lock exclusion and fail-closed capture/resume. It does not run a Docker CLI or claim live service/TLS/crypto correctness.

Enrolled SHA-256:

| File | SHA-256 |
|---|---|
| `controlled-recovery-d3-source-profile.ts` | `739aef1ee37aa2c2fed98f0890d5aa7ff270dcdf1ea960c13558cd4daefb76cc` |
| `controlled-recovery-d3-source-state.ts` | `6ae74a07921af4d6d5dbba3e995cc55d1c0f981e5922e44327cfdaf51d69d7b4` |
| `controlled-recovery-d3-source-services.ts` | `d30a3d8acc39e9437096b1262438cd04d3669dab77b24d04f659d2afbfb61f31` |
| `controlled-recovery-d3-source-backup.ts` | `ae3da41b217036136c2d7f8b041b001ff4f04e7c349539117e99a5da0d351545` |
| `controlled-recovery-d3-docker.ts` | `01dacd89866ef64bfb64e420fa423974331c3f8ee0bfca4a5da3de6a2540e6b0` |
| runtime profile | `bb25b878973049872d48d0358c6fef146c28b5e4122bde1842cd46840d1aa0aa` |
| strict runtime schema | `2e93beae0ecaf591755e8678cc96202788c635542644540d50b3bb8c9603fd3c` |
| D2 activation | `fd9ccffa3cca4512479400cc8257e58d1ed90f12069b4bf7b8483cec88a558b9` |
| D3 activation | `52ee8089e386a6ad9d5664a54ac79e4580cedc47ec817182bcd263daeef19314` |

Remaining before live source/backup acceptance: concrete exclusive retained layout/secrets/CA/TLS generation; protected volume TLS/credential materialization; exact bounded direct source Docker executor and real health clients; real migration/ledger/representative data/object seed and seal; valid three-page PDF; production-validated five-role signed capsule and separate signing keys; real transaction/reservation broker binding; capture/package/encrypt adapters and durable attempt/publication settlement. Source driver installation/live Docker remains separately gated. Whole application recovery, promotion/rollback, production/native recovery, scale/platform/topology and RTO gates remain open.
