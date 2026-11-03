/** Durable policy and response-only authoring previews. Runtime admissions and
 * signaling credentials must never be stored with these authoring records. */
export interface LiveFallbackAsset {
  id: string; media_id: string; storage_object_id: string; bucket: string; object_key: string;
  sha256: string; size: number; content_type: string; render_type: "image" | "video" | "pdf" | "hls";
  representation: string; dependencies?: string[]; cache_key: string;
}
export interface LiveFallbackEntry {
  id: string; slot_id?: string; order: number; asset_id: string; duration_seconds?: number;
  page_number?: number; fit_mode?: "contain" | "cover" | "stretch"; audio_enabled?: boolean; loop_enabled?: boolean;
}
export interface LiveFallbackManifest {
  version: 1;
  presentation: { id: string; layout?: { id: string; aspect_ratio: string; spec: unknown } | null; items: LiveFallbackEntry[] };
  assets: LiveFallbackAsset[];
}
export interface LiveFallbackPreparation {
  id: string; presentation_id: string; state: "PENDING" | "PROCESSING" | "READY" | "FAILED" | "CANCELLED";
  source_fingerprint: string; failure_code: string | null; manifest: LiveFallbackManifest | null;
  dispatch_pending: boolean; created_at: string; updated_at: string;
}
export interface LiveFallbackPreview {
  preparation_id: string; presentation_id: string; source_fingerprint: string; checked_at: string;
  manifest: LiveFallbackManifest;
  downloads: Array<{ asset_id: string; cache_key: string; sha256: string; size: number; content_type: string; url: string; expires_at: string }>;
}
export interface FrozenLivePolicy {
  version: 1; source_kind: "LIVE"; schedule_id: string; schedule_item_id: string; schedule_revision: number;
  live_session_id: string; presenter_user_id: string; policy_revision: number; microphone: boolean; screen_share_audio: boolean;
  start_at: string; end_at: string; priority: number; screen_ids: string[]; screen_group_ids: string[];
  fallback: { preparation_id: string; source_fingerprint: string; manifest: LiveFallbackManifest };
}
export interface LivePreflight {
  schedule_id: string; schedule_revision: number; approval_fingerprint: string; items: FrozenLivePolicy[];
}
export interface LiveApproval {
  version: 1; approval_fingerprint: string; fallback_preparation_ids: Record<string, string>; items: FrozenLivePolicy[];
}
export interface LiveDraftReviewPayload {
  request_id: string; expected_revision: number; name: string; description?: string; timezone: string;
  live_session_id: string; presentation_id: string; preparation_id: string; start_at: string; end_at: string; priority: number;
  screen_ids: string[]; screen_group_ids: string[];
}
export interface LiveDraftReview extends LivePreflight { draft_id: string; draft_revision: number; can_edit: boolean }
export interface LiveDraftDetail {
  draft_id: string; draft_revision: number; schedule_id: string; submitted_request_id: string | null;
  can_edit: boolean; review_request_id: string;
  form: Omit<LiveDraftReviewPayload, "request_id" | "expected_revision">;
}
