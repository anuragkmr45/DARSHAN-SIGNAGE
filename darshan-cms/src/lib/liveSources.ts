import { z } from "zod";
import { ApiError } from "@/api/apiClient";
import type { CreateLiveSessionPayload, LiveSession, UpdateLiveSessionPayload, User } from "@/api/types";
import { usersApi } from "@/api/domains/users";

export interface LiveSourceValues {
  name: string;
  description: string;
  presenter_user_id: string;
  microphone: boolean;
  screen_share_audio: boolean;
  is_active: boolean;
}
export const liveSourceValues = (source?: LiveSession | null, actorId = ""): LiveSourceValues => ({
  name: source?.name ?? "", description: source?.description ?? "", presenter_user_id: source?.presenter_user_id ?? actorId,
  microphone: source?.microphone ?? false, screen_share_audio: source?.screen_share_audio ?? false, is_active: source?.is_active ?? true,
});
const valuesSchema = z.object({
  name: z.string().trim().min(1, "Enter a name.").max(255, "Name must be at most 255 characters."),
  description: z.string().max(4000, "Description must be at most 4000 characters."),
  presenter_user_id: z.string().uuid("Choose a presenter."), microphone: z.boolean(), screen_share_audio: z.boolean(), is_active: z.boolean(),
});

export function liveSourceCreatePayload(values: LiveSourceValues): CreateLiveSessionPayload {
  const parsed = valuesSchema.parse(values);
  return { ...parsed, description: parsed.description.trim() ? parsed.description : null };
}
export function liveSourceUpdatePayload(source: LiveSession, values: LiveSourceValues): UpdateLiveSessionPayload {
  const candidate = liveSourceCreatePayload(values);
  const changes: UpdateLiveSessionPayload = { expected_revision: source.revision };
  for (const key of ["name", "description", "presenter_user_id", "microphone", "screen_share_audio", "is_active"] as const) {
    if (candidate[key] !== source[key]) Object.assign(changes, { [key]: candidate[key] });
  }
  return changes;
}

/** Use the existing permission-scoped directory; never infer global users from source IDs. */
export async function loadLivePresenters(): Promise<User[]> {
  const users = new Map<string, User>();
  let page = 1, totalPages = 1;
  while (page <= totalPages) {
    const response = await usersApi.list({ page, limit: 100, is_active: true });
    for (const user of response.items) if (user.is_active !== false) users.set(user.id, user);
    if (!response.items.length) break;
    totalPages = Number.isFinite(response.total) ? Math.max(1, Math.ceil(response.total / 100)) : page;
    page++;
  }
  return [...users.values()];
}
export const livePresenterLabel = (user: User) => {
  const name = [user.first_name, user.last_name].filter(Boolean).join(" ").trim();
  return name ? `${name} (${user.email})` : user.email;
};
export function eligibleLivePresenters(users: User[], source?: LiveSession | null): User[] {
  return users.filter(user => {
    if (user.is_active === false) return false;
    if (source?.owner_scope !== "DEPARTMENT" || !source.owner_department_id) return true;
    const departments = new Set([...(user.department_ids ?? []), ...(user.additional_department_ids ?? []),
      ...(user.departments?.map(department => department.id) ?? []), ...(user.department_id ? [user.department_id] : [])]);
    return departments.has(source.owner_department_id);
  });
}

export interface LiveSourceError {
  title: string;
  message: string;
  stale: boolean;
  uncertain: boolean;
  blockers: Array<{ label: string; count: number }>;
}
export function liveSourceError(error: unknown, action: "load" | "save" | "delete" = "save"): LiveSourceError {
  const result: LiveSourceError = { title: "Request failed", message: "Try again after checking your connection.", stale: false, uncertain: false, blockers: [] };
  if (error instanceof z.ZodError) return { ...result, title: "Check the form", message: error.issues[0]?.message ?? "Check the entered values." };
  if (!(error instanceof ApiError)) return result;
  if (error.code === "LIVE_SESSION_REVISION_CONFLICT") return { ...result, title: "Source changed", stale: true,
    message: "Someone changed this source. Reload the latest version and review it before saving or deleting." };
  if (error.code === "LIVE_SESSION_IN_USE") {
    const labels: Record<string, string> = { schedule_items: "Editable or current/future schedule items", active_publishes: "Active published schedules",
      live_occurrences: "Live holds, approvals and publications" };
    const details = error.details && typeof error.details === "object" ? error.details as { blockers?: unknown } : undefined;
    const blockers = details?.blockers && typeof details.blockers === "object" ? details.blockers as Record<string, unknown> : {};
    let other = 0;
    for (const [key, value] of Object.entries(blockers)) if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) {
      if (labels[key]) result.blockers.push({ label: labels[key], count: value }); else other += value;
    }
    if (other) result.blockers.push({ label: "Other active references", count: other });
    return { ...result, title: "Source is in use", message: "Remove its editable and current/future schedule references before deleting it." };
  }
  if (error.code === "LIVE_PRESENTER_UNAVAILABLE") return { ...result, title: "Presenter unavailable",
    message: "Choose an active presenter who belongs to the source's department. Refresh the directory if membership changed." };
  if (error.status === 403) return { ...result, title: "Access denied", message: "Your current access does not allow this action. Refresh the list to check your access." };
  if (error.status === 404) return { ...result, title: "Source unavailable", stale: true, message: "This source is no longer available. Close this dialog and refresh the list." };
  if (action !== "load" && (error.status === 408 || error.status >= 500)) return { ...result, title: "Change not confirmed", uncertain: true,
    message: "The change could not be confirmed. Close this dialog and refresh the list before retrying." };
  return { ...result, message: error.message || result.message };
}
