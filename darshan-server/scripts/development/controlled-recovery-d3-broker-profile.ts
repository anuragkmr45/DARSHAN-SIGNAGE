import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { z } from 'zod';
import { canonicalJson, parseStrictJson } from '../../src/backups/backup-broker-protocol';
import { ControlledRecoveryError, digest, sha256 } from '../../src/recovery/controlled-docker/contracts';
import { D3_ROOT, D3_OPERATION_ID } from './controlled-recovery-d3-authority';
import { D3_BROKER_ACTIVATOR, D3_BROKER_ENTRY, D3_BROKER_INVENTORY, D3_BROKER_NODE, verifyD3BrokerInventory } from './controlled-recovery-d3-broker-enrollment';
import { D3_RESERVATION_SOURCE_PROFILE, D3_RESERVATION_DATA_PROFILE, D3_RESERVATION_CAPSULE_PROFILE } from './controlled-recovery-d3-reservation-contract';
export const D3_BROKER_PROFILE = '/home/hexmon/Desktop/DARSHAN-SIGNAGE/deploy/development/controlled-recovery/tiny-d3.broker-profile.json';
export const D3_BROKER_PUBLIC_ROOT = `/run/user/1000/darshan-d3-${D3_OPERATION_ID}`;
export const D3_BROKER_SCOPE_PATH = `/user.slice/user-1000.slice/user@1000.service/app.slice/darshan-d3-controller-${D3_OPERATION_ID}.scope/broker`;
export const d3BrokerProfileSchema = z.object({ format: z.literal('darshan-d3-broker-profile-v1'), non_production: z.literal(true), providers_enabled: z.literal(true), broker_enabled: z.literal(false), capture_enabled: z.literal(false), whole_run_enabled: z.literal(false),
  source_profile_sha256: z.literal(D3_RESERVATION_SOURCE_PROFILE), data_profile_sha256: z.literal(D3_RESERVATION_DATA_PROFILE), capsule_profile_sha256: z.literal(D3_RESERVATION_CAPSULE_PROFILE), reservation_profile_sha256: z.literal('b557f180307dfa7ada44d9574ca99385d001104ad3b6b7201bfdc6b44ca14707'),
  activator: z.literal(D3_BROKER_ACTIVATOR), node: z.literal(D3_BROKER_NODE), entrypoint: z.literal(D3_BROKER_ENTRY), inventory_path: z.literal(D3_BROKER_INVENTORY), inventory_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  main_socket: z.literal(`${D3_ROOT}/run/backup-broker.sock`), recovery_socket: z.literal(`${D3_ROOT}/run/recovery-broker.sock`), main_fd: z.literal(3), recovery_fd: z.literal(4), fdnames: z.literal('backup:recovery'), helper_version: z.literal('d3-v1'),
  socket_mode: z.literal('0644'), parent_mode: z.literal('0700'), umask: z.literal('0077'), public_keyring: z.literal(`${D3_BROKER_PUBLIC_ROOT}/manifest-keyring.json`),
  scope_requirement: z.literal(D3_BROKER_SCOPE_PATH), scope_enrollment: z.null(), controller_memory_max: z.literal('201326592'), controller_pids_max: z.literal(64), controller_cpu_max: z.literal('25000 100000'), broker_memory_max: z.literal('134217728'), broker_pids_max: z.literal(32), broker_cpu_max: z.literal('25000 100000'),
  startup_timeout_ms: z.literal(10000), stop_grace_ms: z.literal(2000), join_timeout_ms: z.literal(10000), maximum_output_bytes: z.literal(65536), minimum_repository_free_bytes: z.literal('1073741824'), commands: z.tuple([z.literal('broker-prepare'), z.literal('broker-status'), z.literal('broker-stop')]) }).strict();
export type D3BrokerProfile = z.infer<typeof d3BrokerProfileSchema>;
export async function loadD3BrokerProfile() { try { const file = await open(D3_BROKER_PROFILE, constants.O_RDONLY | constants.O_NOFOLLOW); let bytes: Buffer; try { const s = await file.stat(); if (!s.isFile() || s.nlink !== 1 || s.uid !== process.getuid?.() || (s.mode & 0o002) || s.size > 16384) throw new Error('profile'); bytes = await file.readFile(); } finally { await file.close(); }
    const profile = d3BrokerProfileSchema.parse(parseStrictJson(bytes, 16384)); if (!bytes.equals(canonicalJson(profile))) throw new Error('canonical'); const inventory = await verifyD3BrokerInventory(profile.inventory_sha256); return { profile, sha256: sha256(bytes), inventory, inventorySha256: digest(inventory) };
  } catch { throw new ControlledRecoveryError('CONTROLLED_RECOVERY_D3_BROKER_PROFILE_INVALID', 'The fixed disabled broker profile or exact dependency authority differs.'); } }
export async function loadInstalledD3Broker(): Promise<never> { await loadD3BrokerProfile(); throw new ControlledRecoveryError('CONTROLLED_RECOVERY_D3_BROKER_NOT_ADMITTED', 'Installed broker remains disabled; accepted source/capsule/reservation, protected runtime keyring and controller-capped delegated scope acceptance are required.'); }
