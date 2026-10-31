# Controlled Docker Recovery — Activation Packet A

Status: static developer fixture only. Packet A does not provide a Packet 1 or Packet 2 effect adapter and must not be used to restore, promote, accept or roll back a deployment. Production native recovery remains unavailable / `ENOTSUP` and unselected.

## Closed activation boundary

Effect commands consult only `/etc/darshan/controlled-recovery/activation.json`. There is no CLI or environment override. The installed file must be root-owned, group `root`, mode `0640`, regular, single-link, bounded, strict canonical JSON and exactly release-03 / 0057. Missing, disabled, noncanonical or mismatched activation fails before profile, broker, key, or Docker access. `status` and `report` retain their journal-only path and do not require activation.

Packet A accepts only `DISABLED` and explicitly non-production `TINY_DISPOSABLE_FIXTURE` modes. The shipped disabled example is the default posture. The tiny example is test data, not production authorization. Even a valid tiny activation still reaches the existing `CONTROLLED_RECOVERY_NOT_ACTIVATED` effect-adapter boundary because Packet A intentionally ships no real adapter.

The activation binds the current release/target/migration ledger and profile/assets/runtime/build digests; root-owned Docker executable and context identity; local Unix endpoint; source repository, broker socket, key roots/keyrings and key-ID-to-recipient map; preloaded image digest/user/entrypoint/command/resource/security settings; Packet 2 profile and fixed overlay; report authority; and bounded command/output limits.

## Typed Docker foundation

The runner exposes only typed inspection, network/volume/container creation, start, stop, join, exact-ID reset, database import and validation methods. It has no public generic `run(args)` and no pull, build, prune, Compose, `down -v`, SSH or remote-daemon path. Ambient Docker host/context/config, proxy, plugin and authentication substitution is rejected. Static transcripts must prove the exact local daemon/context/endpoint, preloaded image digests and runtime configuration, resource labels/IDs, consumers, networks, mounts and configuration hashes.

PostgreSQL data is enrolled only at `/var/lib/postgresql/data`; MinIO data is enrolled only at `/data`. Unexpected extra or anonymous mounts fail target verification.

## Streaming foundation

Production-facing descriptors carry only absolute path, decimal size and SHA-256. Bounded streams hash a regular single-link source; streaming tar/PAX extraction enforces checksum, truncation, entry/path/expanded-size/chunk bounds, duplicate normalization, producer-compatible root/trailing directories, and link/device/sparse/special-type rejection before allocation or file creation. Extracted results contain disk descriptors, never complete bodies. Existing Buffer fixtures remain for Packet 1 unit compatibility only.

## Remaining packets and gates

- Activation Packet B: implement and independently review the real Packet 1 source/hold/preflight/decrypt/target/import/object/validation adapter.
- Activation Packet C: implement Packet 2 application reconciliation/promotion/rollback adapter, then disposable Docker end-to-end rehearsal.
- Installed root-owned assets, actual Docker daemon/context/image identity, broker/key authority, slow-stream cancellation/backpressure, ENOSPC, production topology, RTO/maintenance and activation approval remain untested.

Do not copy the pretty example directly into the installed path. Release tooling must substitute reviewed identities, emit canonical JSON, set exact ownership/mode, sign/package the fixed asset inventory and keep `enabled: false` until Packet B/C and the disposable Docker gate are approved.
