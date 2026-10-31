import { promises as fs } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { BackupBrokerService } from './backup-broker-service';
import { parseSignedCapsulePolicy } from './configuration-capsule-policy';
import { openLocalRepository } from './local-repository';
import { BackupBrokerRepositoryAdapter } from './backup-broker-repository-adapter';
import { parseCanonicalEd25519PrivateKey, parseCanonicalEd25519PublicKeyring } from './ed25519-public-keyring';

function required(name: string): string { const value = process.env[name]?.trim(); if (!value) throw new Error(`${name} is required.`); return value; }
function boundedInteger(name: string, minimum: number, maximum = Number.MAX_SAFE_INTEGER): number {
  const text = required(name); if (!/^(?:0|[1-9][0-9]*)$/.test(text)) throw new Error(`${name} must be a canonical decimal integer.`);
  const value = Number(text); if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new Error(`${name} is outside its safe range.`);
  return value;
}
async function protectedFile(path: string, maximumBytes: number): Promise<Buffer> {
  const stat = await fs.lstat(path);
  if (stat.isSymbolicLink() || !stat.isFile() || (stat.mode & 0o022) !== 0 || stat.size === 0 || stat.size > maximumBytes) throw new Error(`${path} is not a protected bounded regular file.`);
  return fs.readFile(path);
}

async function main(): Promise<void> {
  const trustedKeys = parseCanonicalEd25519PublicKeyring(await protectedFile(required('BACKUP_BROKER_POLICY_TRUST_PATH'), 1024 * 1024), 'Policy trust');
  const policy = parseSignedCapsulePolicy(await protectedFile(required('BACKUP_BROKER_POLICY_PATH'), 1024 * 1024), trustedKeys);
  const retainedValue = parseCanonicalEd25519PublicKeyring(await protectedFile(required('BACKUP_BROKER_MANIFEST_KEYRING_PATH'), 1024 * 1024), 'Manifest keyring');
  const activeKeyId = required('BACKUP_BROKER_MANIFEST_ACTIVE_KEY_ID');
  const retained = [...retainedValue].map(([keyId, publicKeyPem]) => ({ keyId, publicKeyPem }));
  const repositoryDeviceId = boundedInteger('BACKUP_REPOSITORY_DEVICE_ID', 1).toString();
  const repositoryOwnerUid = boundedInteger('BACKUP_REPOSITORY_OWNER_UID', 0, 4_294_967_295);
  const repositoryOwnerGid = boundedInteger('BACKUP_REPOSITORY_OWNER_GID', 0, 4_294_967_295);
  const repository = await openLocalRepository({
    root: required('BACKUP_REPOSITORY_ROOT'), expectedDeviceId: repositoryDeviceId,
    ownerUid: repositoryOwnerUid, ownerGid: repositoryOwnerGid,
    minimumFreeBytes: 0, expectedSiteId: policy.policy.site_id,
    expectedRepositoryId: policy.policy.repository_id,
  });
  const encryptedCapsule = await protectedFile(required('BACKUP_BROKER_CAPSULE_PATH'), 16 * 1024 * 1024);
  const spoolRoot = required('BACKUP_BROKER_SPOOL_ROOT');
  const spoolOwnerUid = boundedInteger('BACKUP_BROKER_SPOOL_OWNER_UID', 0, 4_294_967_295);
  const spoolOwnerGid = boundedInteger('BACKUP_BROKER_SPOOL_OWNER_GID', 0, 4_294_967_295);
  if (!isAbsolute(spoolRoot) || resolve(spoolRoot) !== spoolRoot || await fs.realpath(spoolRoot) !== spoolRoot) throw new Error('BACKUP_BROKER_SPOOL_ROOT must be an absolute canonical path without symlinks.');
  const spoolStat = await fs.lstat(spoolRoot, { bigint: true });
  if (spoolStat.isSymbolicLink() || !spoolStat.isDirectory() || Number(spoolStat.uid) !== spoolOwnerUid || Number(spoolStat.gid) !== spoolOwnerGid || Number(spoolStat.mode & 0o777n) !== 0o700) throw new Error('BACKUP_BROKER_SPOOL_ROOT must be a protected directory owned by the configured spool owner.');
  const repositoryAdapter = new BackupBrokerRepositoryAdapter({
    repository, spoolRoot, spoolDeviceId: spoolStat.dev.toString(), spoolOwnerUid, spoolOwnerGid,
    encryptedCapsule, configurationPolicy: policy,
  });
  const service = new BackupBrokerService({
    socketPath: required('BACKUP_BROKER_SOCKET_PATH'), helperVersion: required('BACKUP_BROKER_HELPER_VERSION'), policy,
    recoverySocketPath: process.env.BACKUP_BROKER_RECOVERY_SOCKET_PATH?.trim() || undefined,
    mainListenFd: boundedInteger('BACKUP_BROKER_MAIN_LISTEN_FD', 3, 1024),
    recoveryListenFd: process.env.BACKUP_BROKER_RECOVERY_SOCKET_PATH ? boundedInteger('BACKUP_BROKER_RECOVERY_LISTEN_FD', 3, 1024) : undefined,
    encryptedCapsule, repository, repositoryAdapter, policyTrustKeys: trustedKeys,
    minimumPublicationFreeBytes: boundedInteger('BACKUP_REPOSITORY_MIN_FREE_BYTES', 1),
    activeSigningKey: { keyId: activeKeyId, privateKeyPem: parseCanonicalEd25519PrivateKey(await protectedFile(required('BACKUP_BROKER_MANIFEST_PRIVATE_KEY_PATH'), 16 * 1024), 'Manifest private key').export({ type: 'pkcs8', format: 'pem' }).toString() },
    retainedVerificationKeys: retained, socketMode: 0o660,
    recoverySocketMode: 0o660,
    socketUid: process.env.BACKUP_BROKER_SOCKET_UID ? boundedInteger('BACKUP_BROKER_SOCKET_UID', 0, 4_294_967_295) : undefined,
    socketGid: process.env.BACKUP_BROKER_SOCKET_GID ? boundedInteger('BACKUP_BROKER_SOCKET_GID', 0, 4_294_967_295) : undefined,
  });
  await service.listen();
  const stop = async () => { await service.close(); process.exit(0); };
  process.once('SIGTERM', () => void stop()); process.once('SIGINT', () => void stop());
}

void main().catch((error) => { process.stderr.write(`Backup broker startup failed: ${error instanceof Error ? error.message : String(error)}\n`); process.exit(1); });
