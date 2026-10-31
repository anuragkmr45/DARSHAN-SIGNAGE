import { canonicalJson } from '../backups/backup-broker-protocol';
import { sha256RecoveryBytes } from './contracts';
import { RecoveryError } from './errors';
import { type ScopedTargetHelperJournal, TargetHelperJournal, type TargetHelperIdentity,
  type TargetHelperJournalState } from './target-helper-journal';
import { encodeTargetHelperResponse, parseTargetHelperRequest, type TargetHelperErrorCode,
  type TargetHelperOperation, type TargetHelperRequest, type TargetHelperResponse,
  type TargetLifecycleState } from './target-helper-protocol';
import { type RecoveryTargetEngineCallContext, type VerifiedTargetStorageContext,
  type VerifiedTargetStorageContextV2 } from './target-storage-authority';

export interface TargetEngineObservation {
  state: TargetLifecycleState;
  evidenceSha256: string;
}

export interface RecoveryTargetEngineAdapter {
  inspect(identity: TargetHelperIdentity, context: RecoveryTargetEngineCallContext): Promise<TargetEngineObservation>;
  inspectPending?(identity: TargetHelperIdentity, context: RecoveryTargetEngineCallContext,
    operation: Exclude<TargetHelperOperation, 'INSPECT'>): Promise<TargetEngineObservation>;
  prepare(identity: TargetHelperIdentity, context: RecoveryTargetEngineCallContext): Promise<TargetEngineObservation>;
  stopRetain(identity: TargetHelperIdentity, context: RecoveryTargetEngineCallContext): Promise<TargetEngineObservation>;
  retire(identity: TargetHelperIdentity, context: RecoveryTargetEngineCallContext): Promise<TargetEngineObservation>;
}

export class TargetEngineEffectError extends Error {
  constructor(message: string, public readonly disposition: 'DEFINITE' | 'AMBIGUOUS', options?: ErrorOptions) {
    super(message, options); this.name = 'TargetEngineEffectError';
  }
}

/** Stable fail-before-effect marker for the intentionally absent Packet 05B1b2a production engine. */
export class TargetEngineNotInstalledError extends TargetEngineEffectError {
  constructor() { super('Target engine is not installed.', 'DEFINITE'); this.name = 'TargetEngineNotInstalledError'; }
}

export type TargetHelperFaultStage = 'after-intent' | 'before-effect' | 'after-effect' | 'before-receipt' | 'after-receipt';

export interface RecoveryTargetAuthorizationCheck {
  screen(request: TargetHelperRequest, freshness: RecoveryTargetAuthorizationFreshness): Promise<void> | void;
  locked(request: TargetHelperRequest, state: Readonly<TargetHelperJournalState> | undefined,
    freshness: RecoveryTargetAuthorizationFreshness):
    Promise<VerifiedTargetStorageContext | VerifiedTargetStorageContextV2 | void> |
    VerifiedTargetStorageContext | VerifiedTargetStorageContextV2 | void;
  beforeDispatch?(request: TargetHelperRequest, state: Readonly<TargetHelperJournalState> | undefined,
    freshness: RecoveryTargetAuthorizationFreshness):
    Promise<VerifiedTargetStorageContext | VerifiedTargetStorageContextV2 | void> |
    VerifiedTargetStorageContext | VerifiedTargetStorageContextV2 | void;
  /** Synchronous gateway verification used at every engine await/effect boundary. */
  assertFresh?(freshness: RecoveryTargetAuthorizationFreshness): void;
}

export interface RecoveryTargetAuthorizationFreshness {
  readonly deadline: Date;
  readonly signal: AbortSignal;
}

function identity(request: TargetHelperRequest): TargetHelperIdentity {
  return { operationId: request.operationId, siteId: request.siteId, hostInstallationId: request.hostInstallationId,
    planSha256: request.planSha256, targetSetId: request.targetSetId, generation: request.generation,
    targetSpecificationSha256: request.targetSpecificationSha256 };
}

function intermediate(operation: TargetHelperOperation, current: TargetLifecycleState): TargetLifecycleState {
  if (operation === 'PREPARE') return current === 'ABSENT' ? 'RESERVED' : 'ALLOCATING';
  if (operation === 'STOP_RETAIN' || operation === 'RETIRE') return 'STOPPING';
  return current;
}

function expectedTerminal(operation: TargetHelperOperation): TargetLifecycleState | null {
  return operation === 'PREPARE' ? 'READY' : operation === 'STOP_RETAIN' ? 'STOPPED_RETAINED' : operation === 'RETIRE' ? 'RETIRED' : null;
}

function safeToRetryEffect(operation: Exclude<TargetHelperOperation, 'INSPECT'>, observed: TargetLifecycleState): boolean {
  if (operation === 'PREPARE') return ['ABSENT', 'RESERVED', 'ALLOCATING', 'CREATED', 'STARTING', 'FAILED_RETAINED'].includes(observed);
  if (operation === 'STOP_RETAIN') return ['READY', 'CREATED', 'STARTING', 'STOPPING'].includes(observed);
  return ['READY', 'STOPPED_RETAINED', 'FAILED_RETAINED', 'STOPPING'].includes(observed);
}

function validAction(operation: TargetHelperOperation, state: TargetLifecycleState): boolean {
  if (operation === 'INSPECT') return true;
  if (operation === 'PREPARE') return ['ABSENT', 'RESERVED', 'ALLOCATING', 'CREATED', 'STARTING', 'FAILED_RETAINED', 'RECONCILIATION_REQUIRED'].includes(state);
  if (operation === 'STOP_RETAIN') return ['READY', 'STARTING', 'CREATED', 'STOPPING', 'RECONCILIATION_REQUIRED'].includes(state);
  return ['READY', 'STOPPED_RETAINED', 'FAILED_RETAINED', 'STOPPING', 'RECONCILIATION_REQUIRED'].includes(state);
}

function common(request: TargetHelperRequest) {
  return { format: request.format, requestId: request.requestId, operation: request.operation,
    operationId: request.operationId, siteId: request.siteId, hostInstallationId: request.hostInstallationId,
    planSha256: request.planSha256, targetSetId: request.targetSetId, generation: request.generation,
    targetSpecificationSha256: request.targetSpecificationSha256, authorizationSha256: request.authorizationSha256 };
}

function success(request: TargetHelperRequest, sequence: number, observation: TargetEngineObservation,
  pendingAction: TargetHelperOperation | null, effectDisposition: 'NONE' | 'DEFINITE' | 'AMBIGUOUS', now: Date): TargetHelperResponse {
  return { ...common(request), ok: true, helperSequence: sequence, state: observation.state, pendingAction,
    reconciliationEvidenceSha256: effectDisposition === 'AMBIGUOUS' ? null : observation.evidenceSha256,
    effectDisposition, observedAt: now.toISOString() };
}

function failure(request: TargetHelperRequest, state: TargetHelperJournalState, code: TargetHelperErrorCode,
  message: string, now: Date): TargetHelperResponse {
  return { ...common(request), ok: false, helperSequence: state.helperSequence + 1, state: state.state,
    pendingAction: state.pendingAction, error: { code, message }, observedAt: now.toISOString() };
}

function unavailable(request: TargetHelperRequest, sequence: number, state: TargetLifecycleState,
  pendingAction: TargetHelperOperation | null, now: Date): TargetHelperResponse {
  return { ...common(request), ok: false, helperSequence: sequence, state, pendingAction,
    error: { code: 'TARGET_NOT_INSTALLED', message: 'Target engine is not installed.' }, observedAt: now.toISOString() };
}

function appendReplay(state: TargetHelperJournalState, request: TargetHelperRequest, requestSha256: string,
  response: TargetHelperResponse): TargetHelperJournalState {
  const all = [...state.replay, { requestId: request.requestId, requestSha256, response }];
  const pinned = all.filter((entry) => entry.response.ok && entry.response.operation === 'PREPARE' &&
    entry.response.state === 'READY' && entry.response.pendingAction === null && entry.response.effectDisposition === 'DEFINITE' &&
    entry.response.reconciliationEvidenceSha256 !== null &&
    sha256RecoveryBytes(canonicalJson(entry.response)) === state.lastReceiptSha256);
  if (pinned.length > 1) {
    throw new RecoveryError('RECOVERY_JOURNAL_CORRUPT', 'Target-helper replay contains multiple pinned PREPARE receipts.');
  }
  const replay = pinned.length === 0 ? all.slice(-128)
    : [pinned[0]!, ...all.filter((entry) => entry !== pinned[0]).slice(-127)]
      .sort((left, right) => left.response.helperSequence - right.response.helperSequence);
  return { ...state, replay };
}

export class RecoveryTargetHelperService {
  private readonly inFlight = new Map<string, { requestSha256: string; promise: Promise<Buffer> }>();
  constructor(private readonly options: {
    journal: TargetHelperJournal;
    engine: RecoveryTargetEngineAdapter;
    authorize(request: TargetHelperRequest): Promise<void> | void;
    now?: () => Date;
    defaultDeadline?: () => Date;
    deadlineNow?: () => Date;
    fault?: (stage: TargetHelperFaultStage) => Promise<void>;
  }) {}

  async handle(bytes: Uint8Array, authorization?: RecoveryTargetAuthorizationCheck, execution?: {
    requestBody?: Uint8Array; deadline?: Date; signal?: AbortSignal;
  }): Promise<Buffer> {
    const request = parseTargetHelperRequest(bytes);
    const deadlineNow = this.options.deadlineNow ?? (() => new Date()); const startedAt = deadlineNow();
    const deadline = execution?.deadline ?? (this.options.defaultDeadline ??
      (() => new Date(startedAt.getTime() + 60_000)))();
    if (!Number.isFinite(deadline.getTime()) || deadline.getTime() <= startedAt.getTime()) {
      throw new RecoveryError('RECOVERY_TARGET_PROTOCOL_INVALID', 'Target-engine deadline is invalid or expired.');
    }
    const controller = new AbortController(); const sourceSignal = execution?.signal;
    const forwardAbort = () => controller.abort(sourceSignal?.reason);
    if (sourceSignal?.aborted) forwardAbort(); else sourceSignal?.addEventListener('abort', forwardAbort, { once: true });
    let deadlineTimer: NodeJS.Timeout | undefined;
    const armDeadline = () => {
      const remaining = deadline.getTime() - deadlineNow().getTime();
      if (remaining <= 0) { controller.abort(new Error('target action deadline')); return; }
      deadlineTimer = setTimeout(armDeadline, Math.min(remaining, 0x7fff_ffff));
    };
    armDeadline(); const signal = controller.signal; const freshness = Object.freeze({ deadline, signal });
    try {
      await this.options.authorize(request); await authorization?.screen(request, freshness);
      signal.throwIfAborted();
      const engineContext: RecoveryTargetEngineCallContext = Object.freeze({ request, requestBody: execution?.requestBody ?? bytes,
        authorizationSha256: request.authorizationSha256, deadline, signal,
        assertFresh: authorization?.assertFresh ? () => authorization.assertFresh!(freshness) : undefined });
      const requestSha256 = sha256RecoveryBytes(canonicalJson(request));
      const inFlightKey = `${request.targetSetId}:${request.requestId}`;
      const existing = this.inFlight.get(inFlightKey);
      if (existing) {
        if (existing.requestSha256 !== requestSha256) throw new RecoveryError('RECOVERY_TARGET_REQUEST_CONFLICT', 'Concurrent requestId was reused with a different canonical body.');
        return await existing.promise;
      }
      const promise = this.handleAuthorized(request, requestSha256, authorization, engineContext, freshness);
      this.inFlight.set(inFlightKey, { requestSha256, promise });
      try { return await promise; } finally { this.inFlight.delete(inFlightKey); }
    } finally {
      if (deadlineTimer) clearTimeout(deadlineTimer);
      sourceSignal?.removeEventListener('abort', forwardAbort);
    }
  }

  private async handleAuthorized(request: TargetHelperRequest, requestSha256: string,
    authorization: RecoveryTargetAuthorizationCheck | undefined,
    engineContext: RecoveryTargetEngineCallContext,
    freshness: RecoveryTargetAuthorizationFreshness): Promise<Buffer> {
    if (request.operation === 'INSPECT') {
      if (!authorization) return encodeTargetHelperResponse(await this.inspectReadonly(request, undefined, false, engineContext));
      const response = await this.options.journal.withTargetReadonly(identity(request), async ({ state }) => {
        const storage = await authorization.locked(request, state, freshness);
        const freshStorage = await authorization.beforeDispatch?.(request, state, freshness);
        return this.inspectReadonly(request, state, true,
          Object.freeze({ ...engineContext, storage: freshStorage ?? storage ?? undefined }));
      });
      return encodeTargetHelperResponse(response);
    }
    const action = request.operation;
    let lockedStorage: VerifiedTargetStorageContext | VerifiedTargetStorageContextV2 | undefined;
    const response = await this.options.journal.withTarget(identity(request), async (journal) => {
      let authorizedEngineContext = Object.freeze({ ...engineContext, storage: lockedStorage });
      let state = journal.read();
      const replay = state.replay.find((entry) => entry.requestId === request.requestId);
      if (replay) {
        if (replay.requestSha256 !== requestSha256) throw new RecoveryError('RECOVERY_TARGET_REQUEST_CONFLICT', 'requestId was reused with a different canonical body.');
        return replay.response;
      }
      if (state.pendingRequestId === request.requestId && state.pendingRequestSha256 !== requestSha256) {
        throw new RecoveryError('RECOVERY_TARGET_REQUEST_CONFLICT', 'Pending requestId was reused with a different canonical body.');
      }
      if (state.pendingAction !== null && state.pendingRequestId === request.requestId &&
          state.pendingRequestSha256 === requestSha256 && state.pendingAction === request.operation) {
        const freshStorage = await authorization?.beforeDispatch?.(request, state, freshness);
        authorizedEngineContext = Object.freeze({ ...engineContext, storage: freshStorage ?? lockedStorage });
        return this.reconcilePending(journal, state, request, requestSha256, authorizedEngineContext,
          authorization ? async (currentState) => authorization.beforeDispatch?.(request, currentState, freshness) : undefined);
      }
      if (request.expectedHelperSequence !== null && request.expectedHelperSequence !== state.helperSequence) {
        return this.recordError(journal, state, request, requestSha256, 'TARGET_SEQUENCE_CONFLICT', 'Expected helper sequence is stale.');
      }
      if (state.pendingAction !== null) {
        return this.recordError(journal, state, request, requestSha256, 'TARGET_STATE_CONFLICT', 'A different durable target action is pending reconciliation.');
      }
      if (!validAction(request.operation, state.state)) {
        return this.recordError(journal, state, request, requestSha256, 'TARGET_STATE_CONFLICT', 'Target action is invalid from the current lifecycle state.');
      }
      const stableState = state.state;
      state = await journal.write((current) => ({ ...current, state: intermediate(request.operation, current.state),
        pendingAction: request.operation, pendingRequestId: request.requestId, pendingRequestSha256: requestSha256,
        effectDisposition: 'NONE', reconciliationEvidenceSha256: null }));
      await this.options.fault?.('after-intent'); await this.options.fault?.('before-effect');
      const freshStorage = await authorization?.beforeDispatch?.(request, state, freshness);
      authorizedEngineContext = Object.freeze({ ...engineContext, storage: freshStorage ?? lockedStorage });
      let observed: TargetEngineObservation;
      try { observed = await this.invoke(action, identity(request), authorizedEngineContext); }
      catch (cause) {
        const disposition = cause instanceof TargetEngineEffectError ? cause.disposition : 'AMBIGUOUS';
        if (disposition === 'AMBIGUOUS') {
          await journal.write((current) => ({ ...current, state: 'RECONCILIATION_REQUIRED', effectDisposition: 'AMBIGUOUS' }));
          throw new RecoveryError('RECOVERY_TARGET_EFFECT_AMBIGUOUS', 'Target engine effect requires exact reconciliation.', { cause });
        }
        return this.recordError(journal, state, request, requestSha256,
          cause instanceof TargetEngineNotInstalledError ? 'TARGET_NOT_INSTALLED' : 'TARGET_ENGINE_FAILED',
          cause instanceof TargetEngineNotInstalledError ? 'Target engine is not installed.' :
            'Target engine rejected the action before effect.', true, stableState);
      }
      await this.options.fault?.('after-effect'); await this.options.fault?.('before-receipt');
      authorizedEngineContext.assertFresh?.();
      const terminal = expectedTerminal(request.operation);
      if (terminal === null || observed.state !== terminal) {
        await journal.write((current) => ({ ...current, state: 'RECONCILIATION_REQUIRED', effectDisposition: 'AMBIGUOUS' }));
        throw new RecoveryError('RECOVERY_TARGET_EFFECT_AMBIGUOUS', 'Target engine returned non-terminal effect evidence.');
      }
      const finalResponse = success(request, state.helperSequence + 1, observed, null, 'DEFINITE', this.now());
      const finalReceiptSha256 = sha256RecoveryBytes(canonicalJson(finalResponse));
      state = await journal.write((current) => appendReplay({ ...current, state: observed.state, pendingAction: null,
        pendingRequestId: null, pendingRequestSha256: null, effectDisposition: 'DEFINITE',
        reconciliationEvidenceSha256: observed.evidenceSha256,
        lastReceiptSha256: request.operation === 'PREPARE' ? finalReceiptSha256 : current.lastReceiptSha256 },
      request, requestSha256, finalResponse));
      await this.options.fault?.('after-receipt'); void state; return finalResponse;
    }, authorization ? async (state) => {
      lockedStorage = (await authorization.locked(request, state, freshness)) ?? undefined;
    } : undefined);
    return encodeTargetHelperResponse(response);
  }

  private now(): Date { return (this.options.now ?? (() => new Date()))(); }

  private invoke(operation: Exclude<TargetHelperOperation, 'INSPECT'>, value: TargetHelperIdentity,
    context: RecoveryTargetEngineCallContext): Promise<TargetEngineObservation> {
    context.signal.throwIfAborted();
    return operation === 'PREPARE' ? this.options.engine.prepare(value, context)
      : operation === 'STOP_RETAIN' ? this.options.engine.stopRetain(value, context) : this.options.engine.retire(value, context);
  }

  private async readReadonlyState(request: TargetHelperRequest): Promise<TargetHelperJournalState | undefined> {
    let state: TargetHelperJournalState | undefined;
    try { state = await this.options.journal.read(request.targetSetId); }
    catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== 'ENOENT' &&
          (!(cause instanceof RecoveryError) || cause.code !== 'RECOVERY_JOURNAL_MISSING')) throw cause;
    }
    return state;
  }

  private async inspectReadonly(request: TargetHelperRequest, lockedState?: TargetHelperJournalState,
    stateAlreadyRead = false, engineContext?: RecoveryTargetEngineCallContext): Promise<TargetHelperResponse> {
    let state: TargetHelperJournalState | undefined = lockedState;
    if (!stateAlreadyRead) state = await this.readReadonlyState(request);
    if (state && (state.operationId !== request.operationId || state.siteId !== request.siteId ||
        state.hostInstallationId !== request.hostInstallationId || state.planSha256 !== request.planSha256 ||
        state.generation !== request.generation || state.targetSpecificationSha256 !== request.targetSpecificationSha256)) {
      throw new RecoveryError('RECOVERY_TARGET_REQUEST_CONFLICT', 'Target inspection identity conflicts with its durable helper journal.');
    }
    let observed: TargetEngineObservation;
    if (!engineContext) throw new RecoveryError('RECOVERY_TARGET_PROTOCOL_INVALID', 'Target-engine execution context is absent.');
    try { engineContext.signal.throwIfAborted(); observed = await this.options.engine.inspect(identity(request), engineContext); }
    catch (cause) {
      if (cause instanceof TargetEngineNotInstalledError) return unavailable(request, state?.helperSequence ?? 0,
        state?.state ?? 'ABSENT', state?.pendingAction ?? null, this.now());
      throw cause;
    }
    engineContext.assertFresh?.();
    if (stateAlreadyRead) {
      const latest = await this.readReadonlyState(request);
      if (latest) state = latest;
    }
    return success(request, state?.helperSequence ?? 0, observed, state?.pendingAction ?? null,
      state?.effectDisposition ?? 'NONE', this.now());
  }

  private async reconcilePending(journal: ScopedTargetHelperJournal, state: TargetHelperJournalState,
    request: TargetHelperRequest, requestSha256: string, engineContext: RecoveryTargetEngineCallContext,
    refresh?: (state: Readonly<TargetHelperJournalState>) => Promise<VerifiedTargetStorageContext |
      VerifiedTargetStorageContextV2 | void>): Promise<TargetHelperResponse> {
    engineContext.signal.throwIfAborted();
    if (request.operation === 'INSPECT') {
      throw new RecoveryError('RECOVERY_JOURNAL_CORRUPT', 'INSPECT cannot be a pending mutating helper action.');
    }
    let observed = this.options.engine.inspectPending
      ? await this.options.engine.inspectPending(identity(request), engineContext, request.operation)
      : await this.options.engine.inspect(identity(request), engineContext);
    const expected = expectedTerminal(request.operation);
    const afterInspectStorage = await refresh?.(state);
    engineContext = Object.freeze({ ...engineContext, storage: afterInspectStorage ?? engineContext.storage });
    engineContext.signal.throwIfAborted();
    if (observed.state !== expected && safeToRetryEffect(request.operation, observed.state)) {
      const beforeRetryStorage = await refresh?.(state);
      engineContext = Object.freeze({ ...engineContext, storage: beforeRetryStorage ?? engineContext.storage });
      engineContext.signal.throwIfAborted();
      const stableObservedState = observed.state;
      try { observed = await this.invoke(request.operation, identity(request), engineContext); }
      catch (cause) {
        const disposition = cause instanceof TargetEngineEffectError ? cause.disposition : 'AMBIGUOUS';
        if (disposition === 'DEFINITE') {
          return this.recordError(journal, state, request, requestSha256,
            cause instanceof TargetEngineNotInstalledError ? 'TARGET_NOT_INSTALLED' : 'TARGET_ENGINE_FAILED',
            cause instanceof TargetEngineNotInstalledError ? 'Target engine is not installed.' :
              'Target engine rejected the reconciled action before effect.', true, stableObservedState);
        }
        await journal.write((current) => ({ ...current, state: 'RECONCILIATION_REQUIRED', effectDisposition: 'AMBIGUOUS' }));
        throw new RecoveryError('RECOVERY_TARGET_EFFECT_AMBIGUOUS', 'Retried target effect remains ambiguous.', { cause });
      }
    }
    if (observed.state !== expected) {
      await journal.write((current) => ({ ...current, state: 'RECONCILIATION_REQUIRED', effectDisposition: 'AMBIGUOUS' }));
      throw new RecoveryError('RECOVERY_TARGET_EFFECT_AMBIGUOUS', 'Pending target effect is not yet conclusively reconciled.');
    }
    const response = success(request, state.helperSequence + 1, observed, null, 'DEFINITE', this.now());
    engineContext.assertFresh?.();
    const receiptSha256 = sha256RecoveryBytes(canonicalJson(response));
    await journal.write((current) => appendReplay({ ...current, state: observed.state, pendingAction: null,
      pendingRequestId: null, pendingRequestSha256: null, effectDisposition: 'DEFINITE',
      reconciliationEvidenceSha256: observed.evidenceSha256,
      lastReceiptSha256: request.operation === 'PREPARE' ? receiptSha256 : current.lastReceiptSha256 },
    request, requestSha256, response)); return response;
  }

  private async recordError(journal: ScopedTargetHelperJournal, state: TargetHelperJournalState, request: TargetHelperRequest,
    requestSha256: string, code: TargetHelperErrorCode, message: string, clearPending = false,
    restoreState?: TargetLifecycleState): Promise<TargetHelperResponse> {
    const response = failure(request, restoreState === undefined ? state : { ...state, state: restoreState }, code, message, this.now());
    await journal.write((current) => appendReplay(clearPending ? { ...current,
      state: restoreState ?? current.state, pendingAction: null, pendingRequestId: null, pendingRequestSha256: null,
      effectDisposition: 'DEFINITE' } : current,
    request, requestSha256, response)); return response;
  }
}

/** Deterministic test-only engine. It never invokes Docker or the host filesystem. */
export class DeterministicFakeTargetEngine implements RecoveryTargetEngineAdapter {
  private readonly targets = new Map<string, TargetLifecycleState>();
  private readonly failures: Array<{ operation: TargetHelperOperation; disposition: 'DEFINITE' | 'AMBIGUOUS' }> = [];
  injectFailure(operation: TargetHelperOperation, disposition: 'DEFINITE' | 'AMBIGUOUS'): void {
    this.failures.push({ operation, disposition });
  }
  setState(targetSetId: string, state: TargetLifecycleState): void { this.targets.set(targetSetId, state); }
  private evidence(identity: TargetHelperIdentity, state: TargetLifecycleState): TargetEngineObservation {
    return { state, evidenceSha256: sha256RecoveryBytes(canonicalJson({ format: 'darshan-fake-target-engine-evidence-v1',
      targetSetId: identity.targetSetId, generation: identity.generation, state })) };
  }
  private effect(operation: TargetHelperOperation, identity: TargetHelperIdentity, state: TargetLifecycleState): TargetEngineObservation {
    const fault = this.failures.shift();
    if (fault) {
      if (fault.operation !== operation) throw new Error('Fake engine fault order mismatch.');
      if (fault.disposition === 'AMBIGUOUS') this.targets.set(identity.targetSetId, state);
      throw new TargetEngineEffectError('Injected fake engine failure.', fault.disposition);
    }
    this.targets.set(identity.targetSetId, state); return this.evidence(identity, state);
  }
  async inspect(identity: TargetHelperIdentity): Promise<TargetEngineObservation> {
    return this.evidence(identity, this.targets.get(identity.targetSetId) ?? 'ABSENT');
  }
  async prepare(identity: TargetHelperIdentity): Promise<TargetEngineObservation> { return this.effect('PREPARE', identity, 'READY'); }
  async stopRetain(identity: TargetHelperIdentity): Promise<TargetEngineObservation> { return this.effect('STOP_RETAIN', identity, 'STOPPED_RETAINED'); }
  async retire(identity: TargetHelperIdentity): Promise<TargetEngineObservation> { return this.effect('RETIRE', identity, 'RETIRED'); }
}

/** Packet 05B1b2a production seam: every observation/effect fails before touching a target. */
export class UnavailableRecoveryTargetEngine implements RecoveryTargetEngineAdapter {
  async inspect(): Promise<TargetEngineObservation> { throw new TargetEngineNotInstalledError(); }
  async prepare(): Promise<TargetEngineObservation> { throw new TargetEngineNotInstalledError(); }
  async stopRetain(): Promise<TargetEngineObservation> { throw new TargetEngineNotInstalledError(); }
  async retire(): Promise<TargetEngineObservation> { throw new TargetEngineNotInstalledError(); }
}
