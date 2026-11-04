import { z } from "zod";
import { createUuid } from "@/lib/uuid";
import type { LiveDraftReviewPayload } from "@/api/liveTypes";
import { browserScheduleTimeZone } from "@/lib/scheduleTimeZone";

const uuid = z.string().uuid();
export const liveDraftFormSchema = z.object({ name: z.string(), description: z.string(), timezone: z.string(),
  live_session_id: z.string(), presentation_id: z.string(), preparation_id: z.string(), start_at: z.string(), end_at: z.string(),
  priority: z.number().int().min(0).max(2), screen_ids: z.array(uuid), screen_group_ids: z.array(uuid) });
export interface LiveDraftForm {
  name: string; description: string; timezone: string; live_session_id: string; presentation_id: string; preparation_id: string;
  start_at: string; end_at: string; priority: number; screen_ids: string[]; screen_group_ids: string[];
}
export const emptyLiveDraftForm = (): LiveDraftForm => ({ name: "", description: "", timezone: browserScheduleTimeZone(),
  live_session_id: "", presentation_id: "", preparation_id: "", start_at: "", end_at: "", priority: 0, screen_ids: [], screen_group_ids: [] });
export const liveDraftStorageKey = (actorId: string) => `darshan:live-authoring:v1:${actorId}`;
const pendingReviewSchema = liveDraftFormSchema.extend({ request_id: uuid, expected_revision: z.number().int().nonnegative() });
const pendingSubmitSchema = z.object({ request_id: uuid, expected_revision: z.number().int().positive(), expected_live_fingerprint: z.string().regex(/^[a-f0-9]{64}$/), notes: z.string().optional() });
const journalSchema = z.object({ version: z.literal(1), draft_id: uuid, draft_revision: z.number().int().nonnegative(), form: liveDraftFormSchema,
  pending_review: pendingReviewSchema.nullable(), pending_submit: pendingSubmitSchema.nullable(), notes: z.string() });
export interface LiveDraftJournal {
  version: 1; draft_id: string; draft_revision: number; form: LiveDraftForm;
  pending_review: (LiveDraftReviewPayload & { description: string }) | null;
  pending_submit: { request_id: string; expected_revision: number; expected_live_fingerprint: string; notes?: string } | null;
  notes: string;
}
export function newLiveDraftJournal(): LiveDraftJournal {
  return { version: 1, draft_id: createUuid(), draft_revision: 0, form: emptyLiveDraftForm(), pending_review: null, pending_submit: null, notes: "" };
}
/** Parse into an allowlisted shape. Preview URLs, tickets and unrelated fields
 * can never be persisted/restored as a live authoring journal. */
export function restoreLiveDraftJournal(raw: string | null): LiveDraftJournal {
  // Explicit interfaces retain required fields under this project's existing
  // strictNullChecks:false configuration; runtime validation still requires them.
  try { const parsed = journalSchema.safeParse(JSON.parse(raw ?? "null")); if (parsed.success) return parsed.data as LiveDraftJournal; }
  catch { /* A corrupt browser draft must not crash authoring. */ }
  return newLiveDraftJournal();
}
export const serializeLiveDraftJournal = (journal: LiveDraftJournal) => JSON.stringify(journalSchema.parse(journal));
export function liveDraftReviewPayload(form: LiveDraftForm, revision: number): LiveDraftReviewPayload & { description: string } {
  const start = new Date(form.start_at), end = new Date(form.end_at);
  if (!form.name.trim() || !uuid.safeParse(form.live_session_id).success || !uuid.safeParse(form.presentation_id).success ||
      !uuid.safeParse(form.preparation_id).success || !Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start >= end ||
      !form.screen_ids.length && !form.screen_group_ids.length) throw new Error("Choose a source, prepared fallback, targets, name and valid schedule window.");
  return { ...form, name: form.name.trim(), start_at: start.toISOString(), end_at: end.toISOString(),
    screen_ids: [...new Set(form.screen_ids)].sort(), screen_group_ids: [...new Set(form.screen_group_ids)].sort(),
    request_id: createUuid(), expected_revision: revision };
}
export function localDateTime(iso: string): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}T${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}:${String(date.getSeconds()).padStart(2, "0")}`;
}
export function instantFromLocalInput(value: string): string {
  if (!value) return "";
  const date = new Date(value), expected = value.length === 16 ? `${value}:00` : value;
  if (!Number.isFinite(date.getTime()) || localDateTime(date.toISOString()) !== expected) {
    throw new Error("This local time does not exist in the browser timezone. Choose another time.");
  }
  // Around a clock rollback two UTC instants can share the same local input.
  // Reject that ambiguity instead of silently choosing the first occurrence.
  const offsets = new Set([-36, 36].map(hours => new Date(date.getTime() + hours * 3_600_000).getTimezoneOffset()));
  for (const offset of offsets) {
    const alternate = date.getTime() + (offset - date.getTimezoneOffset()) * 60_000;
    if (alternate !== date.getTime() && localDateTime(new Date(alternate).toISOString()) === expected) {
      throw new Error("This local time occurs twice during a timezone clock change. Choose an unambiguous time.");
    }
  }
  return date.toISOString();
}
