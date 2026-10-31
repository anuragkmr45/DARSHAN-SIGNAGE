import { ControlledRecoveryError, digest } from '../../src/recovery/controlled-docker/contracts';
import type { DevelopmentD2Activation } from './controlled-recovery-d2';

export const D3_ROOT = '/home/hexmon/Desktop/DARSHAN-SIGNAGE/.controlled-recovery-d3';
export const D3_OPERATION_ID = 'd2000000-0000-4000-8000-000000000001';
export const D3_REPOSITORY_ID = 'd3000000-0000-4000-8000-000000000002';
export const D3_SITE_ID = 'tiny-d1-development';
export interface D3OperationAuthority {
  operationId: typeof D3_OPERATION_ID; repositoryId: typeof D3_REPOSITORY_ID; siteId: typeof D3_SITE_ID;
  releaseId: 'release-03'; schemaId: '0057_controlled_recovery_report_projection'; root: typeof D3_ROOT;
  evidenceRoot: string; keyPath: string; recipientReceiptPath: string; repositoryRoot: string;
  ownerUid: number; ownerGid: number; d2Sha256: string; resourcesSha256: string;
}

/** Derivation never changes a journal or enables D2. Existing foreign journals remain foreign. */
export function deriveD3OperationAuthority(d2: DevelopmentD2Activation): Readonly<D3OperationAuthority> {
  const roles = ['postgres', 'minio', 'valkey', 'api', 'worker', 'cms', 'browser', 'player', 'controller'];
  if (d2.operation_id !== D3_OPERATION_ID || d2.deterministic_prefix !== 'darshan-d2-20261030' || d2.work_root !== D3_ROOT ||
      d2.evidence_root !== `${D3_ROOT}/evidence` || new Set(d2.resources.map(({ role }) => role)).size !== roles.length ||
      roles.some((role) => !d2.resources.some((resource) => resource.role === role && resource.name === `darshan-d2-20261030-${role}`)) ||
      digest(d2.docker) !== digest({ network: 'darshan-d2-20261030-net', postgres_volume: 'darshan-d2-20261030-pg', minio_volume: 'darshan-d2-20261030-minio', valkey_volume: 'darshan-d2-20261030-valkey', public_ports: false }) ||
      process.getuid === undefined || process.getgid === undefined)
    throw new ControlledRecoveryError('CONTROLLED_RECOVERY_D3_OPERATION_AUTHORITY_MISMATCH', 'D2 and D3 operation, roots, or exact resource names differ.');
  return Object.freeze({ operationId: D3_OPERATION_ID, repositoryId: D3_REPOSITORY_ID, siteId: D3_SITE_ID, releaseId: 'release-03',
    schemaId: '0057_controlled_recovery_report_projection', root: D3_ROOT, evidenceRoot: `${D3_ROOT}/evidence`, keyPath: `${D3_ROOT}/keys/recovery.age`,
    recipientReceiptPath: `${D3_ROOT}/evidence/age-public.json`, repositoryRoot: `${D3_ROOT}/repository/${D3_SITE_ID}/backup-repository`,
    ownerUid: process.getuid(), ownerGid: process.getgid(), d2Sha256: digest(d2), resourcesSha256: digest({ resources: d2.resources, docker: d2.docker }) });
}

export function assertD3OperationBinding(authority: D3OperationAuthority, input: { operationId: string; siteId: string; repositoryId?: string; releaseId?: string }): void {
  if (authority.operationId !== D3_OPERATION_ID || authority.repositoryId !== D3_REPOSITORY_ID || authority.siteId !== D3_SITE_ID || authority.releaseId !== 'release-03' ||
      input.operationId !== authority.operationId || input.siteId !== authority.siteId ||
      (input.repositoryId !== undefined && input.repositoryId !== authority.repositoryId) || (input.releaseId !== undefined && input.releaseId !== authority.releaseId))
    throw new ControlledRecoveryError('CONTROLLED_RECOVERY_D3_OPERATION_AUTHORITY_MISMATCH', 'D3 operation binding differs from the retained authority.');
}
