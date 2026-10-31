import { statfs } from 'node:fs/promises';
import { z } from 'zod';
import { parseSignedCapsulePolicy, policySha256 } from '../../src/backups/configuration-capsule-policy';
import { parseCanonicalEd25519PublicKeyring } from '../../src/backups/ed25519-public-keyring';
import { openLocalRepositoryReadonly } from '../../src/backups/local-repository';
import { ControlledRecoveryError, digest, sha256 } from '../../src/recovery/controlled-docker/contracts';
import { D3_ROOT, type D3OperationAuthority } from './controlled-recovery-d3-authority';
import type { ProtectedD3Capsule } from './controlled-recovery-d3-capsule';
import { openD3ProtectedFile, protectD3Directory } from './controlled-recovery-d3-protected-files';
import { d3ReservationAuthoritySchema } from './controlled-recovery-d3-reservation-contract';
import type { FixedD3BackupReservation } from './controlled-recovery-d3-reservation';
import type { D3ReservationPrerequisiteReader } from './controlled-recovery-d3-reservation-prerequisites';
import type { D3BrokerProfile } from './controlled-recovery-d3-broker-profile';
const sha = z.string().regex(/^[a-f0-9]{64}$/);
export const d3BrokerAuthoritySchema = z.object({ format: z.literal('darshan-d3-broker-authority-v1'), reservationAuthority: d3ReservationAuthoritySchema, reservationBindingSha256: sha,
  runId: z.string().uuid(), queueJobId: z.string().uuid(), brokerProfileSha256: sha, dependencyInventorySha256: sha, policySha256: sha, capsuleGeneration: z.string().uuid(), capsuleSha256: sha, capsuleBytes: z.string().regex(/^[1-9][0-9]*$/), inventorySha256: sha,
  ageKeyId: sha, manifestKeyId: sha, manifestKeyringSha256: sha, rootDevice: z.string().regex(/^[1-9][0-9]*$/), repositoryInode: z.string().regex(/^[1-9][0-9]*$/), spoolRoot: z.literal(`${D3_ROOT}/capture/spool`).optional() }).strict();
export type D3BrokerAuthority = z.infer<typeof d3BrokerAuthoritySchema>;
export interface D3BrokerInputs { authority: D3BrokerAuthority; manifestKeyring: Buffer; }
export interface D3BrokerPrerequisites { read(signal?: AbortSignal): Promise<D3BrokerInputs>; }
const failed = () => new ControlledRecoveryError('CONTROLLED_RECOVERY_D3_BROKER_PREREQUISITES_MISSING', 'Broker requires reverified accepted source/data/seal/capsule/reservation, existing repository and retained signing authority.');
export class ProtectedD3BrokerPrerequisites implements D3BrokerPrerequisites {
  constructor(private readonly d: { authority: D3OperationAuthority; profile: D3BrokerProfile; profileSha256: string; reservation: Pick<FixedD3BackupReservation, 'status'>; source: D3ReservationPrerequisiteReader; capsule: Pick<ProtectedD3Capsule, 'status'> }) {}
  async read(signal?: AbortSignal): Promise<D3BrokerInputs> { try {
    const d = this.d; if (signal?.aborted || digest(d.profile) !== d.profileSha256) throw failed(); const source = await d.source.read(signal), reserved = await d.reservation.status(signal), capsule = await d.capsule.status(signal), a = source.authority;
    if (reserved.status !== 'RESERVED' || reserved.operationId !== d.authority.operationId || reserved.siteId !== d.authority.siteId || reserved.repositoryId !== d.authority.repositoryId || reserved.bindingSha256 !== digest({ ...a, runId: reserved.runId }) || a.reservationProfileSha256 !== d.profile.reservation_profile_sha256 || a.sourceProfileSha256 !== d.profile.source_profile_sha256 || a.dataProfileSha256 !== d.profile.data_profile_sha256 || a.capsuleProfileSha256 !== d.profile.capsule_profile_sha256 || capsule.receiptSha256 !== a.capsuleReceiptSha256 || !reserved.queueJobId) throw failed();
    const read = async (path: string, max = 1048576) => { const file = await openD3ProtectedFile(d.authority, `${d.authority.root}/capsule/${path}`, max); try { return await file.readFile(); } finally { await file.close(); } };
    const trust = parseCanonicalEd25519PublicKeyring(await read('public/policy-trust.json'), 'D3 policy trust'), policy = parseSignedCapsulePolicy(await read('output/policy.json'), trust);
    const manifestKeyring = await read('public/manifest-keyring.json'), manifestKeys = parseCanonicalEd25519PublicKeyring(manifestKeyring, 'D3 retained manifest keys');
    if (policySha256(policy) !== a.capsulePolicySha256 || policy.policy.capsule_sha256 !== a.capsuleSha256 || policy.policy.age_recipient_key_id !== a.keyId || policy.policy.encrypted_inventory_sha256 !== a.capsuleInventorySha256 || policy.policy.site_id !== d.authority.siteId || policy.policy.repository_id !== d.authority.repositoryId || policy.policy.release_generation !== 'release-03' || policy.policy.deployment_generation !== d.authority.operationId || policy.policy.compatibility_generation !== 3 || manifestKeys.size !== 1 || !manifestKeys.has(capsule.authorities.manifest)) throw failed();
    const rootDevice = String(await protectD3Directory(d.authority, d.authority.root)); await protectD3Directory(d.authority, d.authority.repositoryRoot);
    const repository = await openLocalRepositoryReadonly({ root: d.authority.repositoryRoot, expectedDeviceId: rootDevice, ownerUid: d.authority.ownerUid, ownerGid: d.authority.ownerGid, expectedSiteId: d.authority.siteId, expectedRepositoryId: d.authority.repositoryId, signal });
    const space = await statfs(d.authority.repositoryRoot, { bigint: true }); if (space.bavail * space.bsize < BigInt(d.profile.minimum_repository_free_bytes)) throw failed();
    const authority = d3BrokerAuthoritySchema.parse({ format: 'darshan-d3-broker-authority-v1', reservationAuthority: a, reservationBindingSha256: reserved.bindingSha256, runId: reserved.runId, queueJobId: reserved.queueJobId, brokerProfileSha256: d.profileSha256,
      dependencyInventorySha256: d.profile.inventory_sha256, policySha256: policySha256(policy), capsuleGeneration: policy.policy.generation, capsuleSha256: policy.policy.capsule_sha256, capsuleBytes: policy.policy.capsule_size_bytes, inventorySha256: policy.policy.encrypted_inventory_sha256, ageKeyId: a.keyId, manifestKeyId: capsule.authorities.manifest, manifestKeyringSha256: sha256(manifestKeyring), rootDevice, repositoryInode: repository.inode });
    if (signal?.aborted) throw failed(); return { authority, manifestKeyring };
  } catch { throw failed(); } }
}
