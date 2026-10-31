import { constants } from 'node:fs';
import { open, realpath } from 'node:fs/promises';
import { z } from 'zod';
import { canonicalJson, parseStrictJson } from '../../src/backups/backup-broker-protocol';
import { ControlledRecoveryError, digest, sha256 } from '../../src/recovery/controlled-docker/contracts';
import { D3_ROOT, D3_OPERATION_ID, D3_REPOSITORY_ID, D3_SITE_ID } from './controlled-recovery-d3-authority';
import { D3_CAPTURE_PG_IMAGE, D3_CAPTURE_TOOLS_IMAGE } from './controlled-recovery-d3-capture-profile';

export const D3_BACKUP_COMMANDS = ['backup-capabilities', 'backup', 'backup-status'] as const;
export type D3BackupCommand = typeof D3_BACKUP_COMMANDS[number];
export const backupFailure = (code = 'CONTROLLED_RECOVERY_D3_BACKUP_UNVERIFIED', cause?: unknown) => new ControlledRecoveryError(code, 'The fixed development backup authority, capability, attempt or publication is unverified.', { cause });
export const D3_BACKUP_PROFILE_PATH = '/home/hexmon/Desktop/DARSHAN-SIGNAGE/deploy/development/controlled-recovery/tiny-d3.backup-publication-profile.json';
export const D3_BACKUP_CAP_ACTIVATION_PATH = '/home/hexmon/Desktop/DARSHAN-SIGNAGE/deploy/development/controlled-recovery/tiny-d3.backup-capabilities-activation.json';
export const D3_BACKUP_ACTIVATION_PATH = '/home/hexmon/Desktop/DARSHAN-SIGNAGE/deploy/development/controlled-recovery/tiny-d3.backup-publication-activation.json';
export const D3_BACKUP_UTILITIES = Object.freeze([
  { path: '/usr/bin/systemd-run', sha256: '6eaf6650fc3bc07ba2fb51242d9d286e56770a2abd7306678aa22050ddf9f935', bytes: 97272 },
  { path: '/usr/bin/systemctl', sha256: '639bce3ce5c06b605079ea56f74e3f08216ddffcfa76e11f62073aa775180082', bytes: 302112 },
  { path: '/usr/bin/systemd-socket-activate', sha256: '233891550408117482cf5e6fac4a8cb13c99df62eb8849b14dbd76f8b2f2b7de', bytes: 31176 },
] as const);
export const D3_BACKUP_ACCEPTED = Object.freeze({ sourceProfileSha256: '1deb808f54ec122f85280b0e5b446913a8db78075b6505b7d77b6beba0278632', dataProfileSha256: '33a2b270c55739e839dca7403034f49f24c39db5d8a8a93a413114bbf4d4176b', capsuleProfileSha256: '5ff0dcaf1c6c6f0c6588143bb1f24ec39f2a772efd360d72bc596e2232e5c1e7',
  capsuleReceiptSha256: '861ee4e36b59a1276352915aba937d415c9121c7df0a53fe79290e54056d68f8', ciphertextSha256: '1b38979c127acb0144448a04a6a7560c23f6b1bccebd26848a60a3c6c66f5a1a', ciphertextBytes: 165096,
  sourceIntentSha256: '79a4bbc72e5b43c7ed32d1f3065983a347f69b867bc5f70febdfa47ff4e90f46', schemaReceiptSha256: 'de3409b73cd3d5153aa8109105896cf8764dd13fb9f6bc9fa63e9c7017826a09', sourceSealReceiptSha256: '6f70345b113b048c3d1621b75a25abb15fd5081d09441add7b28919829573041',
  businessContentSha256: 'c51d8cee4990b29ad62bfaa088f0f8cbd40208db569faaf58f815bc0bcfeabba', physicalIdentitySha256: 'cd9f309f81b122a81462b0ac3ddaa84bf3eb91cc60445ddfa3fa9baa206c86a4', migrationFingerprint: 'bc4a594244220695f869fbaaeb2a9799d03c3668dd1c212b663d009aff3fc144',
  ageReceiptSha256: 'a5e908b3fce787c33399e202449fcceff2ed8284cd56af690e278630d4ab76cf', keyId: 'c3917b23a6e14c4a47c0c53e5237817af19e9c1f14192d9f2ef3e9beec856107',
  capsuleStatusReportSha256: 'fe0eae4790a7e62b089ea145e7083e58fe79397ebea279a6c8586eacbd947343', releaseKeyId: '0ca0bc1ac09f488632ad391a985c804935b1c1bff1b6bd11f7c53f1b1b543cb5', objects: 16, tables: 75 });
const sha = z.string().regex(/^[a-f0-9]{64}$/);
export const d3BackupProfileSchema = z.object({ format: z.literal('darshan-d3-backup-publication-profile-v1'), non_production: z.literal(true), operationId: z.literal(D3_OPERATION_ID), siteId: z.literal(D3_SITE_ID), repositoryId: z.literal(D3_REPOSITORY_ID),
  root: z.literal(`${D3_ROOT}/backup`), accepted: z.custom<typeof D3_BACKUP_ACCEPTED>((v) => digest(v) === digest(D3_BACKUP_ACCEPTED)), pgImage: z.literal(D3_CAPTURE_PG_IMAGE), toolsImage: z.literal(D3_CAPTURE_TOOLS_IMAGE),
  utilities: z.custom<typeof D3_BACKUP_UTILITIES>((v) => digest(v) === digest(D3_BACKUP_UTILITIES)), utilityPackageVersion: z.literal('259.9-0ubuntu0.1'),
  scopeUnit: z.literal(`darshan-d3-controller-${D3_OPERATION_ID}.scope`), scopeParent: z.literal('/user.slice/user-1000.slice/user@1000.service/app.slice'), controllerMemory: z.literal('201326592'), controllerPids: z.literal(64), controllerCpu: z.literal('25000 100000'), brokerMemory: z.literal('134217728'), brokerPids: z.literal(32), brokerCpu: z.literal('25000 100000'),
  capabilityTimeoutMs: z.literal(300000), backupTimeoutMs: z.literal(900000), processOutputBytes: z.literal(1048576), restoreEnabled: z.literal(false), wholeRunEnabled: z.literal(false), interruption: z.literal('AFTER_REPOSITORY_COMMIT_BEFORE_SQL_CONFIRM_ONCE') }).strict();
export type D3BackupProfile = z.infer<typeof d3BackupProfileSchema>;
const base = { non_production: z.literal(true), profileSha256: sha, restoreEnabled: z.literal(false), wholeRunEnabled: z.literal(false) };
export const d3BackupCapabilitiesActivationSchema = z.object({ format: z.literal('darshan-d3-backup-capabilities-activation-v1'), ...base, enabled: z.boolean() }).strict();
export const d3BackupActivationSchema = z.object({ format: z.literal('darshan-d3-backup-publication-activation-v1'), ...base, enabled: z.boolean(), capabilitiesActivationSha256: sha, capabilityReceiptSha256: sha.nullable(), interruptionEnabled: z.boolean() }).strict();
export async function readD3BackupPublicFile(path: string, maximum = 131072) { const h = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW); try { const s = await h.stat(); if (!s.isFile() || s.nlink !== 1 || s.uid !== 1000 || s.gid !== 1000 || (s.mode & 0o002) || s.size < 1 || s.size > maximum || await realpath(path) !== path) throw backupFailure(); return await h.readFile(); } finally { await h.close(); } }
export async function loadD3BackupEnrollment() { const bytes = await readD3BackupPublicFile(D3_BACKUP_PROFILE_PATH), profile = d3BackupProfileSchema.parse(parseStrictJson(bytes, 131072)); if (!canonicalJson(profile).equals(bytes)) throw backupFailure();
  const c = await readD3BackupPublicFile(D3_BACKUP_CAP_ACTIVATION_PATH), a = await readD3BackupPublicFile(D3_BACKUP_ACTIVATION_PATH), capabilities = d3BackupCapabilitiesActivationSchema.parse(parseStrictJson(c, 16384)), activation = d3BackupActivationSchema.parse(parseStrictJson(a, 16384));
  if (!canonicalJson(capabilities).equals(c) || !canonicalJson(activation).equals(a) || capabilities.profileSha256 !== sha256(bytes) || activation.profileSha256 !== sha256(bytes) || activation.capabilitiesActivationSha256 !== sha256(c) || activation.enabled && (!capabilities.enabled || !activation.capabilityReceiptSha256)) throw backupFailure('CONTROLLED_RECOVERY_D3_BACKUP_ACTIVATION_UNVERIFIED');
  return { profile, profileSha256: sha256(bytes), capabilities, capabilitiesActivationSha256: sha256(c), activation, activationSha256: sha256(a) }; }
export async function verifyD3BackupUtilities() { for (const u of D3_BACKUP_UTILITIES) { const h = await open(u.path, constants.O_RDONLY | constants.O_NOFOLLOW); try { const s = await h.stat(); if (!s.isFile() || s.nlink !== 1 || s.uid !== 0 || s.gid !== 0 || (s.mode & 0o7777) !== 0o755 || s.size !== u.bytes || await realpath(u.path) !== u.path || sha256(await h.readFile()) !== u.sha256) throw backupFailure('CONTROLLED_RECOVERY_D3_BACKUP_SCOPE_UTILITY_CHANGED'); } finally { await h.close(); } } return digest(D3_BACKUP_UTILITIES); }
