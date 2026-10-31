import { createPublicKey, randomUUID, verify } from 'node:crypto';
import { createConnection } from 'node:net';
import {
  BACKUP_BROKER_MAX_RESPONSE_BYTES, BACKUP_BROKER_PROTOCOL_VERSION, backupBrokerResponseSchema,
  canonicalJson, parseStrictJson, type BackupBrokerRequest, type BackupBrokerResponse,
} from './backup-broker-protocol';

export class BackupBrokerClientError extends Error {
  constructor(public readonly code: string, message: string, public readonly retryable = false,
    public readonly dispatched = false, public readonly authoritativeResponse = false) { super(message); this.name = 'BackupBrokerClientError'; }
}

export interface BackupBrokerClientOptions {
  socketPath: string; helperVersion: string; policySha256: string; siteId: string; repositoryId: string;
  controlTimeoutMs?: number;
}

export type BackupBrokerClientRequest<T = BackupBrokerRequest> = T extends BackupBrokerRequest
  ? Omit<T, 'protocol_version' | 'request_id' | 'helper_version' | 'policy_sha256' | 'site_id' | 'repository_id' | 'deadline'> & {
      request_id?: string;
      deadline?: string;
    }
  : never;

export class BackupBrokerClient {
  constructor(private readonly options: BackupBrokerClientOptions) {}

  async request(request: BackupBrokerClientRequest, signal?: AbortSignal): Promise<BackupBrokerResponse> {
    signal?.throwIfAborted();
    const defaultTimeout = this.options.controlTimeoutMs ?? 60_000;
    const callerDeadline = request.deadline ? Date.parse(request.deadline) : undefined;
    const timeout = callerDeadline === undefined ? defaultTimeout : callerDeadline - Date.now();
    if (!Number.isFinite(timeout) || timeout <= 0 || timeout > 4 * 60 * 60 * 1000) throw new BackupBrokerClientError('BROKER_DEADLINE_INVALID', 'Caller deadline is outside the supported future four-hour window.');
    const full = {
      ...request, protocol_version: BACKUP_BROKER_PROTOCOL_VERSION, request_id: request.request_id ?? randomUUID(),
      helper_version: this.options.helperVersion, policy_sha256: this.options.policySha256,
      site_id: this.options.siteId, repository_id: this.options.repositoryId,
      deadline: request.deadline ?? new Date(Date.now() + Math.min(defaultTimeout, 59_000)).toISOString(),
    } as BackupBrokerRequest;
    const encoded = canonicalJson(full);
    return new Promise<BackupBrokerResponse>((resolve, reject) => {
      const socket = createConnection(this.options.socketPath); const chunks: Buffer[] = []; let bytes = 0; let settled = false; let dispatched = false;
      const finish = (error?: unknown, response?: BackupBrokerResponse) => { if (settled) return; settled = true; cleanup(); socket.destroy(); error ? reject(error) : resolve(response!); };
      const abort = () => finish(new BackupBrokerClientError('BROKER_ABORTED', 'Backup broker request was aborted.', true, dispatched));
      const timer = setTimeout(() => finish(new BackupBrokerClientError('BROKER_TIMEOUT', 'Backup broker request timed out.', true, dispatched)), timeout);
      const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); };
      signal?.addEventListener('abort', abort, { once: true });
      socket.once('connect', () => { socket.end(encoded); dispatched = true; });
      socket.once('error', () => finish(new BackupBrokerClientError('BROKER_CONNECTION_FAILED',
        'Backup broker connection failed.', true, dispatched)));
      socket.once('close', (hadError) => { if (!settled && !hadError) finish(new BackupBrokerClientError('BROKER_CONNECTION_CLOSED', 'Backup broker closed before a complete response.', true, dispatched)); });
      socket.on('data', (chunk: Buffer) => { bytes += chunk.length; if (bytes > BACKUP_BROKER_MAX_RESPONSE_BYTES) return finish(new BackupBrokerClientError('BROKER_RESPONSE_TOO_LARGE', 'Backup broker response exceeded the bound.', false, dispatched)); chunks.push(chunk); });
      socket.once('end', () => {
        try {
          const parsed = backupBrokerResponseSchema.parse(parseStrictJson(Buffer.concat(chunks), BACKUP_BROKER_MAX_RESPONSE_BYTES));
          if (parsed.request_id !== full.request_id || parsed.helper_version !== this.options.helperVersion || parsed.policy_sha256 !== this.options.policySha256) throw new BackupBrokerClientError('BROKER_RESPONSE_IDENTITY_MISMATCH', 'Backup broker response identity does not match the request.', false, dispatched);
          if (parsed.operation === 'ERROR') throw new BackupBrokerClientError(parsed.code, parsed.message, parsed.retryable, dispatched, true);
          finish(undefined, parsed);
        } catch (error) {
          finish(error instanceof BackupBrokerClientError ? error : new BackupBrokerClientError(
            'BROKER_RESPONSE_INVALID', 'Backup broker response was malformed or unsupported.', false, dispatched));
        }
      });
    });
  }

  async describe(signal?: AbortSignal) { const response = await this.request({ operation: 'DESCRIBE' }, signal); if (response.operation !== 'DESCRIBE') throw new BackupBrokerClientError('BROKER_OPERATION_MISMATCH', 'Expected DESCRIBE response.'); return response; }

  async inspectRestoreHold(request: Omit<Extract<BackupBrokerClientRequest, { operation: 'INSPECT_RESTORE_HOLD' }>, 'operation'>,
    signal?: AbortSignal) {
    const response = await this.request({ operation: 'INSPECT_RESTORE_HOLD', ...request }, signal);
    if (response.operation !== 'INSPECT_RESTORE_HOLD' || response.operation_id !== request.operation_id ||
        response.manifest_sha256 !== request.manifest_sha256) {
      throw new BackupBrokerClientError('BROKER_RETENTION_EVIDENCE_MISMATCH', 'Broker restore-hold inspection does not match the requested lifecycle identity.');
    }
    return response;
  }
}

export function verifyBrokerManifestSignature(input: { payload: Uint8Array; signatureBase64: string; keyId: string; keys: readonly { key_id: string; public_key_pem: string }[] }): boolean {
  const key = input.keys.find((candidate) => candidate.key_id === input.keyId);
  if (!key) return false;
  return verify(null, input.payload, createPublicKey(key.public_key_pem), Buffer.from(input.signatureBase64, 'base64'));
}
