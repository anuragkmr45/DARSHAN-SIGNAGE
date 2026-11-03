import { ApiError } from '@/api/apiClient';
import { liveRuntimeApi } from '@/api/domains/liveRuntime';
import type { LiveAdmissionGrant, LiveAdmissionIdentity, LiveAdmissionPending, LivePresenterAdmissionInput,
  LiveRuntimeOccurrence, LiveRuntimePreflight, LiveRuntimeActionResult, LiveStartInput, LiveStopInput } from '@/api/liveRuntimeTypes';
import { createUuid } from './uuid';
import { stopPresenterCapture, type PresenterCapture, type PresenterConnection, type PresenterMedia } from './livePresenterMedia';

const DOCUMENT_RUNTIME_ID = createUuid();
export type PresenterPhase = 'LOADING' | 'IDLE' | 'CHOOSING' | 'PREVIEW' | 'STARTING' | 'PREPARING' | 'CONNECTING' | 'PUBLISHING' | 'RECONNECTING' | 'STOPPED' | 'EXPIRED' | 'STALE' | 'ERROR';
export interface PresenterSnapshot {
  phase: PresenterPhase; message: string; occurrence?: LiveRuntimeOccurrence; preflight?: LiveRuntimePreflight; capture: boolean; captureGeneration: number;
  localFrame: boolean; mediaConnected: boolean; publishAcknowledged: boolean; microphonePresent: boolean; capturedAudioPresent: boolean;
  audioDegraded: boolean; pendingStart: boolean; pendingStop: boolean; pickerPending: boolean;
}
type Api = Pick<typeof liveRuntimeApi, 'epoch' | 'get' | 'preflight' | 'start' | 'stop' | 'createPresenterAdmission' | 'ticket' | 'renew' | 'observe'>;
export class LivePresenterController {
  private generation = 0;
  private connectionGeneration = 0;
  private disposed = false;
  private review?: LiveRuntimeOccurrence;
  private authorityEpoch?: string;
  private capture?: PresenterCapture;
  private admission?: LiveAdmissionIdentity;
  private connection?: PresenterConnection;
  private startIntent?: LiveStartInput;
  private stopIntent?: LiveStopInput;
  private admissionIntent?: LivePresenterAdmissionInput;
  private windowDeadline = Infinity;
  private authorityDeadline = 0;
  private startupDeadline = 0;
  private reconnectDeadline = 0;
  private task = new AbortController();
  private grantTask?: object;
  private startTask?: object;
  private picker?: object;
  private timer?: ReturnType<typeof setTimeout>;
  private renewTimer?: ReturnType<typeof setTimeout>;
  private watchdog: ReturnType<typeof setInterval>;
  private lastTick: { mono: number; wall: number };
  private sequence = 0;
  private reviewCounter = 0;
  private reviewRequest = 0;
  private listeners = new Set<(state: PresenterSnapshot) => void>();
  private state: PresenterSnapshot = { phase: 'LOADING', message: 'Loading current live eligibility…', capture: false, captureGeneration: 0,
    localFrame: false, mediaConnected: false, publishAcknowledged: false, microphonePresent: false, capturedAudioPresent: false,
    audioDegraded: false, pendingStart: false, pendingStop: false, pickerPending: false };
  readonly runtimeSessionId: string;
  constructor(private readonly options: { actorId: string; occurrenceId: string; media: PresenterMedia; isSessionCurrent: () => boolean;
    api?: Api; now?: () => number; wall?: () => number; runtimeSessionId?: string }) {
    this.runtimeSessionId = options.runtimeSessionId ?? DOCUMENT_RUNTIME_ID;
    this.lastTick = { mono: this.now(), wall: this.wall() };
    this.watchdog = setInterval(() => this.tick(), 200);
  }
  private get api(): Api { return this.options.api ?? liveRuntimeApi; }
  private now(): number { return this.options.now?.() ?? performance.now(); }
  private wall(): number { return this.options.wall?.() ?? Date.now(); }
  getSnapshot(): PresenterSnapshot { return { ...this.state,
    ...(this.review ? { occurrence: { ...this.review, screen_ids: [...this.review.screen_ids], run: this.review.run ? { ...this.review.run } : null } } : {}),
    ...(this.state.preflight ? { preflight: { ...this.state.preflight } } : {}) }; }
  getPreviewStream(): MediaStream | null { return this.capture?.display ?? null; }
  subscribe(listener: (state: PresenterSnapshot) => void): () => void { this.listeners.add(listener); listener(this.getSnapshot()); return () => this.listeners.delete(listener); }
  private update(patch: Partial<PresenterSnapshot>): void {
    this.state = { ...this.state, ...patch, pendingStart: Boolean(this.startIntent), pendingStop: Boolean(this.stopIntent), pickerPending: Boolean(this.picker) };
    if (!this.disposed) for (const listener of this.listeners) listener(this.getSnapshot());
  }
  private current(generation: number): boolean { return !this.disposed && generation === this.generation && this.options.isSessionCurrent(); }
  private sameReview(row: LiveRuntimeOccurrence): boolean {
    const old = this.review;
    return !old || row.id === old.id && row.publish_id === old.publish_id && row.schedule_item_id === old.schedule_item_id &&
      row.live_session_id === old.live_session_id && row.presenter_user_id === old.presenter_user_id && row.item_fingerprint === old.item_fingerprint &&
      row.microphone === old.microphone && row.screen_share_audio === old.screen_share_audio && row.start_at === old.start_at && row.end_at === old.end_at &&
      row.screen_ids.length === old.screen_ids.length && row.screen_ids.every(id => old.screen_ids.includes(id));
  }
  private preflightMessage(preflight: LiveRuntimePreflight): string {
    switch (preflight.reason) {
      case 'READY': return 'Media preflight is ready. Choose a screen for a local preview, then explicitly start.';
      case 'OCCURRENCE_UNAVAILABLE': return 'Schedule, presenter, window or run state currently prevents Start. Media capture remains disabled.';
      case 'MEDIA_UNAVAILABLE': return 'No trusted media node is currently reachable. Media capture remains disabled.';
      case 'MEDIA_PREPARING': return 'The media service is preparing or temporarily not accepting a new run. Media capture remains disabled.';
      case 'MEDIA_CAPACITY': return 'The media node does not have safe capacity for this approved audience. Media capture remains disabled.';
      case 'RUNTIME_CAPACITY': return 'All ten live runtime slots are occupied until teardown is confirmed. Media capture remains disabled.';
    }
  }
  async load(): Promise<void> {
    const generation = this.generation, request = ++this.reviewRequest, started = this.now();
    try {
      const epoch = await this.api.epoch(createUuid(), this.task.signal);
      if (!this.current(generation) || request !== this.reviewRequest) return;
      if (this.authorityEpoch && epoch.epoch_id !== this.authorityEpoch) { this.terminal('STALE', 'Backend authority changed. Close these controls and review a new attempt.'); return; }
      const row = await this.api.get(this.options.occurrenceId, this.runtimeSessionId, this.task.signal);
      if (!this.current(generation) || request !== this.reviewRequest) return;
      if (row.id !== this.options.occurrenceId || row.presenter_user_id !== this.options.actorId || !this.sameReview(row)) { this.terminal('STALE', 'The reviewed occurrence or presenter changed. Open a fresh review.'); return; }
      if (this.review && row.control_revision < this.review.control_revision) return; // Ordering is used only after the nonce/epoch check.
      const preflight = await this.api.preflight(this.options.occurrenceId, this.runtimeSessionId, this.task.signal);
      if (!this.current(generation) || request !== this.reviewRequest) return;
      if (preflight.occurrence_id !== row.id || preflight.authority_epoch !== epoch.epoch_id ||
          preflight.control_revision !== row.control_revision || preflight.item_fingerprint !== row.item_fingerprint ||
          preflight.business_eligible !== row.can_start) {
        this.terminal('STALE', 'Live state changed while media readiness was checked. Reload and review a fresh attempt.'); return;
      }
      if (this.admission && (!row.enabled || !row.run?.owns_current_attempt || row.run.id !== this.admission.run_id || row.run.generation !== this.admission.generation ||
          row.run.node_instance_id !== this.review?.run?.node_instance_id || ['STOPPING', 'STOPPED'].includes(row.run.state))) {
        this.terminal('STOPPED', 'The current live attempt was stopped or replaced.'); return;
      }
      this.authorityEpoch = epoch.epoch_id; this.review = row;
      this.reviewCounter++;
      this.windowDeadline = Math.min(this.windowDeadline, started + Math.max(0, Date.parse(row.end_at) - Date.parse(epoch.server_now)));
      if (this.now() >= this.windowDeadline) { this.terminal('EXPIRED', 'The approved live window ended.'); return; }
      if (this.capture || this.startIntent || this.stopIntent) this.update({ preflight, message: 'Current state reloaded. Pending commands retain their original identity and authority.' });
      else this.update({ phase: 'IDLE', preflight, message: this.preflightMessage(preflight) });
    } catch (error) { if (this.current(generation) && request === this.reviewRequest) this.failure(error, 'Current live eligibility could not be loaded.'); }
  }
  async choose(options: { microphone: boolean; capturedAudio: boolean }): Promise<void> {
    if (this.disposed || this.picker || this.startTask || this.admission || this.stopIntent || this.startIntent || !this.review || !this.options.isSessionCurrent() ||
        ['STALE', 'EXPIRED'].includes(this.state.phase) || this.now() >= this.windowDeadline) return;
    if ((!this.review.can_start && !this.startIntent) || (!this.state.preflight?.ready && !this.startIntent) ||
        options.microphone && !this.review.microphone || options.capturedAudio && !this.review.screen_share_audio) return;
    this.clearLocal(); const generation = this.generation, picker = {}; this.picker = picker;
    this.update({ phase: 'CHOOSING', message: 'Choose the screen or window. Nothing is being published.' });
    let selected: PresenterCapture | undefined;
    try {
      // Native chooser invocation occurs synchronously in this user-gesture
      // call stack, before any await, nonce request or permission lookup.
      const displayPromise = this.options.media.display(options.capturedAudio);
      const display = await displayPromise; selected = { display };
      if (!this.current(generation) || this.now() >= this.windowDeadline) { stopPresenterCapture(selected); return; }
      if (display.getVideoTracks().length !== 1 || display.getVideoTracks()[0]?.readyState !== 'live') throw new Error('CAPTURE_UNAVAILABLE');
      this.capture = selected; // Stop/window/logout must own screen tracks even while a mic prompt is pending.
      const ended = () => { if (this.current(generation) && this.capture === selected) void this.stop('Sharing stopped by the presenter'); };
      for (const track of display.getVideoTracks()) { track.addEventListener('ended', ended, { once: true }); track.addEventListener('mute', ended, { once: true }); }
      if (!options.capturedAudio) for (const track of display.getAudioTracks()) track.stop();
      if (options.microphone) {
        try { selected.microphone = await this.options.media.microphone(); }
        catch { stopPresenterCapture(selected); if (this.current(generation)) { this.clearLocal(); this.update({ phase: 'ERROR', message: 'Microphone was not available. Choose a screen again with microphone off to retry without it.' }); } return; }
      }
      if (!this.current(generation) || this.now() >= this.windowDeadline) { stopPresenterCapture(selected); return; }
      if (display.getVideoTracks()[0]?.readyState !== 'live') { stopPresenterCapture(selected); return; }
      const audioChanged = () => { if (this.current(generation) && this.capture === selected) {
        this.update({ microphonePresent: Boolean(selected.microphone?.getAudioTracks().some(track => track.readyState === 'live' && !track.muted)),
          capturedAudioPresent: display.getAudioTracks().some(track => track.readyState === 'live' && !track.muted), audioDegraded: true,
          message: 'An optional capture audio source ended or became muted. Video may continue; audio is not assumed to be available.' });
      } };
      for (const track of [...display.getAudioTracks(), ...(selected.microphone?.getAudioTracks() ?? [])]) {
        track.addEventListener('ended', audioChanged); track.addEventListener('mute', audioChanged);
      }
      this.update({ phase: 'PREVIEW', capture: true, captureGeneration: this.state.captureGeneration + 1, localFrame: false,
        microphonePresent: Boolean(selected.microphone?.getAudioTracks().some(track => track.readyState === 'live' && !track.muted)),
        capturedAudioPresent: display.getAudioTracks().some(track => track.readyState === 'live' && !track.muted),
        message: options.capturedAudio && !display.getAudioTracks().some(track => track.readyState === 'live') ? 'Local preview only. The browser did not provide captured audio.' : 'Local preview only. Explicit Start is required before anything is published.' });
    } catch { stopPresenterCapture(selected); if (this.current(generation)) { this.clearLocal(); this.update({ phase: 'ERROR', message: 'Screen capture was cancelled or unavailable. No broadcast was started.' }); } }
    finally { if (this.picker === picker) { this.picker = undefined; this.update({}); } }
  }
  localFrame(captureGeneration: number): void { if (this.capture && captureGeneration === this.state.captureGeneration) this.update({ localFrame: true }); }
  private pinAdmission(value: LiveAdmissionIdentity): boolean {
    const row = this.review, run = row?.run;
    return Boolean(row && run && value.version === 1 && value.role === 'presenter' && value.authority_epoch === this.authorityEpoch &&
      value.occurrence_id === row.id && value.publish_id === row.publish_id && value.schedule_item_id === row.schedule_item_id &&
      value.run_id === run.id && value.generation === run.generation && value.participant_id === `presenter_${run.id}` &&
      value.presenter_participant_id === value.participant_id && value.presenter_user_id === this.options.actorId &&
      value.microphone === row.microphone && value.screen_share_audio === row.screen_share_audio && (!this.admission || value.admission_id === this.admission.admission_id));
  }
  async start(): Promise<void> {
    if (this.disposed || this.startTask || this.admission || this.stopIntent || !this.capture || !this.review || !this.authorityEpoch || !this.options.isSessionCurrent() || ['STALE', 'EXPIRED'].includes(this.state.phase)) return;
    if (!this.startIntent && (!this.review.can_start || !this.state.preflight?.ready)) return;
    ++this.reviewRequest; // A pre-start status request cannot overwrite its acknowledged run later.
    if (this.startIntent && (!this.startupDeadline || this.now() >= this.startupDeadline)) {
      this.terminal('EXPIRED', 'The original Start deadline expired. Review confirmed teardown before a new explicit attempt.'); return;
    }
    const generation = this.generation, job = {}; this.startTask = job;
    if (!this.startIntent) this.startupDeadline = this.now() + 10000;
    this.update({ phase: 'STARTING', message: this.startIntent ? 'Retrying the exact pending Start request.' : 'Requesting an explicit live attempt.' });
    try {
      const epoch = await this.api.epoch(createUuid(), this.task.signal);
      if (!this.current(generation)) return;
      if (epoch.epoch_id !== this.authorityEpoch) { this.terminal('STALE', 'Backend authority changed. Close and review a new attempt.'); return; }
      const command = this.startIntent ?? { request_id: createUuid(), runtime_session_id: this.runtimeSessionId, expected_authority_epoch: this.authorityEpoch,
        expected_control_revision: this.review.control_revision, expected_item_fingerprint: this.review.item_fingerprint };
      this.startIntent = Object.freeze(command); this.update({});
      const result = await this.api.start(this.review.id, command, this.task.signal);
      if (!this.current(generation)) { void this.cleanupLateStart(result, command); return; }
      if (!this.sameReview(result) || !result.run || !result.run.owns_current_attempt || result.presenter_user_id !== this.options.actorId) throw new Error('INVALID_AUTHORITY');
      this.startIntent = undefined; this.review = result;
      if (!result.enabled || !['PREPARING', 'RUNNING'].includes(result.run.state)) { this.terminal('STOPPED', 'The saved attempt is no longer active. Reload and explicitly review a new attempt.'); return; }
      this.admissionIntent = Object.freeze({ request_id: createUuid(), runtime_session_id: this.runtimeSessionId });
      this.update({ phase: 'PREPARING', preflight: undefined, message: 'Backend accepted the attempt. Waiting for media admission; no player display is confirmed.' });
      await this.prepareAdmission(generation);
    } catch (error) { if (this.current(generation)) this.failure(error, 'Start was not confirmed. Its exact request is retained; retry explicitly while the startup deadline remains valid.'); }
    finally { if (this.startTask === job) this.startTask = undefined; }
  }
  private async prepareAdmission(generation: number): Promise<void> {
    while (this.current(generation) && this.review?.run && this.admissionIntent && this.now() < this.startupDeadline) {
      let pending: LiveAdmissionPending;
      try { pending = await this.api.createPresenterAdmission(this.review.run.id, this.admissionIntent, this.task.signal); }
      catch (error) { if (this.terminalError(error)) throw error; await this.wait(500); continue; }
      if (!this.current(generation)) return;
      if (!this.pinAdmission(pending)) throw new Error('INVALID_AUTHORITY');
      this.admission = pending;
      if (pending.status === 'READY') { await this.connect(generation); return; }
      await this.wait(500);
    }
  }
  private authorized(generation: number): boolean { return this.current(generation) && Boolean(this.capture && this.admission) && this.now() < this.authorityDeadline && this.now() < this.windowDeadline; }
  private async authority(kind: 'ticket' | 'renew', generation: number): Promise<LiveAdmissionGrant | null> {
    if (this.grantTask || !this.admission || !this.current(generation)) return null;
    const job = {}; this.grantTask = job; const started = this.now(), admission = this.admission;
    try {
      const grant = await this.api[kind](admission.admission_id, { request_id: createUuid(), runtime_session_id: this.runtimeSessionId,
        run_id: admission.run_id, generation: admission.generation }, this.task.signal);
      if (!this.current(generation)) return null;
      if (!this.pinAdmission(grant) || grant.admission_id !== admission.admission_id || !Number.isSafeInteger(grant.lease_ms) || grant.lease_ms <= 0 || grant.lease_ms > 10000 ||
          !Number.isSafeInteger(grant.window_remaining_ms) || grant.window_remaining_ms <= 0) throw new Error('INVALID_AUTHORITY');
      if (this.authorityDeadline > 0 && this.authorityDeadline <= this.now()) { this.terminal('EXPIRED', 'Live authority expired. A new explicit attempt is required.'); return null; }
      const deadline = Math.min(this.windowDeadline, started + grant.lease_ms, started + grant.window_remaining_ms);
      if (deadline <= this.now()) throw new Error('INVALID_AUTHORITY');
      this.authorityDeadline = deadline; this.startupDeadline = 0;
      if (this.renewTimer) clearTimeout(this.renewTimer);
      this.renewTimer = setTimeout(() => void this.renew(generation), Math.max(0, started + 3000 - this.now()));
      return grant;
    } finally { if (this.grantTask === job) this.grantTask = undefined; }
  }
  private async connect(generation: number): Promise<void> {
    if (!this.current(generation) || !this.capture || !this.admission) return;
    const connectionGeneration = ++this.connectionGeneration;
    let obtainedGrant = false;
    try {
      const grant = await this.authority('ticket', generation);
      if (!grant || !this.authorized(generation) || connectionGeneration !== this.connectionGeneration || !grant.signaling) return;
      obtainedGrant = true;
      const valid = () => this.authorized(generation) && connectionGeneration === this.connectionGeneration;
      const connection = this.options.media.connection({
        connected: () => { if (valid()) this.update({ mediaConnected: true }); },
        published: () => { if (valid()) { this.reconnectDeadline = 0; this.update({ phase: 'PUBLISHING', publishAcknowledged: true, message: 'SDK acknowledged local publication. Player frames are confirmed separately.' }); this.observe(); } },
        disconnected: () => { if (valid()) this.reconnect(generation); },
        audioDegraded: () => { if (valid()) this.update({ audioDegraded: true, message: 'Video publication continues; an optional audio source was not published.' }); },
      });
      const reconnecting = this.reconnectDeadline > 0;
      if (!this.reconnectDeadline) this.reconnectDeadline = this.now() + 30000;
      this.connection = connection; this.update({ phase: reconnecting ? 'RECONNECTING' : 'CONNECTING', message: 'Connecting with a fresh single-use ticket.' });
      await connection.publish(grant, this.capture!, valid);
      if (!valid()) void connection.close().catch(() => undefined);
    } catch (error) {
      if (!this.current(generation) || connectionGeneration !== this.connectionGeneration) return;
      if (!obtainedGrant && this.terminalError(error)) { this.terminal('ERROR', 'Current live authority or identity was rejected. Capture was stopped.'); return; }
      if (this.authorityDeadline > this.now()) this.reconnect(generation);
      else if (this.startupDeadline > this.now()) this.timer = setTimeout(() => void this.connect(generation), 500);
    }
  }
  private async renew(generation: number): Promise<void> {
    this.renewTimer = undefined;
    if (!this.authorized(generation)) return;
    try { const renewed = await this.authority('renew', generation); if (renewed) this.observe(); }
    catch (error) { if (this.current(generation) && this.terminalError(error)) { this.terminal('ERROR', 'Live authority was revoked or changed. Capture was stopped.'); return; } }
    if (this.authorized(generation) && !this.renewTimer) this.renewTimer = setTimeout(() => void this.renew(generation), 500);
  }
  private reconnect(generation: number): void {
    if (!this.authorized(generation)) return;
    if (!this.reconnectDeadline) this.reconnectDeadline = this.now() + 30000;
    ++this.connectionGeneration; const old = this.connection; this.connection = undefined;
    void old?.close().catch(() => undefined);
    this.update({ phase: 'RECONNECTING', mediaConnected: false, publishAcknowledged: false, message: 'Media disconnected. A fresh ticket may reconnect only while the current lease remains valid.' });
    if (this.timer) clearTimeout(this.timer); this.timer = setTimeout(() => void this.connect(generation), 500);
  }
  private terminalError(error: unknown): boolean { return !(error instanceof ApiError) || error.status === 401 || error.status === 403 || error.status === 409 || error.status === 410 || error.code === 'LIVE_RESPONSE_INVALID'; }
  private failure(error: unknown, fallback: string): void {
    if (error instanceof ApiError && (error.status === 401 || error.status === 403)) { this.terminal('ERROR', 'The current session no longer permits this live action.'); return; }
    if (error instanceof ApiError && error.code === 'LIVE_AUTHORITY_EPOCH_CHANGED') { this.terminal('STALE', 'Backend authority changed. Close and review a new attempt.'); return; }
    if (!(error instanceof ApiError) || error.status === 409 || error.status === 410 || error.code === 'LIVE_RESPONSE_INVALID') { this.terminal('STALE', 'The live request no longer matches current authority. Reload and review explicitly.'); return; }
    this.update({ phase: 'ERROR', message: fallback });
  }
  private observe(): void {
    if (!this.admission || !this.authorized(this.generation)) return;
    void this.api.observe(this.admission.admission_id, { runtime_session_id: this.runtimeSessionId, run_id: this.admission.run_id,
      generation: this.admission.generation, sequence: ++this.sequence, connection: this.state.mediaConnected ? 'CONNECTED' : 'CONNECTING',
      subscription: 'NONE', frame: this.state.localFrame ? 'READY' : 'NONE', audio: this.state.audioDegraded ? 'DEGRADED' : !this.state.publishAcknowledged ? 'NONE' : this.state.microphonePresent || this.state.capturedAudioPresent ? 'READY' : 'MUTED',
      fallback_ready: false, fallback_reason: null }, this.task.signal).catch(() => undefined);
  }
  private wait(ms: number): Promise<void> {
    const signal = this.task.signal;
    return new Promise((resolve, reject) => { const abort = () => { clearTimeout(timer); reject(new Error('CANCELLED')); };
      const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, ms);
      if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true }); });
  }
  private tick(): void {
    const now = this.now(), wall = this.wall(), gap = now - this.lastTick.mono, wallGap = wall - this.lastTick.wall;
    this.lastTick = { mono: now, wall };
    if (this.disposed) return;
    if (!this.options.isSessionCurrent()) { this.terminal('STOPPED', 'The CMS session changed. Local capture was stopped.'); return; }
    if ((this.capture || this.picker) && (gap < 0 || gap > 1500 || Math.abs(wallGap - gap) > 1500)) { this.terminal('EXPIRED', 'The browser or machine paused. Explicitly review a new attempt.'); return; }
    if ((this.capture || this.picker || this.admission) && now >= this.windowDeadline) { this.terminal('EXPIRED', 'The approved live window ended.'); return; }
    if (this.authorityDeadline > 0 && now >= this.authorityDeadline || this.startupDeadline > 0 && now >= this.startupDeadline || this.reconnectDeadline > 0 && now >= this.reconnectDeadline) {
      this.terminal('EXPIRED', 'Live authority or its bounded connection deadline expired. A new explicit attempt is required.');
    }
  }
  private clearLocal(): void {
    ++this.generation; ++this.connectionGeneration; this.task.abort(); this.task = new AbortController();
    this.startTask = undefined; this.grantTask = undefined;
    if (this.timer) clearTimeout(this.timer); if (this.renewTimer) clearTimeout(this.renewTimer);
    this.timer = undefined; this.renewTimer = undefined;
    const capture = this.capture; this.capture = undefined;
    this.admission = undefined; this.admissionIntent = undefined;
    stopPresenterCapture(capture); // Must precede every asynchronous SDK/API cleanup.
    const connection = this.connection; this.connection = undefined; void connection?.close().catch(() => undefined);
    this.authorityDeadline = 0; this.startupDeadline = 0; this.reconnectDeadline = 0;
    this.update({ capture: false, localFrame: false, mediaConnected: false, publishAcknowledged: false, microphonePresent: false, capturedAudioPresent: false, audioDegraded: false });
  }
  private terminal(phase: PresenterPhase, message: string): void { this.clearLocal(); this.update({ phase, message }); void this.requestStop('Presenter authority or local capture ended'); }
  async stop(reason = 'Presenter stopped sharing'): Promise<void> { this.clearLocal(); this.update({ phase: 'STOPPED', message: 'Local capture and audio stopped. Waiting for backend stop confirmation.' }); await this.requestStop(reason); }
  private async requestStop(reason: string): Promise<void> {
    const row = this.review, run = row?.run;
    if (!row || !run || !this.authorityEpoch || !this.options.isSessionCurrent() || run.state === 'STOPPED') return;
    const command = this.stopIntent ?? { mode: 'PRESENTER' as const, request_id: createUuid(), runtime_session_id: this.runtimeSessionId,
      expected_authority_epoch: this.authorityEpoch, expected_control_revision: row.control_revision, reason, run_id: run.id, generation: run.generation };
    this.stopIntent = Object.freeze(command); this.update({});
    const generation = this.generation;
    try {
      const result = await this.api.stop(row.id, command);
      if (this.current(generation) && this.stopIntent === command && this.sameReview(result) &&
          result.run?.id === command.run_id && result.run.generation === command.generation) {
        this.review = result; this.stopIntent = undefined; this.update({ message: 'Stop accepted. Media capacity is retained until teardown is confirmed.' });
      }
    } catch { if (this.current(generation) && this.stopIntent === command) this.update({ message: 'Local capture is stopped. Stop confirmation is pending; Retry Stop preserves the exact original request.' }); }
  }
  private async cleanupLateStart(result: LiveRuntimeActionResult, command: LiveStartInput): Promise<void> {
    if (!result.run?.owns_current_attempt || !this.sameReview(result) || !this.options.isSessionCurrent()) return;
    try { await this.api.stop(result.id, { mode: 'PRESENTER', request_id: createUuid(), runtime_session_id: this.runtimeSessionId,
      expected_authority_epoch: command.expected_authority_epoch, expected_control_revision: result.control_revision,
      reason: 'Presenter closed before Start was acknowledged', run_id: result.run.id, generation: result.run.generation }); } catch { /* Independent media lease and reconciliation remain authoritative. */ }
  }
  async reviewNewAttempt(): Promise<void> {
    if (this.capture || this.startTask || this.picker || this.disposed) return;
    const before = this.reviewCounter, generation = this.generation;
    await this.load();
    if (!this.current(generation) || this.reviewCounter === before || !this.review?.can_start || !this.state.preflight?.ready ||
        this.review.run && this.review.run.state !== 'STOPPED') return;
    this.clearLocal(); this.startIntent = undefined; this.stopIntent = undefined;
    this.update({ phase: 'IDLE', message: 'Current state permits a new explicit review. Choose a screen; nothing resumes automatically.' });
  }
  dispose(): void { if (this.disposed) return; void this.stop('Presenter controls closed'); this.disposed = true; clearInterval(this.watchdog); this.listeners.clear(); }
}
