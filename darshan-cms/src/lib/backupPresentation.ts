export const formatDecimalBytes = (value: string | null | undefined) => {
  if (!value || !/^(0|[1-9][0-9]*)$/.test(value)) return "Size unavailable";
  const bytes = BigInt(value);
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  let divisor = 1n;
  let unit = 0;
  while (unit < units.length - 1 && bytes >= divisor * 1000n) {
    divisor *= 1000n;
    unit += 1;
  }
  if (unit === 0) return `${bytes.toString()} B`;
  const whole = bytes / divisor;
  const fraction = ((bytes % divisor) * 100n) / divisor;
  return `${whole.toString()}.${fraction.toString().padStart(2, "0")} ${units[unit]}`;
};

const alertMessages: Record<string, string> = {
  BACKUP_VERIFIED_SUCCESS_OVERDUE: "No recent publication-read-back verified backup is available.",
  BACKUP_ACTIVE_ATTEMPT_STUCK: "The active backup heartbeat or lease is stale.",
  BACKUP_REPOSITORY_CAPACITY_LOW: "The encrypted repository is below its approved free-space threshold.",
  BACKUP_REPOSITORY_CAPACITY_UNAVAILABLE: "Repository capacity cannot be safely observed.",
  BACKUP_RETRY_EXHAUSTED: "A backup exhausted its retry sequence and needs operator action.",
  BACKUP_RETENTION_FAILURE: "A retention operation is failed, partial, or uncertain.",
};

export const presentBackupAlert = (code: string) => ({
  code,
  message: alertMessages[code] ?? "Backup health requires operator review.",
});
