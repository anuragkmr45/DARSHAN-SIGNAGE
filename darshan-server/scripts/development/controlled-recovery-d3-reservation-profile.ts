import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { z } from 'zod';
import { canonicalJson, parseStrictJson } from '../../src/backups/backup-broker-protocol';
import { ControlledRecoveryError, sha256 } from '../../src/recovery/controlled-docker/contracts';
import { D3_RESERVATION_SOURCE_PROFILE, D3_RESERVATION_DATA_PROFILE, D3_RESERVATION_CAPSULE_PROFILE } from './controlled-recovery-d3-reservation-contract';
import { D3_CONTROL_DDL_SHA256 } from './controlled-recovery-d3-reservation-control';
export const D3_RESERVATION_PROFILE_PATH = '/home/hexmon/Desktop/DARSHAN-SIGNAGE/deploy/development/controlled-recovery/tiny-d3.reservation-profile.json';
export const D3_RESERVATION_DDL_PATH = '/home/hexmon/Desktop/DARSHAN-SIGNAGE/deploy/development/controlled-recovery/reservation-control.sql';
export const d3ReservationProfileSchema = z.object({ format: z.literal('darshan-d3-reservation-profile-v1'), non_production: z.literal(true), providers_enabled: z.literal(true),
  reservation_enabled: z.literal(false), capture_enabled: z.literal(false), broker_enabled: z.literal(false), whole_run_enabled: z.literal(false),
  source_profile_sha256: z.literal(D3_RESERVATION_SOURCE_PROFILE), data_profile_sha256: z.literal(D3_RESERVATION_DATA_PROFILE), capsule_profile_sha256: z.literal(D3_RESERVATION_CAPSULE_PROFILE),
  control_schema: z.literal('darshan_d3_control'), control_ddl_path: z.literal(D3_RESERVATION_DDL_PATH), control_ddl_sha256: z.literal(D3_CONTROL_DDL_SHA256),
  outside_application_migrations: z.literal(true), excluded_from_capture: z.literal(true), queue: z.literal('backup'), queue_schema: z.literal('pgboss'), application_name: z.literal('darshan-d3-reservation'),
  statement_timeout_ms: z.literal(10000), lock_timeout_ms: z.literal(1000), transaction_timeout_ms: z.literal(30000), maximum_bindings: z.literal(1),
  commands: z.tuple([z.literal('reserve-backup'), z.literal('reservation-status')]) }).strict();
export type D3ReservationProfile = z.infer<typeof d3ReservationProfileSchema>;
export async function loadD3ReservationProfile() { const read = async (path: string, maximum: number) => { const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW); try { const stat = await file.stat(); if (!stat.isFile() || stat.nlink !== 1 || stat.uid !== process.getuid?.() || (stat.mode & 0o002) || stat.size < 1 || stat.size > maximum) throw new Error('profile'); return await file.readFile(); } finally { await file.close(); } };
  try { const bytes = await read(D3_RESERVATION_PROFILE_PATH, 16384), profile = d3ReservationProfileSchema.parse(parseStrictJson(bytes, 16384)); if (!canonicalJson(profile).equals(bytes) || sha256(await read(profile.control_ddl_path, 16384)) !== profile.control_ddl_sha256) throw new Error('binding');
    for (const [name, hash] of [['tiny-d3.runtime-profile.json', profile.source_profile_sha256], ['tiny-d3.source-data-profile.json', profile.data_profile_sha256], ['tiny-d3.capsule-profile.json', profile.capsule_profile_sha256]]) if (sha256(await read(`/home/hexmon/Desktop/DARSHAN-SIGNAGE/deploy/development/controlled-recovery/${name}`, 131072)) !== hash) throw new Error('binding'); return { profile, sha256: sha256(bytes) };
  } catch { throw new ControlledRecoveryError('CONTROLLED_RECOVERY_D3_RESERVATION_PROFILE_INVALID', 'The fixed disabled reservation profile, DDL or accepted source/data/capsule authority differs.'); } }
export async function loadInstalledD3BackupReservation(): Promise<never> { await loadD3ReservationProfile(); throw new ControlledRecoveryError('CONTROLLED_RECOVERY_D3_RESERVATION_NOT_ADMITTED', 'Installed backup reservation remains disabled pending independent review, real source/capsule acceptance and separate enrollment.'); }
/** This exact D3-only dump contract is a prerequisite for future capture; it is not an executor. */
export function fixedD3ReservationDumpArguments() { return Object.freeze(['--format=custom', '--no-owner', '--no-privileges', '--exclude-schema=darshan_d3_control', '--file=/output/database.dump', '--dbname=darshan']); }
