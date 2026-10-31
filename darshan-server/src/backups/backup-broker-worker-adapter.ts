import { createHash, createPublicKey, randomUUID, verify } from 'node:crypto';
import { constants as fsConstants, promises as fs } from 'node:fs';
import { dirname, isAbsolute, join, parse, resolve } from 'node:path';
import { z } from 'zod';
import { BackupBrokerClient, BackupBrokerClientError } from './backup-broker-client';
import { canonicalJson, parseStrictJson, type BrokerPublicationEvidence } from './backup-broker-protocol';
import { signedCapsulePolicySchema } from './configuration-capsule-policy';
import { parseBackupManifest, serializeBackupManifest, serializeUnsignedBackupManifest, type BackupManifestV1 } from './manifest';
import { parseCanonicalEd25519PublicKeyring } from './ed25519-public-keyring';

const mutationRequestSchema = z.object({ request_id: z.string().uuid(), deadline: z.string().datetime({ offset: true }) }).strict();
const requestIdsSchema = z.object({
  version: z.literal(1), attempt_deadline: z.string().datetime({ offset: true }),
  PREPARE_PUBLICATION: mutationRequestSchema, COMMIT_PUBLICATION: mutationRequestSchema, QUARANTINE_PUBLICATION: mutationRequestSchema,
}).strict();

export interface BrokerAttemptIdentity {
  runId: string; attemptId: string; captureId: string; captureGeneration: number; deadlineAt: Date;
}

export interface BrokerLifecycleIdentity {
  runId: string;
  attemptId: string;
  captureId: string;
  captureGeneration: number;
  manifestSha256: string;
  operationId: string;
  ownerToken: string;
  fenceToken: string;
}

export type BrokerRetentionTruth = Extract<Awaited<ReturnType<BackupBrokerClient['request']>>, { operation: 'INSPECT_RETENTION_TRUTH' }>;
export type BrokerRestoreHoldInspection = Awaited<ReturnType<BackupBrokerClient['inspectRestoreHold']>>;
export type BrokerDeletionResult = Extract<Awaited<ReturnType<BackupBrokerClient['request']>>, {
  operation: 'CLAIM_RUN_DELETION' | 'EXECUTE_RUN_DELETION' | 'RECONCILE_RUN_DELETION';
}>;

function digest(bytes: Uint8Array): string { return createHash('sha256').update(bytes).digest('hex'); }
function requestFields(identity: BrokerAttemptIdentity) {
  return { run_id: identity.runId, attempt_id: identity.attemptId, capture_id: identity.captureId, capture_generation: identity.captureGeneration };
}
function lifecycleRequestFields(identity: BrokerLifecycleIdentity) {
  return {
    run_id: identity.runId,
    attempt_id: identity.attemptId,
    capture_id: identity.captureId,
    capture_generation: identity.captureGeneration,
    manifest_sha256: identity.manifestSha256,
    operation_id: identity.operationId,
    owner_token: identity.ownerToken,
    fence_token: identity.fenceToken,
  };
}
function controlDeadline(authority: Date): string {
  const deadline = Math.min(authority.getTime(), Date.now() + 59_000);
  if (!Number.isFinite(deadline) || deadline <= Date.now()) throw new BackupBrokerClientError('BROKER_AUTHORITY_EXPIRED', 'Backup attempt deadline has expired.');
  return new Date(deadline).toISOString();
}

function inspectionDeadline(): string {
  return new Date(Date.now() + 59_000).toISOString();
}

function mutationDeadline(): string {
  return new Date(Date.now() + (4 * 60 * 60 * 1_000) - 1_000).toISOString();
}

async function protectedKeyring(path: string): Promise<ReadonlyMap<string, string>> {
  if (await fs.realpath(path) !== path) throw new BackupBrokerClientError('BROKER_KEYRING_UNTRUSTED', 'Manifest public keyring path is not canonical.');
  let parent = dirname(path);
  for (;;) {
    const directory = await fs.lstat(parent, { bigint: true });
    const runtimeUid = typeof process.getuid === 'function' ? process.getuid() : Number(directory.uid);
    if (directory.isSymbolicLink() || !directory.isDirectory() || ![0, runtimeUid].includes(Number(directory.uid)) || Number(directory.mode & 0o022n) !== 0) {
      throw new BackupBrokerClientError('BROKER_KEYRING_UNTRUSTED', 'Manifest public keyring parent chain is not protected.');
    }
    if (parent === parse(parent).root) break;
    parent = dirname(parent);
  }
  const stat = await fs.lstat(path, { bigint: true });
  const runtimeUid = typeof process.getuid === 'function' ? process.getuid() : Number(stat.uid);
  if (stat.isSymbolicLink() || !stat.isFile() || stat.nlink !== 1n || ![0, runtimeUid].includes(Number(stat.uid)) ||
      Number(stat.mode & 0o022n) !== 0 || stat.size < 1n || stat.size > 1024n * 1024n) {
    throw new BackupBrokerClientError('BROKER_KEYRING_UNTRUSTED', 'Manifest public keyring is not a protected bounded regular file.');
  }
  try { return parseCanonicalEd25519PublicKeyring(await fs.readFile(path), 'Manifest keyring'); }
  catch { throw new BackupBrokerClientError('BROKER_KEYRING_UNTRUSTED', 'Manifest public keyring contains an invalid key.'); }
}

export async function persistedBrokerRequestIds(root: string, deadlineAt: Date): Promise<z.infer<typeof requestIdsSchema>> {
  if (!Number.isFinite(deadlineAt.getTime()) || deadlineAt.getTime() <= Date.now()) throw new BackupBrokerClientError('BROKER_AUTHORITY_EXPIRED', 'Backup attempt deadline has expired.');
  const deadline = deadlineAt.toISOString();
  const path = join(root, 'broker-request-ids.json');
  try {
    const stat = await fs.lstat(path, { bigint: true });
    if (stat.isSymbolicLink() || !stat.isFile() || Number(stat.mode & 0o777n) !== 0o600 || stat.nlink !== 1n || stat.size > 4096n) throw new Error('Unsafe broker request-id file.');
    const persisted = requestIdsSchema.parse(parseStrictJson(await fs.readFile(path), 4096));
    if (persisted.attempt_deadline !== deadline || Object.values(persisted).some((value) => typeof value === 'object' && value.deadline !== deadline)) {
      throw new BackupBrokerClientError('BROKER_MUTATION_REPLAY_CONFLICT', 'Persisted broker mutation authority does not match the claimed attempt deadline.');
    }
    return persisted;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const operation = () => ({ request_id: randomUUID(), deadline });
  const created = requestIdsSchema.parse({ version: 1, attempt_deadline: deadline,
    PREPARE_PUBLICATION: operation(), COMMIT_PUBLICATION: operation(), QUARANTINE_PUBLICATION: operation() });
  const handle = await fs.open(path, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY | fsConstants.O_NOFOLLOW, 0o600);
  try { await handle.writeFile(canonicalJson(created)); await handle.sync(); } finally { await handle.close(); }
  const parent = await fs.open(root, fsConstants.O_RDONLY | fsConstants.O_DIRECTORY);
  try { await parent.sync(); } finally { await parent.close(); }
  return created;
}

export class BackupBrokerWorkerAdapter {
  private constructor(
    private readonly client: BackupBrokerClient,
    private readonly keys: ReadonlyMap<string, string>,
    readonly capability: Awaited<ReturnType<BackupBrokerClient['describe']>>,
  ) {}

  static async create(input: {
    socketPath: string; helperVersion: string; policySha256: string; siteId: string; repositoryId: string;
    keyringPath: string; expectedRelease: string; expectedDeployment: string; expectedCompatibility: number;
    expectedAgeKeyId: string; expectedCapsuleGeneration: string; expectedCapsuleSha256: string;
    signal?: AbortSignal;
  }): Promise<BackupBrokerWorkerAdapter> {
    if (!isAbsolute(input.socketPath) || resolve(input.socketPath) !== input.socketPath ||
        !isAbsolute(input.keyringPath) || resolve(input.keyringPath) !== input.keyringPath) {
      throw new BackupBrokerClientError('BROKER_RUNTIME_PATH_INVALID', 'Broker socket and verification keyring paths must be absolute and normalized.');
    }
    const keys = await protectedKeyring(input.keyringPath);
    const client = new BackupBrokerClient({ socketPath: input.socketPath, helperVersion: input.helperVersion, policySha256: input.policySha256, siteId: input.siteId, repositoryId: input.repositoryId });
    const capability = await client.describe(input.signal);
    if (!capability.capabilities.durable_publication || capability.site_id !== input.siteId || capability.repository_id !== input.repositoryId ||
        capability.release_generation !== input.expectedRelease || capability.deployment_generation !== input.expectedDeployment ||
        capability.compatibility_generation !== input.expectedCompatibility || capability.age_recipient_key_id !== input.expectedAgeKeyId ||
        capability.capsule_generation !== input.expectedCapsuleGeneration || capability.capsule_sha256 !== input.expectedCapsuleSha256) {
      throw new BackupBrokerClientError('BROKER_CAPABILITY_MISMATCH', 'Backup broker capability does not match immutable worker policy.');
    }
    const described = new Map(capability.manifest_verification_keys.map((key) => [key.key_id, key.public_key_pem]));
    if (described.size !== keys.size || [...keys].some(([id, pem]) => described.get(id) !== pem) || capability.manifest_verification_keys.filter((key) => key.active).length !== 1) {
      throw new BackupBrokerClientError('BROKER_KEYRING_MISMATCH', 'Backup broker verification keys do not match the protected worker keyring.');
    }
    return new BackupBrokerWorkerAdapter(client, keys, capability);
  }

  verifySignature(payload: Uint8Array, keyId: string, signatureBase64: string): boolean {
    const pem = this.keys.get(keyId); return Boolean(pem && verify(null, payload, createPublicKey(pem), Buffer.from(signatureBase64, 'base64')));
  }

  async selectCapsule(identity: BrokerAttemptIdentity, signal: AbortSignal): Promise<Buffer> {
    const response = await this.client.request({ operation: 'SELECT_CAPSULE', ...requestFields(identity),
      expected_capsule_generation: this.capability.capsule_generation, expected_capsule_sha256: this.capability.capsule_sha256,
      deadline: controlDeadline(identity.deadlineAt) }, signal);
    if (response.operation !== 'SELECT_CAPSULE') throw new BackupBrokerClientError('BROKER_OPERATION_MISMATCH', 'Expected SELECT_CAPSULE response.');
    const capsule = Buffer.from(response.capsule_base64, 'base64');
    const marker = parseStrictJson(Buffer.from(response.active_marker), 16_384) as Record<string, unknown>;
    if (capsule.toString('base64') !== response.capsule_base64 || capsule.byteLength.toString() !== this.capability.capsule_size_bytes ||
        digest(capsule) !== response.capsule_sha256 || response.capsule_sha256 !== this.capability.capsule_sha256 ||
        response.capsule_generation !== this.capability.capsule_generation || marker.capsule_generation !== response.capsule_generation ||
        marker.capsule_sha256 !== response.capsule_sha256 || marker.site_id !== this.capability.site_id ||
        marker.repository_id !== this.capability.repository_id ||
        !this.verifySignature(Buffer.from(response.active_marker), response.key_id, response.active_marker_signature_base64)) {
      throw new BackupBrokerClientError('BROKER_CAPSULE_EVIDENCE_INVALID', 'Selected configuration capsule evidence is invalid.');
    }
    return capsule;
  }

  async prepare(input: { identity: BrokerAttemptIdentity; attemptRoot: string; unsignedManifest: BackupManifestV1; signal: AbortSignal }) {
    const ids = await persistedBrokerRequestIds(input.attemptRoot, input.identity.deadlineAt);
    const bytes = serializeUnsignedBackupManifest(input.unsignedManifest); const unsignedSha256 = digest(bytes);
    const response = await this.client.request({ operation: 'PREPARE_PUBLICATION', ...requestFields(input.identity),
      expected_capsule_generation: this.capability.capsule_generation, unsigned_manifest_sha256: unsignedSha256,
      manifest_base64: bytes.toString('base64'), request_id: ids.PREPARE_PUBLICATION.request_id, deadline: ids.PREPARE_PUBLICATION.deadline }, input.signal);
    if (response.operation !== 'PREPARE_PUBLICATION' || response.unsigned_manifest_sha256 !== unsignedSha256 ||
        !this.verifySignature(bytes, response.key_id, response.signature_base64)) {
      throw new BackupBrokerClientError('BROKER_PREPARE_EVIDENCE_INVALID', 'Broker PREPARE signature or digest is invalid.');
    }
    const signedManifest = parseBackupManifest(serializeBackupManifest({ ...input.unsignedManifest, signature: {
      algorithm: response.algorithm, keyId: response.key_id, valueBase64: response.signature_base64,
    }}));
    const signedBytes = serializeBackupManifest(signedManifest);
    if (digest(signedBytes) !== response.signed_manifest_sha256) throw new BackupBrokerClientError('BROKER_PREPARE_EVIDENCE_INVALID', 'Broker signed-manifest digest is invalid.');
    const expectedIncomplete = new RegExp(`^incomplete/${input.identity.runId.toLowerCase()}\\.${input.identity.attemptId.toLowerCase()}\\.[a-f0-9]{32}$`);
    if (!expectedIncomplete.test(response.incomplete_relative_path) || response.published_relative_path !== `runs/${input.identity.runId.toLowerCase()}`) {
      throw new BackupBrokerClientError('BROKER_PREPARE_EVIDENCE_INVALID', 'Broker PREPARE publication paths are not bound to the attempt identity.');
    }
    return { signedManifest, signedBytes, unsignedSha256, signedSha256: response.signed_manifest_sha256,
      incompleteRelativePath: response.incomplete_relative_path, publishedRelativePath: response.published_relative_path };
  }

  validateEvidence(evidence: BrokerPublicationEvidence, identity: BrokerAttemptIdentity, signedBytes: Uint8Array): void {
    const manifest = parseBackupManifest(signedBytes); const manifestSha256 = digest(signedBytes);
    if (!manifest.signature || manifest.signature.algorithm !== 'Ed25519' ||
        !this.verifySignature(serializeUnsignedBackupManifest(manifest), manifest.signature.keyId, manifest.signature.valueBase64)) {
      throw new BackupBrokerClientError('BROKER_PUBLICATION_EVIDENCE_INVALID', 'Published manifest signature is not valid under the protected worker keyring.');
    }
    const policyBytes = Buffer.from(evidence.canonical_signed_configuration_policy_base64, 'base64');
    let policyDocument;
    try { policyDocument = signedCapsulePolicySchema.parse(parseStrictJson(policyBytes, 1024 * 1024)); }
    catch { throw new BackupBrokerClientError('BROKER_PUBLICATION_EVIDENCE_INVALID', 'Published configuration policy is malformed.'); }
    const policyBinding = manifest.configurationPolicy;
    if (policyBytes.toString('base64') !== evidence.canonical_signed_configuration_policy_base64 ||
        !policyBytes.equals(canonicalJson(policyDocument)) || digest(policyBytes) !== evidence.configuration_policy_sha256 ||
        evidence.configuration_policy_sha256 !== this.capability.policy_sha256 || !policyBinding ||
        policyBinding.policySha256 !== evidence.configuration_policy_sha256 ||
        policyBinding.capsuleGeneration !== evidence.capsule_generation ||
        policyBinding.encryptedInventorySha256 !== evidence.encrypted_inventory_sha256 ||
        policyDocument.policy.generation !== evidence.capsule_generation ||
        policyDocument.policy.encrypted_inventory_sha256 !== evidence.encrypted_inventory_sha256 ||
        policyDocument.policy.site_id !== this.capability.site_id || policyDocument.policy.repository_id !== this.capability.repository_id ||
        policyDocument.policy.contract_id !== this.capability.contract_id) {
      throw new BackupBrokerClientError('BROKER_PUBLICATION_EVIDENCE_INVALID', 'Published configuration policy evidence is not bound to the signed manifest and broker capability.');
    }
    const expected = [identity.runId, identity.attemptId, identity.captureId, identity.captureGeneration] as const;
    for (const row of [evidence.intent, evidence.receipt]) {
      if (row.repository_id !== manifest.repository.id || row.site_id !== manifest.site.id || row.run_id !== expected[0] || row.attempt_id !== expected[1] ||
          row.capture_id !== expected[2] || row.capture_generation !== expected[3] || row.manifest_sha256 !== manifestSha256) throw new BackupBrokerClientError('BROKER_PUBLICATION_EVIDENCE_INVALID', 'Publication evidence identity or digest is invalid.');
    }
    const sealedAt = Date.parse(manifest.capture.sealedAt);
    const createdAt = Date.parse(evidence.intent.created_at);
    const publishedAt = Date.parse(evidence.receipt.published_at);
    const verifiedAt = Date.parse(evidence.receipt.verified_at);
    if (![sealedAt, createdAt, publishedAt, verifiedAt].every(Number.isFinite) ||
        evidence.canonical_signed_manifest_base64 !== Buffer.from(signedBytes).toString('base64') ||
        evidence.run_relative_path !== `runs/${identity.runId.toLowerCase()}` ||
        evidence.manifest_relative_path !== `runs/${identity.runId.toLowerCase()}/manifest.json` ||
        evidence.configuration_policy_relative_path !== `runs/${identity.runId.toLowerCase()}/configuration-policy.json` ||
        publishedAt > identity.deadlineAt.getTime() || createdAt < sealedAt || createdAt > publishedAt || verifiedAt < publishedAt) {
      throw new BackupBrokerClientError('BROKER_PUBLICATION_EVIDENCE_INVALID', 'Publication evidence bytes or deadline is invalid.');
    }
    const expectedArtifacts = new Map(manifest.artifacts.map((artifact) => [artifact.ciphertextPath, {
      size: artifact.ciphertextSizeBytes, sha256: artifact.ciphertextSha256,
    }]));
    const seenArtifacts = new Set<string>();
    if (expectedArtifacts.size !== 3 || evidence.intent.artifacts.length !== 3 || evidence.intent.artifacts.some((artifact) => {
      const expectedArtifact = expectedArtifacts.get(artifact.path);
      if (seenArtifacts.has(artifact.path)) return true;
      seenArtifacts.add(artifact.path);
      return !expectedArtifact || expectedArtifact.size !== artifact.size || expectedArtifact.sha256 !== artifact.sha256;
    }) || [...expectedArtifacts.keys()].some((path) => !seenArtifacts.has(path))) {
      throw new BackupBrokerClientError('BROKER_PUBLICATION_EVIDENCE_INVALID', 'Publication evidence artifact set does not match the signed manifest.');
    }
  }

  async commit(input: { identity: BrokerAttemptIdentity; attemptRoot: string; unsignedSha256: string; signedSha256: string; signedBytes: Uint8Array; signal: AbortSignal }) {
    const ids = await persistedBrokerRequestIds(input.attemptRoot, input.identity.deadlineAt);
    const response = await this.client.request({ operation: 'COMMIT_PUBLICATION', ...requestFields(input.identity), unsigned_manifest_sha256: input.unsignedSha256,
      signed_manifest_sha256: input.signedSha256, request_id: ids.COMMIT_PUBLICATION.request_id, deadline: ids.COMMIT_PUBLICATION.deadline }, input.signal);
    if (response.operation !== 'COMMIT_PUBLICATION' || response.unsigned_manifest_sha256 !== input.unsignedSha256 || response.signed_manifest_sha256 !== input.signedSha256) {
      throw new BackupBrokerClientError('BROKER_COMMIT_EVIDENCE_INVALID', 'Broker COMMIT digest is invalid.');
    }
    this.validateEvidence(response.evidence, input.identity, input.signedBytes); return response.evidence;
  }

  async inspect(identity: BrokerAttemptIdentity, signedSha256?: string, signal?: AbortSignal) {
    const response = await this.client.request({ operation: 'INSPECT_PUBLICATION', ...requestFields(identity), ...(signedSha256 ? { signed_manifest_sha256: signedSha256 } : {}), deadline: inspectionDeadline() }, signal);
    if (response.operation !== 'INSPECT_PUBLICATION') throw new BackupBrokerClientError('BROKER_OPERATION_MISMATCH', 'Expected INSPECT_PUBLICATION response.');
    return response;
  }

  async inspectRetentionTruth(identity: BrokerLifecycleIdentity, signal?: AbortSignal): Promise<BrokerRetentionTruth> {
    const response = await this.client.request({ operation: 'INSPECT_RETENTION_TRUTH', ...lifecycleRequestFields(identity),
      deadline: inspectionDeadline() }, signal);
    if (response.operation !== 'INSPECT_RETENTION_TRUTH' || response.manifest_sha256 !== identity.manifestSha256) {
      throw new BackupBrokerClientError('BROKER_RETENTION_EVIDENCE_MISMATCH', 'Broker retention truth does not match the requested lifecycle identity.');
    }
    return response;
  }

  inspectRestoreHold(identity: BrokerLifecycleIdentity, signal?: AbortSignal): Promise<BrokerRestoreHoldInspection> {
    return this.client.inspectRestoreHold({ ...lifecycleRequestFields(identity), deadline: inspectionDeadline() }, signal);
  }

  private async deletionRequest(operation: 'CLAIM_RUN_DELETION' | 'EXECUTE_RUN_DELETION' | 'RECONCILE_RUN_DELETION',
    identity: BrokerLifecycleIdentity, signal?: AbortSignal): Promise<BrokerDeletionResult> {
    const response = await this.client.request({ operation, ...lifecycleRequestFields(identity), deadline: mutationDeadline() }, signal);
    if (response.operation !== operation || response.operation_id !== identity.operationId ||
        response.deleted_entries > response.total_entries || response.artifacts.length !== response.total_entries ||
        response.artifacts.filter((artifact) => artifact.status === 'DELETED').length !== response.deleted_entries) {
      throw new BackupBrokerClientError('BROKER_RETENTION_EVIDENCE_MISMATCH', 'Broker deletion response identity or progress is invalid.');
    }
    return response;
  }

  claimRunDeletion(identity: BrokerLifecycleIdentity, signal?: AbortSignal): Promise<BrokerDeletionResult> {
    return this.deletionRequest('CLAIM_RUN_DELETION', identity, signal);
  }

  executeRunDeletion(identity: BrokerLifecycleIdentity, signal?: AbortSignal): Promise<BrokerDeletionResult> {
    return this.deletionRequest('EXECUTE_RUN_DELETION', identity, signal);
  }

  reconcileRunDeletion(identity: BrokerLifecycleIdentity, signal?: AbortSignal): Promise<BrokerDeletionResult> {
    return this.deletionRequest('RECONCILE_RUN_DELETION', identity, signal);
  }

  async cleanupStaging(identity: BrokerLifecycleIdentity, signal?: AbortSignal): Promise<'CLEANED' | 'ABSENT'> {
    const response = await this.client.request({ operation: 'CLEANUP_STAGING', ...lifecycleRequestFields(identity), deadline: mutationDeadline() }, signal);
    if (response.operation !== 'CLEANUP_STAGING' || response.operation_id !== identity.operationId) {
      throw new BackupBrokerClientError('BROKER_RETENTION_EVIDENCE_MISMATCH', 'Broker staging-cleanup response identity is invalid.');
    }
    return response.status;
  }
}
