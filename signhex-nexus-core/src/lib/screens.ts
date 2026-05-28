import type { ScreenGroup, ScreenOverviewItem } from "@/api/types";

export type ScreenIndicatorTone = "ok" | "warning" | "error" | "neutral";

export type ScreenIndicator = {
  label: string;
  tone: ScreenIndicatorTone;
};

function humanizeEnumValue(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function maskCompactIdentifier(value?: string | null): string {
  if (!value) return "N/A";
  if (value.length <= 4) return value;
  return `***${value.slice(-4)}`;
}

export function maskCertificateSerial(serial?: string | null): string {
  return maskCompactIdentifier(serial);
}

export function formatMaskedScreenId(screenId?: string | null): string {
  return `Screen ID: ${maskCompactIdentifier(screenId)}`;
}

export function getScreenPlaybackSourceLabel(
  source?: string | null,
  options: { hasPublish?: boolean } = {},
): string {
  switch (source) {
    case "EMERGENCY":
      return "Emergency";
    case "HEARTBEAT":
      return "Live";
    case "SCHEDULE":
      return "Scheduled";
    case "DEFAULT":
      return "Default";
    case "UNKNOWN":
    case undefined:
    case null:
    case "":
      return options.hasPublish ? "Standby" : "Idle";
    default:
      return humanizeEnumValue(source);
  }
}

export function getScreenPlaybackHeadline(
  screen: Pick<ScreenOverviewItem, "status" | "publish" | "playback">,
): string {
  const currentMediaName =
    screen.playback?.current_media?.name ||
    screen.playback?.current_media?.filename ||
    null;

  if (currentMediaName) {
    return currentMediaName;
  }

  switch (screen.playback?.source) {
    case "EMERGENCY":
      return "Emergency playback";
    case "DEFAULT":
      return "Default media";
    case "SCHEDULE":
      return screen.publish?.schedule_name ? `Schedule: ${screen.publish.schedule_name}` : "Scheduled content";
    case "HEARTBEAT":
      return "Live playback";
    case "UNKNOWN":
    case undefined:
    case null:
    case "":
      return screen.publish?.schedule_name
        ? `Schedule: ${screen.publish.schedule_name}`
        : (screen.status === "OFFLINE" ? "Screen offline" : "No active playback");
    default:
      return screen.publish?.schedule_name || "Playback active";
  }
}

export function getScreenAuthIndicator(
  authDiagnostics?: ScreenOverviewItem["auth_diagnostics"],
): ScreenIndicator | null {
  switch (authDiagnostics?.state) {
    case "VALID":
      return { label: "Auth OK", tone: "ok" };
    case "MISSING_CERTIFICATE":
      return { label: "No certificate", tone: "warning" };
    case "EXPIRED_CERTIFICATE":
      return { label: "Certificate expired", tone: "warning" };
    case "REVOKED_CERTIFICATE":
      return { label: "Certificate revoked", tone: "error" };
    default:
      return authDiagnostics?.state
        ? { label: humanizeEnumValue(authDiagnostics.state), tone: "warning" }
        : null;
  }
}

export function getScreenHeartbeatIndicator(
  screen: Pick<ScreenOverviewItem, "status" | "health_state">,
  hasStaleHeartbeat: boolean,
): ScreenIndicator | null {
  if (screen.health_state === "RECOVERY_REQUIRED") {
    return null;
  }

  if (screen.status === "OFFLINE" || screen.health_state === "OFFLINE") {
    return { label: "Offline", tone: "error" };
  }

  if (hasStaleHeartbeat || screen.health_state === "STALE") {
    return { label: "Delayed heartbeat", tone: "warning" };
  }

  if (screen.health_state === "ERROR") {
    return { label: "Needs attention", tone: "error" };
  }

  if (screen.health_state === "ONLINE") {
    return { label: "Heartbeat OK", tone: "ok" };
  }

  return null;
}

export function getScreenIndicatorBadgeClassName(tone: ScreenIndicatorTone): string {
  switch (tone) {
    case "ok":
      return "border-emerald-500 text-emerald-700";
    case "warning":
      return "border-amber-500 text-amber-700";
    case "error":
      return "border-red-500 text-red-700";
    default:
      return "border-slate-400 text-slate-700";
  }
}

function normalizeSearchValue(value?: string | null): string {
  return value?.trim().toLowerCase() ?? "";
}

export function matchesScreenSearch(screen: ScreenOverviewItem, search: string): boolean {
  const query = normalizeSearchValue(search);
  if (!query) return true;

  return [screen.name, screen.location, screen.id].some((value) =>
    normalizeSearchValue(value).includes(query)
  );
}

export function matchesScreenGroupSearch(
  group: ScreenGroup,
  search: string,
  screenNamesById: Map<string, string>,
): boolean {
  const query = normalizeSearchValue(search);
  if (!query) return true;

  const memberNames = (group.screen_ids ?? [])
    .map((screenId) => normalizeSearchValue(screenNamesById.get(screenId)))
    .filter(Boolean);

  return [group.name, group.description, ...memberNames].some((value) =>
    normalizeSearchValue(value).includes(query)
  );
}
