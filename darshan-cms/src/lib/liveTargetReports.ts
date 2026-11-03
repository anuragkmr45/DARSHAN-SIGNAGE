import type { LiveTargetReport, LiveTargetReports } from '@/api/domains/liveTargetReports';
const reasons: Record<NonNullable<LiveTargetReport['reason']>, string> = {
  NO_RUN: 'No live attempt', PUBLICATION_INACTIVE: 'Publication inactive', WINDOW_NOT_ACTIVE: 'Outside the approved window',
  OCCURRENCE_DISABLED: 'Occurrence disabled', RUN_STOPPED: 'Run stopping or stopped', AUTHORITY_CHANGED: 'Authority changed',
  PRESENTER_UNAVAILABLE: 'Presenter authorization unavailable', NO_ADMISSION: 'No receiver admission', ADMISSION_PENDING: 'Receiver admission pending',
  ADMISSION_REVOKED: 'Receiver admission revoked', RUNTIME_MISMATCH: 'Report belongs to a different player runtime', NO_REPORT: 'No player report received',
  STALE_REPORT: 'Player report is stale', CLOCK_UNCERTAIN: 'Server receipt time is uncertain', INVALID_REPORT: 'Player report is invalid',
};
export function liveTargetView(row: LiveTargetReport, elapsedMs: number, clockUncertain = false) {
  const fresh = !clockUncertain && row.freshness === 'FRESH' && row.report !== null && row.age_ms !== null && elapsedMs >= 0 && row.age_ms + elapsedMs <= 10000;
  return { fresh, label: row.screen_name ?? `Screen ***${row.screen_id.slice(-6)}`,
    reason: fresh ? 'Fresh player report' : clockUncertain ? 'Browser timing changed; refresh reports' : row.reason ? reasons[row.reason] : 'Player report is stale',
    ageMs: row.age_ms === null ? null : Math.max(0, Math.floor(row.age_ms + Math.max(0, elapsedMs))) };
}
/** The initial reporting dates come from authenticated server time, not the CMS clock. */
export function serverLiveReportingWindow(serverNow: string): { from: string; until: string } {
  const value = Date.parse(serverNow); if (!Number.isFinite(value)) throw new Error('Server time could not be verified.');
  return { from: new Date(value).toISOString().slice(0, 10), until: new Date(value + 7 * 86_400_000).toISOString().slice(0, 10) };
}
export const liveTargetReportSummary = (value: LiveTargetReports, elapsedMs = 0, clockUncertain = false) => ({
  fresh: value.targets.filter(row => liveTargetView(row, elapsedMs, clockUncertain).fresh).length, total: value.targets.length,
});
