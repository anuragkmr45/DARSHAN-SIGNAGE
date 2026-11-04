const actionVerbs: Record<string, string> = {
  CREATE: "created",
  CREATED: "created",
  UPDATE: "updated",
  UPDATED: "updated",
  EDIT: "edited",
  DELETE: "deleted",
  DELETED: "deleted",
  RESTORE: "restored",
  REVOKE: "revoked",
  TRIGGER: "triggered",
  CLEAR: "cleared",
  START: "started",
  STOP: "stopped",
  BAN: "banned",
  UNBAN: "unbanned",
  MUTE: "muted",
  UNMUTE: "unmuted",
};

export const formatAuditResource = (value?: string | null): string => {
  if (!value?.trim()) return "Record";
  const words = value.trim().replace(/([a-z\d])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1).toLowerCase();
};

export const formatAuditAction = (action?: string | null, resourceType?: string | null): string => {
  if (!action?.trim()) return "Recorded event";
  const parts = action.trim().split(/[_\s-]+/).filter(Boolean);
  const verb = actionVerbs[parts.at(-1)?.toUpperCase() ?? ""];
  if (!verb) return formatAuditResource(action);

  const subject = parts.length > 1 ? parts.slice(0, -1).join("_") : resourceType;
  const label = /^(LIVE_SESSION|LIVE_RUN)$/i.test(subject ?? "")
    ? "Live broadcast"
    : formatAuditResource(subject);
  return `${label} ${verb}`;
};
