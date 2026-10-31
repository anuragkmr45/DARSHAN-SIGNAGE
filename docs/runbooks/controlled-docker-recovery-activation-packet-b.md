# Controlled Recovery Activation Packet B

Packet B supplies the production-boundary Packet 1 adapter composition. It remains statically and injectably verified only: no Docker command, broker request, key use, decryption, import, object write, validation query, service or network action was executed while producing this packet.

The adapter selects only an exact committed V2 publication through the protected repository journal and pinned public keyrings, reselects the source before phases, applies the reviewed release-03/0057 compatibility ledger, acquires an operation-bound broker restore hold, and composes the existing capacity, archive, target ownership, transactional database, object readback and reference-validation contracts.

Durable Packet 1 receipts live outside the recovered database under the fixed protected workspace. Source, owner/fence, phase evidence digest, bounded aggregates and timings use canonical root-private atomic files. Receipts contain no credentials, object names or user content. A phase is resumably confirmed only when its durable receipt and a fresh protected boundary observation have the same evidence digest.

Database import is fixed to `psql -X --set=ON_ERROR_STOP=1 --single-transaction`, an empty ambient option set and the private fixed credential mount. Database reset is reachable only through exact owned-target re-observation. Object restore streams disk descriptors, hashes a full GET before every skip and after every PUT, checkpoints only aggregate digests, and requires exact final enumeration. Data validation retains the existing class-by-class SQL/reference/object checks and explicit transient exclusions.

The current installed activation format is still Packet A and explicitly acknowledges that it has no effect adapter. The production CLI therefore rejects effect activation with `CONTROLLED_RECOVERY_PACKET_B_ASSETS_NOT_ENROLLED` before constructing any broker/key/Docker boundary. Release engineering must separately enroll and review Packet B executable, migration, database credential, artifact/decrypt, object endpoint and SQL-validation identities before this guard can be removed. Do not reinterpret the tiny fixture activation as Packet B approval.

Packet C remains responsible for Packet 2 effects and disposable Docker application/promotion/rollback E2E. Live broker/key/age/PostgreSQL/MinIO/Docker, cancellation, ENOSPC, production-size streaming, forward-migration, split-host and RTO evidence remain pending.
