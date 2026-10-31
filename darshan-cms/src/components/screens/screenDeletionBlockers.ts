import { ApiError } from "@/api/apiClient";

const labels: Record<string, string> = {
  schedule_items: "Schedule items",
  active_publishes: "Active publishes",
  reservations: "Reservations",
  active_emergencies: "Active emergencies",
  defaults: "Default media assignments",
};

export function screenDeletionBlockers(error: unknown): string[] {
  if (!(error instanceof ApiError) || error.status !== 409 ||
      !["SCREEN_IN_USE", "SCREEN_GROUP_IN_USE"].includes(error.code ?? "")) return [];
  const details = error.details;
  if (!details || typeof details !== "object" || !("blockers" in details)) return [];
  const blockers = details.blockers;
  if (!blockers || typeof blockers !== "object") return [];
  return Object.entries(blockers).flatMap(([key, value]) =>
    key in labels && typeof value === "number" && value > 0
      ? [`${labels[key]}: ${value}`]
      : []);
}
