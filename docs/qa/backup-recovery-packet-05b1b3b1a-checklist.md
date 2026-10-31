# Packet 05B1b3b1a target engine foundation QA checklist

This checkpoint is strict fake-only contract coverage. Do not invoke Docker or
another engine, a live/network/SSH service, a production private key, decrypt,
import, or restore.

- [x] Bind execution-profile-v1 to the exact full signed ENGINE_PROFILE-v2
  envelope digest and protected-Docker-inventory-v1 to the exact full signed
  PROTECTION_INVENTORY-v2 envelope digest without an identity back-edge.
- [x] Reject unknown, duplicate, noncanonical, oversized, incomplete, and
  one-field-mutated profile/inventory records.
- [x] Fix immutable images/config/platform/architecture, direct entrypoints,
  numeric users, fresh exact environment, credential file handles, read-only
  rootfs, tmpfs, security, resources, health, logging, restart, internal
  networking, no ports, and opaque bind sources.
- [x] Expose no caller path/argv/endpoint/credential/generic-exec authority
  API; require the unmistakable test-only scripted authority marker.
- [x] Emit pure command plans using fixed operation/role enums and opaque
  handles only; reject role mismatch and injected path fields.
- [x] Require a bounded complete sanitized inspection and validate exact CIDs,
  images/config, runtime config, mounts, security, resources, health, no ports,
  internal network and endpoints.
- [x] Reject protected identity/ancestor/alias overlap, incomplete enumeration,
  and target/unknown consumers across protected containers, networks, volumes,
  and bind roots. Represent both relationship directions with strict endpoint
  domains/roles. Return only safe hashes/handles/health summary.
- [x] Canonically reparse typed profile, inventory, enrollment and observation
  objects at exported boundaries; reject cast/mutated completeness and zero or
  incoherent resource limits.
- [x] Bind the Docker socket to the protected DAEMON_SOCKET identity and
  validate credential file identity, numeric owner/group, mode and destination.
- [x] Reject exact physical-identity equality between candidate data binds or
  credentials and protected roots, bind roots, or volumes even when opaque
  handles differ and no relationship is declared. Keep non-equal aliases on
  the authority-provided relationship path.
- [x] Include every credential authority handle in direct protected-handle
  overlap and give PostgreSQL password, MinIO root-password, and MinIO root-user
  credentials distinct candidate relationship roles. Reject both relationship
  directions, aliases, ancestor edges, wrong handles, and role confusion.
- [x] Generate genuine disposable Ed25519 ENGINE_PROFILE-v2 and
  PROTECTION_INVENTORY-v2 envelopes and bind their complete envelope digests.
- [x] Reject a secret sentinel in public profile environment fields; credential
  artifacts remain opaque authority handles and fixed file destinations only.
- [x] Confirm the production worker remains hard-wired to
  `UnavailableRecoveryTargetEngine` with no environment selector or install
  wiring, and accepted v2/v4 identity-chain regression remains green.
- [x] Run serialized focused tests, app/scripts no-emit, touched ESLint,
  backend build, diff checks, and accepted-evidence hash comparison.

Deferred: effectful engine/resource admission (05B1b3b1b), lifecycle/journal
and post-engine validation integration (05B1b3b2), signed-role/source-free
install wiring (05B1b4), and all Docker/live/credential/decrypt/import/restore,
reconciliation, promotion/rollback, live topology and production drills.
