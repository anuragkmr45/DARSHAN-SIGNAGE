import { PRODUCTION_BUCKETS, type ProductionBucket } from './storage-buckets.js';

export const BACKUP_CONTRACT_VERSION = 1 as const;

export type BackupObjectSource = Readonly<{
  bucket: ProductionBucket;
  prefix?: string;
}>;

/**
 * Durable object-storage content included in disaster-recovery backups.
 * media-staging is intentionally transient. Only log archives are selected
 * from archives so locally cached backup files cannot recursively include
 * previous backups.
 */
export const BACKUP_OBJECT_SOURCES: readonly BackupObjectSource[] = [
  { bucket: 'media-source' },
  { bucket: 'media-ready' },
  { bucket: 'media-thumbnails' },
  { bucket: 'device-screenshots' },
  { bucket: 'logs-audit' },
  { bucket: 'logs-system' },
  { bucket: 'logs-auth' },
  { bucket: 'logs-heartbeats' },
  { bucket: 'logs-proof-of-play' },
  { bucket: 'archives', prefix: 'logs/' },
] as const;

export const BACKUP_BUCKETS = Object.freeze(
  Array.from(new Set(BACKUP_OBJECT_SOURCES.map(({ bucket }) => bucket)))
) as readonly ProductionBucket[];

function hasControlCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 31 || code === 127) return true;
  }
  return false;
}

export function isBackupObjectAllowed(bucket: string, objectKey: string): boolean {
  if (
    !objectKey || objectKey.startsWith('/') || objectKey.includes('\\') || hasControlCharacters(objectKey) ||
    objectKey.split('/').some((part) => !part || part === '.' || part === '..')
  ) {
    return false;
  }
  return BACKUP_OBJECT_SOURCES.some(
    (source) => source.bucket === bucket && (!source.prefix || objectKey.startsWith(source.prefix))
  );
}

export function assertBackupContractCoversProductionBuckets(): void {
  const production = new Set<string>(PRODUCTION_BUCKETS);
  for (const source of BACKUP_OBJECT_SOURCES) {
    if (!production.has(source.bucket)) throw new Error(`Backup source references an unknown production bucket: ${source.bucket}`);
  }
}
