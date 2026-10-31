import { pathToFileURL } from 'node:url';
import { stdin, stdout } from 'node:process';
import { canonicalJson } from '../src/backups/backup-broker-protocol';
import { loadRecoveryPublicKeyring, readProtectedOperatorFile } from '../src/recovery/operator-inputs';
import { RecoveryTargetAuthorizationGateway } from '../src/recovery/target-authorization-envelope';
import { TargetHelperJournal } from '../src/recovery/target-helper-journal';
import { TARGET_HELPER_MAX_REQUEST_BYTES, TARGET_HELPER_MAX_RESPONSE_BYTES,
  TARGET_HELPER_REQUEST_TIMEOUT_MS } from '../src/recovery/target-helper-protocol';
import { RecoveryTargetHelperService, UnavailableRecoveryTargetEngine,
  } from '../src/recovery/target-helper-service';
import { parseRecoveryTargetInstalledIdentity, requireEffectEligibleInstalledIdentity,
  type RecoveryTargetInstalledIdentityV2 } from '../src/recovery/target-storage-authority';

const DEFAULT_ACTION_DEADLINE_MS = 60_000;
function fixedEnvironment(name: string, pattern?: RegExp): string {
  const value = process.env[name];
  if (!value || (pattern && !pattern.test(value))) throw new Error(`missing fixed ${name}`);
  return value;
}

export async function readOneShotTargetFrame(input: NodeJS.ReadableStream = stdin,
  timeoutMs = TARGET_HELPER_REQUEST_TIMEOUT_MS, idleTimeoutMs = DEFAULT_ACTION_DEADLINE_MS): Promise<Buffer> {
  const chunks: Buffer[] = []; let size = 0; let frameTimer: NodeJS.Timeout | undefined;
  const destroy = (message: string) =>
    (input as NodeJS.ReadableStream & { destroy(error?: Error): void }).destroy(new Error(message));
  let idleTimer: NodeJS.Timeout | undefined = setTimeout(() => destroy('idle connection deadline'), idleTimeoutMs);
  const arm = () => {
    if (idleTimer) { clearTimeout(idleTimer); idleTimer = undefined; }
    frameTimer ??= setTimeout(() => destroy('incomplete frame'), timeoutMs);
  };
  try {
    for await (const value of input) {
      const chunk = Buffer.from(value); if (chunk.byteLength === 0) continue; arm();
      size += chunk.byteLength;
      if (size > TARGET_HELPER_MAX_REQUEST_BYTES + 1) throw new Error('oversized frame');
      chunks.push(chunk);
    }
  } finally { if (frameTimer) clearTimeout(frameTimer); if (idleTimer) clearTimeout(idleTimer); }
  const frame = Buffer.concat(chunks, size);
  if (frame.byteLength < 2 || frame.byteLength > TARGET_HELPER_MAX_REQUEST_BYTES + 1 ||
      frame[frame.byteLength - 1] !== 0x0a || frame.includes(0x0d) ||
      frame.subarray(0, -1).includes(0x0a)) throw new Error('invalid frame');
  return frame.subarray(0, -1);
}

export async function runTargetHelperOneShot(input: {
  gateway: { handle(bytes: Uint8Array, execution?: { deadline?: Date; signal?: AbortSignal }): Promise<Buffer> };
  readable?: NodeJS.ReadableStream;
  writable?: NodeJS.WritableStream;
  actionDeadlineMs?: number;
}): Promise<void> {
  const request = await readOneShotTargetFrame(input.readable);
  const deadline = input.actionDeadlineMs ?? DEFAULT_ACTION_DEADLINE_MS;
  if (!Number.isSafeInteger(deadline) || deadline < 1 || deadline > 240_000) throw new Error('invalid action deadline');
  const actionEndsAt = Date.now() + deadline;
  let timer: NodeJS.Timeout | undefined; const controller = new AbortController();
  timer = setTimeout(() => controller.abort(new Error('action deadline')), deadline);
  const response = await input.gateway.handle(request, { deadline: new Date(actionEndsAt), signal: controller.signal })
    .finally(() => { if (timer) clearTimeout(timer); });
  controller.signal.throwIfAborted();
  if (response.byteLength > TARGET_HELPER_MAX_RESPONSE_BYTES || response.includes(0x0a) || response.includes(0x0d)) {
    throw new Error('invalid response frame');
  }
  const writable = input.writable ?? stdout;
  const remaining = actionEndsAt - Date.now(); if (remaining <= 0) throw new Error('response deadline');
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    timer = setTimeout(() => {
      if (settled) return; settled = true;
      (writable as NodeJS.WritableStream & { destroy(error?: Error): void }).destroy(new Error('response deadline'));
      reject(new Error('response deadline'));
    }, remaining);
    writable.write(Buffer.concat([response, Buffer.from('\n')]), (error?: Error | null) => {
      if (settled) return; settled = true; if (timer) clearTimeout(timer);
      if (error) reject(error); else resolve();
    });
  });
  writable.end();
}

export async function createProductionTargetHelperGateway(): Promise<RecoveryTargetAuthorizationGateway> {
  const journalRoot = fixedEnvironment('DARSHAN_TARGET_HELPER_JOURNAL_ROOT');
  const keyringFile = fixedEnvironment('DARSHAN_TARGET_HELPER_KEYRING_FILE');
  const identityFile = fixedEnvironment('DARSHAN_TARGET_HELPER_IDENTITY_FILE');
  const authorityToken = fixedEnvironment('DARSHAN_TARGET_HELPER_INSTANCE_AUTHORITY_TOKEN', /^[a-f0-9]{64}$/);
  const expectedUid = Number(fixedEnvironment('DARSHAN_TARGET_HELPER_UID', /^(?:0|[1-9][0-9]*)$/));
  const expectedGid = Number(fixedEnvironment('DARSHAN_TARGET_HELPER_GID', /^(?:0|[1-9][0-9]*)$/));
  const [keyring, identityBytes] = await Promise.all([
    loadRecoveryPublicKeyring(keyringFile, { expectedUid, expectedGid }),
    readProtectedOperatorFile({ path: identityFile, maximumBytes: 4096, expectedUid, expectedGid }),
  ]);
  const parsed = requireEffectEligibleInstalledIdentity(parseRecoveryTargetInstalledIdentity(identityBytes));
  const expected: RecoveryTargetInstalledIdentityV2 = {
    format: 'darshan-recovery-target-helper-installation-v2',
    siteId: fixedEnvironment('DARSHAN_TARGET_HELPER_SITE_ID'),
    hostInstallationId: fixedEnvironment('DARSHAN_TARGET_HELPER_INSTALLATION_ID'),
    hostPolicySha256: fixedEnvironment('DARSHAN_TARGET_HELPER_POLICY_SHA256', /^[a-f0-9]{64}$/),
    helperRoleSha256: fixedEnvironment('DARSHAN_TARGET_HELPER_ROLE_SHA256', /^[a-f0-9]{64}$/),
    engineProfileSha256: fixedEnvironment('DARSHAN_TARGET_HELPER_ENGINE_PROFILE_SHA256', /^[a-f0-9]{64}$/),
    specificationRootSha256: fixedEnvironment('DARSHAN_TARGET_HELPER_SPECIFICATION_ROOT_SHA256', /^[a-f0-9]{64}$/),
    evidenceRootSha256: fixedEnvironment('DARSHAN_TARGET_HELPER_EVIDENCE_ROOT_SHA256', /^[a-f0-9]{64}$/),
    allocationLedgerRootSha256: fixedEnvironment('DARSHAN_TARGET_HELPER_ALLOCATION_LEDGER_ROOT_SHA256', /^[a-f0-9]{64}$/),
    allocationControlRootSha256: fixedEnvironment('DARSHAN_TARGET_HELPER_ALLOCATION_CONTROL_ROOT_SHA256', /^[a-f0-9]{64}$/),
    activeRootSha256: fixedEnvironment('DARSHAN_TARGET_HELPER_ACTIVE_ROOT_SHA256', /^[a-f0-9]{64}$/),
    quarantineRootSha256: fixedEnvironment('DARSHAN_TARGET_HELPER_QUARANTINE_ROOT_SHA256', /^[a-f0-9]{64}$/),
    poolRootSha256: fixedEnvironment('DARSHAN_TARGET_HELPER_POOL_ROOT_SHA256', /^[a-f0-9]{64}$/),
    storageAuthorityIdentitySha256: fixedEnvironment('DARSHAN_TARGET_HELPER_STORAGE_AUTHORITY_SHA256', /^[a-f0-9]{64}$/),
    hostMode: fixedEnvironment('DARSHAN_TARGET_HELPER_HOST_MODE', /^(?:SINGLE_HOST|SPLIT_HOST)$/) as 'SINGLE_HOST' | 'SPLIT_HOST',
  };
  if (!canonicalJson(parsed).equals(canonicalJson(expected))) {
    throw new Error('installed identity differs from native authority');
  }
  const journal = new TargetHelperJournal({ root: journalRoot, expectedUid, expectedGid,
    instanceAuthorityToken: authorityToken, requireInstanceAuthority: true });
  const service = new RecoveryTargetHelperService({ journal, engine: new UnavailableRecoveryTargetEngine(), authorize: () => undefined });
  return new RecoveryTargetAuthorizationGateway({ service, keys: keyring.keys, installedIdentity: parsed });
}

async function main(): Promise<void> {
  try {
    await runTargetHelperOneShot({ gateway: await createProductionTargetHelperGateway(),
      actionDeadlineMs: Number(process.env.DARSHAN_TARGET_HELPER_ACTION_DEADLINE_MS ?? DEFAULT_ACTION_DEADLINE_MS) });
  } catch {
    process.stderr.write('target-helper-worker: request failed\n');
    process.exitCode = 78;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main();
