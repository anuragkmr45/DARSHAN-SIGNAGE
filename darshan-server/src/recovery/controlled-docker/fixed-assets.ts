import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { ControlledRecoveryError } from './contracts';

export interface FixedInstalledAsset {
  path: string;
  sha256: string;
  ownerUid: number;
  ownerGid: number;
  mode: number;
  maximumBytes: number;
}

export interface FixedAssetObservation {
  path: string;
  size: string;
  sha256: string;
  ownerUid: number;
  ownerGid: number;
  mode: number;
}

export async function verifyFixedInstalledAsset(asset: FixedInstalledAsset): Promise<FixedAssetObservation> {
  if (!asset.path.startsWith('/') || !/^[a-f0-9]{64}$/.test(asset.sha256) || !Number.isSafeInteger(asset.maximumBytes) || asset.maximumBytes < 1) {
    throw new ControlledRecoveryError('CONTROLLED_RECOVERY_ACTIVATION_INVALID', 'Fixed installed asset descriptor is invalid.');
  }
  let handle;
  try { handle = await open(asset.path, constants.O_RDONLY | constants.O_NOFOLLOW); }
  catch (cause) { throw new ControlledRecoveryError('CONTROLLED_RECOVERY_ACTIVATION_ASSET_UNSAFE', 'Fixed installed activation asset is missing or unsafe.', { cause }); }
  try {
    const stat = await handle.stat();
    const mode = stat.mode & 0o777;
    if (!stat.isFile() || stat.nlink !== 1 || stat.uid !== asset.ownerUid || stat.gid !== asset.ownerGid || mode !== asset.mode ||
        stat.size < 1 || stat.size > asset.maximumBytes) {
      throw new ControlledRecoveryError('CONTROLLED_RECOVERY_ACTIVATION_ASSET_UNSAFE', 'Fixed installed activation asset identity, ownership, mode, link count, or size differs.');
    }
    const hash = createHash('sha256');
    const buffer = Buffer.allocUnsafe(64 * 1024);
    let offset = 0;
    while (offset < stat.size) {
      const read = await handle.read(buffer, 0, Math.min(buffer.length, stat.size - offset), offset);
      if (read.bytesRead < 1) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_ACTIVATION_ASSET_UNSAFE', 'Fixed installed activation asset was truncated during verification.');
      hash.update(buffer.subarray(0, read.bytesRead));
      offset += read.bytesRead;
    }
    const actual = hash.digest('hex');
    if (actual !== asset.sha256) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_ACTIVATION_ASSET_CHANGED', 'Fixed installed activation asset digest differs.');
    return { path: asset.path, size: stat.size.toString(), sha256: actual, ownerUid: stat.uid, ownerGid: stat.gid, mode };
  } finally { await handle.close(); }
}

export async function verifyFixedInstalledAssets(assets: readonly FixedInstalledAsset[]): Promise<readonly FixedAssetObservation[]> {
  const paths = new Set<string>();
  for (const asset of assets) {
    if (paths.has(asset.path)) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_ACTIVATION_INVALID', 'Fixed installed activation asset path is duplicated.');
    paths.add(asset.path);
  }
  const observations: FixedAssetObservation[] = [];
  for (const asset of assets) observations.push(await verifyFixedInstalledAsset(asset));
  return observations;
}
