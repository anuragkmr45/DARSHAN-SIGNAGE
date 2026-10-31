import { statfs } from 'node:fs/promises';
import { config as appConfig } from '@/config';
import { openRecoveryRepositoryReadonly } from '@/recovery/repository-source';

export type BackupRepositoryCapacityHealth = {
  status: 'HEALTHY' | 'LOW' | 'UNAVAILABLE' | 'UNSUPPORTED';
  available_bytes: string | null;
  minimum_free_bytes: string | null;
  reason_code: string | null;
};

/**
 * Read-only capacity observation. Repository identity is re-established before
 * statfs so an unmounted/replaced path is never presented as healthy capacity.
 */
export async function observeBackupRepositoryCapacity(): Promise<BackupRepositoryCapacityHealth> {
  if (appConfig.BACKUP_REPOSITORY_KIND !== 'LOCAL_FILESYSTEM') {
    return { status: 'UNSUPPORTED', available_bytes: null, minimum_free_bytes: null,
      reason_code: 'BACKUP_REPOSITORY_CAPACITY_UNSUPPORTED' };
  }
  const root = appConfig.BACKUP_REPOSITORY_ROOT;
  const device = appConfig.BACKUP_REPOSITORY_DEVICE_ID;
  const ownerUid = appConfig.BACKUP_REPOSITORY_OWNER_UID;
  const ownerGid = appConfig.BACKUP_REPOSITORY_OWNER_GID;
  const siteId = appConfig.BACKUP_SITE_ID;
  const repositoryId = appConfig.BACKUP_REPOSITORY_ID;
  const minimum = appConfig.BACKUP_REPOSITORY_MIN_FREE_BYTES;
  if (!root || !device || ownerUid === undefined || ownerGid === undefined || !siteId || !repositoryId || !minimum) {
    return { status: 'UNAVAILABLE', available_bytes: null, minimum_free_bytes: minimum ? String(minimum) : null,
      reason_code: 'BACKUP_REPOSITORY_CAPACITY_UNCONFIGURED' };
  }
  try {
    await openRecoveryRepositoryReadonly({ root, expectedDeviceId: device, ownerUid, ownerGid,
      expectedSiteId: siteId, expectedRepositoryId: repositoryId });
    const value = await statfs(root, { bigint: true });
    const available = value.bavail * value.bsize;
    const threshold = BigInt(minimum);
    return { status: available < threshold ? 'LOW' : 'HEALTHY', available_bytes: available.toString(),
      minimum_free_bytes: threshold.toString(), reason_code: available < threshold ? 'BACKUP_REPOSITORY_CAPACITY_LOW' : null };
  } catch {
    return { status: 'UNAVAILABLE', available_bytes: null, minimum_free_bytes: String(minimum),
      reason_code: 'BACKUP_REPOSITORY_CAPACITY_UNAVAILABLE' };
  }
}
