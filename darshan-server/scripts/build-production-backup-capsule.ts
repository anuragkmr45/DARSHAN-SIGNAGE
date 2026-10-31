import { createHash, createPrivateKey, createPublicKey } from 'node:crypto';
import { constants as fsConstants, promises as fs } from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, join, parse, resolve, sep } from 'node:path';
import { canonicalJson, parseStrictJson } from '../src/backups/backup-broker-protocol';
import { signCapsulePolicy, type ConfigurationCapsulePolicy } from '../src/backups/configuration-capsule-policy';
import { CAPSULE_INVENTORY_FILE, CAPSULE_INVENTORY_FORMAT, EMBEDDED_MANIFEST_SIGNING_KEY, PRODUCTION_CAPSULE_CONTRACT_ID,
  REQUIRED_CAPSULE_ROLES, capsuleInventoryBytes, validateProductionCapsuleInventory, type CapsuleInventoryEntry } from '../src/backups/configuration-capsule-inventory';
import { canonicalKeyringObject, parseCanonicalEd25519PrivateKey, parseCanonicalEd25519PublicKeyring } from '../src/backups/ed25519-public-keyring';

const ROLE_ALLOWLIST = {
  backend: [
    ['.env.production', '0640', '0640', 262_144, 'backend-env-base'],
    ['certs/device-ca.crt', '0644', '0644', 65_536],
    ['certs/device-ca.key', '0600', '0600', 65_536],
    ['certs/server.crt', '0644', '0644', 65_536],
    ['certs/server.key', '0600', '0600', 65_536],
    ['certs/transport-ca.crt', '0644', '0644', 65_536],
    ['metrics-gateway.conf', '0644', '0644', 262_144],
    ['secrets/database-url', '0640', '0640', 16_384],
    ['secrets/jwt-secret', '0640', '0640', 16_384],
    ['secrets/minio-access-key', '0640', '0640', 16_384],
    ['secrets/minio-secret-key', '0640', '0640', 16_384],
    ['secrets/observability-metrics-bearer-token', '0640', '0640', 16_384],
    ['secrets/valkey-url', '0640', '0640', 16_384],
  ],
  data: [
    ['.env.production', '0640', '0640', 262_144],
    ['postgres/pg_hba.conf', '0644', '0644', 65_536],
    ['tls/CAs/transport-ca.crt', '0644', '0644', 65_536],
    ['tls/postgres-ca.crt', '0644', '0644', 65_536],
    ['tls/postgres.crt', '0644', '0644', 65_536],
    ['tls/postgres.key', '0600', '0600', 65_536],
    ['tls/public.crt', '0644', '0644', 65_536],
    ['tls/private.key', '0600', '0600', 65_536],
    ['secrets/minio-access-key', '0640', '0640', 16_384],
    ['secrets/minio-secret-key', '0640', '0640', 16_384],
    ['secrets/postgres-monitoring-password', '0640', '0640', 16_384],
    ['secrets/postgres-monitoring-uri', '0640', '0640', 65_536],
    ['secrets/postgres-monitoring-user', '0640', '0640', 16_384],
    ['secrets/postgres-password', '0640', '0640', 16_384],
  ],
  cms: [
    ['.env.production', '0640', '0640', 262_144],
    ['nginx/default.conf', '0644', '0644', 262_144],
    ['tls/tls.crt', '0644', '0644', 65_536],
    ['tls/tls.key', '0600', '0600', 65_536],
    ['tls/transport-ca.crt', '0644', '0644', 65_536],
    ['www/config/app-config.json', '0644', '0644', 262_144],
  ],
  valkey: [
    ['.env.production', '0640', '0640', 262_144],
    ['tls/ca.crt', '0644', '0644', 65_536],
    ['tls/server.crt', '0644', '0644', 65_536],
    ['tls/server.key', '0600', '0600', 65_536],
    ['secrets/valkey-password', '0640', '0640', 16_384],
  ],
  observability: [
    ['.env.production', '0640', '0640', 262_144],
    ['alertmanager/alertmanager.yml', '0644', '0644', 262_144],
    ['alertmanager/templates/default.tmpl', '0644', '0644', 262_144],
    ['alertmanager/web-config.yml', '0644', '0644', 262_144],
    ['certs/server.crt', '0644', '0644', 65_536],
    ['certs/server.key', '0600', '0600', 65_536],
    ['certs/transport-ca.crt', '0644', '0644', 65_536],
    ['grafana/grafana.ini', '0644', '0644', 262_144],
    ['grafana/provisioning/dashboards/dashboards.yml', '0644', '0644', 262_144],
    ['grafana/provisioning/datasources/prometheus.yml', '0644', '0644', 262_144],
    ['grafana/dashboards/players-fleet.json', '0644', '0644', 1_048_576],
    ['grafana/dashboards/vm-valkey.json', '0644', '0644', 1_048_576],
    ['grafana/dashboards/vm1-data.json', '0644', '0644', 1_048_576],
    ['grafana/dashboards/vm2-backend.json', '0644', '0644', 1_048_576],
    ['grafana/dashboards/vm3-cms.json', '0644', '0644', 1_048_576],
    ['grafana/dashboards/vm4-observability.json', '0644', '0644', 1_048_576],
    ['prometheus/file-sd/players.targets.json', '0644', '0644', 1_048_576],
    ['prometheus/prometheus.yml', '0644', '0644', 1_048_576],
    ['prometheus/rules/alerts.yml', '0644', '0644', 1_048_576],
    ['prometheus/rules/recording-rules.yml', '0644', '0644', 1_048_576],
    ['prometheus/web-config.yml', '0644', '0644', 262_144],
    ['secrets/backend-metrics-bearer-token', '0640', '0640', 16_384],
    ['secrets/grafana-admin-password', '0640', '0640', 16_384],
  ],
} as const;

interface Input {
  outputDirectory: string;
  roleRoots: Record<keyof typeof ROLE_ALLOWLIST, string>;
  siteId: string;
  repositoryId: string;
  releaseGeneration: string;
  deploymentGeneration: string;
  compatibilityGeneration: number;
  ageRecipient: string;
  ageRecipientKeyId: string;
  ageBinary: string;
  ageVersion: string;
  ageSha256: string;
  tarBinary: string;
  policyPrivateKeyFile: string;
  releaseSigningPrivateKeyFile: string;
  manifestPrivateKeyFile: string;
  manifestPublicKeyringFile: string;
  policyKeyId: string;
  manifestKeyId: string;
  createdAt: string;
}

async function run(file: string, args: string[]): Promise<{ stdout: Buffer; stderr: Buffer }> {
  return new Promise((accept, reject) => {
    const child = spawn(file, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout: Buffer[] = []; const stderr: Buffer[] = []; let stderrBytes = 0;
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => { if (stderrBytes < 16_384) stderr.push(chunk.subarray(0, 16_384 - stderrBytes)); stderrBytes += chunk.length; });
    child.once('error', reject);
    child.once('close', (code) => code === 0 ? accept({ stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) })
      : reject(new Error(`${file} failed with exit ${code}: ${Buffer.concat(stderr).toString('utf8').trim()}`)));
  });
}

async function protectedSingleFile(path: string, expectedMode?: number): Promise<Awaited<ReturnType<typeof fs.lstat>>> {
  if (resolve(path) !== path || await fs.realpath(path) !== path) throw new Error(`Input path is not canonical: ${path}`);
  const stat = await fs.lstat(path, { bigint: true });
  const runtimeUid = typeof process.getuid === 'function' ? process.getuid() : Number(stat.uid);
  if (stat.isSymbolicLink() || !stat.isFile() || stat.nlink !== 1n || ![0, runtimeUid].includes(Number(stat.uid)) ||
      (expectedMode !== undefined && Number(stat.mode & 0o777n) !== expectedMode)) {
    throw new Error(`Input is not a protected single-link regular file: ${path}`);
  }
  let parent = dirname(path);
  for (;;) {
    const directory = await fs.lstat(parent, { bigint: true });
    const worldWritable = Number(directory.mode & 0o002n) !== 0;
    const protectedStickyRoot = worldWritable && Number(directory.uid) === 0 && Number(directory.mode & 0o1000n) !== 0;
    if (directory.isSymbolicLink() || !directory.isDirectory() || (worldWritable && !protectedStickyRoot)) throw new Error(`Input parent chain is unsafe: ${path}`);
    if (parent === parse(parent).root) break;
    parent = dirname(parent);
  }
  return stat;
}

function stable(before: Awaited<ReturnType<typeof fs.lstat>>, after: Awaited<ReturnType<typeof fs.lstat>>): boolean {
  return before.dev === after.dev && before.ino === after.ino && before.size === after.size && before.mtimeNs === after.mtimeNs && before.ctimeNs === after.ctimeNs;
}

function projectBytes(role: keyof typeof ROLE_ALLOWLIST, relativePath: string, bytes: Buffer, projection?: string): Buffer {
  if (!projection) return bytes;
  if (role !== 'backend' || relativePath !== '.env.production' || projection !== 'backend-env-base') throw new Error('Unknown capsule projection.');
  const excluded = new Set(['BACKUP_BROKER_POLICY_SHA256', 'BACKUP_CAPSULE_GENERATION', 'BACKUP_CAPSULE_SHA256']);
  const seen = new Set<string>();
  const lines = bytes.toString('utf8').split(/\r?\n/).filter((line) => {
    const name = line.slice(0, line.indexOf('='));
    if (!excluded.has(name)) return line.length > 0;
    if (seen.has(name)) throw new Error(`Duplicate derived backend overlay field ${name}.`);
    seen.add(name); return false;
  });
  if (seen.size !== excluded.size) throw new Error('Backend environment is missing a required derived overlay field.');
  return Buffer.from(`${lines.join('\n')}\n`, 'utf8');
}

const chunks: Buffer[] = [];
for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
const input = parseStrictJson(Buffer.concat(chunks), 128 * 1024) as Input;
if (!input || typeof input !== 'object' || !/^[a-z0-9][a-z0-9_-]{0,62}$/.test(input.siteId) || !Number.isSafeInteger(input.compatibilityGeneration)) throw new Error('Producer input identity is invalid.');
for (const path of [input.outputDirectory, input.ageBinary, input.tarBinary, input.policyPrivateKeyFile, input.releaseSigningPrivateKeyFile,
  input.manifestPrivateKeyFile, input.manifestPublicKeyringFile, ...Object.values(input.roleRoots)]) {
  if (typeof path !== 'string' || resolve(path) !== path) throw new Error('Producer paths must be absolute and normalized.');
}
const policyKeyStat = await protectedSingleFile(input.policyPrivateKeyFile, 0o600);
if (Number(policyKeyStat.mode & 0o022n) !== 0) throw new Error('Policy signing key permissions are unsafe.');
await protectedSingleFile(input.releaseSigningPrivateKeyFile, 0o600);
await protectedSingleFile(input.manifestPrivateKeyFile, 0o600);
await protectedSingleFile(input.manifestPublicKeyringFile);
const policyAuthority = createPublicKey(parseCanonicalEd25519PrivateKey(await fs.readFile(input.policyPrivateKeyFile), 'Policy private key')).export({ type: 'spki', format: 'pem' }).toString();
const releaseAuthority = createPublicKey(createPrivateKey(await fs.readFile(input.releaseSigningPrivateKeyFile))).export({ type: 'spki', format: 'pem' }).toString();
const manifestPrivateBytes = await fs.readFile(input.manifestPrivateKeyFile);
const manifestPrivate = manifestPrivateBytes.toString('utf8');
const manifestPublic = createPublicKey(parseCanonicalEd25519PrivateKey(manifestPrivateBytes, 'Manifest private key')).export({ type: 'spki', format: 'pem' }).toString();
const retainedKeyring = parseCanonicalEd25519PublicKeyring(await fs.readFile(input.manifestPublicKeyringFile), 'Manifest keyring');
const retainedActive = retainedKeyring.get(input.manifestKeyId);
if (typeof retainedActive !== 'string' || retainedActive !== manifestPublic) throw new Error('Manifest private key does not match the retained active public keyring entry.');
if (new Set([policyAuthority, releaseAuthority, manifestPublic]).size !== 3) throw new Error('Release, policy, and manifest signing authorities must be distinct.');
await protectedSingleFile(input.ageBinary);
const ageHash = createHash('sha256').update(await fs.readFile(input.ageBinary)).digest('hex');
if (ageHash !== input.ageSha256) throw new Error('Pinned age binary SHA-256 mismatch.');
const ageVersion = (await run(input.ageBinary, ['--version'])).stdout.toString('utf8').trim().replace(/^v/, '');
if (ageVersion !== input.ageVersion) throw new Error('Pinned age binary version mismatch.');
await fs.mkdir(input.outputDirectory, { recursive: false, mode: 0o700 });
const stage = await fs.mkdtemp(join(dirname(input.outputDirectory), '.capsule-stage-'));
const tarPath = join(dirname(input.outputDirectory), `.configuration-${process.pid}.tar`);
const entries: CapsuleInventoryEntry[] = [];
try {
  for (const [role, specifications] of Object.entries(ROLE_ALLOWLIST) as [keyof typeof ROLE_ALLOWLIST, typeof ROLE_ALLOWLIST[keyof typeof ROLE_ALLOWLIST]][]) {
    const roleRoot = input.roleRoots[role];
    if (await fs.realpath(roleRoot) !== roleRoot) throw new Error(`Role root is not canonical: ${role}`);
    for (const [relativePath, sourceMode, restoreMode, maximumBytes, projection] of specifications) {
      if (relativePath.startsWith('/') || relativePath.includes('..') || relativePath.includes('\\')) throw new Error('Unsafe compiled capsule allowlist path.');
      const source = resolve(roleRoot, relativePath);
      if (!source.startsWith(`${roleRoot}${sep}`)) throw new Error('Capsule allowlist escaped its role root.');
      const before = await protectedSingleFile(source, Number.parseInt(sourceMode, 8));
      if (before.size < 1n || before.size > BigInt(maximumBytes)) throw new Error(`Capsule input has invalid size: ${role}/${relativePath}`);
      const sourceBytes = await fs.readFile(source);
      const after = await fs.lstat(source, { bigint: true });
      if (!stable(before, after)) throw new Error(`Capsule input mutated while read: ${role}/${relativePath}`);
      const bytes = projectBytes(role, relativePath, sourceBytes, projection);
      const destination = join(stage, role, relativePath);
      await fs.mkdir(dirname(destination), { recursive: true, mode: 0o700 });
      const handle = await fs.open(destination, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY | fsConstants.O_NOFOLLOW, Number.parseInt(restoreMode, 8));
      try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
      entries.push({ role, path: relativePath, type: 'file', source_mode: sourceMode,
        restore_owner: { uid: 0, gid: 0 }, restore_mode: restoreMode, max_bytes: String(maximumBytes),
        sha256: createHash('sha256').update(bytes).digest('hex') });
    }
  }
  const embeddedManifestPath = EMBEDDED_MANIFEST_SIGNING_KEY.path;
  const embeddedManifestBytes = manifestPrivateBytes;
  const embeddedManifestDestination = join(stage, 'backend', embeddedManifestPath);
  await fs.mkdir(dirname(embeddedManifestDestination), { recursive: true, mode: 0o700 });
  const embeddedManifestHandle = await fs.open(embeddedManifestDestination, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY | fsConstants.O_NOFOLLOW, 0o600);
  try { await embeddedManifestHandle.writeFile(embeddedManifestBytes); await embeddedManifestHandle.sync(); } finally { await embeddedManifestHandle.close(); }
  entries.push({ role: EMBEDDED_MANIFEST_SIGNING_KEY.role, path: embeddedManifestPath, type: 'file', source_mode: EMBEDDED_MANIFEST_SIGNING_KEY.sourceMode, restore_owner: { uid: 0, gid: 0 },
    restore_mode: EMBEDDED_MANIFEST_SIGNING_KEY.restoreMode, max_bytes: String(EMBEDDED_MANIFEST_SIGNING_KEY.maximumBytes), sha256: createHash('sha256').update(embeddedManifestBytes).digest('hex') });
  entries.sort((a, b) => Buffer.compare(Buffer.from(`${a.role}/${a.path}`), Buffer.from(`${b.role}/${b.path}`)));
  const inventoryDocument = validateProductionCapsuleInventory({ format: CAPSULE_INVENTORY_FORMAT, contract_id: PRODUCTION_CAPSULE_CONTRACT_ID, entries });
  const inventoryBytes = capsuleInventoryBytes(inventoryDocument.entries);
  const inventoryHandle = await fs.open(join(stage, CAPSULE_INVENTORY_FILE), fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY | fsConstants.O_NOFOLLOW, 0o600);
  try { await inventoryHandle.writeFile(inventoryBytes); await inventoryHandle.sync(); } finally { await inventoryHandle.close(); }
  await run(input.tarBinary, ['--sort=name', '--mtime=@0', '--owner=0', '--group=0', '--numeric-owner', '--format=pax', '--pax-option=delete=atime,delete=ctime', '-cf', tarPath, '-C', stage, '.']);
  const capsulePath = join(input.outputDirectory, 'configuration.tar.age');
  await run(input.ageBinary, ['--encrypt', '--recipient', input.ageRecipient, '--output', capsulePath, tarPath]);
  await fs.chmod(capsulePath, 0o640);
  const capsule = await fs.readFile(capsulePath);
  const generation = `${input.releaseGeneration}.${input.deploymentGeneration}.configuration-v2`;
  const policy: ConfigurationCapsulePolicy = {
    version: 2, generation, site_id: input.siteId, repository_id: input.repositoryId, created_at: input.createdAt,
    capsule_sha256: createHash('sha256').update(capsule).digest('hex'), capsule_size_bytes: String(capsule.byteLength),
    release_generation: input.releaseGeneration, deployment_generation: input.deploymentGeneration,
    compatibility_generation: input.compatibilityGeneration, age_recipient_key_id: input.ageRecipientKeyId,
    contract_id: PRODUCTION_CAPSULE_CONTRACT_ID, encrypted_inventory_sha256: createHash('sha256').update(inventoryBytes).digest('hex'),
    required_roles: [...REQUIRED_CAPSULE_ROLES],
  };
  const policyPrivate = (await fs.readFile(input.policyPrivateKeyFile)).toString('utf8');
  const signed = signCapsulePolicy({ policy, privateKeyPem: policyPrivate, keyId: input.policyKeyId });
  const policyPublic = createPublicKey(createPrivateKey(policyPrivate)).export({ type: 'spki', format: 'pem' }).toString();
  await fs.writeFile(join(input.outputDirectory, 'capsule-policy.signed.json'), canonicalJson(signed), { mode: 0o640, flag: 'wx' });
  await fs.writeFile(join(input.outputDirectory, 'policy-trust.json'), canonicalJson({ [input.policyKeyId]: policyPublic }), { mode: 0o640, flag: 'wx' });
  await fs.writeFile(join(input.outputDirectory, 'manifest-keyring.json'), canonicalJson(canonicalKeyringObject(retainedKeyring)), { mode: 0o640, flag: 'wx' });
  await fs.writeFile(join(input.outputDirectory, 'manifest-signing.key'), manifestPrivateBytes, { mode: 0o600, flag: 'wx' });
  const overlay = { version: 1, excluded_from_capsule_inventory: true, local_protocol: 'V2_BROKER',
    policy_sha256: createHash('sha256').update(canonicalJson(signed)).digest('hex'), capsule_generation: generation,
    capsule_sha256: policy.capsule_sha256, capsule_size_bytes: policy.capsule_size_bytes };
  await fs.writeFile(join(input.outputDirectory, 'deployment-overlay.json'), canonicalJson(overlay), { mode: 0o640, flag: 'wx' });
  process.stdout.write(JSON.stringify(overlay));
} finally {
  await fs.rm(stage, { recursive: true, force: true });
  await fs.rm(tarPath, { force: true });
}
