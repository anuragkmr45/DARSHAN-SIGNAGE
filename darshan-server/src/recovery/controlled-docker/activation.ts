import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { z } from 'zod';
import { canonicalJson, parseStrictJson } from '../../backups/backup-broker-protocol';
import { CONTROLLED_RECOVERY_PACKET3_TARGET } from '../release-target';
import { ControlledRecoveryError } from './contracts';
import { verifyFixedInstalledAssets, type FixedInstalledAsset } from './fixed-assets';

export const INSTALLED_CONTROLLED_RECOVERY_ACTIVATION = '/etc/darshan/controlled-recovery/activation.json';
export const CONTROLLED_RECOVERY_ACTIVATION_FORMAT = 'darshan-controlled-recovery-activation-v1';

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const absolute = z.string().startsWith('/').max(1024);
const decimal = z.string().regex(/^[1-9][0-9]*$/);
const asset = z.object({ path: absolute, sha256: digest }).strict();
const containerRole = z.object({
  image: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._/:@-]{0,511}@sha256:[a-f0-9]{64}$/),
  user: z.string().regex(/^[0-9]+:[0-9]+$/),
  entrypoint: z.array(z.string().min(1).max(256)).length(1),
  command: z.array(z.string().min(1).max(256)).min(1).max(16),
  memory_bytes: decimal,
  nano_cpus: decimal,
  pids_limit: z.number().int().positive().max(4096),
  read_only_root: z.literal(true),
  no_new_privileges: z.literal(true),
  cap_drop_all: z.literal(true),
}).strict();

export const controlledRecoveryActivationSchema = z.object({
  format: z.literal(CONTROLLED_RECOVERY_ACTIVATION_FORMAT),
  enabled: z.boolean(),
  activation_mode: z.enum(['DISABLED', 'TINY_DISPOSABLE_FIXTURE']),
  non_production_acknowledgement: z.literal('PACKET_A_HAS_NO_EFFECT_ADAPTER'),
  site_id: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,62}$/),
  release: z.object({
    release_id: z.literal(CONTROLLED_RECOVERY_PACKET3_TARGET.releaseId),
    target_id: z.literal(CONTROLLED_RECOVERY_PACKET3_TARGET.targetId),
    terminal_migration_id: z.literal(CONTROLLED_RECOVERY_PACKET3_TARGET.terminalMigrationId),
    migration_manifest_sha256: z.literal(CONTROLLED_RECOVERY_PACKET3_TARGET.migrationManifestSha256),
    profile: asset,
    assets_manifest: asset,
    recovery_runtime_manifest: asset,
    production_build_manifest: asset,
  }).strict(),
  docker: z.object({
    executable: asset,
    config_identity: asset,
    context: z.literal('darshan-controlled-recovery'),
    endpoint: z.literal('unix:///var/run/docker.sock'),
    daemon_identity_sha256: digest,
  }).strict(),
  source: z.object({
    repository_root: absolute,
    manifest_keyring: asset,
    policy_keyring: asset,
    broker_socket: absolute,
    recovery_key_root: absolute,
    recipients: z.array(z.object({ key_id: z.string().regex(/^[A-Za-z0-9._:-]{1,128}$/), recipient: z.string().regex(/^age1[0-9a-z]{20,100}$/) }).strict()).min(1).max(32),
  }).strict(),
  resources: z.object({ postgres: containerRole, minio: containerRole, importer: containerRole, validator: containerRole }).strict(),
  packet2: z.object({ profile: asset, fixed_overlay: asset }).strict(),
  report_authority: z.object({ public_keyring: asset, active_key_id: z.string().regex(/^[A-Za-z0-9._:-]{1,128}$/) }).strict(),
  limits: z.object({ command_timeout_ms: z.number().int().positive().max(86_400_000), stdout_max_bytes: z.number().int().positive().max(16 * 1024 * 1024), stderr_max_bytes: z.number().int().positive().max(16 * 1024 * 1024) }).strict(),
}).strict().superRefine((value, context) => {
  if (value.enabled !== (value.activation_mode === 'TINY_DISPOSABLE_FIXTURE')) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Activation enabled flag and mode disagree.' });
  }
  if (new Set(value.source.recipients.map((entry) => entry.key_id)).size !== value.source.recipients.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Recovery recipient key IDs must be unique.' });
  }
});

export type ControlledRecoveryActivation = z.infer<typeof controlledRecoveryActivationSchema>;

export function parseCanonicalControlledRecoveryActivation(bytes: Uint8Array): ControlledRecoveryActivation {
  try {
    const parsed = controlledRecoveryActivationSchema.parse(parseStrictJson(bytes, 512 * 1024));
    if (!Buffer.from(bytes).equals(canonicalJson(parsed))) {
      throw new ControlledRecoveryError('CONTROLLED_RECOVERY_ACTIVATION_INVALID', 'Installed activation contract is not canonical JSON.');
    }
    return parsed;
  } catch (cause) {
    if (cause instanceof ControlledRecoveryError) throw cause;
    throw new ControlledRecoveryError('CONTROLLED_RECOVERY_ACTIVATION_INVALID', 'Installed activation contract is invalid.', { cause });
  }
}

export function controlledRecoveryActivationAssets(value: ControlledRecoveryActivation): FixedInstalledAsset[] {
  const root0640 = (entry: { path: string; sha256: string }, maximumBytes = 16 * 1024 * 1024): FixedInstalledAsset =>
    ({ ...entry, ownerUid: 0, ownerGid: 0, mode: 0o640, maximumBytes });
  const root0600 = (entry: { path: string; sha256: string }, maximumBytes = 16 * 1024 * 1024): FixedInstalledAsset =>
    ({ ...entry, ownerUid: 0, ownerGid: 0, mode: 0o600, maximumBytes });
  return [
    { ...value.docker.executable, ownerUid: 0, ownerGid: 0, mode: 0o755, maximumBytes: 256 * 1024 * 1024 },
    root0640(value.docker.config_identity), root0640(value.release.profile), root0640(value.release.assets_manifest),
    root0640(value.release.recovery_runtime_manifest), root0640(value.release.production_build_manifest),
    root0600(value.source.manifest_keyring), root0600(value.source.policy_keyring), root0640(value.packet2.profile),
    root0640(value.packet2.fixed_overlay), root0600(value.report_authority.public_keyring),
  ];
}

async function readInstalledActivation(): Promise<Buffer> {
  let handle;
  try { handle = await open(INSTALLED_CONTROLLED_RECOVERY_ACTIVATION, constants.O_RDONLY | constants.O_NOFOLLOW); }
  catch (cause) { throw new ControlledRecoveryError('CONTROLLED_RECOVERY_NOT_ACTIVATED', 'Controlled recovery activation is not installed.', { cause }); }
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.nlink !== 1 || stat.uid !== 0 || stat.gid !== 0 || (stat.mode & 0o777) !== 0o640 || stat.size < 1 || stat.size > 512 * 1024) {
      throw new ControlledRecoveryError('CONTROLLED_RECOVERY_ACTIVATION_INVALID', 'Installed activation contract ownership, mode, link count, type, or size differs.');
    }
    return await handle.readFile();
  } finally { await handle.close(); }
}

/** Fixed installed path only. No caller, environment, endpoint, or path override is accepted. */
export async function loadInstalledControlledRecoveryActivation(): Promise<ControlledRecoveryActivation> {
  const activation = parseCanonicalControlledRecoveryActivation(await readInstalledActivation());
  if (!activation.enabled || activation.activation_mode === 'DISABLED') {
    throw new ControlledRecoveryError('CONTROLLED_RECOVERY_NOT_ACTIVATED', 'Controlled recovery activation is explicitly disabled.');
  }
  await verifyFixedInstalledAssets(controlledRecoveryActivationAssets(activation));
  return activation;
}
