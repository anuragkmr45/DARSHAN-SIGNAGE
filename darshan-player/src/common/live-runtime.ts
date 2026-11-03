import type { FrozenLivePolicy } from './live-playback'

/** Memory-only runtime authority; these types must never enter DeviceSnapshot. */
export type LiveRunSummary = { id: string; generation: number; state: 'PREPARING' | 'RUNNING' | 'STOPPING' | 'STOPPED';
  node_instance_id: string; presenter_participant_id: string; created_at: string; stopped_at: string | null; owns_current_attempt: boolean }
export type LiveRuntimeState = { version: 1; authority_epoch: string; server_now: string; live_version: string | null;
  availability: 'READY' | 'NOT_RUNNING' | 'PREPARING' | 'STOPPING' | 'DISABLED' | 'ENDED' | 'EMERGENCY' | 'UNAVAILABLE';
  occurrence_id: string; publish_id: string; schedule_id: string; schedule_item_id: string; start_at: string; end_at: string;
  screen_ids: string[]; control_revision: number; enabled: boolean; policy_status: 'VALID' | 'INVALID';
  policy: FrozenLivePolicy | null; run: LiveRunSummary | null }
export type LiveAdmissionIdentity = { version: 1; authority_epoch: string; server_now: string; live_version: string | null;
  occurrence_id: string; publish_id: string; schedule_item_id: string; run_id: string; generation: number;
  admission_id: string; role: 'receiver'; participant_id: string; presenter_participant_id: string; presenter_user_id: string;
  microphone: boolean; screen_share_audio: boolean }
export type LiveAdmissionPending = LiveAdmissionIdentity & { status: 'PREPARING' | 'READY'; retry_after_ms: 500 }
export type LiveAdmissionGrant = LiveAdmissionIdentity & { status: 'AUTHORIZED'; lease_ms: number; window_remaining_ms: number;
  renew_after_ms: 3000; signaling?: { url: string; ticket: string } }
/** Only ephemeral renderer data; no authority REST endpoint or credentials. */
export type LiveReceiverGrant = { view_epoch: string; run_id: string; generation: number; admission_id: string;
  participant_id: string; presenter_participant_id: string; microphone: boolean; screen_share_audio: boolean;
  lease_remaining_ms: number; signaling: { url: string; ticket: string } }
export type LiveReceiverLease = { view_epoch: string; lease_ms: number }
export type LiveReceiverObservation = { view_epoch: string; kind: 'connected' | 'first-frame' | 'audio-ready' | 'audio-degraded' | 'disconnected' | 'failed' | 'heartbeat' }
export type LiveReceiverBridge = { grant(): Promise<LiveReceiverGrant | null>; report(observation: LiveReceiverObservation): void;
  lease(): Promise<LiveReceiverLease | null>; onActivate(listener: () => void): () => void }
