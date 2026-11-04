import type { ObservabilityMachineSummary } from "@/api/types";

export const formatPercent = (value?: number | null, digits = 0) => {
  if (value === undefined || value === null || Number.isNaN(value)) return "—";
  return `${value.toFixed(digits)}%`;
};

export const formatBytes = (bytes?: number | null) => {
  if (bytes === undefined || bytes === null || Number.isNaN(bytes)) return "—";
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  const exponent = Math.min(
    units.length - 1,
    Math.floor(Math.log(bytes) / Math.log(1024)),
  );
  const value = bytes / Math.pow(1024, exponent);
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[exponent]}`;
};

export const formatRelativeTimestamp = (value?: string | null) => {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString();
};

export const getMachineStatusTone = (
  status?: ObservabilityMachineSummary["status"],
) => {
  switch (status) {
    case "healthy":
      return "status-outline-success";
    case "degraded":
      return "status-outline-warning";
    case "critical":
      return "status-outline-error";
    case "unconfigured":
      return "status-outline-info";
    default:
      return "border-input text-muted-foreground";
  }
};

export const getServiceStatusTone = (status?: "up" | "down" | "unknown") => {
  switch (status) {
    case "up":
      return "status-text-success";
    case "down":
      return "status-text-error";
    default:
      return "text-muted-foreground";
  }
};

export const getMachineRoleLabel = (
  role: ObservabilityMachineSummary["role"],
) => {
  switch (role) {
    case "backend":
      return "Server VM";
    case "cms":
      return "CMS VM";
    case "data":
      return "Data VM";
    case "valkey":
      return "Valkey VM";
    case "observability":
      return "Observability VM";
    case "media":
      return "Media VM";
    case "development":
      return "Development Host";
    default:
      return "Machine";
  }
};
