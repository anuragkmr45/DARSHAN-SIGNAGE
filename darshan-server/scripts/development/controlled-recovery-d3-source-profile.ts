import { z } from 'zod';
import { D3_ROOT } from './controlled-recovery-d3-authority';

export const D3_SOURCE_COMMANDS = ['prepare', 'capture', 'resume', 'status', 'stop'] as const;
export const D3_SOURCE_STAGES = ['LAYOUT_READY', 'SERVICES_READY', 'SCHEMA_READY', 'SEEDED_AND_SEALED', 'CAPSULE_READY', 'BACKUP_RESERVED', 'PUBLICATION_VERIFIED', 'SOURCE_STOPPED'] as const;
export const D3_SOURCE_ROOT = `${D3_ROOT}/source`;
export const d3SourceBackupProfileSchema = z.object({
  format: z.literal('darshan-d3-source-backup-profile-v1'), enabled: z.literal(false),
  providers_enabled: z.literal(true), live_prepare_enabled: z.literal(true), capture_enabled: z.literal(false),
  live_commands: z.tuple([z.literal('preflight'), z.literal('prepare'), z.literal('status'), z.literal('stop')]),
  commands: z.tuple([z.literal('prepare'), z.literal('capture'), z.literal('resume'), z.literal('status'), z.literal('stop')]),
  work_root: z.literal(D3_SOURCE_ROOT), state_root: z.literal(`${D3_SOURCE_ROOT}/state`), staging_root: z.literal(`${D3_SOURCE_ROOT}/staging`),
  secrets_root: z.literal(`${D3_SOURCE_ROOT}/secrets`), tls_root: z.literal(`${D3_SOURCE_ROOT}/tls`), directory_mode: z.literal('0700'), file_mode: z.literal('0600'),
  network: z.object({ name: z.literal('darshan-d2-20261030-net'), driver: z.literal('bridge'), internal: z.literal(true), subnet: z.literal('172.30.250.0/28'), gateway: z.literal('172.30.250.1') }).strict(),
  postgres: z.object({ name: z.literal('darshan-d2-20261030-postgres'), init_name: z.literal('darshan-d2-20261030-postgres-init'), volume: z.literal('darshan-d2-20261030-pg'),
    ip: z.literal('172.30.250.2'), database: z.literal('darshan'), user: z.literal('darshan'), runtime_user: z.literal('70:70'), data_directory: z.literal('/var/lib/postgresql/data/pgdata'), tls_directory: z.literal('/var/lib/postgresql/data/.d3-tls'),
    minimum_tls: z.literal('TLSv1.2'), password_encryption: z.literal('scram-sha-256'), init_timeout_ms: z.literal(120000) }).strict(),
  minio: z.object({ name: z.literal('darshan-d2-20261030-minio'), volume: z.literal('darshan-d2-20261030-minio'), ip: z.literal('172.30.250.3'),
    user: z.number().int().positive(), group: z.number().int().positive(), browser: z.literal(false), tls: z.literal(true) }).strict(),
  valkey: z.object({ name: z.literal('darshan-d2-20261030-valkey'), volume: z.literal('darshan-d2-20261030-valkey'), ip: z.literal('172.30.250.4'),
    user: z.number().int().positive(), group: z.number().int().positive(), plaintext_port: z.literal(0), tls_port: z.literal(6379), maxmemory_bytes: z.literal('33554432'),
    acl_required: z.literal(true), appendonly: z.literal(true), appendfsync: z.literal('always') }).strict(),
  health: z.object({ attempts: z.literal(30), interval_ms: z.literal(1000), probe_timeout_ms: z.literal(2000), total_timeout_ms: z.literal(90000),
    postgres_authenticated_tls_select: z.literal(true), minio_authenticated_tls_s3: z.literal(true), valkey_authenticated_tls_ping: z.literal(true),
    reject_plaintext_and_unauthenticated: z.literal(true) }).strict(),
  backup: z.object({ maximum_plaintext_bytes: z.literal('33554432'), repository_root: z.literal(`${D3_ROOT}/repository/tiny-d1-development/backup-repository`),
    capsule_roles: z.tuple([z.literal('backend'), z.literal('data'), z.literal('cms'), z.literal('valkey'), z.literal('observability')]),
    age_private_key_excluded: z.literal(true), distinct_disposable_signing_keys: z.literal(true) }).strict(),
}).strict();
export type D3SourceBackupProfile = z.infer<typeof d3SourceBackupProfileSchema>;

export function fixedD3SourceBackupProfile(ownerUid: number, ownerGid: number): D3SourceBackupProfile {
  return d3SourceBackupProfileSchema.parse({ format: 'darshan-d3-source-backup-profile-v1', enabled: false, commands: D3_SOURCE_COMMANDS,
    providers_enabled: true, live_prepare_enabled: true, capture_enabled: false, live_commands: ['preflight', 'prepare', 'status', 'stop'],
    work_root: D3_SOURCE_ROOT, state_root: `${D3_SOURCE_ROOT}/state`, staging_root: `${D3_SOURCE_ROOT}/staging`, secrets_root: `${D3_SOURCE_ROOT}/secrets`, tls_root: `${D3_SOURCE_ROOT}/tls`, directory_mode: '0700', file_mode: '0600',
    network: { name: 'darshan-d2-20261030-net', driver: 'bridge', internal: true, subnet: '172.30.250.0/28', gateway: '172.30.250.1' },
    postgres: { name: 'darshan-d2-20261030-postgres', init_name: 'darshan-d2-20261030-postgres-init', volume: 'darshan-d2-20261030-pg', ip: '172.30.250.2', database: 'darshan', user: 'darshan', runtime_user: '70:70', data_directory: '/var/lib/postgresql/data/pgdata', tls_directory: '/var/lib/postgresql/data/.d3-tls', minimum_tls: 'TLSv1.2', password_encryption: 'scram-sha-256', init_timeout_ms: 120000 },
    minio: { name: 'darshan-d2-20261030-minio', volume: 'darshan-d2-20261030-minio', ip: '172.30.250.3', user: ownerUid, group: ownerGid, browser: false, tls: true },
    valkey: { name: 'darshan-d2-20261030-valkey', volume: 'darshan-d2-20261030-valkey', ip: '172.30.250.4', user: ownerUid, group: ownerGid, plaintext_port: 0, tls_port: 6379, maxmemory_bytes: '33554432', acl_required: true, appendonly: true, appendfsync: 'always' },
    health: { attempts: 30, interval_ms: 1000, probe_timeout_ms: 2000, total_timeout_ms: 90000, postgres_authenticated_tls_select: true, minio_authenticated_tls_s3: true, valkey_authenticated_tls_ping: true, reject_plaintext_and_unauthenticated: true },
    backup: { maximum_plaintext_bytes: '33554432', repository_root: `${D3_ROOT}/repository/tiny-d1-development/backup-repository`, capsule_roles: ['backend', 'data', 'cms', 'valkey', 'observability'], age_private_key_excluded: true, distinct_disposable_signing_keys: true } });
}
