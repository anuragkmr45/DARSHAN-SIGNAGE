/** Chromium/ICU may report the older IANA alias for India's time zone. */
export function normalizeScheduleTimeZone(timeZone: string | null | undefined): string {
  const value = timeZone || "UTC";
  return value === "Asia/Calcutta" ? "Asia/Kolkata" : value;
}

export function browserScheduleTimeZone(): string {
  return normalizeScheduleTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone);
}
