import { constants } from 'node:fs';
import { open, realpath } from 'node:fs/promises';
import { z } from 'zod';
import { canonicalJson, parseStrictJson } from '../../src/backups/backup-broker-protocol';
import { PRODUCTION_CAPSULE_CONTRACT_ID, REQUIRED_CAPSULE_ROLES } from '../../src/backups/configuration-capsule-inventory';
import { ControlledRecoveryError, sha256 } from '../../src/recovery/controlled-docker/contracts';
import { D3_ROOT } from './controlled-recovery-d3-authority';
import { D3_SOURCE_PROFILE_SHA256 } from './controlled-recovery-d3-source-data-profile';

export const D3_CAPSULE_DATA_PROFILE_SHA256 = '33a2b270c55739e839dca7403034f49f24c39db5d8a8a93a413114bbf4d4176b';
export const D3_CAPSULE_REPOSITORY = '/home/hexmon/Desktop/DARSHAN-SIGNAGE';
export const D3_CAPSULE_TEMPLATE_PATHS = Object.freeze({
  assembly: 'scripts/bundle/assemble-runtime-bundle.sh',
  ...Object.fromEntries(REQUIRED_CAPSULE_ROLES.map((role) => [`${role}-env`, `deploy/development/controlled-recovery/capsule-templates/${role}.env.template`])),
  prometheus: 'deploy/shared/observability/prometheus/prometheus.yml.template', grafana: 'deploy/shared/observability/grafana/grafana.ini.template',
  dashboards: 'deploy/shared/observability/grafana/provisioning/dashboards/dashboards.yml', datasource: 'deploy/shared/observability/grafana/provisioning/datasources/prometheus.yml',
  alertmanager: 'deploy/shared/observability/alertmanager/alertmanager.yml.template', 'alert-template': 'deploy/shared/observability/alertmanager/templates/default.tmpl',
  alerts: 'deploy/shared/observability/prometheus/rules/alerts.yml', recording: 'deploy/shared/observability/prometheus/rules/recording-rules.yml', targets: 'deploy/shared/observability/prometheus/file-sd/players.targets.json',
  ...Object.fromEntries(['players-fleet', 'vm-valkey', 'vm1-data', 'vm2-backend', 'vm3-cms', 'vm4-observability'].map((name) => [`dashboard-${name}`, `deploy/shared/observability/grafana/dashboards/${name}.json`])),
} as Record<string, string>);
export const D3_CAPSULE_PROFILE_PATH = `${D3_CAPSULE_REPOSITORY}/deploy/development/controlled-recovery/tiny-d3.capsule-profile.json`;
const sha = z.string().regex(/^[a-f0-9]{64}$/);
export const d3CapsuleProfileSchema = z.object({ format: z.literal('darshan-d3-capsule-profile-v1'), non_production: z.literal(true), providers_enabled: z.literal(true),
  live_capsule_enabled: z.literal(false), capsule_enabled: z.literal(false), capture_enabled: z.literal(false), whole_run_enabled: z.literal(false), configuration_only: z.literal(true),
  backend_process_role: z.literal('api'), backup_worker_available: z.literal(false), backup_worker_blocker: z.literal('NATIVE_PINNED_AGE_AUTHORITY_NOT_ENROLLED'),
  source_profile_sha256: z.literal(D3_SOURCE_PROFILE_SHA256), data_profile_sha256: z.literal(D3_CAPSULE_DATA_PROFILE_SHA256),
  root: z.literal(`${D3_ROOT}/capsule`), contract_id: z.literal(PRODUCTION_CAPSULE_CONTRACT_ID), required_roles: z.tuple([z.literal('backend'), z.literal('data'), z.literal('cms'), z.literal('valkey'), z.literal('observability')]),
  maximum_plaintext_bytes: z.literal(8388608), maximum_ciphertext_bytes: z.literal(16777216), compatibility_generation: z.literal(3), release_id: z.literal('release-03'),
  role_directory_mode: z.literal('0700'), private_mode: z.literal('0600'), source_modes_are_actual_stat: z.literal(true), derived_overlay_exclusions: z.tuple([z.literal('BACKUP_BROKER_POLICY_SHA256'), z.literal('BACKUP_CAPSULE_GENERATION'), z.literal('BACKUP_CAPSULE_SHA256')]),
  templates: z.array(z.object({ role: z.string(), path: z.string(), sha256: sha }).strict()).length(Object.keys(D3_CAPSULE_TEMPLATE_PATHS).length),
}).strict().superRefine((value, context) => { if (new Set(value.templates.map(({ role }) => role)).size !== Object.keys(D3_CAPSULE_TEMPLATE_PATHS).length || value.templates.some(({ role, path }) => !Object.hasOwn(D3_CAPSULE_TEMPLATE_PATHS, role) || path !== `${D3_CAPSULE_REPOSITORY}/${D3_CAPSULE_TEMPLATE_PATHS[role]}`)) context.addIssue({ code: 'custom', message: 'The exact checked-in capsule template set differs.' }); });
export type D3CapsuleProfile = z.infer<typeof d3CapsuleProfileSchema>;
const failed = () => new ControlledRecoveryError('CONTROLLED_RECOVERY_D3_CAPSULE_PROFILE_INVALID', 'The fixed capsule profile, source/data binding or checked-in template inventory is unverified.');
export async function loadD3CapsuleProfile() {
  const file = await open(D3_CAPSULE_PROFILE_PATH, constants.O_RDONLY | constants.O_NOFOLLOW);
  try { const s = await file.stat(); if (!s.isFile() || s.nlink !== 1 || s.uid !== process.getuid?.() || (s.mode & 0o777) !== 0o664 || s.size > 32768) throw failed(); const bytes = await file.readFile(); const profile = d3CapsuleProfileSchema.parse(parseStrictJson(bytes, 32768)); if (!canonicalJson(profile).equals(bytes)) throw failed();
    for (const [path, expected] of [[`${D3_CAPSULE_REPOSITORY}/deploy/development/controlled-recovery/tiny-d3.runtime-profile.json`, profile.source_profile_sha256], [`${D3_CAPSULE_REPOSITORY}/deploy/development/controlled-recovery/tiny-d3.source-data-profile.json`, profile.data_profile_sha256]]) { const input = await open(path!, constants.O_RDONLY | constants.O_NOFOLLOW); try { const stat = await input.stat(); if (!stat.isFile() || stat.nlink !== 1 || stat.uid !== process.getuid?.() || (stat.mode & 0o002) || stat.size > 131072 || sha256(await input.readFile()) !== expected) throw failed(); } finally { await input.close(); } }
    return { profile, sha256: sha256(bytes) };
  } catch { throw failed(); } finally { await file.close(); }
}
export async function loadD3CapsuleTemplates(profile: D3CapsuleProfile): Promise<ReadonlyMap<string, Buffer>> {
  d3CapsuleProfileSchema.parse(profile); const values = new Map<string, Buffer>(); let total = 0;
  try { for (const entry of profile.templates) { const file = await open(entry.path, constants.O_RDONLY | constants.O_NOFOLLOW); try { const s = await file.stat(); if (!s.isFile() || s.nlink !== 1 || s.uid !== process.getuid?.() || (s.mode & 0o002) || s.size < 1 || s.size > 2097152 || await realpath(entry.path) !== entry.path) throw failed(); const bytes = await file.readFile(); total += bytes.length; if (total > 8388608 || sha256(bytes) !== entry.sha256) throw failed(); values.set(entry.role, bytes); } finally { await file.close(); } } return values;
  } catch { throw failed(); }
}
export function assertD3CapsuleLiveGate(_profile: D3CapsuleProfile): never { throw new ControlledRecoveryError('CONTROLLED_RECOVERY_D3_CAPSULE_NOT_ADMITTED', 'Live capsule construction remains disabled until seeded source acceptance and separate enrollment review.'); }
