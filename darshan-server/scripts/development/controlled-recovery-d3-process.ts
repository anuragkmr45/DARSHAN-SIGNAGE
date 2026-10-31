import { ControlledRecoveryError, digest } from '../../src/recovery/controlled-docker/contracts';
import { assertVerifiedD3AgeIdentity, type VerifiedD3AgeIdentity } from './controlled-recovery-d3-age-identity';
import { D3_OPERATION_ID, D3_REPOSITORY_ID, D3_ROOT, D3_SITE_ID } from './controlled-recovery-d3-authority';

export type D3HostRole = 'api' | 'worker' | 'cms' | 'browser' | 'player' | 'controller';
export interface D3ProcessExecution { spawnFixed(input: { executable: string; argv: readonly string[]; cwd: string; env: Readonly<Record<string, string>>; cgroup: { memoryMax: string; pidsMax: number; cpuQuotaMicros: string }; timeoutMs: number }): Promise<{ processId: string; cgroupEvidenceSha256: string }>; }
export interface D3RuntimeLayoutBoundary { prepare(input: { root: string; cwd: string; emptyDotenvPath: string; configPath: string; config: ReturnType<typeof fixedD3BackendConfig>;
  secretTargets: { postgresIp: string; minioIp: string; valkeyIp: string } }): Promise<{ ambientDotenvAbsent: boolean; modeEvidenceSha256: string; targetEvidenceSha256: string }>; }
export interface D3BackendRuntimeAuthority { containerToolsConfigSha256: string; brokerPolicySha256: string; capsuleGeneration: string; capsuleSha256: string;
  ageIdentity: VerifiedD3AgeIdentity;
  repositoryDeviceId: string; spoolDeviceId: string; ownerUid: string; ownerGid: string; }
const caps: Record<D3HostRole, { memoryMax: string; pidsMax: number; cpuQuotaMicros: string }> = {
  api: { memoryMax: '402653184', pidsMax: 128, cpuQuotaMicros: '50000' }, worker: { memoryMax: '805306368', pidsMax: 192, cpuQuotaMicros: '100000' },
  cms: { memoryMax: '67108864', pidsMax: 64, cpuQuotaMicros: '25000' }, browser: { memoryMax: '536870912', pidsMax: 128, cpuQuotaMicros: '50000' },
  player: { memoryMax: '805306368', pidsMax: 192, cpuQuotaMicros: '100000' }, controller: { memoryMax: '201326592', pidsMax: 64, cpuQuotaMicros: '25000' }, };
export class FixedD3ProcessSupervisor {
  constructor(private readonly executor: D3ProcessExecution, private readonly layout: D3RuntimeLayoutBoundary, private readonly authority: D3BackendRuntimeAuthority) {}
  async launch(role: D3HostRole, input: { postgresIp: string; minioIp: string; valkeyIp: string }) { const allowedIp = (value: string) => /^172\.(?:1[6-9]|2[0-9]|3[01])\.[0-9]{1,3}\.[0-9]{1,3}$/.test(value);
    if (![input.postgresIp, input.minioIp, input.valkeyIp].every(allowedIp)) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_D3_BRIDGE_IDENTITY_INVALID', 'D3 host process bridge identity is invalid.');
    const node20 = '/home/hexmon/.nvm/versions/node/v20.20.2/bin/node';
    const fixed: Record<D3HostRole, { executable: string; argv: readonly string[] }> = {
      api: { executable: node20, argv: ['/home/hexmon/Desktop/DARSHAN-SIGNAGE/darshan-server/dist/index.js', '--role=api'] },
      worker: { executable: node20, argv: ['/home/hexmon/Desktop/DARSHAN-SIGNAGE/darshan-server/dist/index.js', '--role=worker'] },
      cms: { executable: node20, argv: ['/home/hexmon/Desktop/DARSHAN-SIGNAGE/darshan-server/scripts/development/d3-static-cms.mjs'] },
      browser: { executable: node20, argv: ['/home/hexmon/Desktop/DARSHAN-SIGNAGE/darshan-server/scripts/development/d3-cms-live.mjs'] },
      player: { executable: node20, argv: ['/home/hexmon/Desktop/DARSHAN-SIGNAGE/darshan-server/scripts/development/d3-player-bootstrap.mjs'] },
      controller: { executable: node20, argv: ['/home/hexmon/Desktop/DARSHAN-SIGNAGE/darshan-server/scripts/development/d3-controller.mjs'] }, };
    const root = '/home/hexmon/Desktop/DARSHAN-SIGNAGE/.controlled-recovery-d3';
    const prepared = await this.layout.prepare({ root, cwd: `${root}/runtime-empty`, emptyDotenvPath: `${root}/runtime-empty/empty.env`, configPath: `${root}/config/backend.json`,
      config: fixedD3BackendConfig(input), secretTargets: input });
    if (!prepared.ambientDotenvAbsent || ![prepared.modeEvidenceSha256, prepared.targetEvidenceSha256].every((value) => /^[a-f0-9]{64}$/.test(value)))
      throw new ControlledRecoveryError('CONTROLLED_RECOVERY_D3_RUNTIME_LAYOUT_UNSAFE', 'D3 runtime layout, file-secret targets, or empty cwd is unproven.');
    const backend = role === 'api' || role === 'worker';
    const environment = Object.freeze({ ...(backend ? fixedD3BackendProductionEnv(role, root, this.authority) : { NODE_ENV: 'production', DARSHAN_D3: '1', DOTENV_CONFIG_PATH: `${root}/runtime-empty/empty.env`, PATH: '/home/hexmon/.nvm/versions/node/v20.20.2/bin:/usr/bin:/bin', HOME: `${root}/home` }),
      DISPLAY: role === 'player' ? ':0' : '' });
    return this.executor.spawnFixed({ ...fixed[role], cwd: `${root}/runtime-empty`, env: environment, cgroup: caps[role], timeoutMs: 120_000 }); }
  expectedCgroupEvidence(role: D3HostRole) { return digest(caps[role]); }
}

export function fixedD3BackendProductionEnv(role: 'api' | 'worker', root: string, authority: D3BackendRuntimeAuthority): Readonly<Record<string, string>> {
  assertVerifiedD3AgeIdentity(authority.ageIdentity, { operationId: D3_OPERATION_ID, siteId: D3_SITE_ID, repositoryId: D3_REPOSITORY_ID, keyPath: `${D3_ROOT}/keys/recovery.age` });
  if (root !== D3_ROOT || authority.ageIdentity.toolsConfigSha256 !== authority.containerToolsConfigSha256 || ![authority.containerToolsConfigSha256, authority.brokerPolicySha256, authority.capsuleSha256].every((value) => /^[a-f0-9]{64}$/.test(value)) ||
      authority.ownerUid !== String(process.getuid?.()) || authority.ownerGid !== String(process.getgid?.()) ||
      ![authority.repositoryDeviceId, authority.spoolDeviceId, authority.ownerUid, authority.ownerGid].every((value) => /^\d+$/.test(value)))
    throw new ControlledRecoveryError('CONTROLLED_RECOVERY_D3_RUNTIME_AUTHORITY_INVALID', 'D3 production runtime authority is incomplete.');
  return Object.freeze({ NODE_ENV: 'production', DARSHAN_D3: '1', DARSHAN_PROCESS_ROLE: role, DARSHAN_CONFIG_FILE: `${root}/config/backend.json`, DOTENV_CONFIG_PATH: `${root}/runtime-empty/empty.env`,
    DATABASE_URL_FILE: `${root}/secrets/database-url`, JWT_SECRET_FILE: `${root}/secrets/jwt-secret`, MINIO_ACCESS_KEY_FILE: `${root}/secrets/minio-access-key`, MINIO_SECRET_KEY_FILE: `${root}/secrets/minio-secret-key`, VALKEY_URL_FILE: `${root}/secrets/valkey-url`,
    DATABASE_TLS_ENABLED: 'true', DATABASE_CA_CERT_PATH: `${root}/tls/ca.crt`, SERVER_TLS_ENABLED: 'true', TLS_CERT_PATH: `${root}/tls/server.crt`, TLS_KEY_PATH: `${root}/tls/server.key`, CA_CERT_PATH: `${root}/tls/ca.crt`,
    HOST: '127.0.0.1', PORT: '18441', DEVICE_PORT: '18442', PATH: '/home/hexmon/.nvm/versions/node/v20.20.2/bin:/usr/bin:/bin', HOME: `${root}/home`, DEVICE_AUTH_MODE: 'signature', DEVICE_SOCKET_LEGACY_AUTH_ALLOWED: 'false',
    DEVICE_SOCKET_SIGNED_AUTH_ENABLED: 'true', DEVICE_SOCKET_AUTH_REPLAY_PROTECTION_ENABLED: 'true', DEVICE_SOCKET_AUTH_REPLAY_FAIL_CLOSED: 'true', LOGIN_THROTTLE_PROVIDER: 'valkey', LOGIN_THROTTLE_FAIL_CLOSED: 'true',
    DARSHAN_RELEASE_ID: 'release-03', DARSHAN_SOURCE_COMMIT: 'development', DARSHAN_COMPATIBILITY_GENERATION: '3',
    BACKUP_INTERVAL_HOURS: '24', BACKUP_RETENTION_DAYS: '30', BACKUP_REPOSITORY_KIND: 'LOCAL_FILESYSTEM', BACKUP_REPOSITORY_ROOT: `${root}/repository/tiny-d1-development/backup-repository`, BACKUP_REPOSITORY_DEVICE_ID: authority.repositoryDeviceId,
    BACKUP_REPOSITORY_OWNER_UID: authority.ownerUid, BACKUP_REPOSITORY_OWNER_GID: authority.ownerGid, BACKUP_REPOSITORY_MIN_FREE_BYTES: '1073741824', BACKUP_REPOSITORY_ID: 'd3000000-0000-4000-8000-000000000002',
    BACKUP_ENCRYPTION_RECIPIENT: authority.ageIdentity.recipient, BACKUP_ENCRYPTION_KEY_ID: authority.ageIdentity.keyId, BACKUP_LOCAL_PROTOCOL: 'V2_BROKER',
    BACKUP_BROKER_SOCKET_PATH: `${root}/run/backup-broker.sock`, BACKUP_BROKER_HELPER_VERSION: 'd3-v1', BACKUP_BROKER_POLICY_SHA256: authority.brokerPolicySha256,
    BACKUP_MANIFEST_PUBLIC_KEYRING_PATH: `${root}/trust/manifest-public-keyring.json`, BACKUP_POLICY_PUBLIC_KEYRING_PATH: `${root}/trust/policy-public-keyring.json`, BACKUP_WORKER_SPOOL_ROOT: `${root}/spool`,
    BACKUP_WORKER_SPOOL_DEVICE_ID: authority.spoolDeviceId, BACKUP_WORKER_SPOOL_OWNER_UID: authority.ownerUid, BACKUP_WORKER_SPOOL_OWNER_GID: authority.ownerGid,
    BACKUP_CAPSULE_GENERATION: authority.capsuleGeneration, BACKUP_CAPSULE_SHA256: authority.capsuleSha256, BACKUP_SITE_ID: 'tiny-d1-development', BACKUP_SCHEDULE_TIME: '02:00', BACKUP_SCHEDULE_TIMEZONE: 'UTC' });
}

export function fixedD3BackendConfig(input: { postgresIp: string; minioIp: string; valkeyIp: string }, root = '/home/hexmon/Desktop/DARSHAN-SIGNAGE/.controlled-recovery-d3') {
  const allowed = (value: string) => /^172\.(?:1[6-9]|2[0-9]|3[01])\.[0-9]{1,3}\.[0-9]{1,3}$/.test(value);
  if (!Object.values(input).every(allowed)) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_D3_BRIDGE_IDENTITY_INVALID', 'D3 backend config requires exact inspected bridge addresses.');
  return { environment: { name: 'd3-tiny-disposable', deploymentId: 'darshan-d2-20261030', serverId: 'd3-api' },
    http: { appPublicBaseUrl: 'https://127.0.0.1:18443', corsOrigins: ['https://127.0.0.1:18443'], socketAllowedOrigins: ['https://127.0.0.1:18443'] },
    realtime: { enabled: true, busProvider: 'valkey', socketTransport: 'websocket', socketAllowPolling: false },
    valkey: { mode: 'standalone', tlsEnabled: true, authRequired: true, caCertPath: `${root}/tls/ca.crt`, namespace: 'darshan:d3' },
    security: { authCookieSecure: true, csrfEnabled: true, loginThrottleProvider: 'valkey', loginThrottleFailClosed: true, swaggerUiEnabled: false },
    media: { endpoint: `https://${input.minioIp}:9000`, publicEndpoint: 'https://127.0.0.1:18443' } };
}

export const D3_REQUIRED_TOOLS = [
  { role: 'node20', path: '/home/hexmon/.nvm/versions/node/v20.20.2/bin/node', version: 'v20.20.2' },
] as const;
export interface D3ToolObserver { observe(path: string): Promise<{ regular: boolean; executable: boolean; sha256: string; version: string } | null>; }
export async function assertD3Tools(observer: D3ToolObserver, enrolled: Readonly<Record<string, { sha256: string; version: string }>>): Promise<string> { const evidence = [];
  for (const tool of D3_REQUIRED_TOOLS) { const value = await observer.observe(tool.path); const expected = enrolled[tool.role]; if (!value || !value.regular || !value.executable || !expected || value.sha256 !== expected.sha256 || value.version !== expected.version)
      throw new ControlledRecoveryError('CONTROLLED_RECOVERY_D3_TOOL_UNAVAILABLE', `Required D3 tool ${tool.role} is absent or not enrolled.`); evidence.push({ role: tool.role, sha256: value.sha256, version: value.version }); }
  return digest(evidence);
}
