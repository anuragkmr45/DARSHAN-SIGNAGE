import { createHash, createPrivateKey, createPublicKey, sign } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { createConnection, createServer, type Server, type Socket } from 'node:net';
import { dirname, join } from 'node:path';
import {
  BACKUP_BROKER_MAX_REQUEST_BYTES, BACKUP_BROKER_PROTOCOL_VERSION, canonicalJson,
  parseBackupBrokerRequest, RECOVERY_BROKER_INCOMPLETE_FRAME_TIMEOUT_MS, RECOVERY_BROKER_MAX_CONNECTIONS,
  RECOVERY_BROKER_MAX_REQUEST_BYTES, RECOVERY_BROKER_OPERATIONS, type BackupBrokerRequest, type BackupBrokerResponse,
} from './backup-broker-protocol';
import { policySha256, validateCapsuleBytes, type SignedConfigurationCapsulePolicy } from './configuration-capsule-policy';
import { parseBackupManifest, serializeBackupManifest, serializeUnsignedBackupManifest } from './manifest';
import { BackupBrokerJournal, type BrokerJournalState, type BrokerPublicationRecord } from './backup-broker-journal';
import type { LocalRepository } from './local-repository';
import { assertRepositoryStillMatches } from './local-repository';
import type { BackupBrokerRepositoryAdapter } from './backup-broker-repository-adapter';
import { RepositoryMutationAuthority } from './repository-mutation-authority';
import { RepositoryRetentionAdapter } from './repository-retention-adapter';

export interface BackupBrokerServiceOptions {
  socketPath: string;
  socketMode?: number;
  socketUid?: number;
  socketGid?: number;
  recoverySocketPath?: string;
  recoverySocketMode?: number;
  recoverySocketUid?: number;
  recoverySocketGid?: number;
  mainListenFd?: number;
  recoveryListenFd?: number;
  /** Unit-test-only compatibility path. Production must use inherited listener FDs. */
  allowFilesystemListenersForTests?: boolean;
  closeGraceMs?: number;
  helperVersion: string;
  policy: SignedConfigurationCapsulePolicy;
  encryptedCapsule: Uint8Array;
  repository: LocalRepository;
  repositoryAdapter: Pick<BackupBrokerRepositoryAdapter, 'prepare' | 'commit' | 'inspect' | 'quarantine'>;
  activeSigningKey: { keyId: string; privateKeyPem: string };
  retainedVerificationKeys?: readonly { keyId: string; publicKeyPem: string }[];
  policyTrustKeys?: ReadonlyMap<string, string>;
  /** Test hook and future bounded repository adapter. It must honor abort. */
  beforeOperation?: (request: BackupBrokerRequest, signal: AbortSignal) => Promise<void>;
  /** Test-only startup barrier used to exercise transactional dual-listener readiness. */
  beforeRecoveryBind?: () => Promise<void>;
  /** Test-only close barrier used to exercise hidden/public pathname replacement handling. */
  beforeListenerClose?: (listener: { kind: 'main' | 'recovery'; path: string; bindPath: string }) => Promise<void>;
  retentionAdapter?: Pick<RepositoryRetentionAdapter, 'planDeletion' | 'executeDeletion' | 'cleanupStaging'> &
    Partial<Pick<RepositoryRetentionAdapter, 'inspectPublished'>>;
  retentionFault?: (stage: 'after-intent-fsync') => Promise<void>;
  minimumPublicationFreeBytes?: number;
}

export function requiredPublicationCapacityBytes(artifactSizes: readonly string[], reserveBytes: number): number {
  if (!Number.isSafeInteger(reserveBytes) || reserveBytes < 0) {
    throw Object.assign(new Error('Publication reserve is outside the safe capacity-check bound.'), { code: 'BACKUP_REPOSITORY_CAPACITY' });
  }
  const total = artifactSizes.reduce((sum, size) => sum + BigInt(size), BigInt(reserveBytes));
  if (total > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw Object.assign(new Error('Incoming publication size exceeds the repository capacity-check bound.'), { code: 'BACKUP_REPOSITORY_CAPACITY' });
  }
  return Number(total);
}

export class BackupBrokerService {
  private readonly listeners = new Map<'main' | 'recovery', {
    path: string; bindPath?: string; hiddenDetached: boolean; filesystemOwned: boolean; server: Server; identity?: { dev: number; ino: number };
    sockets: Set<Socket>; pending: Set<Socket>;
  }>();
  private readonly requestTasks = new Set<Promise<void>>();
  private state: 'IDLE' | 'STARTING' | 'READY' | 'CLOSING' | 'FAILED' = 'IDLE';
  private closePromise: Promise<void> | undefined;
  private readonly policyDigest: string;
  private readonly journal: BackupBrokerJournal;
  private readonly publicKeys: readonly { keyId: string; publicKeyPem: string; active: boolean }[];
  private authority: RepositoryMutationAuthority | undefined;
  private readonly retentionAdapter: Pick<RepositoryRetentionAdapter, 'planDeletion' | 'executeDeletion' | 'cleanupStaging'> &
    Partial<Pick<RepositoryRetentionAdapter, 'inspectPublished'>>;

  constructor(private readonly options: BackupBrokerServiceOptions) {
    this.policyDigest = policySha256(options.policy);
    this.journal = new BackupBrokerJournal(options.repository);
    validateCapsuleBytes(options.policy.policy, options.encryptedCapsule);
    const activePublic = createPublicKey(createPrivateKey(options.activeSigningKey.privateKeyPem)).export({ type: 'spki', format: 'pem' }).toString();
    this.publicKeys = [
      { keyId: options.activeSigningKey.keyId, publicKeyPem: activePublic, active: true },
      ...(options.retainedVerificationKeys ?? []).filter((key) => key.keyId !== options.activeSigningKey.keyId).map((key) => ({ ...key, active: false })),
    ];
    if (new Set(this.publicKeys.map((key) => key.keyId)).size !== this.publicKeys.length) throw new Error('Duplicate manifest verification key id.');
    if (!options.retentionAdapter && !options.policyTrustKeys) throw new Error('Repository retention requires the protected policy trust keyring.');
    this.retentionAdapter = options.retentionAdapter ?? new RepositoryRetentionAdapter({
      repository: options.repository,
      policyTrustKeys: options.policyTrustKeys!,
      manifestVerificationKeys: new Map(this.publicKeys.map((key) => [key.keyId, key.publicKeyPem])),
      assertAuthority: async () => {
        if (!this.authority) throw Object.assign(new Error('Repository mutation authority is not held.'), { code: 'BROKER_AUTHORITY_STALE_FENCE' });
        await this.authority.assertCurrent();
      },
    });
  }

  async listen(): Promise<void> {
    if (this.state !== 'IDLE' || this.listeners.size > 0 || this.closePromise) throw new Error('Backup broker is already listening or closing.');
    if (this.options.recoverySocketPath === this.options.socketPath) throw new Error('Recovery broker socket path must be distinct from the main broker socket path.');
    if (this.options.mainListenFd === undefined && !this.options.allowFilesystemListenersForTests) throw new Error('Production backup broker requires an inherited main listener FD.');
    if (this.options.recoverySocketPath && this.options.recoveryListenFd === undefined && !this.options.allowFilesystemListenersForTests) throw new Error('Production recovery broker requires an inherited recovery listener FD.');
    this.state = 'STARTING';
    try {
      this.authority = await RepositoryMutationAuthority.acquire({ repository: this.options.repository, socketPath: this.options.socketPath });
      await this.bindListener('main', this.options.socketPath, this.options.mainListenFd, BACKUP_BROKER_MAX_REQUEST_BYTES,
        this.options.socketMode ?? 0o660, this.options.socketUid, this.options.socketGid);
      if (this.options.recoverySocketPath) {
        await this.options.beforeRecoveryBind?.();
        await this.bindListener('recovery', this.options.recoverySocketPath, this.options.recoveryListenFd, RECOVERY_BROKER_MAX_REQUEST_BYTES,
          this.options.recoverySocketMode ?? 0o660, this.options.recoverySocketUid ?? this.options.socketUid,
          this.options.recoverySocketGid ?? this.options.socketGid);
      }
      this.state = 'READY';
      for (const [kind, listener] of this.listeners) {
        for (const socket of listener.pending) this.admit(socket, kind, kind === 'recovery' ? RECOVERY_BROKER_MAX_REQUEST_BYTES : BACKUP_BROKER_MAX_REQUEST_BYTES);
        listener.pending.clear();
      }
    } catch (error) {
      if (typeof error === 'object' && error && 'code' in error && error.code === 'BROKER_STARTUP_ROLLBACK_UNCERTAIN') {
        this.state = 'FAILED';
        await this.rollbackListeners();
        throw error;
      }
      try {
        await this.rollbackListeners();
        await this.authority?.release();
        this.authority = undefined;
        this.state = 'IDLE';
      } catch (cleanupError) {
        this.state = 'FAILED';
        throw Object.assign(new Error('Backup broker startup failed and exact listener cleanup could not be proven; repository authority was retained.', { cause: cleanupError }), { code: 'BROKER_STARTUP_ROLLBACK_UNCERTAIN' });
      }
      throw error;
    }
  }

  private async removeStaleSocket(path: string): Promise<void> {
    await fs.mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const parent = await fs.lstat(dirname(path));
    if (parent.isSymbolicLink() || !parent.isDirectory() || (parent.mode & 0o777) !== 0o700 ||
        parent.uid !== this.options.repository.ownerUid || parent.gid !== this.options.repository.ownerGid ||
        await fs.realpath(dirname(path)) !== dirname(path)) {
      throw new Error('Backup broker socket parent must be a canonical repository-owner 0700 directory.');
    }
    const stale = await fs.lstat(path).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return undefined;
      throw error;
    });
    if (stale && !stale.isSocket()) throw new Error('Backup broker socket path is occupied by a non-socket entry.');
    if (stale) {
      const staleIdentity = { dev: stale.dev, ino: stale.ino };
      const active = await new Promise<boolean>((resolve, reject) => {
        const probe = createConnection(path);
        const timer = setTimeout(() => { probe.destroy(); reject(Object.assign(new Error('Backup broker stale-socket probe timed out.'), { code: 'BROKER_SOCKET_PROBE_TIMEOUT' })); }, 1_000);
        timer.unref?.();
        probe.once('connect', () => { clearTimeout(timer); probe.destroy(); resolve(true); });
        probe.once('error', (error: NodeJS.ErrnoException) => {
          clearTimeout(timer);
          probe.destroy();
          if (error.code === 'ECONNREFUSED') resolve(false); else reject(error);
        });
      });
      if (active) throw new Error('Backup broker socket already has an active listener.');
      const stillStale = await fs.lstat(path);
      if (!stillStale.isSocket() || stillStale.dev !== staleIdentity.dev || stillStale.ino !== staleIdentity.ino) {
        throw new Error('Backup broker socket path changed during stale-socket inspection.');
      }
      await fs.unlink(path);
    }
  }

  private async bindListener(kind: 'main' | 'recovery', path: string, inheritedFd: number | undefined, maximumBytes: number,
    mode: number, uid: number | undefined, gid: number | undefined): Promise<void> {
    if (inheritedFd !== undefined) {
      if (!Number.isSafeInteger(inheritedFd) || inheritedFd < 3 || inheritedFd > 1024) throw new Error('Inherited broker listener FD is invalid.');
      const sockets = new Set<Socket>(); const pending = new Set<Socket>();
      const server = createServer({ allowHalfOpen: true }, (socket) => {
        if (kind === 'recovery' && sockets.size >= RECOVERY_BROKER_MAX_CONNECTIONS) { socket.destroy(); return; }
        sockets.add(socket); socket.once('close', () => sockets.delete(socket));
        if (this.state === 'READY') this.admit(socket, kind, maximumBytes); else if (this.state === 'STARTING') pending.add(socket); else socket.destroy();
      });
      await new Promise<void>((resolve, reject) => {
        const failed = (error: Error) => { server.off('listening', ready); reject(error); };
        const ready = () => { server.off('error', failed); resolve(); };
        server.once('error', failed); server.once('listening', ready); server.listen({ fd: inheritedFd, exclusive: true });
      });
      this.listeners.set(kind, { path, hiddenDetached: true, filesystemOwned: false, server, sockets, pending });
      return;
    }
    if (Buffer.byteLength(path) > 107) throw new Error('Backup broker Unix socket path exceeds the Linux sockaddr_un bound.');
    await this.removeStaleSocket(path);
    const bindPath = join(dirname(path), '.broker-bind');
    if (Buffer.byteLength(bindPath) > 107) throw new Error('Backup broker private bind path exceeds the Linux sockaddr_un bound.');
    await this.removeStaleSocket(bindPath);
    const sockets = new Set<Socket>();
    const pending = new Set<Socket>();
    const server = createServer({ allowHalfOpen: true }, (socket) => {
      if (kind === 'recovery' && sockets.size >= RECOVERY_BROKER_MAX_CONNECTIONS) {
        socket.destroy(); return;
      }
      sockets.add(socket); socket.once('close', () => sockets.delete(socket));
      if (this.state === 'READY') this.admit(socket, kind, maximumBytes);
      else if (this.state === 'STARTING') pending.add(socket);
      else socket.destroy();
    });
    await new Promise<void>((resolve, reject) => {
      const failed = (error: Error) => { server.off('listening', ready); reject(error); };
      const ready = () => { server.off('error', failed); resolve(); };
      server.once('error', failed); server.once('listening', ready); server.listen(bindPath);
    });
    const created = await fs.lstat(bindPath).catch(async (cause) => {
      await this.closeServer(server).catch(() => undefined);
      throw Object.assign(new Error('Backup broker listener path identity could not be established; authority was retained.', { cause }), { code: 'BROKER_STARTUP_ROLLBACK_UNCERTAIN' });
    });
    if (!created.isSocket()) {
      await this.closeServer(server).catch(() => undefined);
      throw Object.assign(new Error('Backup broker listener path is not the created Unix socket; authority was retained.'), { code: 'BROKER_STARTUP_ROLLBACK_UNCERTAIN' });
    }
    const listener = { path, bindPath, hiddenDetached: false, filesystemOwned: true, server, identity: { dev: created.dev, ino: created.ino }, sockets, pending };
    this.listeners.set(kind, listener);
    await fs.chmod(bindPath, mode);
    if (uid !== undefined || gid !== undefined) {
      await fs.chown(bindPath, uid ?? -1, gid ?? -1);
    }
    await fs.link(bindPath, path);
    const final = await fs.lstat(path);
    if (!final.isSocket() || final.dev !== created.dev || final.ino !== created.ino) {
      throw new Error('Backup broker socket identity changed while applying metadata.');
    }
    const hidden = await fs.lstat(bindPath);
    if (!hidden.isSocket() || hidden.dev !== created.dev || hidden.ino !== created.ino) {
      throw Object.assign(new Error('Backup broker private bind path changed before detachment.'), { code: 'BROKER_HIDDEN_PATH_OWNERSHIP_UNCERTAIN' });
    }
    await fs.unlink(bindPath);
    listener.hiddenDetached = true;
  }

  async close(): Promise<void> {
    if (!this.closePromise) {
      const attempt = this.closeOnce(); this.closePromise = attempt;
      void attempt.catch(() => {
        if (this.closePromise === attempt) { this.closePromise = undefined; this.state = 'FAILED'; }
      });
    }
    return this.closePromise;
  }

  private async closeServer(server: Server): Promise<void> {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }

  private async closeOwnedServer(kind: 'main' | 'recovery', listener: {
    path: string; bindPath?: string; hiddenDetached: boolean; filesystemOwned: boolean; server: Server; identity?: { dev: number; ino: number };
  }): Promise<void> {
    if (!listener.filesystemOwned) { if (listener.server.listening) await this.closeServer(listener.server); return; }
    await this.options.beforeListenerClose?.({ kind, path: listener.path, bindPath: listener.bindPath! });
    const hidden = await fs.lstat(listener.bindPath!).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return undefined;
      throw error;
    });
    if (listener.hiddenDetached) {
      if (hidden) throw Object.assign(new Error('Backup broker detached private bind path was recreated; listener was retained.'), { code: 'BROKER_HIDDEN_PATH_OWNERSHIP_UNCERTAIN' });
    } else if (!hidden || !hidden.isSocket() || hidden.dev !== listener.identity!.dev || hidden.ino !== listener.identity!.ino) {
      throw Object.assign(new Error('Backup broker private bind path no longer names the exact owned socket.'), { code: 'BROKER_HIDDEN_PATH_OWNERSHIP_UNCERTAIN' });
    }
    if (listener.server.listening) await this.closeServer(listener.server);
  }

  private async exactUnlink(listener: { path: string; filesystemOwned: boolean; identity?: { dev: number; ino: number } }): Promise<void> {
    if (!listener.filesystemOwned) return;
    const entry = await fs.lstat(listener.path).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return undefined;
      throw error;
    });
    if (!entry) return;
    if (!entry.isSocket() || entry.dev !== listener.identity!.dev || entry.ino !== listener.identity!.ino) {
      throw Object.assign(new Error('Backup broker socket path no longer names the exact owned socket.'), { code: 'BROKER_SOCKET_OWNERSHIP_UNCERTAIN' });
    }
    await fs.unlink(listener.path);
  }

  private async rollbackListeners(): Promise<void> {
    const listeners = [...this.listeners.entries()];
    await Promise.all(listeners.map(async ([kind, listener]) => {
      for (const socket of listener.pending) socket.destroy();
      for (const socket of listener.sockets) socket.destroy();
      await this.closeOwnedServer(kind, listener);
    }));
    for (const [, listener] of listeners.reverse()) await this.exactUnlink(listener);
    this.listeners.clear();
  }

  private async closeOnce(): Promise<void> {
    if (this.listeners.size === 0 && !this.authority) return;
    this.state = 'CLOSING';
    const listeners = [...this.listeners.entries()];
    const graceMs = this.options.closeGraceMs ?? 30_000;
    if (!Number.isSafeInteger(graceMs) || graceMs < 10_000 || graceMs > 240_000) {
      throw new Error('Backup broker close grace must be between 10 and 240 seconds.');
    }
    const drain = (async () => {
      await Promise.all(listeners.map(([kind, listener]) => this.closeOwnedServer(kind, listener)));
      while (this.requestTasks.size > 0) await Promise.allSettled([...this.requestTasks]);
      await this.journal.drain();
    })();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        drain,
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(Object.assign(
          new Error('Backup broker drain grace expired; repository authority and socket evidence were retained.'),
          { code: 'BROKER_DRAIN_TIMEOUT' })), graceMs); timer.unref?.(); }),
      ]);
    } finally { if (timer) clearTimeout(timer); }
    for (const [, listener] of [...listeners].reverse()) await this.exactUnlink(listener);
    const authority = this.authority;
    if (authority) await authority.release();
    this.authority = undefined;
    this.listeners.clear();
    this.closePromise = undefined;
    this.state = 'IDLE';
  }

  private admit(socket: Socket, endpoint: 'main' | 'recovery', maximumBytes: number): void {
    const abort = new AbortController(); let bytes = 0; const chunks: Buffer[] = [];
    const frameTimer = endpoint === 'recovery' ? setTimeout(() => socket.destroy(), RECOVERY_BROKER_INCOMPLETE_FRAME_TIMEOUT_MS) : undefined;
    frameTimer?.unref?.();
    // A parsed request may still be doing repository work. Keep disconnect
    // cancellation live until the connection itself closes.
    const disconnect = () => abort.abort(new Error('Backup broker client disconnected.'));
    socket.once('close', () => { if (frameTimer) clearTimeout(frameTimer); disconnect(); }); socket.once('error', disconnect);
    socket.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > maximumBytes + 1) { socket.destroy(); return; }
      chunks.push(chunk);
    });
    socket.once('end', () => {
      const all = Buffer.concat(chunks); const newline = all.indexOf(0x0a);
      if (newline < 0 || newline !== all.length - 1) { this.writeError(socket, undefined, 'BROKER_FRAME_INVALID', 'Exactly one newline-delimited request followed by write EOF is required.'); return; }
      if (frameTimer) clearTimeout(frameTimer);
      const task = this.process(socket, all.subarray(0, newline), abort.signal, endpoint);
      this.requestTasks.add(task);
      void task.finally(() => this.requestTasks.delete(task));
    });
  }

  private error(request: BackupBrokerRequest | undefined, code: string, message: string, retryable = false): BackupBrokerResponse {
    return {
      protocol_version: BACKUP_BROKER_PROTOCOL_VERSION, operation: 'ERROR',
      request_id: request?.request_id ?? '00000000-0000-4000-8000-000000000000', helper_version: this.options.helperVersion,
      policy_sha256: this.policyDigest, code, message, retryable,
    };
  }

  private writeError(socket: Socket, request: BackupBrokerRequest | undefined, code: string, message: string, retryable = false): void {
    socket.end(canonicalJson(this.error(request, code, message, retryable)));
  }

  private async process(socket: Socket, frame: Buffer, signal: AbortSignal, endpoint: 'main' | 'recovery'): Promise<void> {
    let request: BackupBrokerRequest | undefined;
    try {
      request = parseBackupBrokerRequest(frame);
      if (endpoint === 'recovery' && !RECOVERY_BROKER_OPERATIONS.has(request.operation)) {
        throw Object.assign(new Error('Operation is not admitted on the recovery broker endpoint.'), { code: 'BROKER_RECOVERY_OPERATION_FORBIDDEN' });
      }
      if (request.helper_version !== this.options.helperVersion || request.policy_sha256 !== this.policyDigest ||
          request.site_id !== this.options.policy.policy.site_id || request.repository_id !== this.options.policy.policy.repository_id) {
        throw Object.assign(new Error('Broker policy, helper, site, or repository identity mismatch.'), { code: 'BROKER_IDENTITY_MISMATCH' });
      }
      const immutableRead = request.operation === 'DESCRIBE' || request.operation === 'SELECT_CAPSULE';
      const controlRead = immutableRead || request.operation === 'INSPECT_PUBLICATION' || request.operation === 'INSPECT_RETENTION_TRUTH' ||
        request.operation === 'INSPECT_RESTORE_HOLD';
      const operation = async (state: BrokerJournalState, checkpoint: () => Promise<void> = async () => undefined) => {
        const remaining = Date.parse(request!.deadline) - Date.now();
        const maximum = controlRead ? 60_000 : 4 * 60 * 60 * 1000;
        if (!Number.isFinite(remaining) || remaining <= 0 || remaining > maximum) {
          throw Object.assign(new Error(`Request deadline must be immutable, future, and no more than ${controlRead ? '60 seconds' : '4 hours'}.`), { code: 'BROKER_DEADLINE_INVALID' });
        }
        const operationSignal = AbortSignal.any([signal, AbortSignal.timeout(remaining)]);
        if (!immutableRead) {
          if (!this.authority) throw Object.assign(new Error('Repository mutation authority is not held.'), { code: 'BROKER_AUTHORITY_STALE_FENCE' });
          await this.authority.assertCurrent();
        }
        await this.options.beforeOperation?.(request!, operationSignal);
        operationSignal.throwIfAborted();
        return canonicalJson(await this.handle(request!, state, operationSignal, checkpoint));
      };
      const encoded = immutableRead
        ? await operation({ format: 'darshan-backup-broker-journal-v2', revision: 0, requests: {}, publications: {}, holds: {}, deletions: {}, tombstones: {}, staging_cleanups: {} })
        : request.operation === 'INSPECT_RESTORE_HOLD'
        ? await this.journal.queryReadonly(operation)
        : controlRead
        ? await this.journal.query(operation)
        : await this.journal.execute({
          requestId: request.request_id, requestSha256: createHash('sha256').update(canonicalJson(request)).digest('hex'), operation,
          reconstruct: async (state) => canonicalJson(await this.handle(request!, state, signal)),
          replayOverride: async (state) => {
            if (!('run_id' in request!)) return undefined;
            if (['INSPECT_RETENTION_TRUTH', 'ACQUIRE_RESTORE_HOLD', 'RELEASE_RESTORE_HOLD', 'MARK_RESTORE_HOLD_UNCERTAIN',
              'CLAIM_RUN_DELETION', 'EXECUTE_RUN_DELETION', 'RECONCILE_RUN_DELETION', 'CLEANUP_STAGING'].includes(request!.operation)) {
              return canonicalJson(await this.handle(request!, state, signal));
            }
            if (!state.tombstones[request!.run_id] || !['PREPARE_PUBLICATION', 'COMMIT_PUBLICATION', 'QUARANTINE_PUBLICATION'].includes(request!.operation)) return undefined;
            return canonicalJson(this.error(request!, 'BROKER_PUBLICATION_HISTORICAL_ONLY', 'Historical publication acknowledgement exists, but current repository truth is deleted.'));
          },
        });
      socket.end(encoded);
    } catch (error) {
      if (signal.aborted || socket.destroyed) return;
      const code = typeof error === 'object' && error && 'code' in error && typeof error.code === 'string' ? error.code : 'BROKER_REQUEST_INVALID';
      this.writeError(socket, request, code, error instanceof Error ? error.message : 'Invalid broker request.');
    }
  }

  private assertPublicationIdentity(request: Extract<BackupBrokerRequest, { run_id: string }>, existing: BrokerPublicationRecord): void {
    if (existing.site_id !== request.site_id || existing.repository_id !== request.repository_id || existing.run_id !== request.run_id ||
        existing.attempt_id !== request.attempt_id || existing.capture_id !== request.capture_id || existing.capture_generation !== request.capture_generation) {
      throw Object.assign(new Error('run_id is already claimed by another publication identity.'), { code: 'BROKER_RUN_CLAIM_CONFLICT' });
    }
  }

  private async handle(request: BackupBrokerRequest, state: BrokerJournalState, signal: AbortSignal, checkpoint: () => Promise<void> = async () => undefined): Promise<BackupBrokerResponse> {
    const common = { protocol_version: BACKUP_BROKER_PROTOCOL_VERSION, request_id: request.request_id, helper_version: this.options.helperVersion, policy_sha256: this.policyDigest } as const;
    if (request.operation === 'DESCRIBE') return {
      ...common, operation: 'DESCRIBE', site_id: request.site_id, repository_id: request.repository_id,
      capsule_generation: this.options.policy.policy.generation, capsule_sha256: this.options.policy.policy.capsule_sha256,
      capsule_size_bytes: this.options.policy.policy.capsule_size_bytes,
      release_generation: this.options.policy.policy.release_generation,
      deployment_generation: this.options.policy.policy.deployment_generation,
      compatibility_generation: this.options.policy.policy.compatibility_generation,
      age_recipient_key_id: this.options.policy.policy.age_recipient_key_id,
      contract_id: this.options.policy.policy.contract_id,
      encrypted_inventory_sha256: this.options.policy.policy.encrypted_inventory_sha256,
      required_roles: this.options.policy.policy.required_roles,
      capabilities: { durable_publication: true, repository_retention_authority: true, durable_restore_holds: true, whole_run_deletion: true },
      manifest_verification_keys: this.publicKeys.map((key) => ({ key_id: key.keyId, algorithm: 'Ed25519' as const, public_key_pem: key.publicKeyPem, active: key.active })),
      configuration_contract: [{ logical_name: 'configuration.encrypted-capsule', required: true, max_bytes: this.options.encryptedCapsule.byteLength.toString() }],
    };
    if (request.operation === 'SELECT_CAPSULE') {
      if (request.expected_capsule_generation !== this.options.policy.policy.generation || request.expected_capsule_sha256 !== this.options.policy.policy.capsule_sha256) {
        throw Object.assign(new Error('Expected capsule generation or digest does not match active signed policy.'), { code: 'BROKER_CAPSULE_MISMATCH' });
      }
      const marker = canonicalJson({ version: 2, site_id: request.site_id, repository_id: request.repository_id, capsule_generation: request.expected_capsule_generation, capsule_sha256: request.expected_capsule_sha256 }).toString('utf8');
      const signature = sign(null, Buffer.from(marker), createPrivateKey(this.options.activeSigningKey.privateKeyPem));
      return { ...common, operation: 'SELECT_CAPSULE', capsule_generation: request.expected_capsule_generation, capsule_sha256: request.expected_capsule_sha256, capsule_base64: Buffer.from(this.options.encryptedCapsule).toString('base64'), active_marker: marker, active_marker_signature_base64: signature.toString('base64'), key_id: this.options.activeSigningKey.keyId };
    }
    const existing = state.publications[request.run_id];
    if (existing && request.operation !== 'INSPECT_RESTORE_HOLD') this.assertPublicationIdentity(request, existing);
    const tombstone = state.tombstones[request.run_id];
    if (tombstone && request.operation === 'INSPECT_PUBLICATION') {
      return { ...common, operation: 'INSPECT_PUBLICATION', status: tombstone.disposition === 'DELETED' ? 'DELETED' : 'DELETION_CLAIMED',
        unsigned_manifest_sha256: existing?.unsigned_manifest_sha256, signed_manifest_sha256: tombstone.manifest_sha256 };
    }
    if (tombstone && ['PREPARE_PUBLICATION', 'COMMIT_PUBLICATION', 'QUARANTINE_PUBLICATION'].includes(request.operation)) {
      throw Object.assign(new Error('Historical publication acknowledgement exists, but current repository truth is deleted.'), { code: 'BROKER_PUBLICATION_HISTORICAL_ONLY' });
    }

    const lifecycleOperations = new Set([
      'INSPECT_RETENTION_TRUTH', 'INSPECT_RESTORE_HOLD', 'ACQUIRE_RESTORE_HOLD', 'RELEASE_RESTORE_HOLD', 'MARK_RESTORE_HOLD_UNCERTAIN',
      'CLAIM_RUN_DELETION', 'EXECUTE_RUN_DELETION', 'RECONCILE_RUN_DELETION', 'CLEANUP_STAGING',
    ]);
    if (lifecycleOperations.has(request.operation)) {
      const lifecycle = request as Extract<BackupBrokerRequest, { manifest_sha256: string }>;
      const holds = Object.values(state.holds).filter((hold) => hold.run_id === lifecycle.run_id);
      const activeHolds = holds.filter((hold) => hold.status === 'ACTIVE');
      const uncertainHolds = holds.filter((hold) => hold.status === 'UNCERTAIN');
      const deletion = Object.values(state.deletions).find((candidate) => candidate.run_id === lifecycle.run_id);
      const assertLifecycleRecord = (record: { site_id: string; repository_id: string; run_id: string; attempt_id: string; capture_id: string; capture_generation: number; manifest_sha256: string; operation_id: string; owner_token: string; fence_token: string }) => {
        if (record.site_id !== lifecycle.site_id || record.repository_id !== lifecycle.repository_id || record.run_id !== lifecycle.run_id ||
            record.attempt_id !== lifecycle.attempt_id || record.capture_id !== lifecycle.capture_id || record.capture_generation !== lifecycle.capture_generation ||
            record.manifest_sha256 !== lifecycle.manifest_sha256 || record.operation_id !== lifecycle.operation_id ||
            record.owner_token !== lifecycle.owner_token || record.fence_token !== lifecycle.fence_token) {
          throw Object.assign(new Error('Lifecycle operation identity or fence token conflicts with durable evidence.'), { code: 'BROKER_LIFECYCLE_FENCE_CONFLICT' });
        }
      };
      const exactHold = state.holds[lifecycle.operation_id];
      if (request.operation === 'INSPECT_RESTORE_HOLD' && exactHold) {
        assertLifecycleRecord(exactHold);
        return { ...common, operation: request.operation, operation_id: lifecycle.operation_id,
          manifest_sha256: lifecycle.manifest_sha256, status: exactHold.status };
      }
      if (request.operation === 'INSPECT_RESTORE_HOLD') {
        return { ...common, operation: request.operation, operation_id: lifecycle.operation_id,
          manifest_sha256: lifecycle.manifest_sha256, status: 'ABSENT' };
      }
      const cleanupOperation = request.operation === 'CLEANUP_STAGING';
      if (!existing || existing.status !== (cleanupOperation ? 'QUARANTINED' : 'COMMITTED') || existing.signed_manifest_sha256 !== lifecycle.manifest_sha256) {
        if (!tombstone || tombstone.manifest_sha256 !== lifecycle.manifest_sha256) {
          throw Object.assign(new Error('Lifecycle request does not match a committed publication identity.'), { code: 'BROKER_LIFECYCLE_IDENTITY_MISMATCH' });
        }
      }
      const deletionArtifacts = (record: NonNullable<typeof deletion>) => Object.entries(record.entries)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([artifactKey, entry]) => ({
          artifact_key: artifactKey,
          artifact_kind: artifactKey === 'database.tar.age' ? 'DATABASE' as const
            : artifactKey === 'objects.tar.age' ? 'OBJECTS' as const
            : artifactKey === 'configuration.tar.age' || artifactKey === 'configuration-policy.json' ? 'CONFIGURATION' as const
            : artifactKey === 'manifest.json' ? 'MANIFEST' as const : 'OTHER' as const,
          ...(entry.expected_sha256 ? { expected_sha256: entry.expected_sha256 } : {}),
          ...(entry.expected_size ? { expected_size_bytes: entry.expected_size } : {}),
          status: entry.status === 'DELETED' ? 'DELETED' as const : 'PENDING' as const,
        }));
      if (request.operation === 'INSPECT_RETENTION_TRUTH') {
        const status = tombstone?.disposition === 'DELETED' || deletion?.status === 'DELETED' ? 'DELETED'
          : deletion?.status === 'PARTIAL' ? 'PARTIAL'
          : deletion?.status === 'DELETING' || deletion?.status === 'RENAMED' ? 'DELETING'
          : deletion?.status === 'CLAIMED' ? 'DELETION_CLAIMED'
          : deletion?.status === 'UNCERTAIN' || tombstone?.disposition === 'UNCERTAIN' ? 'UNCERTAIN' : 'AVAILABLE';
        return { ...common, operation: 'INSPECT_RETENTION_TRUTH', status, active_holds: activeHolds.length,
          uncertain_holds: uncertainHolds.length, ...(deletion ? { deletion_operation_id: deletion.operation_id } : {}), manifest_sha256: lifecycle.manifest_sha256 };
      }
      if (request.operation === 'ACQUIRE_RESTORE_HOLD') {
        if (deletion || tombstone) throw Object.assign(new Error('Restore hold cannot be acquired after deletion is claimed.'), { code: 'BROKER_DELETE_ALREADY_CLAIMED' });
        const prior = state.holds[lifecycle.operation_id];
        if (prior) { assertLifecycleRecord(prior); return { ...common, operation: request.operation, operation_id: lifecycle.operation_id, status: prior.status }; }
        if (this.retentionAdapter.inspectPublished) await this.retentionAdapter.inspectPublished(existing!, signal);
        else await this.options.repositoryAdapter.inspect(existing!, signal);
        state.holds[lifecycle.operation_id] = {
          site_id: lifecycle.site_id, repository_id: lifecycle.repository_id, run_id: lifecycle.run_id, attempt_id: lifecycle.attempt_id,
          capture_id: lifecycle.capture_id, capture_generation: lifecycle.capture_generation, manifest_sha256: lifecycle.manifest_sha256,
          operation_id: lifecycle.operation_id, owner_token: lifecycle.owner_token, fence_token: lifecycle.fence_token,
          status: 'ACTIVE', acquired_at: new Date().toISOString(), released_at: null, uncertain_at: null,
        };
        return { ...common, operation: request.operation, operation_id: lifecycle.operation_id, status: 'ACTIVE' };
      }
      if (request.operation === 'RELEASE_RESTORE_HOLD' || request.operation === 'MARK_RESTORE_HOLD_UNCERTAIN') {
        const hold = state.holds[lifecycle.operation_id];
        if (!hold) throw Object.assign(new Error('Restore hold identity is unknown.'), { code: 'BROKER_RESTORE_HOLD_NOT_FOUND' });
        assertLifecycleRecord(hold);
        if (request.operation === 'RELEASE_RESTORE_HOLD') {
          hold.status = 'RELEASED'; hold.released_at ??= new Date().toISOString();
          return { ...common, operation: request.operation, operation_id: lifecycle.operation_id, status: 'RELEASED' };
        }
        if (hold.status !== 'RELEASED') { hold.status = 'UNCERTAIN'; hold.uncertain_at ??= new Date().toISOString(); }
        return { ...common, operation: request.operation, operation_id: lifecycle.operation_id, status: hold.status };
      }
      if (request.operation === 'CLAIM_RUN_DELETION') {
        if (activeHolds.length || uncertainHolds.length) throw Object.assign(new Error('Active or uncertain restore holds protect this run.'), { code: 'BROKER_DELETE_BLOCKED_BY_HOLD' });
        if (deletion) { assertLifecycleRecord(deletion); return { ...common, operation: request.operation, operation_id: deletion.operation_id,
          status: deletion.status, deleted_entries: Object.values(deletion.entries).filter((entry) => entry.status === 'DELETED').length,
          total_entries: Object.keys(deletion.entries).length, artifacts: deletionArtifacts(deletion) }; }
        const entries = await this.retentionAdapter.planDeletion(existing!, signal);
        const now = new Date().toISOString();
        state.deletions[lifecycle.operation_id] = {
          site_id: lifecycle.site_id, repository_id: lifecycle.repository_id, run_id: lifecycle.run_id, attempt_id: lifecycle.attempt_id,
          capture_id: lifecycle.capture_id, capture_generation: lifecycle.capture_generation, manifest_sha256: lifecycle.manifest_sha256,
          operation_id: lifecycle.operation_id, owner_token: lifecycle.owner_token, fence_token: lifecycle.fence_token,
          status: 'CLAIMED', claimed_at: now, updated_at: now, namespace_renamed: false, entries, last_error_code: null,
        };
        state.tombstones[lifecycle.run_id] = {
          site_id: lifecycle.site_id, repository_id: lifecycle.repository_id, run_id: lifecycle.run_id, attempt_id: lifecycle.attempt_id,
          capture_id: lifecycle.capture_id, capture_generation: lifecycle.capture_generation, manifest_sha256: lifecycle.manifest_sha256,
          operation_id: lifecycle.operation_id, disposition: 'INTENT', recorded_at: now, completed_at: null,
        };
        await checkpoint();
        await this.options.retentionFault?.('after-intent-fsync');
        return { ...common, operation: request.operation, operation_id: lifecycle.operation_id, status: 'CLAIMED', deleted_entries: 0,
          total_entries: Object.keys(entries).length, artifacts: deletionArtifacts(state.deletions[lifecycle.operation_id]) };
      }
      if (request.operation === 'EXECUTE_RUN_DELETION' || request.operation === 'RECONCILE_RUN_DELETION') {
        if (!deletion) throw Object.assign(new Error('Deletion operation was not durably claimed.'), { code: 'BROKER_DELETE_NOT_CLAIMED' });
        assertLifecycleRecord(deletion);
        const durableTombstone = state.tombstones[lifecycle.run_id];
        if (!durableTombstone || durableTombstone.operation_id !== deletion.operation_id) throw Object.assign(new Error('Deletion intent evidence is missing or conflicting.'), { code: 'BROKER_DELETE_INTENT_MISSING' });
        if (deletion.status !== 'DELETED') {
          try { await this.retentionAdapter.executeDeletion({ deletion, signal, checkpoint }); }
          catch (error) {
            const deletionCompleted = (deletion.status as string) === 'DELETED';
            if (!deletionCompleted) {
              deletion.status = deletion.namespace_renamed || Object.values(deletion.entries).some((entry) => entry.status === 'DELETED') ? 'PARTIAL' : 'UNCERTAIN';
            }
            deletion.last_error_code = typeof error === 'object' && error && 'code' in error && typeof error.code === 'string' ? error.code : 'BROKER_DELETE_FAILED';
            deletion.updated_at = new Date().toISOString(); durableTombstone.disposition = deletionCompleted ? 'INTENT' : deletion.status === 'PARTIAL' ? 'PARTIAL' : 'UNCERTAIN';
            await checkpoint(); throw error;
          }
        }
        durableTombstone.disposition = 'DELETED'; durableTombstone.completed_at ??= new Date().toISOString(); await checkpoint();
        return { ...common, operation: request.operation, operation_id: deletion.operation_id, status: 'DELETED',
          deleted_entries: Object.values(deletion.entries).filter((entry) => entry.status === 'DELETED').length,
          total_entries: Object.keys(deletion.entries).length, artifacts: deletionArtifacts(deletion) };
      }
      if (activeHolds.length || uncertainHolds.length || deletion || tombstone) {
        throw Object.assign(new Error('Staging cleanup is blocked by unresolved repository lifecycle evidence.'), { code: 'BROKER_STAGING_NOT_CLEANABLE' });
      }
      let cleanup = state.staging_cleanups[lifecycle.operation_id];
      if (cleanup) assertLifecycleRecord(cleanup);
      else {
        cleanup = state.staging_cleanups[lifecycle.operation_id] = {
          site_id: lifecycle.site_id, repository_id: lifecycle.repository_id, run_id: lifecycle.run_id, attempt_id: lifecycle.attempt_id,
          capture_id: lifecycle.capture_id, capture_generation: lifecycle.capture_generation, manifest_sha256: lifecycle.manifest_sha256,
          operation_id: lifecycle.operation_id, owner_token: lifecycle.owner_token, fence_token: lifecycle.fence_token,
          status: 'CLAIMED', claimed_at: new Date().toISOString(),
        };
        await checkpoint();
      }
      if (cleanup.status === 'CLEANED') return { ...common, operation: 'CLEANUP_STAGING', operation_id: cleanup.operation_id, status: 'CLEANED' };
      try {
        await this.retentionAdapter.cleanupStaging({ publication: existing!, cleanup, signal, checkpoint });
        cleanup.status = 'CLEANED'; await checkpoint();
      } catch (error) { if (cleanup.status !== 'RENAMED') cleanup.status = 'UNCERTAIN'; await checkpoint(); throw error; }
      return { ...common, operation: 'CLEANUP_STAGING', operation_id: cleanup.operation_id, status: 'CLEANED' };
    }
    if (request.operation === 'PREPARE_PUBLICATION') {
      if (request.expected_capsule_generation !== this.options.policy.policy.generation) throw Object.assign(new Error('Capsule generation changed.'), { code: 'BROKER_CAPSULE_MISMATCH' });
      const manifestBytes = Buffer.from(request.manifest_base64, 'base64');
      if (manifestBytes.toString('base64') !== request.manifest_base64) throw Object.assign(new Error('Manifest bytes must use canonical base64.'), { code: 'BROKER_MANIFEST_INVALID' });
      let manifest;
      try { manifest = parseBackupManifest(manifestBytes); }
      catch (cause) { throw Object.assign(new Error('PREPARE requires a strict canonical backup manifest.', { cause }), { code: 'BROKER_MANIFEST_INVALID' }); }
      if (manifest.signature !== null || !manifestBytes.equals(serializeUnsignedBackupManifest(manifest))) {
        throw Object.assign(new Error('PREPARE accepts only byte-for-byte canonical unsigned manifests.'), { code: 'BROKER_MANIFEST_INVALID' });
      }
      const actualDigest = createHash('sha256').update(manifestBytes).digest('hex');
      if (actualDigest !== request.unsigned_manifest_sha256) throw Object.assign(new Error('Unsigned manifest digest does not match canonical manifest bytes.'), { code: 'BROKER_MANIFEST_DIGEST_MISMATCH' });
      if (manifest.site.id !== request.site_id || manifest.repository.id !== request.repository_id ||
          manifest.run.id !== request.run_id || manifest.run.attemptId !== request.attempt_id ||
          manifest.capture.id !== request.capture_id || manifest.capture.generation !== request.capture_generation.toString()) {
        throw Object.assign(new Error('Manifest identity does not match the bound broker request.'), { code: 'BROKER_MANIFEST_IDENTITY_MISMATCH' });
      }
      if (manifest.release.id !== this.options.policy.policy.release_generation ||
          manifest.encryption.keyId !== this.options.policy.policy.age_recipient_key_id) {
        throw Object.assign(new Error('Manifest release or age-recipient identity does not match signed capsule policy.'), { code: 'BROKER_MANIFEST_POLICY_MISMATCH' });
      }
      const configurationPolicy = manifest.configurationPolicy;
      if (manifest.version !== 2 || !configurationPolicy || configurationPolicy.policySha256 !== this.policyDigest ||
          configurationPolicy.capsuleGeneration !== this.options.policy.policy.generation ||
          configurationPolicy.encryptedInventorySha256 !== this.options.policy.policy.encrypted_inventory_sha256) {
        throw Object.assign(new Error('Manifest does not bind the exact trusted configuration capsule policy.'), { code: 'BROKER_MANIFEST_POLICY_MISMATCH' });
      }
      const expectedArtifacts = new Map([
        ['DATABASE', { name: 'database', path: 'database.tar.age' }],
        ['OBJECTS', { name: 'objects', path: 'objects.tar.age' }],
        ['CONFIGURATION', { name: 'configuration', path: 'configuration.tar.age' }],
      ]);
      if (manifest.artifacts.length !== 3 || manifest.artifacts.some((artifact) => {
        const expected = expectedArtifacts.get(artifact.kind);
        if (!expected || artifact.name !== expected.name || artifact.ciphertextPath !== expected.path) return true;
        expectedArtifacts.delete(artifact.kind);
        return false;
      }) || expectedArtifacts.size !== 0) {
        throw Object.assign(new Error('Manifest must contain exactly database, objects, and configuration ciphertext artifacts.'), { code: 'BROKER_MANIFEST_ARTIFACT_SET_INVALID' });
      }
      await assertRepositoryStillMatches(this.options.repository, requiredPublicationCapacityBytes(
        manifest.artifacts.map((artifact) => artifact.ciphertextSizeBytes),
        this.options.minimumPublicationFreeBytes ?? 0,
      ));
      const capsuleArtifact = manifest.artifacts.find((artifact) => artifact.kind === 'CONFIGURATION')!;
      if (capsuleArtifact.ciphertextSha256 !== this.options.policy.policy.capsule_sha256 ||
          capsuleArtifact.ciphertextSizeBytes !== this.options.policy.policy.capsule_size_bytes) {
        throw Object.assign(new Error('Manifest does not contain the exact active encrypted configuration capsule artifact.'), { code: 'BROKER_MANIFEST_CAPSULE_MISMATCH' });
      }
      if (existing && existing.unsigned_manifest_sha256 !== request.unsigned_manifest_sha256) throw Object.assign(new Error('Publication identity already has another unsigned manifest digest.'), { code: 'BROKER_PUBLICATION_CONFLICT' });
      if (existing) return { ...common, operation: 'PREPARE_PUBLICATION', unsigned_manifest_sha256: existing.unsigned_manifest_sha256, signed_manifest_sha256: existing.signed_manifest_sha256, algorithm: 'Ed25519', key_id: existing.key_id, signature_base64: existing.signature_base64,
        incomplete_relative_path: `incomplete/${existing.attempt_directory}`, published_relative_path: `runs/${existing.run_id}` };
      const signature = sign(null, manifestBytes, createPrivateKey(this.options.activeSigningKey.privateKeyPem));
      const signatureBase64 = signature.toString('base64');
      const signedBytes = serializeBackupManifest({ ...manifest, signature: { algorithm: 'Ed25519', keyId: this.options.activeSigningKey.keyId, valueBase64: signatureBase64 } });
      const signedDigest = createHash('sha256').update(signedBytes).digest('hex');
      const attemptDirectory = await this.options.repositoryAdapter.prepare({ request, manifest, signedManifestBytes: signedBytes, signal });
      state.publications[request.run_id] = {
        site_id: request.site_id, repository_id: request.repository_id, run_id: request.run_id, attempt_id: request.attempt_id,
        capture_id: request.capture_id, capture_generation: request.capture_generation, policy_sha256: request.policy_sha256,
        capsule_generation: request.expected_capsule_generation, unsigned_manifest_sha256: request.unsigned_manifest_sha256,
        signed_manifest_sha256: signedDigest, key_id: this.options.activeSigningKey.keyId, signature_base64: signatureBase64,
        unsigned_manifest_base64: request.manifest_base64, attempt_directory: attemptDirectory, status: 'PREPARED',
      };
      return { ...common, operation: 'PREPARE_PUBLICATION', unsigned_manifest_sha256: request.unsigned_manifest_sha256, signed_manifest_sha256: signedDigest, algorithm: 'Ed25519', key_id: this.options.activeSigningKey.keyId, signature_base64: signatureBase64,
        incomplete_relative_path: `incomplete/${attemptDirectory}`, published_relative_path: `runs/${request.run_id}` };
    }
    if (request.operation === 'INSPECT_PUBLICATION') {
      if (existing && request.signed_manifest_sha256 && request.signed_manifest_sha256 !== existing.signed_manifest_sha256) throw Object.assign(new Error('Requested signed manifest digest does not match publication.'), { code: 'BROKER_PUBLICATION_CONFLICT' });
      if (!existing) return { ...common, operation: 'INSPECT_PUBLICATION', status: 'ABSENT' };
      if (existing.status !== 'QUARANTINED') {
        try {
          const evidence = await this.options.repositoryAdapter.inspect(existing, signal);
          return { ...common, operation: 'INSPECT_PUBLICATION', status: 'COMMITTED', unsigned_manifest_sha256: existing.unsigned_manifest_sha256, signed_manifest_sha256: existing.signed_manifest_sha256, evidence };
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || existing.status === 'COMMITTED') throw Object.assign(new Error('Repository truth does not match broker publication state.', { cause: error }), { code: 'BROKER_REPOSITORY_TRUTH_MISMATCH' });
        }
      }
      return { ...common, operation: 'INSPECT_PUBLICATION', status: existing.status, unsigned_manifest_sha256: existing.unsigned_manifest_sha256, signed_manifest_sha256: existing.signed_manifest_sha256 };
    }
    if (request.operation !== 'COMMIT_PUBLICATION' && request.operation !== 'QUARANTINE_PUBLICATION') {
      throw Object.assign(new Error('Unsupported broker operation.'), { code: 'BROKER_OPERATION_UNSUPPORTED' });
    }
    if (!existing || existing.unsigned_manifest_sha256 !== request.unsigned_manifest_sha256 || existing.signed_manifest_sha256 !== request.signed_manifest_sha256) throw Object.assign(new Error('Publication was not prepared with these manifest digests.'), { code: 'BROKER_PUBLICATION_CONFLICT' });
    if (request.operation === 'COMMIT_PUBLICATION') {
      if (existing.status === 'QUARANTINED') throw Object.assign(new Error('Quarantined publication cannot be committed.'), { code: 'BROKER_PUBLICATION_STATE_CONFLICT' });
      let evidence;
      if (existing.status === 'PREPARED') {
        const unsigned = parseBackupManifest(Buffer.from(existing.unsigned_manifest_base64, 'base64'));
        const signed = { ...unsigned, signature: { algorithm: 'Ed25519', keyId: existing.key_id, valueBase64: existing.signature_base64 } };
        evidence = await this.options.repositoryAdapter.commit({ publication: existing, manifest: signed, signedManifestBytes: serializeBackupManifest(signed), signal });
      } else evidence = await this.options.repositoryAdapter.inspect(existing, signal);
      existing.status = 'COMMITTED';
      return { ...common, operation: 'COMMIT_PUBLICATION', unsigned_manifest_sha256: existing.unsigned_manifest_sha256, signed_manifest_sha256: existing.signed_manifest_sha256, status: 'COMMITTED', evidence };
    }
    if (existing.status === 'COMMITTED') throw Object.assign(new Error('Committed publication cannot be quarantined.'), { code: 'BROKER_PUBLICATION_STATE_CONFLICT' });
    if (existing.status === 'PREPARED') await this.options.repositoryAdapter.quarantine(existing);
    existing.status = 'QUARANTINED';
    return { ...common, operation: 'QUARANTINE_PUBLICATION', unsigned_manifest_sha256: existing.unsigned_manifest_sha256, signed_manifest_sha256: existing.signed_manifest_sha256, status: 'QUARANTINED' };
  }
}
