import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { z } from 'zod';
import { canonicalJson, parseStrictJson } from '../../src/backups/backup-broker-protocol';
import { ControlledRecoveryError, sha256 } from '../../src/recovery/controlled-docker/contracts';
import { D3_ROOT } from './controlled-recovery-d3-authority';

export const D3_DATA_PROFILE_PATH = '/home/hexmon/Desktop/DARSHAN-SIGNAGE/deploy/development/controlled-recovery/tiny-d3.source-data-profile.json';
export const D3_MIGRATIONS_PATH = '/home/hexmon/Desktop/DARSHAN-SIGNAGE/darshan-server/drizzle/migrations';
export const D3_SOURCE_PROFILE_SHA256 = '1deb808f54ec122f85280b0e5b446913a8db78075b6505b7d77b6beba0278632';
export const d3SourceDataProfileSchema = z.object({ format: z.literal('darshan-d3-source-data-profile-v1'), non_production: z.literal(true),
  providers_enabled: z.literal(true), live_seed_enabled: z.boolean(), capsule_enabled: z.literal(false), capture_enabled: z.literal(false), whole_run_enabled: z.literal(false),
  source_profile_sha256: z.literal(D3_SOURCE_PROFILE_SHA256), commands: z.tuple([z.literal('seed'), z.literal('data-status')]),
  migrations_directory: z.literal(D3_MIGRATIONS_PATH), release_id: z.literal('release-03'), terminal_migration: z.literal('0057_controlled_recovery_report_projection.sql'),
  manifest_sha256: z.literal('6e5c624c235629f01bf5c0b3875232da1ab99633b1e9cd787f1422c46291304d'), migration_count: z.literal(59),
  pgboss_construction_sha256: z.literal('7b9593e6817ca69beb70db10424517c5bfb3086d3c0749858fdb75259466269d'),
  data_root: z.literal(`${D3_ROOT}/source/data`), application_name: z.literal('darshan-d3-source-data'), writer_role: z.literal('darshan_d3_seed'),
  maximum_object_bytes: z.literal(33554432), maximum_objects: z.literal(32), maximum_table_rows: z.literal(10000), timeout_ms: z.literal(30000),
  fixture_derivatives_are_conversion_evidence: z.literal(false), seed_writer_login: z.literal(false), operational_exclusions_only: z.literal(true),
}).strict();
export type D3SourceDataProfile = z.infer<typeof d3SourceDataProfileSchema>;
export async function loadD3SourceDataProfile() {
  const handle = await open(D3_DATA_PROFILE_PATH, constants.O_RDONLY | constants.O_NOFOLLOW);
  try { const stat = await handle.stat(); if (!stat.isFile() || stat.nlink !== 1 || stat.uid !== process.getuid?.() || (stat.mode & 0o777) !== 0o664 || stat.size > 16384) throw new Error('unsafe');
    const bytes = await handle.readFile(); const profile = d3SourceDataProfileSchema.parse(parseStrictJson(bytes, 16384)); if (!canonicalJson(profile).equals(bytes)) throw new Error('canonical'); return { profile, sha256: sha256(bytes) };
  } catch { throw new ControlledRecoveryError('CONTROLLED_RECOVERY_D3_SOURCE_DATA_PROFILE_INVALID', 'The fixed source data profile is unverified.'); } finally { await handle.close(); }
}
