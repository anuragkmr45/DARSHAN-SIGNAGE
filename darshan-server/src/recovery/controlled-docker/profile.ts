import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { z } from 'zod';
import { sha256, ControlledRecoveryError } from './contracts';

export const INSTALLED_CONTROLLED_RECOVERY_PROFILE = '/etc/darshan/controlled-recovery/profile.json';
export const INSTALLED_CURRENT_CONTROLLED_RECOVERY_PROFILE = '/etc/darshan/controlled-recovery/profile.release-03.json';
export const CONTROLLED_RECOVERY_PROFILE_FORMAT = 'darshan-controlled-docker-recovery-profile-v1';

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const absolute = z.string().startsWith('/').max(1024);
const fixedTool = z.object({ executable: absolute, version: z.string().min(1).max(64), sha256: digest }).strict();
const fixedImage = z.object({ reference: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._/:@-]{0,511}@sha256:[a-f0-9]{64}$/) }).strict();
const capacity = z.object({
  protected_workspace_headroom_bytes: z.string().regex(/^[1-9][0-9]*$/),
  pg_multiplier_numerator: z.string().regex(/^[1-9][0-9]*$/),
  pg_multiplier_denominator: z.string().regex(/^[1-9][0-9]*$/),
  wal_headroom_bytes: z.string().regex(/^[1-9][0-9]*$/),
  minio_headroom_bytes: z.string().regex(/^[1-9][0-9]*$/),
  target_disk_headroom_bytes: z.string().regex(/^[1-9][0-9]*$/),
  required_memory_bytes: z.string().regex(/^[1-9][0-9]*$/),
  required_inodes: z.string().regex(/^[1-9][0-9]*$/),
}).strict();

const controlledRecoveryProfileFields = {
  format: z.literal(CONTROLLED_RECOVERY_PROFILE_FORMAT),
  site_id: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,62}$/),
  repository: z.object({ root: absolute, device_id: z.string().min(1).max(160), repository_id: z.string().uuid(), owner_uid: z.number().int().nonnegative(), owner_gid: z.number().int().nonnegative() }).strict(),
  journal_root: absolute,
  protected_workspace_root: absolute,
  recovery_key_root: absolute,
  docker: z.object({
    context: z.literal('darshan-controlled-recovery'),
    compose_file: absolute,
    executable: absolute,
    private_network_prefix: z.literal('darshan-recovery-net'),
    postgres_volume_prefix: z.literal('darshan-recovery-pg'),
    minio_volume_prefix: z.literal('darshan-recovery-minio'),
    mount_destinations: z.object({
      postgres: z.literal('/var/lib/postgresql/data'),
      minio: z.literal('/data'),
    }).strict(),
  }).strict(),
  images: z.object({ postgres: fixedImage, minio: fixedImage, importer: fixedImage, validator: fixedImage }).strict(),
  tools: z.object({ age: fixedTool, tar: fixedTool, psql: fixedTool }).strict(),
  configuration: z.object({ asset_manifest: absolute, expected_sha256: digest }).strict(),
  limits: z.object({ max_artifact_bytes: z.string().regex(/^[1-9][0-9]*$/), max_entries: z.number().int().positive().max(10_000_000), max_path_bytes: z.number().int().positive().max(4096), object_batch_size: z.number().int().positive().max(1000), phase_timeout_ms: z.number().int().positive().max(86_400_000) }).strict(),
  capacity,
};

/** Immutable Packet 1 release-01/0055 deployment contract. */
export const controlledRecoveryProfileSchema = z.object({
  ...controlledRecoveryProfileFields,
  profile_id: z.literal('darshan-release-01-controlled-recovery'),
  release_id: z.literal('release-01'),
  target_id: z.literal('darshan-server-release-01'),
  terminal_migration_id: z.literal('0055_backup_deletion_idempotency_bindings.sql'),
}).strict();

/** Separately approved current application recovery contract; it does not widen the Packet 1 pin. */
export const currentControlledRecoveryProfileSchema = z.object({
  ...controlledRecoveryProfileFields,
  profile_id: z.literal('darshan-release-03-controlled-recovery'),
  release_id: z.literal('release-03'),
  target_id: z.literal('darshan-server-release-03-controlled'),
  terminal_migration_id: z.literal('0057_controlled_recovery_report_projection.sql'),
}).strict();

export const approvedControlledRecoveryProfileSchema = z.union([
  controlledRecoveryProfileSchema,
  currentControlledRecoveryProfileSchema,
]);

export type ControlledRecoveryProfile = z.infer<typeof approvedControlledRecoveryProfileSchema>;

async function readOwnedRegular(path: string, maximum: number): Promise<Buffer> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.nlink !== 1 || stat.uid !== 0 || stat.size < 1 || stat.size > maximum || (stat.mode & 0o022) !== 0) {
      throw new ControlledRecoveryError('CONTROLLED_PROFILE_UNSAFE', 'Installed recovery asset is not a bounded non-writable regular file.');
    }
    return await handle.readFile();
  } finally { await handle.close(); }
}

export async function loadInstalledControlledRecoveryProfile(path = INSTALLED_CONTROLLED_RECOVERY_PROFILE): Promise<ControlledRecoveryProfile> {
  try {
    const profile = approvedControlledRecoveryProfileSchema.parse(JSON.parse((await readOwnedRegular(path, 256 * 1024)).toString('utf8')));
    const assetBytes = await readOwnedRegular(profile.configuration.asset_manifest, 1024 * 1024);
    if (sha256(assetBytes) !== profile.configuration.expected_sha256) {
      throw new ControlledRecoveryError('CONTROLLED_PROFILE_ASSET_CHANGED', 'Installed controlled-recovery asset manifest digest differs.');
    }
    const assets = z.object({ format: z.literal('darshan-controlled-recovery-assets-v1'), files: z.array(z.object({ path: absolute, sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict()).max(128) }).strict().parse(JSON.parse(assetBytes.toString('utf8')));
    for (const asset of assets.files) {
      if (sha256(await readOwnedRegular(asset.path, 256 * 1024 * 1024)) !== asset.sha256) throw new ControlledRecoveryError('CONTROLLED_PROFILE_ASSET_CHANGED', 'A fixed recovery asset differs from its manifest.');
    }
    return profile;
  } catch (cause) {
    if (cause instanceof ControlledRecoveryError) throw cause;
    throw new ControlledRecoveryError('CONTROLLED_PROFILE_INVALID', 'Installed controlled-recovery profile is missing or invalid.', { cause });
  }
}

export function installedControlledRecoveryProfilePath(releaseId: 'release-01' | 'release-03'): string {
  return releaseId === 'release-03' ? INSTALLED_CURRENT_CONTROLLED_RECOVERY_PROFILE : INSTALLED_CONTROLLED_RECOVERY_PROFILE;
}

/** Caller options may identify only the approved operation/source/site/release/key. */
export const controlledRecoveryPrepareInputSchema = z.object({
  operation_id: z.string().uuid(), backup_run_id: z.string().uuid(), manifest_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  site_id: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,62}$/), approved_release_id: z.enum(['release-01', 'release-03']),
  recovery_key_file: absolute,
}).strict();

