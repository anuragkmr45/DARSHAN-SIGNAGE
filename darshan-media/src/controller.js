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
export const CLEANUP_BUDGET_MS = 3000;
export const JOIN_SETTLE_BUDGET_MS = 500;

/** In-memory enforcement authority for one SFU node. PostgreSQL remains upstream authority. */
export class AdmissionController {
  constructor({ adapter, isolate, signalUrl, now = () => performance.now(), maxRuns = 10, maxReceivers = 25 }) {
    if (typeof isolate !== 'function') throw new Error('An SFU isolation hook is required');
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
  }

  create(input) {
    this.assertAvailable();
    requireValue(input && typeof input === 'object' && !Array.isArray(input), 'INVALID_INPUT');
    requireValue(opaqueId(input.id) && opaqueId(input.run_id) && opaqueId(input.participant_id), 'INVALID_ID');
    requireValue(Number.isSafeInteger(input.generation) && input.generation > 0, 'INVALID_GENERATION');
    requireValue(input.role === 'presenter' || input.role === 'receiver', 'INVALID_ROLE');
    this.validateTiming(input);
    requireValue(input.window_remaining_ms > CLEANUP_BUDGET_MS, 'AUTHORITY_WINDOW_TOO_SHORT');
    requireValue(input.audio && typeof input.audio.microphone === 'boolean' && typeof input.audio.screen_share_audio === 'boolean', 'INVALID_AUDIO_POLICY');
    if (this.admissions.has(input.id)) throw new MediaError('ADMISSION_EXISTS');
    const room = `darshan-${createHash('sha256').update(JSON.stringify([input.run_id, input.generation])).digest('hex').slice(0, 40)}`;
    const participantKey = `${room}:${input.participant_id}`;
    if (this.participants.has(participantKey)) throw new MediaError('PARTICIPANT_IDENTITY_ALREADY_USED');
    const occupied = [...this.admissions.values()].filter((entry) => entry.state !== 'REVOKED');
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
    const now = this.now();
    const entry = {
      id: input.id, runId: input.run_id, generation: input.generation, participantId: input.participant_id,
      role: input.role, audio: { ...input.audio }, room, state: 'IDLE',
      hardDeadline: now + input.window_remaining_ms,
      deadline: now + Math.min(input.lease_ms, input.window_remaining_ms),
      requestedLeaseMs: input.lease_ms,
      connection: undefined, removalPromise: undefined, ticketHash: undefined,
    };
    this.admissions.set(entry.id, entry);
    this.runGenerations.set(entry.runId, entry.generation);
    // Identities are tombstoned even after revocation; a later attempt needs a new identity.
    this.participants.set(participantKey, entry.id);
    return this.issueTicket(entry.id, entry.generation);
  }

  get(id) {
    const entry = this.admissions.get(id);
    if (!entry) throw new MediaError('ADMISSION_NOT_FOUND', 404);
    return entry;
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
    };
  }

  renew(id, input) {
    requireValue(input && typeof input === 'object' && !Array.isArray(input), 'INVALID_INPUT');
    const entry = this.get(id);
    this.assertCurrent(entry, input.generation);
    this.validateTiming(input);
    const now = this.now();
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

  issueTicket(id, generation) {
    const entry = this.get(id);
    this.assertCurrent(entry, generation);
    if (entry.state !== 'IDLE' && entry.state !== 'ISSUED') throw new MediaError('PARTICIPANT_STILL_CONNECTED');
    this.invalidateTicket(entry);
    const ticket = randomBytes(32).toString('base64url');
    entry.ticketHash = ticketHash(ticket);
    this.tickets.set(entry.ticketHash, entry.id);
    entry.state = 'ISSUED';
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

  async revoke(id, reason = 'REVOKED') {
    const entry = this.get(id);
    entry.revokeReason = reason;
    this.invalidateTicket(entry);
    await this.remove(entry, true);
    return this.view(entry);
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
    for (const entry of this.admissions.values()) {
      entry.revoked = true;
      entry.state = 'REVOKED';
      try { entry.connection?.destroy(); } catch { /* Isolation must not depend on client socket health. */ }
      try { entry.pendingJoin?.abort?.(); } catch { /* Node isolation remains mandatory. */ }
      entry.connection = undefined;
    }
    this.isolationPromise = Promise.resolve().then(() => this.isolate(reason)).then(() => {
      this.isolationComplete = true;
    }).catch(() => {
      // Remain isolated and unhealthy; the independent supervisor must enforce shutdown.
      this.isolationComplete = false;
    });
    return this.isolationPromise;
  }

  async sweep() {
    const now = this.now();
    await Promise.all([...this.admissions.values()]
      .filter((entry) => entry.state !== 'REVOKED' && now >= entry.deadline - CLEANUP_BUDGET_MS)
      .map((entry) => this.revoke(entry.id, 'EXPIRED')));
  }

  health() {
    return { status: this.isolated ? 'isolated' : 'ready', isolation_complete: this.isolationComplete,
      active_admissions: [...this.admissions.values()].filter((entry) => entry.state !== 'REVOKED').length };
  }
}
