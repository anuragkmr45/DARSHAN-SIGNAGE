import { constants as fsConstants, promises as fs } from 'node:fs';
import { dirname, isAbsolute, resolve, sep } from 'node:path';
import { z } from 'zod';
import { canonicalJson, parseStrictJson } from '../backups/backup-broker-protocol';
import { canonicalKeyringObject, parseCanonicalEd25519PublicKeyring } from '../backups/ed25519-public-keyring';
import { RecoveryError } from './errors';

export const RECOVERY_OPERATOR_CONFIG_FORMAT = 'darshan-recovery-operator-config-v1' as const;
export const RECOVERY_OPERATOR_CONFIG_FORMAT_V2 = 'darshan-recovery-operator-config-v2' as const;
export const RECOVERY_OPERATOR_CONFIG_FORMAT_V3 = 'darshan-recovery-operator-config-v3' as const;
const CONFIG_MAX_BYTES = 64 * 1024;
const KEYRING_MAX_BYTES = 1024 * 1024;

const absolutePath = z.string().min(1).max(4096).refine((value) =>
  isAbsolute(value) && resolve(value) === value && !value.endsWith(sep), 'path must be canonical and absolute');
const uuid = z.string().uuid().transform((value) => value.toLowerCase());
const configCommon = {
  site_id: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,62}$/),
  repository: z.object({
    root: absolutePath,
    device_id: z.string().regex(/^(?:0|[1-9][0-9]*)$/),
    owner_uid: z.number().int().nonnegative().safe(),
    owner_gid: z.number().int().nonnegative().safe(),
    repository_id: uuid,
  }).strict(),
  trust: z.object({
    policy_keyring_file: absolutePath,
    manifest_keyring_file: absolutePath,
  }).strict(),
  target: z.object({
    target_id: z.literal('darshan-server-release-01'),
    release_id: z.literal('release-01'),
    migrations_directory: absolutePath,
  }).strict(),
};
const configV1Schema = z.object({ format: z.literal(RECOVERY_OPERATOR_CONFIG_FORMAT), ...configCommon }).strict();
const configV2Schema = z.object({
  format: z.literal(RECOVERY_OPERATOR_CONFIG_FORMAT_V2), ...configCommon,
  broker: z.object({
    socket_path: absolutePath,
    helper_version: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/),
    policy_sha256: z.string().regex(/^[a-f0-9]{64}$/),
    control_timeout_ms: z.number().int().min(1_000).max(240_000).safe(),
  }).strict(),
  journal: z.object({ root: absolutePath }).strict(),
}).strict();
const configV3Schema = z.object({
  format: z.literal(RECOVERY_OPERATOR_CONFIG_FORMAT_V3), ...configCommon,
  broker: configV2Schema.shape.broker,
  journal: configV2Schema.shape.journal,
  target_gateway: z.object({
    relay_socket_path: absolutePath,
    specification_root: absolutePath,
    authorization_root: absolutePath,
    authorization_keyring_file: absolutePath,
    action_deadline_ms: z.number().int().min(1_000).max(240_000).safe(),
  }).strict(),
}).strict();
const configSchema = z.discriminatedUnion('format', [configV1Schema, configV2Schema, configV3Schema]);

export type RecoveryOperatorConfig = z.infer<typeof configSchema>;
export type RecoveryOperatorConfigV3 = z.infer<typeof configV3Schema>;
export type RecoveryOperatorConfigV2 = z.infer<typeof configV2Schema> | RecoveryOperatorConfigV3;

export interface ProtectedOperatorReadHooks {
  afterOpen?(path: string): Promise<void>;
  afterRead?(path: string): Promise<void>;
}

export async function readProtectedOperatorFile(input: {
  path: string;
  maximumBytes: number;
  expectedUid: number;
  expectedGid: number;
  hooks?: ProtectedOperatorReadHooks;
  signal?: AbortSignal;
}): Promise<Buffer> {
  input.signal?.throwIfAborted();
  if (!isAbsolute(input.path) || resolve(input.path) !== input.path || input.path.endsWith(sep)) {
    throw new RecoveryError('RECOVERY_INPUT_UNSAFE', 'Operator input path must be canonical and absolute.');
  }
  let handle: Awaited<ReturnType<typeof fs.open>>;
  try {
    handle = await fs.open(input.path, fsConstants.O_RDONLY | fsConstants.O_NONBLOCK | fsConstants.O_NOFOLLOW);
  } catch (cause) {
    const code = (cause as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') throw new RecoveryError('RECOVERY_INPUT_MISSING', 'Required operator input is missing.', { cause });
    throw new RecoveryError('RECOVERY_INPUT_UNSAFE', 'Operator input could not be opened safely.', { cause });
  }
  const parent = dirname(input.path); let parentBefore; let parentReal;
  try { [parentBefore, parentReal] = await Promise.all([fs.lstat(parent, { bigint: true }), fs.realpath(parent)]); }
  catch (cause) { await handle.close(); throw new RecoveryError('RECOVERY_INPUT_UNSAFE', 'Operator input parent is unavailable.', { cause }); }
  if (parentBefore.isSymbolicLink() || !parentBefore.isDirectory() || Number(parentBefore.uid) !== input.expectedUid ||
      Number(parentBefore.gid) !== input.expectedGid || Number(parentBefore.mode & 0o777n) !== 0o700 || parentReal !== parent) {
    await handle.close(); throw new RecoveryError('RECOVERY_INPUT_UNSAFE', 'Operator input parent must be a canonical owner-only directory.');
  }
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || before.nlink !== 1n || Number(before.uid) !== input.expectedUid ||
        Number(before.gid) !== input.expectedGid || Number(before.mode & 0o777n) !== 0o600 ||
        before.size < 1n || before.size > BigInt(input.maximumBytes)) {
      throw new RecoveryError('RECOVERY_INPUT_UNSAFE', 'Operator input must be a bounded owner-only single-link regular file.');
    }
    if (await fs.realpath(input.path) !== input.path) {
      throw new RecoveryError('RECOVERY_INPUT_UNSAFE', 'Operator input path must not traverse symbolic links.');
    }
    await input.hooks?.afterOpen?.(input.path);
    const expected = Number(before.size); const chunks: Buffer[] = []; let offset = 0;
    while (offset <= expected) {
      input.signal?.throwIfAborted();
      const chunk = Buffer.allocUnsafe(Math.min(64 * 1024, expected + 1 - offset));
      const { bytesRead } = await handle.read(chunk, 0, chunk.byteLength, offset);
      if (bytesRead === 0) break;
      chunks.push(chunk.subarray(0, bytesRead)); offset += bytesRead;
      if (offset > expected) break;
    }
    await input.hooks?.afterRead?.(input.path);
    input.signal?.throwIfAborted();
    let after; let pathname;
    try { [after, pathname] = await Promise.all([handle.stat({ bigint: true }), fs.lstat(input.path, { bigint: true })]); }
    catch (cause) { throw new RecoveryError('RECOVERY_INPUT_UNSAFE', 'Operator input path changed during bounded read.', { cause }); }
    if (offset !== expected || pathname.isSymbolicLink() || pathname.dev !== before.dev || pathname.ino !== before.ino ||
        pathname.nlink !== 1n || after.dev !== before.dev || after.ino !== before.ino || after.nlink !== before.nlink ||
        after.size !== before.size || after.uid !== before.uid || after.gid !== before.gid || after.mode !== before.mode ||
        after.mtimeNs !== before.mtimeNs || after.ctimeNs !== before.ctimeNs) {
      throw new RecoveryError('RECOVERY_INPUT_UNSAFE', 'Operator input changed during bounded read.');
    }
    let parentAfter; let parentRealAfter;
    try { [parentAfter, parentRealAfter] = await Promise.all([fs.lstat(parent, { bigint: true }), fs.realpath(parent)]); }
    catch (cause) { throw new RecoveryError('RECOVERY_INPUT_UNSAFE', 'Operator input parent changed during bounded read.', { cause }); }
    if (parentAfter.isSymbolicLink() || !parentAfter.isDirectory() || parentAfter.dev !== parentBefore.dev ||
        parentAfter.ino !== parentBefore.ino || parentAfter.uid !== parentBefore.uid || parentAfter.gid !== parentBefore.gid ||
        parentAfter.mode !== parentBefore.mode || parentRealAfter !== parent) {
      throw new RecoveryError('RECOVERY_INPUT_UNSAFE', 'Operator input parent changed during bounded read.');
    }
    return Buffer.concat(chunks, expected);
  } finally { await handle.close(); }
}

function parseCanonical<T>(bytes: Buffer, maximumBytes: number, schema: z.ZodType<T>, label: string): T {
  try {
    const parsed = schema.parse(parseStrictJson(bytes, maximumBytes));
    if (!canonicalJson(parsed).equals(bytes)) throw new Error('non-canonical JSON');
    return parsed;
  } catch (cause) {
    throw new RecoveryError('RECOVERY_INPUT_INVALID', `${label} is not strict canonical JSON with the reviewed schema.`, { cause });
  }
}

export async function loadRecoveryOperatorConfig(path: string, options?: {
  expectedUid?: number; expectedGid?: number; hooks?: ProtectedOperatorReadHooks; signal?: AbortSignal;
}): Promise<RecoveryOperatorConfig> {
  const expectedUid = options?.expectedUid ?? process.getuid?.();
  const expectedGid = options?.expectedGid ?? process.getgid?.();
  if (expectedUid === undefined || expectedGid === undefined) {
    throw new RecoveryError('RECOVERY_INPUT_UNSAFE', 'Operator input ownership cannot be established on this platform.');
  }
  return parseCanonical(await readProtectedOperatorFile({ path, maximumBytes: CONFIG_MAX_BYTES,
    expectedUid, expectedGid, hooks: options?.hooks, signal: options?.signal }), CONFIG_MAX_BYTES, configSchema, 'Recovery operator config');
}

export async function loadRecoveryPublicKeyring(path: string, options?: {
  expectedUid?: number; expectedGid?: number; hooks?: ProtectedOperatorReadHooks; signal?: AbortSignal;
}): Promise<{ keys: ReadonlyMap<string, string> }> {
  const expectedUid = options?.expectedUid ?? process.getuid?.();
  const expectedGid = options?.expectedGid ?? process.getgid?.();
  if (expectedUid === undefined || expectedGid === undefined) {
    throw new RecoveryError('RECOVERY_INPUT_UNSAFE', 'Keyring ownership cannot be established on this platform.');
  }
  const bytes = await readProtectedOperatorFile({ path, maximumBytes: KEYRING_MAX_BYTES,
    expectedUid, expectedGid, hooks: options?.hooks, signal: options?.signal });
  try {
    const keys = parseCanonicalEd25519PublicKeyring(bytes, 'Recovery public keyring');
    if (!canonicalJson(canonicalKeyringObject(keys)).equals(bytes)) throw new Error('non-canonical keyring JSON');
    return { keys };
  } catch (cause) {
    throw new RecoveryError('RECOVERY_INPUT_INVALID', 'Recovery public keyring is not canonical retained public-key evidence.', { cause });
  }
}
