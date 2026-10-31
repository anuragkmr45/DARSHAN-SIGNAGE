import { timingSafeEqual } from 'node:crypto';

import { BackupError } from './errors';

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const DECIMAL_PATTERN = /^(0|[1-9][0-9]*)$/;
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const MAX_MANIFEST_BYTES = 1024 * 1024;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SITE_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,62}$/;

function hasControlCharacters(value: string) {
  return [...value].some((character) => character.charCodeAt(0) <= 0x1f || character.charCodeAt(0) === 0x7f);
}

export type BackupArtifactKind = 'DATABASE' | 'OBJECTS' | 'CONFIGURATION' | 'OTHER';

export interface BackupManifestArtifactV1 {
  kind: BackupArtifactKind;
  name: string;
  ciphertextPath: string;
  ciphertextSizeBytes: string;
  ciphertextSha256: string;
}

export interface BackupManifestSignatureEnvelope {
  algorithm: string;
  keyId: string;
  valueBase64: string;
}

export interface BackupManifestV1 {
  /** Version 1 remains readable; brokered publication requires version 2. */
  version: 1 | 2;
  repository: { kind: 'LOCAL_FILESYSTEM'; id: string };
  site: { id: string };
  run: { id: string; attemptId: string };
  capture: {
    id: string;
    generation: string;
    startedAt: string;
    sealedAt: string;
    stagingInventorySha256: string;
  };
  release: { id: string };
  schema: { migrationId: string; fingerprintSha256: string };
  encryption: { keyId: string; tool: { name: 'age'; version: string; executableSha256: string } };
  artifacts: BackupManifestArtifactV1[];
  configurationPolicy?: {
    policySha256: string;
    capsuleGeneration: string;
    encryptedInventorySha256: string;
  };
  /** Null is representable during construction only. Production acceptance must call verifyBackupManifestSignature. */
  signature: BackupManifestSignatureEnvelope | null;
}

export interface BackupManifestSigner {
  readonly algorithm: string;
  readonly keyId: string;
  sign(payload: Uint8Array): Promise<Uint8Array>;
}

export interface BackupManifestVerifier {
  verify(input: {
    algorithm: string;
    keyId: string;
    payload: Uint8Array;
    signature: Uint8Array;
  }): Promise<boolean>;
}

function compareUtf8(left: string, right: string) {
  return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'));
}

function canonicalize(value: unknown, path: string, seen: Set<object>): string {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || Object.is(value, -0)) {
      throw new BackupError('BACKUP_MANIFEST_INVALID', `${path} contains an unsafe JSON number; use a canonical decimal string for quantities.`);
    }
    return String(value);
  }
  if (typeof value !== 'object') {
    throw new BackupError('BACKUP_MANIFEST_INVALID', `${path} contains a value that JSON cannot represent.`);
  }
  if (seen.has(value)) throw new BackupError('BACKUP_MANIFEST_INVALID', `${path} contains a reference cycle.`);
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      const items = value.map((item, index) => {
        if (!Object.prototype.hasOwnProperty.call(value, index)) {
          throw new BackupError('BACKUP_MANIFEST_INVALID', `${path} contains a sparse array.`);
        }
        return canonicalize(item, `${path}[${index}]`, seen);
      });
      return `[${items.join(',')}]`;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new BackupError('BACKUP_MANIFEST_INVALID', `${path} contains a non-plain object.`);
    }
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort(compareUtf8);
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalize(record[key], `${path}.${key}`, seen)}`).join(',')}}`;
  } finally {
    seen.delete(value);
  }
}

export function canonicalJSONStringify(value: unknown): string {
  return canonicalize(value, '$', new Set());
}

class StrictJsonParser {
  private position = 0;

  constructor(private readonly text: string) {}

  parse(): unknown {
    this.skipWhitespace();
    const value = this.parseValue('$');
    this.skipWhitespace();
    if (this.position !== this.text.length) this.fail('Unexpected trailing content.');
    return value;
  }

  private parseValue(path: string): unknown {
    const character = this.text[this.position];
    if (character === '{') return this.parseObject(path);
    if (character === '[') return this.parseArray(path);
    if (character === '"') return this.parseString();
    if (character === '-' || (character >= '0' && character <= '9')) return this.parseNumber(path);
    for (const [literal, value] of [['true', true], ['false', false], ['null', null]] as const) {
      if (this.text.startsWith(literal, this.position)) {
        this.position += literal.length;
        return value;
      }
    }
    this.fail('Expected a JSON value.');
  }

  private parseObject(path: string): Record<string, unknown> {
    this.position++;
    const result: Record<string, unknown> = Object.create(null);
    const names = new Set<string>();
    this.skipWhitespace();
    if (this.text[this.position] === '}') { this.position++; return result; }
    for (;;) {
      if (this.text[this.position] !== '"') this.fail('Expected an object property name.');
      const name = this.parseString();
      if (names.has(name)) {
        throw new BackupError('BACKUP_MANIFEST_DUPLICATE_ENTRY', `${path} contains duplicate property ${JSON.stringify(name)}.`);
      }
      names.add(name);
      this.skipWhitespace();
      if (this.text[this.position++] !== ':') this.fail('Expected a colon after an object property name.');
      this.skipWhitespace();
      result[name] = this.parseValue(`${path}.${name}`);
      this.skipWhitespace();
      const delimiter = this.text[this.position++];
      if (delimiter === '}') return result;
      if (delimiter !== ',') this.fail('Expected a comma or closing brace.');
      this.skipWhitespace();
    }
  }

  private parseArray(path: string): unknown[] {
    this.position++;
    const result: unknown[] = [];
    this.skipWhitespace();
    if (this.text[this.position] === ']') { this.position++; return result; }
    for (;;) {
      result.push(this.parseValue(`${path}[${result.length}]`));
      this.skipWhitespace();
      const delimiter = this.text[this.position++];
      if (delimiter === ']') return result;
      if (delimiter !== ',') this.fail('Expected a comma or closing bracket.');
      this.skipWhitespace();
    }
  }

  private parseString(): string {
    const start = this.position++;
    while (this.position < this.text.length) {
      const character = this.text[this.position++];
      if (character === '"') {
        try { return JSON.parse(this.text.slice(start, this.position)) as string; }
        catch { this.fail('Invalid JSON string.'); }
      }
      if (character === '\\') {
        const escaped = this.text[this.position++];
        if (escaped === 'u') {
          if (!/^[0-9a-fA-F]{4}$/.test(this.text.slice(this.position, this.position + 4))) this.fail('Invalid Unicode escape.');
          this.position += 4;
        } else if (!'"\\/bfnrt'.includes(escaped ?? '')) this.fail('Invalid string escape.');
      } else if (character.charCodeAt(0) <= 0x1f) this.fail('Unescaped control character in string.');
    }
    this.fail('Unterminated JSON string.');
  }

  private parseNumber(path: string): number {
    const remainder = this.text.slice(this.position);
    const match = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/.exec(remainder);
    if (!match) this.fail('Invalid JSON number.');
    this.position += match[0].length;
    const number = Number(match[0]);
    if (!Number.isSafeInteger(number) || Object.is(number, -0) || match[0] !== String(number)) {
      throw new BackupError('BACKUP_MANIFEST_INVALID', `${path} contains an unsafe JSON number; use a canonical decimal string for quantities.`);
    }
    return number;
  }

  private skipWhitespace() {
    while (' \n\r\t'.includes(this.text[this.position] ?? '\0')) this.position++;
  }

  private fail(message: string): never {
    throw new BackupError('BACKUP_MANIFEST_INVALID', `${message} (byte offset ${Buffer.byteLength(this.text.slice(0, this.position), 'utf8')})`);
  }
}

function record(value: unknown, path: string, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(`${path} must be an object.`);
  const result = value as Record<string, unknown>;
  const actual = Object.keys(result).sort(compareUtf8);
  const expected = [...keys].sort(compareUtf8);
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    invalid(`${path} has unknown or missing properties.`);
  }
  return result;
}

function invalid(message: string): never {
  throw new BackupError('BACKUP_MANIFEST_INVALID', message);
}

function text(value: unknown, path: string, maximumBytes = 256): string {
  if (typeof value !== 'string' || value.length === 0 || value.trim() !== value || hasControlCharacters(value)) invalid(`${path} must be a non-empty control-free string without surrounding whitespace.`);
  if (value.normalize('NFC') !== value || Buffer.from(value, 'utf8').toString('utf8') !== value) invalid(`${path} must be well-formed NFC UTF-8.`);
  if (Buffer.byteLength(value, 'utf8') > maximumBytes) invalid(`${path} is too long.`);
  return value;
}

function decimal(value: unknown, path: string): string {
  if (typeof value !== 'string' || !DECIMAL_PATTERN.test(value) || value.length > 40) invalid(`${path} must be a canonical bounded unsigned decimal string.`);
  return value;
}

function sha256(value: unknown, path: string): string {
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) invalid(`${path} must be a lowercase SHA-256 digest.`);
  return value;
}

function uuid(value: unknown, path: string): string {
  const result = text(value, path, 36);
  if (!UUID_PATTERN.test(result)) invalid(`${path} must be an RFC 4122 UUID.`);
  return result.toLowerCase();
}

function timestamp(value: unknown, path: string): string {
  const result = text(value, path, 32);
  if (Number.isNaN(Date.parse(result)) || new Date(result).toISOString() !== result) invalid(`${path} must be a canonical UTC ISO-8601 timestamp.`);
  return result;
}

function safeRelativePath(value: unknown, path: string): string {
  const result = text(value, path, 1024);
  if (result.startsWith('/') || result.includes('\\') || result.split('/').some((part) => part === '' || part === '.' || part === '..')) {
    throw new BackupError('BACKUP_UNSAFE_PATH', `${path} must be a safe normalized relative POSIX path.`);
  }
  return result;
}

function validateArtifact(value: unknown, index: number): BackupManifestArtifactV1 {
  const path = `$.artifacts[${index}]`;
  const item = record(value, path, ['kind', 'name', 'ciphertextPath', 'ciphertextSizeBytes', 'ciphertextSha256']);
  if (!['DATABASE', 'OBJECTS', 'CONFIGURATION', 'OTHER'].includes(String(item.kind))) invalid(`${path}.kind is unsupported.`);
  return {
    kind: item.kind as BackupArtifactKind,
    name: text(item.name, `${path}.name`),
    ciphertextPath: safeRelativePath(item.ciphertextPath, `${path}.ciphertextPath`),
    ciphertextSizeBytes: decimal(item.ciphertextSizeBytes, `${path}.ciphertextSizeBytes`),
    ciphertextSha256: sha256(item.ciphertextSha256, `${path}.ciphertextSha256`),
  };
}

export function validateBackupManifest(value: unknown): BackupManifestV1 {
  const candidateVersion = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>).version : undefined;
  if (candidateVersion !== 1 && candidateVersion !== 2) throw new BackupError('BACKUP_MANIFEST_VERSION_UNSUPPORTED', `Backup manifest version ${String(candidateVersion)} is unsupported.`);
  const input = record(value, '$', ['version', 'repository', 'site', 'run', 'capture', 'release', 'schema', 'encryption', 'artifacts', ...(candidateVersion === 2 ? ['configurationPolicy'] : []), 'signature']);
  const repository = record(input.repository, '$.repository', ['kind', 'id']);
  if (repository.kind !== 'LOCAL_FILESYSTEM') invalid('$.repository.kind is unsupported.');
  const site = record(input.site, '$.site', ['id']);
  const run = record(input.run, '$.run', ['id', 'attemptId']);
  const capture = record(input.capture, '$.capture', [
    'id', 'generation', 'startedAt', 'sealedAt', 'stagingInventorySha256',
  ]);
  const release = record(input.release, '$.release', ['id']);
  const schema = record(input.schema, '$.schema', ['migrationId', 'fingerprintSha256']);
  const encryption = record(input.encryption, '$.encryption', ['keyId', 'tool']);
  const tool = record(encryption.tool, '$.encryption.tool', ['name', 'version', 'executableSha256']);
  if (tool.name !== 'age') invalid('$.encryption.tool.name must be age.');
  if (!Array.isArray(input.artifacts) || input.artifacts.length === 0 || input.artifacts.length > 64) invalid('$.artifacts must contain between 1 and 64 artifacts.');
  const artifacts = input.artifacts.map(validateArtifact);
  const names = new Set<string>();
  const paths = new Set<string>();
  for (const artifact of artifacts) {
    if (names.has(artifact.name) || paths.has(artifact.ciphertextPath)) {
      throw new BackupError('BACKUP_MANIFEST_DUPLICATE_ENTRY', 'Backup manifest artifact names and ciphertext paths must be unique.');
    }
    names.add(artifact.name);
    paths.add(artifact.ciphertextPath);
  }
  let signature: BackupManifestSignatureEnvelope | null = null;
  if (input.signature !== null) {
    const envelope = record(input.signature, '$.signature', ['algorithm', 'keyId', 'valueBase64']);
    const valueBase64 = text(envelope.valueBase64, '$.signature.valueBase64', 16_384);
    if (!BASE64_PATTERN.test(valueBase64)) invalid('$.signature.valueBase64 must be canonical base64.');
    signature = { algorithm: text(envelope.algorithm, '$.signature.algorithm'), keyId: text(envelope.keyId, '$.signature.keyId'), valueBase64 };
  }
  const startedAt = timestamp(capture.startedAt, '$.capture.startedAt');
  const sealedAt = timestamp(capture.sealedAt, '$.capture.sealedAt');
  if (sealedAt < startedAt) invalid('$.capture.sealedAt must not precede startedAt.');
  const siteId = text(site.id, '$.site.id');
  if (!SITE_ID_PATTERN.test(siteId)) invalid('$.site.id must be a canonical site identifier.');
  let configurationPolicy: BackupManifestV1['configurationPolicy'];
  if (candidateVersion === 2) {
    const policy = record(input.configurationPolicy, '$.configurationPolicy', ['policySha256', 'capsuleGeneration', 'encryptedInventorySha256']);
    configurationPolicy = {
      policySha256: sha256(policy.policySha256, '$.configurationPolicy.policySha256'),
      capsuleGeneration: text(policy.capsuleGeneration, '$.configurationPolicy.capsuleGeneration'),
      encryptedInventorySha256: sha256(policy.encryptedInventorySha256, '$.configurationPolicy.encryptedInventorySha256'),
    };
  }
  return {
    version: candidateVersion,
    repository: { kind: 'LOCAL_FILESYSTEM', id: uuid(repository.id, '$.repository.id') },
    site: { id: siteId },
    run: { id: uuid(run.id, '$.run.id'), attemptId: uuid(run.attemptId, '$.run.attemptId') },
    capture: {
      id: uuid(capture.id, '$.capture.id'),
      generation: decimal(capture.generation, '$.capture.generation'),
      startedAt,
      sealedAt,
      stagingInventorySha256: sha256(capture.stagingInventorySha256, '$.capture.stagingInventorySha256'),
    },
    release: { id: text(release.id, '$.release.id') },
    schema: { migrationId: text(schema.migrationId, '$.schema.migrationId'), fingerprintSha256: sha256(schema.fingerprintSha256, '$.schema.fingerprintSha256') },
    encryption: {
      keyId: text(encryption.keyId, '$.encryption.keyId'),
      tool: {
        name: 'age',
        version: text(tool.version, '$.encryption.tool.version'),
        executableSha256: sha256(tool.executableSha256, '$.encryption.tool.executableSha256'),
      },
    },
    artifacts,
    ...(configurationPolicy ? { configurationPolicy } : {}),
    signature,
  };
}

export function parseBackupManifest(input: string | Uint8Array): BackupManifestV1 {
  const bytes = typeof input === 'string' ? Buffer.from(input, 'utf8') : Buffer.from(input);
  if (bytes.length === 0 || bytes.length > MAX_MANIFEST_BYTES) invalid('Backup manifest size is outside the accepted bounds.');
  const source = bytes.toString('utf8');
  if (!Buffer.from(source, 'utf8').equals(bytes) || source.charCodeAt(0) === 0xfeff) invalid('Backup manifest must be unambiguous UTF-8 without a BOM.');
  return validateBackupManifest(new StrictJsonParser(source).parse());
}

export function serializeBackupManifest(manifest: BackupManifestV1): Buffer {
  return Buffer.from(`${canonicalJSONStringify(validateBackupManifest(manifest))}\n`, 'utf8');
}

export function serializeUnsignedBackupManifest(manifest: BackupManifestV1): Buffer {
  return Buffer.from(canonicalJSONStringify({ ...manifest, signature: null }), 'utf8');
}

export async function signBackupManifest(manifest: BackupManifestV1, signer: BackupManifestSigner): Promise<BackupManifestV1> {
  const validated = validateBackupManifest(manifest);
  if (validated.signature !== null) invalid('A manifest must be unsigned before it is signed.');
  const signature = await signer.sign(serializeUnsignedBackupManifest(validated));
  return validateBackupManifest({
    ...validated,
    signature: {
      algorithm: text(signer.algorithm, 'signer.algorithm'),
      keyId: text(signer.keyId, 'signer.keyId'),
      valueBase64: Buffer.from(signature).toString('base64'),
    },
  });
}

export async function verifyBackupManifestSignature(manifest: BackupManifestV1, verifier: BackupManifestVerifier): Promise<void> {
  const validated = validateBackupManifest(manifest);
  if (!validated.signature) {
    throw new BackupError('BACKUP_MANIFEST_SIGNATURE_REQUIRED', 'Unsigned backup manifests are not valid production manifests.');
  }
  const signature = Buffer.from(validated.signature.valueBase64, 'base64');
  const accepted = await verifier.verify({
    algorithm: validated.signature.algorithm,
    keyId: validated.signature.keyId,
    payload: serializeUnsignedBackupManifest(validated),
    signature,
  });
  // Keep a uniform branch shape for local verifiers that return a byte token.
  const decision = Buffer.from([accepted ? 1 : 0]);
  if (!timingSafeEqual(decision, Buffer.from([1]))) {
    throw new BackupError('BACKUP_MANIFEST_SIGNATURE_INVALID', 'Backup manifest signature verification failed.');
  }
}
