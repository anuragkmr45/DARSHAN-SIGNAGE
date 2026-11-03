import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiClient } from '@/api/apiClient';
import { getLiveTargetReports, type LiveTargetReports } from '@/api/domains/liveTargetReports';
import { LiveTargetReportTable } from '@/components/live/LiveTargetReports';
import { liveTargetView, liveTargetReportSummary, serverLiveReportingWindow } from './liveTargetReports';
const id = (number: number) => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const fixture = (): LiveTargetReports => ({ version: 1, occurrence_id: id(1), server_now: '2050-01-01T12:00:01.000Z', fresh_for_ms: 10000,
  run: { id: id(2), generation: 2, state: 'RUNNING' }, targets: [{ screen_id: id(3), screen_name: null, freshness: 'FRESH', reason: null, received_at: '2050-01-01T12:00:00.000Z', age_ms: 1000,
    report: { sequence: 9, connection: 'CONNECTED', subscription: 'SUBSCRIBED', frame: 'NONE', audio: 'NONE', fallback_ready: true, fallback_reason: null } }] });
describe('live player target report contract', () => {
  afterEach(() => vi.restoreAllMocks());
  it('validates frozen audience, exact current run/generation and explicit unknown reasons without caching any grants', async () => {
    const value = fixture(), request = vi.spyOn(apiClient, 'request').mockResolvedValue(value), expected = { screenIds: [id(3)], run: { id: id(2), generation: 2 } };
    expect(await getLiveTargetReports(id(1), expected)).toEqual(value); expect(request).toHaveBeenCalledWith(expect.objectContaining({ method: 'GET', path: `/live-occurrences/${id(1)}/targets` }));
    for (const changed of [ { ...value, occurrence_id: id(90) }, { ...value, run: { ...value.run, generation: 1 } },
      { ...value, targets: [...value.targets, ...value.targets] }, { ...value, targets: [{ ...value.targets[0], screen_id: id(90) }] },
      { ...value, targets: [{ ...value.targets[0], freshness: 'UNKNOWN', reason: null }] },
      { ...value, targets: [{ ...value.targets[0], age_ms: 11000 }] },
      { ...value, targets: [{ ...value.targets[0], report: { ...value.targets[0].report, ticket: 'MUST_NOT_ACCEPT' } }] },
    ]) { request.mockResolvedValueOnce(changed); await expect(getLiveTargetReports(id(1), expected)).rejects.toMatchObject({ code: 'LIVE_REPORT_INVALID' }); }
  });
  it('ages retained reports against conservative monotonic elapsed time and treats clock uncertainty as unknown', () => {
    const value = fixture(), row = value.targets[0]; expect(liveTargetView(row, 8000)).toMatchObject({ fresh: true, ageMs: 9000, label: 'Screen ***000003' });
    expect(liveTargetView(row, 9001)).toMatchObject({ fresh: false, reason: 'Player report is stale' });
    expect(liveTargetView(row, 1, true).fresh).toBe(false); expect(liveTargetView(row, -1).fresh).toBe(false);
    expect(liveTargetReportSummary(value, 9001)).toEqual({ fresh: 0, total: 1 });
    expect(liveTargetView({ ...row, freshness: 'UNKNOWN', reason: 'RUNTIME_MISMATCH' }, 0).fresh).toBe(false);
  });
  it('shows separate report facts and historical stale values without inventing frames, sound or player success', () => {
    const value = fixture(), markup = renderToStaticMarkup(createElement(LiveTargetReportTable, { value }));
    expect(markup).toContain('1 / 1 fresh reports'); expect(markup).toContain('Screen ***000003'); expect(markup).toContain('connected'); expect(markup).toContain('not reported ready'); expect(markup).toContain('none'); expect(markup).not.toContain('Success');
    const stale = renderToStaticMarkup(createElement(LiveTargetReportTable, { value, elapsedMs: 11000 }));
    expect(stale).toContain('0 / 1 fresh reports'); expect(stale).toContain('Unknown'); expect(stale).toContain('Last report: connected');
    const never = renderToStaticMarkup(createElement(LiveTargetReportTable, { value: { ...value, targets: [{ ...value.targets[0], freshness: 'UNKNOWN', reason: 'NO_REPORT', report: null, received_at: null, age_ms: null }] } }));
    expect(never).toContain('Never received for this admission'); expect(never).not.toContain('Last report: connected');
  });
  it('uses backend time for the initial UTC window even when the CMS clock is years wrong', () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2020-12-31T23:59:59Z'));
    expect(serverLiveReportingWindow('2050-06-30T23:59:59Z')).toEqual({ from: '2050-06-30', until: '2050-07-07' });
    expect(() => serverLiveReportingWindow('invalid')).toThrow();
  });
  it('preserves backend authorization failures rather than converting forbidden access into empty or successful data', async () => {
    vi.spyOn(apiClient, 'request').mockRejectedValue(new ApiError({ status: 403, message: 'Denied' }));
    await expect(getLiveTargetReports(id(1), { screenIds: [id(3)], run: { id: id(2), generation: 2 } })).rejects.toMatchObject({ status: 403 });
  });
});
