import { createHash } from 'node:crypto';
import { canonicalJson } from './backup-broker-protocol';

export const REQUIRED_CAPSULE_ROLES = ['backend', 'data', 'cms', 'valkey', 'observability'] as const;

export const CAPSULE_ROLE_ALLOWLIST = {
  backend: [
    ['.env.production', '0640', '0640', 262_144, 'backend-env-base'],
    ['certs/device-ca.crt', '0644', '0644', 65_536], ['certs/device-ca.key', '0600', '0600', 65_536],
    ['certs/server.crt', '0644', '0644', 65_536], ['certs/server.key', '0600', '0600', 65_536],
    ['certs/transport-ca.crt', '0644', '0644', 65_536], ['metrics-gateway.conf', '0644', '0644', 262_144],
    ['secrets/database-url', '0640', '0640', 16_384], ['secrets/jwt-secret', '0640', '0640', 16_384],
    ['secrets/minio-access-key', '0640', '0640', 16_384], ['secrets/minio-secret-key', '0640', '0640', 16_384],
    ['secrets/observability-metrics-bearer-token', '0640', '0640', 16_384], ['secrets/valkey-url', '0640', '0640', 16_384],
  ],
  data: [
    ['.env.production', '0640', '0640', 262_144], ['postgres/pg_hba.conf', '0644', '0644', 65_536],
    ['tls/CAs/transport-ca.crt', '0644', '0644', 65_536], ['tls/postgres-ca.crt', '0644', '0644', 65_536],
    ['tls/postgres.crt', '0644', '0644', 65_536], ['tls/postgres.key', '0600', '0600', 65_536],
    ['tls/public.crt', '0644', '0644', 65_536], ['tls/private.key', '0600', '0600', 65_536],
    ['secrets/minio-access-key', '0640', '0640', 16_384], ['secrets/minio-secret-key', '0640', '0640', 16_384],
    ['secrets/postgres-monitoring-password', '0640', '0640', 16_384], ['secrets/postgres-monitoring-uri', '0640', '0640', 65_536],
    ['secrets/postgres-monitoring-user', '0640', '0640', 16_384], ['secrets/postgres-password', '0640', '0640', 16_384],
  ],
  cms: [
    ['.env.production', '0640', '0640', 262_144], ['nginx/default.conf', '0644', '0644', 262_144],
    ['tls/tls.crt', '0644', '0644', 65_536], ['tls/tls.key', '0600', '0600', 65_536],
    ['tls/transport-ca.crt', '0644', '0644', 65_536], ['www/config/app-config.json', '0644', '0644', 262_144],
  ],
  valkey: [
    ['.env.production', '0640', '0640', 262_144], ['tls/ca.crt', '0644', '0644', 65_536],
    ['tls/server.crt', '0644', '0644', 65_536], ['tls/server.key', '0600', '0600', 65_536],
    ['secrets/valkey-password', '0640', '0640', 16_384],
  ],
  observability: [
    ['.env.production', '0640', '0640', 262_144], ['alertmanager/alertmanager.yml', '0644', '0644', 262_144],
    ['alertmanager/templates/default.tmpl', '0644', '0644', 262_144], ['alertmanager/web-config.yml', '0644', '0644', 262_144],
    ['certs/server.crt', '0644', '0644', 65_536], ['certs/server.key', '0600', '0600', 65_536],
    ['certs/transport-ca.crt', '0644', '0644', 65_536], ['grafana/grafana.ini', '0644', '0644', 262_144],
    ['grafana/provisioning/dashboards/dashboards.yml', '0644', '0644', 262_144],
    ['grafana/provisioning/datasources/prometheus.yml', '0644', '0644', 262_144],
    ['grafana/dashboards/players-fleet.json', '0644', '0644', 1_048_576], ['grafana/dashboards/vm-valkey.json', '0644', '0644', 1_048_576],
    ['grafana/dashboards/vm1-data.json', '0644', '0644', 1_048_576], ['grafana/dashboards/vm2-backend.json', '0644', '0644', 1_048_576],
    ['grafana/dashboards/vm3-cms.json', '0644', '0644', 1_048_576], ['grafana/dashboards/vm4-observability.json', '0644', '0644', 1_048_576],
    ['prometheus/file-sd/players.targets.json', '0644', '0644', 1_048_576], ['prometheus/prometheus.yml', '0644', '0644', 1_048_576],
    ['prometheus/rules/alerts.yml', '0644', '0644', 1_048_576], ['prometheus/rules/recording-rules.yml', '0644', '0644', 1_048_576],
    ['prometheus/web-config.yml', '0644', '0644', 262_144], ['secrets/backend-metrics-bearer-token', '0640', '0640', 16_384],
    ['secrets/grafana-admin-password', '0640', '0640', 16_384],
  ],
} as const;

export const EMBEDDED_MANIFEST_SIGNING_KEY = {
  role: 'backend', path: 'secrets/backup-manifest-signing.key', sourceMode: '0600', restoreMode: '0600', maximumBytes: 16_384,
} as const;

const contractEntries: Array<{ role: string; path: string; source_mode: string; restore_owner: { uid: number; gid: number }; restore_mode: string; max_bytes: string }> = Object.entries(CAPSULE_ROLE_ALLOWLIST).flatMap(([role, specifications]) => specifications.map(
  ([path, sourceMode, restoreMode, maximumBytes]) => ({ role, path, source_mode: sourceMode, restore_owner: { uid: 0, gid: 0 }, restore_mode: restoreMode, max_bytes: String(maximumBytes) }),
));
contractEntries.push({ role: EMBEDDED_MANIFEST_SIGNING_KEY.role, path: EMBEDDED_MANIFEST_SIGNING_KEY.path,
  source_mode: EMBEDDED_MANIFEST_SIGNING_KEY.sourceMode, restore_owner: { uid: 0, gid: 0 },
  restore_mode: EMBEDDED_MANIFEST_SIGNING_KEY.restoreMode, max_bytes: String(EMBEDDED_MANIFEST_SIGNING_KEY.maximumBytes) });
contractEntries.sort((left, right) => Buffer.compare(Buffer.from(`${left.role}/${left.path}`), Buffer.from(`${right.role}/${right.path}`)));

export const PRODUCTION_CAPSULE_CONTRACT_ID = `darshan-production-capsule-v2:${createHash('sha256').update(canonicalJson({ version: 1, entries: contractEntries })).digest('hex')}`;
export const CAPSULE_INVENTORY_FILE = 'capsule-inventory.json';
export const CAPSULE_INVENTORY_FORMAT = 'darshan-encrypted-capsule-inventory-v1' as const;

export interface CapsuleInventoryEntry {
  role: typeof REQUIRED_CAPSULE_ROLES[number]; path: string; type: 'file'; source_mode: string;
  restore_owner: { uid: number; gid: number }; restore_mode: string; max_bytes: string; sha256: string;
}
export interface CapsuleInventoryDocument {
  format: typeof CAPSULE_INVENTORY_FORMAT; contract_id: string; entries: CapsuleInventoryEntry[];
}

export function capsuleInventoryBytes(entries: CapsuleInventoryEntry[]): Buffer {
  return canonicalJson({ format: CAPSULE_INVENTORY_FORMAT, contract_id: PRODUCTION_CAPSULE_CONTRACT_ID, entries });
}

export function validateProductionCapsuleInventory(value: unknown): CapsuleInventoryDocument {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Encrypted capsule inventory must be an object.');
  const document = value as Record<string, unknown>;
  if (Object.keys(document).sort().join(',') !== 'contract_id,entries,format' || document.format !== CAPSULE_INVENTORY_FORMAT ||
      document.contract_id !== PRODUCTION_CAPSULE_CONTRACT_ID || !Array.isArray(document.entries)) throw new Error('Encrypted capsule inventory header is invalid.');
  const expected = new Map(contractEntries.map((entry) => [`${entry.role}/${entry.path}`, entry]));
  if (document.entries.length !== expected.size) throw new Error('Encrypted capsule inventory is not the exact production contract.');
  for (const candidate of document.entries) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) throw new Error('Encrypted capsule inventory entry is invalid.');
    const entry = candidate as Record<string, unknown>; const identity = `${entry.role}/${entry.path}`; const contract = expected.get(identity);
    const restoreOwner = entry.restore_owner;
    if (Object.keys(entry).sort().join(',') !== 'max_bytes,path,restore_mode,restore_owner,role,sha256,source_mode,type' || !contract || entry.type !== 'file' ||
        entry.source_mode !== contract.source_mode || entry.restore_mode !== contract.restore_mode || entry.max_bytes !== contract.max_bytes ||
        !restoreOwner || typeof restoreOwner !== 'object' || Array.isArray(restoreOwner) ||
        Object.keys(restoreOwner).sort().join(',') !== 'gid,uid' ||
        (restoreOwner as Record<string, unknown>).uid !== 0 || (restoreOwner as Record<string, unknown>).gid !== 0 ||
        typeof entry.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(entry.sha256)) {
      throw new Error(`Encrypted capsule inventory entry violates the production contract: ${identity}.`);
    }
    expected.delete(identity);
  }
  if (expected.size) throw new Error('Encrypted capsule inventory is missing required production entries.');
  return value as CapsuleInventoryDocument;
}
