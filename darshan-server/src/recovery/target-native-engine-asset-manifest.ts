import { createHash } from 'node:crypto';
import { z } from 'zod';
import { canonicalJson, parseStrictJson } from '../backups/backup-broker-protocol';
import { RecoveryError } from './errors';
import { targetAuthorityHandleSchema } from './target-engine-contracts';

export const INSTALLED_ENGINE_ASSETS_V1_MAX_BYTES = 128 * 1024;
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const u64 = z.string().regex(/^(?:0|[1-9][0-9]{0,19})$/).refine((value) => BigInt(value) <= 0xffff_ffff_ffff_ffffn);
const descriptor = z.object({
  authorityHandle: targetAuthorityHandleSchema, fixedPath: z.string().regex(/^\/(?:[a-z0-9._-]+\/)*[a-z0-9._-]+$/),
  contentSha256: digest, descriptorIdentitySha256: digest, deviceMajor: u64, deviceMinor: u64,
  inode: u64.refine((value) => value !== '0'), mountId: u64.refine((value) => value !== '0'),
  ownerUid: u64, ownerGid: u64, mode: z.enum(['0400', '0440', '0500', '0555', '0600', '0700', '0755']),
  linkCount: z.literal('1'), stableIdentity: z.literal(true),
}).strict();
const image = z.object({
  role: z.enum(['POSTGRES_IMAGE', 'MINIO_IMAGE']), imageId: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  repositoryDigest: z.string().regex(/^[a-z0-9./_-]+@sha256:[a-f0-9]{64}$/), configSha256: digest,
  rootfsSha256: digest, platform: z.literal('linux'), architecture: z.literal('amd64'), operatingSystem: z.literal('linux'),
  preloaded: z.literal(true), implicitPullAllowed: z.literal(false),
}).strict();

const schema = z.object({
  format: z.literal('darshan-recovery-installed-engine-assets-v1'),
  protectedRoot: z.literal('/var/lib/darshan-recovery/installed-engine-v1'),
  enumerationComplete: z.literal(true),
  dockerElf: descriptor.extend({ elfClass: z.literal('ELF64'), elfMachine: z.literal('X86_64') }).strict(),
  clientConfig: descriptor.extend({ fixedPath: z.literal('/var/lib/darshan-recovery/docker-client') }).strict(),
  daemon: z.object({ transport: z.literal('UNIX'), fixedSocketPath: z.literal('/run/docker.sock'),
    socketAuthorityHandle: targetAuthorityHandleSchema, socketIdentitySha256: digest,
    daemonIdentitySha256: digest, apiVersion: z.literal('1.44'), contextName: z.literal('default-local'),
    tls: z.literal(false), ambientContextAllowed: z.literal(false), ambientProxyAllowed: z.literal(false),
    authHelperAllowed: z.literal(false), pluginsAllowed: z.literal(false) }).strict(),
  images: z.tuple([image.extend({ role: z.literal('POSTGRES_IMAGE') }), image.extend({ role: z.literal('MINIO_IMAGE') })]),
  assets: z.tuple([
    descriptor.extend({ fixedPath: z.literal('/etc/darshan-recovery/postgresql.conf') }),
    descriptor.extend({ fixedPath: z.literal('/etc/darshan-recovery/minio.env') }),
    descriptor.extend({ fixedPath: z.literal('/opt/darshan-recovery/bootstrap/postgres') }),
    descriptor.extend({ fixedPath: z.literal('/opt/darshan-recovery/bootstrap/minio') }),
    descriptor.extend({ fixedPath: z.literal('/opt/darshan-recovery/probes/postgres-ready') }),
    descriptor.extend({ fixedPath: z.literal('/opt/darshan-recovery/probes/minio-ready') }),
  ]),
  numericUsers: z.object({ postgresUid: z.literal('999'), postgresGid: z.literal('999'),
    minioUid: z.literal('1000'), minioGid: z.literal('1000'), usernsMode: z.literal('private'),
    usernsMappingSha256: digest }).strict(),
  policySha256: digest, securityPolicySha256: digest, resourcePolicySha256: digest,
  loggingPolicySha256: digest, quiescencePolicySha256: digest, manifestSha256: digest,
}).strict();

export type InstalledEngineAssetsV1 = z.infer<typeof schema>;
function body(value: InstalledEngineAssetsV1): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'manifestSha256'));
}
export function installedEngineAssetsV1Sha256(value: Omit<InstalledEngineAssetsV1, 'manifestSha256'> | InstalledEngineAssetsV1): string {
  const object = 'manifestSha256' in value ? body(value as InstalledEngineAssetsV1) : value;
  return createHash('sha256').update(Buffer.from('darshan-recovery-installed-engine-assets-v1\0'))
    .update(canonicalJson(object)).digest('hex');
}
function validate(value: InstalledEngineAssetsV1): void {
  const descriptors = [value.dockerElf, value.clientConfig, ...value.assets];
  if (value.manifestSha256 !== installedEngineAssetsV1Sha256(value) ||
      new Set(descriptors.map((entry) => entry.authorityHandle)).size !== descriptors.length ||
      new Set(descriptors.map((entry) => `${entry.deviceMajor}:${entry.deviceMinor}:${entry.inode}:${entry.mountId}`)).size !== descriptors.length ||
      new Set(descriptors.map((entry) => entry.fixedPath)).size !== descriptors.length ||
      new Set(value.images.map((entry) => entry.imageId)).size !== value.images.length) {
    throw new RecoveryError('RECOVERY_TARGET_AUTH_INVALID', 'Installed engine assets are incomplete, aliased, reordered, or self-hash invalid.');
  }
}
export function encodeInstalledEngineAssetsV1(value: InstalledEngineAssetsV1): Buffer {
  const parsed = schema.parse(value); validate(parsed); const bytes = canonicalJson(parsed);
  if (bytes.byteLength > INSTALLED_ENGINE_ASSETS_V1_MAX_BYTES) throw new RecoveryError('RECOVERY_TARGET_PROTOCOL_INVALID', 'Installed assets exceed 128 KiB.');
  return bytes;
}
export function parseInstalledEngineAssetsV1(bytes: Uint8Array): InstalledEngineAssetsV1 {
  try {
    const source = Buffer.from(bytes); const value = schema.parse(parseStrictJson(source, INSTALLED_ENGINE_ASSETS_V1_MAX_BYTES));
    validate(value); if (!encodeInstalledEngineAssetsV1(value).equals(source)) throw new Error('noncanonical'); return value;
  } catch (cause) {
    if (cause instanceof RecoveryError) throw cause;
    throw new RecoveryError('RECOVERY_TARGET_PROTOCOL_INVALID', 'Installed engine assets are not strict canonical bounded JSON.', { cause });
  }
}
