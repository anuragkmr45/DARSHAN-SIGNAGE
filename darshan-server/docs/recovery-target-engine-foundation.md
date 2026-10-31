# Recovery target engine foundation (Packet 05B1b3b1a)

Packet 05B1b3b1a is a fake-only, non-effectful contract checkpoint. Production
still constructs `UnavailableRecoveryTargetEngine`; the production worker,
native listeners, and engine factory have no selector or Docker installation
wiring. A v2/v4 request therefore remains `RECOVERY_TARGET_EFFECT_INELIGIBLE`
at the unwired evidence/attestation gate, or reaches the separately retained
unavailable adapter only in an already eligible test seam.

## Acyclic private enrollment

`darshan-recovery-target-engine-execution-profile-v1` is downstream of, and
binds the complete signed `ENGINE_PROFILE` evidence-v2 envelope digest. It does
not modify or back-reference accepted evidence-v2 bytes. The protected Docker
inventory is independently downstream of, and binds the complete signed
`PROTECTION_INVENTORY` evidence-v2 envelope digest. A private engine enrollment
then binds both canonical record digests and both upstream envelope digests.
Nothing in this private layer feeds target specification, target-set,
attestation, plan-v4, or authorization identity, so the accepted b3b0 chain
remains acyclic and byte-identical.

The execution profile fixes `/usr/bin/docker` plus its content digest, the
protected Docker client configuration directory, Unix daemon/socket identity,
daemon identity and API version. PostgreSQL and MinIO have immutable image IDs,
linux/amd64 image configuration digests, no declared image volumes, direct
entrypoint/argv, work directory, numeric uid/gid, exact fresh environment,
opaque credential file references, read-only root filesystems, exact tmpfs,
cap-drop ALL, no-new-privileges, pinned seccomp/LSM identities and digests,
private namespaces, no devices/groups, strictly positive/coherent resources,
fixed local logging,
restart `no`, `autoRemove: false`, direct non-shell health policies, one fixed
internal network, no published ports, and exact opaque bind-source authority
handles. Tags, pull, build, Compose, shell, ambient `process.env`, raw daemon
endpoints, caller paths, and secret values are not contract fields.

## Private resource authority

`TargetResourceAuthority` can read an enrolled profile, read an enrolled
protected inventory, or obtain one authority-sanitized inspection by opaque
handle. It exposes no caller path, argv, engine endpoint, credential, generic
exec, or lifecycle mutation method. The only provided implementation is named
`TestOnlyScriptedTargetResourceAuthority`, requires the literal
`TEST_ONLY_DO_NOT_USE_IN_PRODUCTION` marker, performs no host/engine I/O, and
rejects call-order or handle substitution. The pure command planner returns
only reviewed operation/role enums and opaque handles; no plan is executable in
this packet.

## Complete sanitized inspection

The bounded canonical inspect contract is the private authority's sanitized
projection, not public raw `docker inspect` output. It contains no bind-source
path, daemon endpoint, credential content, or secret environment value. The
validator checks exact container/image/config/platform/architecture,
entrypoint/cmd/user/environment/labels/workdir, no declared volumes, exact
bind/credential references and propagation, rootfs/tmpfs/security/privilege/
capability/namespace/device/group/resource/restart/autoremove/logging fields,
no ports, exact internal network and container/endpoint IDs, IP identities,
health state and hashed output. It requires complete enumeration, rejects any
target or unknown consumer across protected containers, networks, volumes, and
bind roots, and compares planned handles against protected container/network/
volume/bind/root/socket identities and ancestor/alias relationships.
Relationship endpoints distinguish enrolled protected roles from candidate
target roles—including separate PostgreSQL password, MinIO root-password, and
MinIO root-user credential roles—permit either direction, and require the exact
candidate profile handle. Every credential authority handle also participates
in direct protected-handle overlap detection. Independently of handles and relationships, every candidate data-bind
and credential-file physical identity digest is compared with protected root,
bind-root, and volume physical identity digests; exact equality always rejects.
Relationships remain the authority source for non-equal ancestor/alias cases.
Container, image, network, and unrelated content hashes are not conflated with
this filesystem/file identity domain. The exported validator canonically reparses profile and inventory at
entry, so casts or post-parse mutation cannot bypass strictness. Credential
mounts bind an opaque file identity, numeric owner/group and mode; the daemon
socket digest must equal the protected DAEMON_SOCKET identity. Its result
contains only hashes, opaque handles, counts implied by the fixed schema, and
`HEALTHY`.

## Deferred gates

Packet 05B1b3b1b now adds a deliberately unwired, explicitly test-constructed
constrained adapter below this foundation. Its strict v1 resource-admission,
lifecycle-command, sanitized-result, and authoritative-observation contracts
contain fixed enums and opaque authority handles only. A separate protected
engine journal publishes bounded canonical INTENT/RECEIPT records as a
no-clobber hard-link hash chain. It permits only the fixed fake-only sequence:
admit existing allocation and credential references, create the private
network, create PostgreSQL then MinIO, start PostgreSQL then MinIO, verify the
complete effective state, or stop MinIO then PostgreSQL while retaining every
resource. RETIRE fails before effect; remove, quarantine, and PURGE are absent.
INSPECT is read-only and reports a terminal state only when fresh authority
truth matches a durable terminal engine receipt.

The constrained adapter is exported for explicit test construction only. The
production worker, native listener, factory/selector surface, and installation
wiring remain byte-unchanged and still construct
`UnavailableRecoveryTargetEngine`. The scripted lifecycle authority retains
the literal `TEST_ONLY_DO_NOT_USE_IN_PRODUCTION` marker and does not invoke an
engine or host service.

Packet 05B1b3b2a now provides the separately documented native OFD authority,
private descriptor protocol, restart fencing, and helper process-lifetime
foundation. It does not select or install the constrained adapter. Packet
05B1b3b2b1 now provides the separately documented fixed local-fixture native
executor, profile-v2 and inspect-v2/v3 contracts, exact acquired-frame/deadline
fencing, and strict materialization-v2 transition journal without production
selection. Its corrected checkpoint also requires replay durability after
link publication, exact TypeScript enrolled-resource evidence, semantic
validation of canonical journal records, and affirmative direct-child exit-zero
status independently of cleanup proof. Packet 05B1b3b2b2 remains responsible
for credential materialization, start/bootstrap, authenticated readiness, and
real-daemon evidence/attestation integration; later recovery-validation work remains responsible
for decrypt/import and restored application validation. Packet
05B1b4 remains responsible for signed-role, source-free bundle, installed
content/trust, and service wiring. Docker/live service execution, network/SSH,
production private keys, credential materialization, decrypt/import/restore,
reconciliation, validation/promotion/rollback, hold release, live topology,
RPO/RTO, load/soak, failover, and production rehearsal are not performed or
claimed by this checkpoint.
