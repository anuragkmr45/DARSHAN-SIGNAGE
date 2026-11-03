import { createHash, randomBytes } from 'node:crypto';
import { performance } from 'node:perf_hooks';

export class MediaError extends Error {
  constructor(code, status = 409) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

const requireValue = (condition, code, status = 400) => {
  if (!condition) throw new MediaError(code, status);
};
const opaqueId = (value) => typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,128}$/.test(value);
const ticketHash = (ticket) => createHash('sha256').update(ticket).digest('hex');
const duration = (value, max) => Number.isSafeInteger(value) && value > 0 && value <= max;
const runKey = (runId, generation) => JSON.stringify([runId, generation]);
const verifiedAuthority = Symbol('verified authority');
export const CLEANUP_BUDGET_MS = 3000;
export const JOIN_SETTLE_BUDGET_MS = 500;

/** In-memory enforcement authority for one SFU node. PostgreSQL remains upstream authority. */
export class AdmissionController {
  constructor({ adapter, isolate, signalUrl, now = () => performance.now(), maxRuns = 10, maxReceivers = 25, maxTrackedEntries = 10_000, maxPendingAuthorityChecks = 512, startHeadroom = maxRuns * (maxReceivers + 2), managedInstanceId, ready = true, strictAuthority, hostReadiness }) {
    if (typeof isolate !== 'function') throw new Error('An SFU isolation hook is required');
    if (!Number.isSafeInteger(maxTrackedEntries) || maxTrackedEntries < 1) throw new Error('Invalid tracked-state limit');
    if (!Number.isSafeInteger(maxPendingAuthorityChecks) || maxPendingAuthorityChecks < 1) throw new Error('Invalid pending authority limit');
    if (!Number.isSafeInteger(startHeadroom) || startHeadroom < 1) throw new Error('Invalid admission maintenance headroom');
    this.adapter = adapter;
    this.isolate = isolate;
    this.signalUrl = signalUrl;
    this.now = now;
    this.maxRuns = maxRuns;
    this.maxReceivers = maxReceivers;
    this.admissions = new Map();
    this.tickets = new Map();
    this.participants = new Map();
    this.runGenerations = new Map();
    this.admissionTombstones = new Map();
    this.runTombstones = new Set();
    this.trackedStateKeys = new Set();
    this.maxTrackedEntries = maxTrackedEntries;
    if (strictAuthority && (!opaqueId(strictAuthority.nodeInstanceId) || !opaqueId(strictAuthority.authorityEpoch)
      || typeof strictAuthority.verifyAuthority !== 'function'
      || !duration(strictAuthority.verificationTimeoutMs ?? 1500, 1500)
      || (strictAuthority.mode !== undefined && !['backend', 'strict-injected'].includes(strictAuthority.mode)))) throw new Error('Invalid strict authority configuration');
    this.strictAuthority = strictAuthority ? Object.freeze({ ...strictAuthority }) : undefined;
    this.authorityOperations = new Map();
    this.pendingAuthorityChecks = new Set();
    this.maxPendingAuthorityChecks = maxPendingAuthorityChecks;
    this.startHeadroom = startHeadroom;
    this.managedInstanceId = managedInstanceId;
    this.hostReadiness = hostReadiness;
    this.ready = ready;
    this.isolated = false;
    this.isolationComplete = false;
    this.isolationPromise = undefined;
  }

  validateTiming(input) {
    requireValue(duration(input.lease_ms, 10_000), 'INVALID_LEASE');
    requireValue(duration(input.window_remaining_ms, 2_147_483_647), 'INVALID_WINDOW');
    requireValue(input.lease_ms > CLEANUP_BUDGET_MS, 'LEASE_TOO_SHORT');
  }

  assertAvailable() {
    if (this.isolated) throw new MediaError('MEDIA_NODE_ISOLATED', 503);
    if (this.strictAuthority?.mode === 'backend' && !this.hostReadiness?.check()) throw new MediaError('MEDIA_HOST_NOT_READY', 503);
    if (!this.ready) throw new MediaError('MEDIA_NODE_NOT_READY', 503);
  }

  trackState(keys) {
    const missing = [...new Set(keys)].filter(key => !this.trackedStateKeys.has(key));
    if (this.trackedStateKeys.size + missing.length > this.maxTrackedEntries) {
      void this.isolateNode('TRACKED_STATE_CAPACITY_EXHAUSTED');
      throw new MediaError('TRACKED_STATE_CAPACITY_EXHAUSTED', 503);
    }
    for (const key of missing) this.trackedStateKeys.add(key);
  }

  assertNotRevoked(id, runId, generation) {
    if (this.admissionTombstones.has(id)) throw new MediaError('ADMISSION_REVOKED', 410);
    if (this.runTombstones.has(runKey(runId, generation))) throw new MediaError('RUN_REVOKED', 410);
  }

  occupiedAdmissions() {
    // Logical revocation alone does not prove that the SFU stopped transmitting.
    return [...this.admissions.values()].filter(entry => entry.state !== 'REVOKED' || !entry.teardownConfirmed);
  }

  identityView() {
    return this.strictAuthority ? { protocol_version: 1, node_instance_id: this.strictAuthority.nodeInstanceId,
      authority_epoch: this.strictAuthority.authorityEpoch,
      ...(this.managedInstanceId ? { managed_instance_id: this.managedInstanceId } : {}) } : {};
  }

  validateFence(input) {
    requireValue(input && typeof input === 'object' && !Array.isArray(input), 'INVALID_INPUT');
    if (input.node_instance_id !== this.strictAuthority.nodeInstanceId) throw new MediaError('MEDIA_NODE_INSTANCE_MISMATCH');
    if (input.authority_epoch !== this.strictAuthority.authorityEpoch) throw new MediaError('AUTHORITY_EPOCH_MISMATCH');
    requireValue(Number.isSafeInteger(input.operation_revision) && input.operation_revision > 0, 'INVALID_OPERATION_REVISION');
  }

  admissionTarget(id, input) {
    requireValue(opaqueId(id) && opaqueId(input.run_id), 'INVALID_ID');
    requireValue(input.id === undefined || input.id === id, 'INVALID_ADMISSION_TARGET');
    requireValue(Number.isSafeInteger(input.generation) && input.generation > 0, 'INVALID_GENERATION');
    const entry = this.admissions.get(id);
    if (entry && (entry.runId !== input.run_id || entry.generation !== input.generation)) throw new MediaError('ADMISSION_IDENTITY_MISMATCH');
    return { id, run_id: input.run_id, generation: input.generation };
  }

  claimAuthorityOperation(scope, input, target, action) {
    const previous = this.authorityOperations.get(scope);
    if (previous && (previous.runId !== target.run_id || previous.generation !== target.generation)) throw new MediaError('ADMISSION_IDENTITY_MISMATCH');
    const replayedRevoke = previous && previous.revision === input.operation_revision && previous.action === action && action === 'REVOKE';
    if (previous && input.operation_revision <= previous.revision && !replayedRevoke) throw new MediaError('STALE_OPERATION');
    if (replayedRevoke) return previous;
    this.trackState([scope, `run:${runKey(target.run_id, target.generation)}`]);
    previous?.abort?.abort();
    const operation = { revision: input.operation_revision, action, runId: target.run_id, generation: target.generation };
    this.authorityOperations.set(scope, operation);
    return operation;
  }

  async authorizeAdmission(action, id, input) {
    this.validateFence(input); // A foreign instance/epoch must never reserve or poison local state.
    this.assertAvailable();
    const target = this.admissionTarget(id, input);
    this.assertNotRevoked(id, target.run_id, target.generation);
    if (action !== 'CREATE') this.assertCurrent(this.get(id), target.generation);
    if (action === 'CREATE' && this.strictAuthority.mode === 'backend'
      && !this.occupiedAdmissions().some(entry => entry.runId === target.run_id && entry.generation === target.generation)
      && ![...this.pendingAuthorityChecks].some(entry => entry.runId === target.run_id && entry.generation === target.generation)
      && this.maxTrackedEntries - this.trackedStateKeys.size < this.startHeadroom) {
      throw new MediaError('MEDIA_NODE_MAINTENANCE_REQUIRED', 503);
    }
    if (this.pendingAuthorityChecks.size >= this.maxPendingAuthorityChecks) {
      void this.isolateNode('AUTHORITY_CHECK_CAPACITY_EXHAUSTED');
      throw new MediaError('AUTHORITY_CHECK_CAPACITY_EXHAUSTED', 503);
    }
    const scope = `admission:${id}`;
    const operation = this.claimAuthorityOperation(scope, input, target, action);
    const startedAt = this.now();
    const nonce = randomBytes(32).toString('base64url');
    const abort = new AbortController();
    operation.abort = abort;
    this.pendingAuthorityChecks.add(operation);
    let timer;
    let abortCheck;
    try {
      const grant = await Promise.race([
        Promise.resolve().then(() => this.strictAuthority.verifyAuthority(Object.freeze({
          ...target, ...this.identityView(), action, nonce, operation_revision: operation.revision, signal: abort.signal,
        }))),
        new Promise((_, reject) => { timer = setTimeout(() => {
          reject(new MediaError('AUTHORITY_CHECK_TIMEOUT', 503)); abort.abort();
        }, this.strictAuthority.verificationTimeoutMs ?? 1500); }),
        new Promise((_, reject) => {
          abortCheck = () => reject(new MediaError('AUTHORITY_CHECK_CANCELLED', 409));
          abort.signal.addEventListener('abort', abortCheck, { once: true });
        }),
      ]);
      this.assertAvailable();
      if (this.authorityOperations.get(scope) !== operation) throw new MediaError('STALE_OPERATION');
      this.assertNotRevoked(id, target.run_id, target.generation);
      if (!grant || grant.nonce !== nonce || grant.node_instance_id !== this.strictAuthority.nodeInstanceId
        || grant.authority_epoch !== this.strictAuthority.authorityEpoch || grant.operation_revision !== operation.revision
        || grant.id !== id || grant.run_id !== target.run_id || grant.generation !== target.generation) throw new MediaError('AUTHORITY_RESPONSE_MISMATCH', 403);
      if (grant.allowed === false) {
        await this.revoke(id, 'AUTHORITY_DENIED', target);
        throw new MediaError('AUTHORITY_DENIED', 403);
      }
      requireValue(grant.allowed === true, 'AUTHORITY_RESPONSE_INVALID', 403);
      const canonical = { ...target, participant_id: grant.participant_id, role: grant.role,
        audio: { microphone: grant.audio?.microphone, screen_share_audio: grant.audio?.screen_share_audio },
        lease_ms: grant.lease_ms, window_remaining_ms: grant.window_remaining_ms };
      requireValue(opaqueId(canonical.participant_id), 'INVALID_AUTHORITY_PARTICIPANT', 403);
      requireValue(canonical.role === 'presenter' || canonical.role === 'receiver', 'INVALID_AUTHORITY_ROLE', 403);
      requireValue(typeof canonical.audio.microphone === 'boolean' && typeof canonical.audio.screen_share_audio === 'boolean', 'INVALID_AUDIO_POLICY');
      this.validateTiming(canonical);
      if (this.now() >= startedAt + Math.min(canonical.lease_ms, canonical.window_remaining_ms) - CLEANUP_BUDGET_MS) {
        throw new MediaError('AUTHORITY_CHECK_EXPIRED', 410);
      }
      if (action !== 'CREATE') {
        const entry = this.get(id);
        if (entry.participantId !== canonical.participant_id || entry.role !== canonical.role
          || entry.audio.microphone !== canonical.audio.microphone || entry.audio.screen_share_audio !== canonical.audio.screen_share_audio) {
          throw new MediaError('AUTHORITY_IDENTITY_MISMATCH', 403);
        }
      }
      return { canonical, startedAt, operation, scope };
    } finally {
      clearTimeout(timer);
      abort.signal.removeEventListener('abort', abortCheck);
      abort.abort();
      operation.abort = undefined;
      this.pendingAuthorityChecks.delete(operation);
    }
  }

  assertAuthorizedResult(result) {
    this.assertAvailable();
    if (this.authorityOperations.get(result.scope) !== result.operation) throw new MediaError('STALE_OPERATION');
    this.assertNotRevoked(result.canonical.id, result.canonical.run_id, result.canonical.generation);
  }

  async createAuthorized(input) {
    if (!this.strictAuthority) return this.create(input);
    const result = await this.authorizeAdmission('CREATE', input?.id, input);
    this.assertAuthorizedResult(result);
    const { canonical, startedAt } = result;
    return this.create(canonical, verifiedAuthority, startedAt);
  }

  async renewAuthorized(id, input) {
    if (!this.strictAuthority) return this.renew(id, input);
    const result = await this.authorizeAdmission('RENEW', id, input);
    this.assertAuthorizedResult(result);
    const { canonical, startedAt } = result;
    return this.renew(id, canonical, verifiedAuthority, startedAt);
  }

  async issueTicketAuthorized(id, input) {
    if (!this.strictAuthority) return this.issueTicket(id, input.generation);
    const result = await this.authorizeAdmission('TICKET', id, input);
    this.assertAuthorizedResult(result);
    const { canonical, startedAt } = result;
    const entry = this.get(id);
    this.assertCurrent(entry, canonical.generation);
    if (entry.state !== 'IDLE' && entry.state !== 'ISSUED') throw new MediaError('PARTICIPANT_STILL_CONNECTED');
    this.renew(id, canonical, verifiedAuthority, startedAt);
    return this.issueTicket(id, canonical.generation, verifiedAuthority);
  }

  async revokeAuthorized(id, input) {
    let target;
    if (this.strictAuthority) {
      this.validateFence(input);
      target = this.admissionTarget(id, input);
      this.claimAuthorityOperation(`admission:${id}`, input, target, 'REVOKE');
    }
    return this.revoke(id, 'REVOKED', target);
  }

  async revokeRunAuthorized(runId, input) {
    requireValue(input && typeof input === 'object' && !Array.isArray(input), 'INVALID_INPUT');
    if (this.strictAuthority) {
      this.validateFence(input);
      requireValue(opaqueId(runId) && Number.isSafeInteger(input.generation) && input.generation > 0, 'INVALID_RUN');
      this.claimAuthorityOperation(`run:${runKey(runId, input.generation)}`, input, { run_id: runId, generation: input.generation }, 'REVOKE');
    }
    return this.revokeRun(runId, input.generation);
  }

  create(input, proof, anchoredAt) {
    if (this.strictAuthority && proof !== verifiedAuthority) throw new MediaError('STRICT_AUTHORITY_REQUIRED', 403);
    this.assertAvailable();
    requireValue(input && typeof input === 'object' && !Array.isArray(input), 'INVALID_INPUT');
    requireValue(opaqueId(input.id) && opaqueId(input.run_id) && opaqueId(input.participant_id), 'INVALID_ID');
    requireValue(Number.isSafeInteger(input.generation) && input.generation > 0, 'INVALID_GENERATION');
    requireValue(input.role === 'presenter' || input.role === 'receiver', 'INVALID_ROLE');
    this.validateTiming(input);
    requireValue(input.window_remaining_ms > CLEANUP_BUDGET_MS, 'AUTHORITY_WINDOW_TOO_SHORT');
    requireValue(input.audio && typeof input.audio.microphone === 'boolean' && typeof input.audio.screen_share_audio === 'boolean', 'INVALID_AUDIO_POLICY');
    this.assertNotRevoked(input.id, input.run_id, input.generation);
    if (this.admissions.has(input.id)) throw new MediaError('ADMISSION_EXISTS');
    const roomIdentity = this.strictAuthority
      ? [this.strictAuthority.authorityEpoch, this.strictAuthority.nodeInstanceId, input.run_id, input.generation]
      : [input.run_id, input.generation];
    const room = `darshan-${createHash('sha256').update(JSON.stringify(roomIdentity)).digest('hex').slice(0, 40)}`;
    const participantKey = `${room}:${input.participant_id}`;
    if (this.participants.has(participantKey)) throw new MediaError('PARTICIPANT_IDENTITY_ALREADY_USED');
    const occupied = this.occupiedAdmissions();
    const currentGeneration = this.runGenerations.get(input.run_id);
    if (currentGeneration !== undefined && input.generation < currentGeneration) throw new MediaError('STALE_GENERATION');
    if (currentGeneration !== undefined && input.generation > currentGeneration && occupied.some((entry) => entry.runId === input.run_id)) {
      throw new MediaError('PRIOR_GENERATION_STILL_OCCUPIED');
    }
    if (!occupied.some((entry) => entry.room === room) && new Set(occupied.map((entry) => entry.room)).size >= this.maxRuns) {
      throw new MediaError('RUN_CAPACITY_EXCEEDED');
    }
    const roomEntries = occupied.filter((entry) => entry.room === room);
    if (input.role === 'presenter' && roomEntries.some((entry) => entry.role === 'presenter')) throw new MediaError('PRESENTER_ALREADY_ADMITTED');
    if (input.role === 'receiver' && roomEntries.filter((entry) => entry.role === 'receiver').length >= this.maxReceivers) {
      throw new MediaError('RECEIVER_CAPACITY_EXCEEDED');
    }
    this.trackState([`admission:${input.id}`, `run:${runKey(input.run_id, input.generation)}`]);
    const now = proof === verifiedAuthority ? anchoredAt : this.now();
    const entry = {
      id: input.id, runId: input.run_id, generation: input.generation, participantId: input.participant_id,
      role: input.role, audio: { ...input.audio }, room, state: 'IDLE',
      hardDeadline: now + input.window_remaining_ms,
      deadline: now + Math.min(input.lease_ms, input.window_remaining_ms),
      requestedLeaseMs: input.lease_ms,
      teardownConfirmed: false,
      connection: undefined, removalPromise: undefined, ticketHash: undefined,
    };
    this.admissions.set(entry.id, entry);
    this.runGenerations.set(entry.runId, entry.generation);
    // Identities are tombstoned even after revocation; a later attempt needs a new identity.
    this.participants.set(participantKey, entry.id);
    return this.issueTicket(entry.id, entry.generation, proof);
  }

  get(id) {
    const entry = this.admissions.get(id);
    if (!entry) throw new MediaError('ADMISSION_NOT_FOUND', 404);
    return entry;
  }

  admissionView(id) {
    if (this.admissionTombstones.has(id) && !this.admissions.has(id)) return this.revokedAdmissionView(id);
    return this.view(this.get(id));
  }

  assertCurrent(entry, generation) {
    this.assertAvailable();
    if (generation !== entry.generation) throw new MediaError('STALE_GENERATION');
    if (entry.revoked || entry.state === 'REVOKED' || this.now() >= entry.deadline - CLEANUP_BUDGET_MS) {
      // Begin removal synchronously before exposing the expired state to another caller.
      void this.revoke(entry.id, 'EXPIRED');
      throw new MediaError('ADMISSION_EXPIRED', 410);
    }
  }

  view(entry) {
    const now = this.now();
    return {
      admission_id: entry.id, run_id: entry.runId, generation: entry.generation,
      state: entry.state, lease_ms: Math.max(0, Math.floor(entry.deadline - now)),
      window_remaining_ms: Math.max(0, Math.floor(entry.hardDeadline - now)),
      requested_lease_ms: entry.requestedLeaseMs, cleanup_budget_ms: CLEANUP_BUDGET_MS,
      enforcement_starts_in_ms: Math.max(0, Math.floor(entry.deadline - CLEANUP_BUDGET_MS - now)),
      teardown_confirmed: entry.teardownConfirmed === true,
      ...this.identityView(),
    };
  }

  renew(id, input, proof, anchoredAt) {
    if (this.strictAuthority && proof !== verifiedAuthority) throw new MediaError('STRICT_AUTHORITY_REQUIRED', 403);
    requireValue(input && typeof input === 'object' && !Array.isArray(input), 'INVALID_INPUT');
    const entry = this.get(id);
    this.assertCurrent(entry, input.generation);
    this.validateTiming(input);
    const now = proof === verifiedAuthority ? anchoredAt : this.now();
    // Neither a replay nor an upstream clock change can extend the original approved window.
    entry.hardDeadline = Math.min(entry.hardDeadline, now + input.window_remaining_ms);
    entry.deadline = Math.min(now + input.lease_ms, entry.hardDeadline);
    entry.requestedLeaseMs = input.lease_ms;
    this.assertCurrent(entry, input.generation);
    return this.view(entry);
  }

  invalidateTicket(entry) {
    if (entry.ticketHash) this.tickets.delete(entry.ticketHash);
    entry.ticketHash = undefined;
  }

  issueTicket(id, generation, proof) {
    if (this.strictAuthority && proof !== verifiedAuthority) throw new MediaError('STRICT_AUTHORITY_REQUIRED', 403);
    const entry = this.get(id);
    this.assertCurrent(entry, generation);
    if (entry.state !== 'IDLE' && entry.state !== 'ISSUED') throw new MediaError('PARTICIPANT_STILL_CONNECTED');
    this.invalidateTicket(entry);
    const ticket = randomBytes(32).toString('base64url');
    entry.ticketHash = ticketHash(ticket);
    this.tickets.set(entry.ticketHash, entry.id);
    entry.state = 'ISSUED';
    entry.teardownConfirmed = false;
    return { ...this.view(entry), ticket, signal_url: this.signalUrl };
  }

  /** Consume before any asynchronous token/SFU work, so concurrent upgrades cannot replay. */
  inspectTicket(ticket) {
    this.assertAvailable();
    if (typeof ticket !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(ticket)) throw new MediaError('INVALID_TICKET', 401);
    const id = this.tickets.get(ticketHash(ticket));
    if (!id) throw new MediaError('INVALID_TICKET', 401);
    const entry = this.get(id);
    this.assertCurrent(entry, entry.generation);
    if (entry.state !== 'ISSUED') throw new MediaError('INVALID_TICKET', 401);
    return entry;
  }

  consumeTicket(ticket) {
    const entry = this.inspectTicket(ticket);
    this.invalidateTicket(entry);
    entry.state = 'CONNECTING';
    return entry;
  }

  setConnection(entry, connection) {
    this.assertCurrent(entry, entry.generation);
    if (entry.state !== 'CONNECTING') throw new MediaError('STALE_CONNECTION');
    entry.connection = connection;
    entry.state = 'CONNECTED';
  }

  registerPendingJoin(entry, pendingJoin) {
    this.assertCurrent(entry, entry.generation);
    if (entry.state !== 'CONNECTING') throw new MediaError('STALE_CONNECTION');
    entry.pendingJoin = pendingJoin;
  }

  async disconnect(id) {
    const entry = this.get(id);
    if (entry.state === 'REMOVING') return entry.removalPromise;
    if (entry.state === 'REVOKED' || entry.state === 'IDLE' || entry.state === 'ISSUED') return;
    await this.remove(entry, false);
  }

  async revoke(id, reason = 'REVOKED', target) {
    requireValue(opaqueId(id), 'INVALID_ID');
    this.trackState([`admission:${id}`]);
    // Retain unknown IDs too: a delayed create cannot resurrect an earlier stop.
    const entry = this.admissions.get(id);
    const previous = this.admissionTombstones.get(id);
    this.admissionTombstones.set(id, { reason, runId: entry?.runId ?? target?.run_id ?? previous?.runId,
      generation: entry?.generation ?? target?.generation ?? previous?.generation });
    if (!entry) return this.revokedAdmissionView(id);
    entry.revokeReason = reason;
    this.invalidateTicket(entry);
    await this.remove(entry, true);
    return this.view(entry);
  }

  revokedAdmissionView(id) {
    const target = this.admissionTombstones.get(id);
    return { admission_id: id, state: 'REVOKED', lease_ms: 0, window_remaining_ms: 0,
      ...(target?.runId ? { run_id: target.runId, generation: target.generation } : {}),
      teardown_confirmed: true, teardown_reason: 'ADMISSION_NEVER_CREATED', ...this.identityView() };
  }

  runView(runId, generation) {
    const entries = [...this.admissions.values()].filter(entry => entry.runId === runId && entry.generation === generation);
    const revoked = this.runTombstones.has(runKey(runId, generation));
    if (!entries.length && !revoked) throw new MediaError('RUN_NOT_FOUND', 404);
    return { run_id: runId, generation, state: revoked ? 'REVOKED' : 'ACTIVE',
      admission_count: entries.length, teardown_confirmed: revoked && entries.every(entry => entry.teardownConfirmed), ...this.identityView() };
  }

  async revokeRun(runId, generation, reason = 'RUN_REVOKED') {
    requireValue(opaqueId(runId), 'INVALID_ID');
    requireValue(Number.isSafeInteger(generation) && generation > 0, 'INVALID_GENERATION');
    this.trackState([`run:${runKey(runId, generation)}`]);
    this.runTombstones.add(runKey(runId, generation));
    for (const operation of this.authorityOperations.values()) {
      if (operation.runId === runId && operation.generation === generation) operation.abort?.abort();
    }
    this.runGenerations.set(runId, Math.max(generation, this.runGenerations.get(runId) ?? 0));
    await Promise.all([...this.admissions.values()]
      .filter(entry => entry.runId === runId && entry.generation === generation)
      .map(entry => this.revoke(entry.id, reason)));
    return this.runView(runId, generation);
  }

  async remove(entry, revoke) {
    entry.revoked = entry.revoked || revoke;
    if (entry.state === 'REVOKED') return;
    if (entry.removalPromise) return entry.removalPromise;
    entry.state = 'REMOVING';
    this.invalidateTicket(entry);
    // Close signaling too, but SFU removal below is what terminates established media.
    const connection = entry.connection;
    entry.connection = undefined;
    try { connection?.destroy(); } catch { /* SFU removal must still run if signaling disposal fails. */ }
    try { entry.pendingJoin?.closeClient(); } catch { /* Still reconcile the SFU join. */ }
    const operation = (async () => {
      let joinTimer;
      try {
        if (entry.pendingJoin) {
          // not_found is insufficient while an upstream join may still create the participant.
          const outcome = await Promise.race([
            entry.pendingJoin.settled.catch(() => 'UNCERTAIN'),
            new Promise((resolve) => { joinTimer = setTimeout(() => resolve('UNCERTAIN'), JOIN_SETTLE_BUDGET_MS); }),
          ]);
          clearTimeout(joinTimer);
          if (outcome !== 'CONFIRMED' && outcome !== 'REJECTED') {
            await this.isolateNode('UPSTREAM_JOIN_UNCERTAIN');
            entry.state = 'REVOKED';
            return;
          }
        }
        await this.adapter.removeParticipant(entry.room, entry.participantId);
        entry.teardownConfirmed = true;
        entry.state = entry.revoked || this.isolated ? 'REVOKED' : 'IDLE';
        entry.pendingJoin = undefined;
      } catch {
        await this.isolateNode('PARTICIPANT_REMOVAL_FAILED');
        entry.state = 'REVOKED';
      } finally {
        clearTimeout(joinTimer);
        entry.removalPromise = undefined;
      }
    })();
    entry.removalPromise = operation;
    return operation;
  }

  async isolateNode(reason) {
    if (this.isolationPromise) return this.isolationPromise;
    this.isolated = true;
    this.tickets.clear();
    for (const operation of this.authorityOperations.values()) operation.abort?.abort();
    for (const entry of this.admissions.values()) {
      entry.revoked = true;
      entry.state = 'REVOKED';
      try { entry.connection?.destroy(); } catch { /* Isolation must not depend on client socket health. */ }
      try { entry.pendingJoin?.abort?.(); } catch { /* Node isolation remains mandatory. */ }
      entry.connection = undefined;
    }
    this.isolationPromise = Promise.resolve().then(() => this.isolate(reason)).then(() => {
      this.isolationComplete = true;
      for (const entry of this.admissions.values()) entry.teardownConfirmed = true;
    }).catch(() => {
      // Remain isolated and unhealthy; the independent supervisor must enforce shutdown.
      this.isolationComplete = false;
    });
    return this.isolationPromise;
  }

  async sweep() {
    if (this.strictAuthority?.mode === 'backend') this.hostReadiness?.check();
    const now = this.now();
    await Promise.all([...this.admissions.values()]
      .filter((entry) => entry.state !== 'REVOKED' && now >= entry.deadline - CLEANUP_BUDGET_MS)
      .map((entry) => this.revoke(entry.id, 'EXPIRED')));
  }

  health() {
    const hostReady = this.strictAuthority?.mode !== 'backend' || this.hostReadiness?.check() === true;
    const remaining = this.maxTrackedEntries - this.trackedStateKeys.size;
    const maintenance = this.strictAuthority?.mode === 'backend' && remaining < this.startHeadroom;
    return { status: this.isolated ? 'isolated' : this.ready && hostReady ? 'ready' : 'starting', isolation_complete: this.isolationComplete,
      active_admissions: this.occupiedAdmissions().length,
      occupied_runs: new Set(this.occupiedAdmissions().map(entry => entry.room)).size,
      tracked_entries: this.trackedStateKeys.size, tracked_entry_limit: this.maxTrackedEntries,
      tracked_remaining: remaining, required_start_headroom: this.startHeadroom,
      accepting_new_runs: !this.isolated && this.ready && hostReady && !maintenance, maintenance_reason: maintenance ? 'TRACKED_STATE_HEADROOM_LOW' : null,
      pending_authority_checks: this.pendingAuthorityChecks.size, pending_check_limit: this.maxPendingAuthorityChecks,
      authority_mode: this.strictAuthority ? this.strictAuthority.mode ?? 'strict-injected' : 'prototype', ...this.identityView() };
  }
}
