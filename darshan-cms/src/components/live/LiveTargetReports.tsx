import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ApiError } from '@/api/apiClient';
import { getLiveTargetReports, type LiveTargetReports as Reports } from '@/api/domains/liveTargetReports';
import type { LiveRuntimeOccurrence } from '@/api/liveRuntimeTypes';
import { liveTargetReportSummary, liveTargetView } from '@/lib/liveTargetReports';
import { Button } from '@/components/ui/button';

export function LiveTargetReportTable({ value, elapsedMs = 0, clockUncertain = false }: { value: Reports; elapsedMs?: number; clockUncertain?: boolean }) {
  const summary = liveTargetReportSummary(value, elapsedMs, clockUncertain);
  return <><p className="break-all text-xs">{summary.fresh} / {summary.total} fresh reports · Server sample {value.server_now} · {value.run ? `Run ${value.run.id}, generation ${value.run.generation}` : 'No live run'}</p>
    <div className="overflow-x-auto"><table className="w-full text-left text-xs"><caption className="sr-only">Current live target player reports; unknown rows may include last reported values</caption>
      <thead><tr>{['Screen', 'Report freshness', 'Server received / age', 'Connection', 'Subscription', 'Frame', 'Audio', 'Fallback'].map(label => <th key={label} scope="col" className="p-2">{label}</th>)}</tr></thead>
      <tbody>{value.targets.map(row => { const view = liveTargetView(row, elapsedMs, clockUncertain), report = row.report;
        const prefix = view.fresh ? '' : 'Last report: ';
        return <tr key={row.screen_id} className="border-t"><th scope="row" className="p-2">{view.label}</th><td className="p-2">{view.fresh ? 'Fresh' : 'Unknown'}<br />{view.reason}</td>
          <td className="p-2">{row.received_at ?? 'Never received for this admission'}{view.ageMs !== null && <><br />{Math.floor(view.ageMs / 1000)} seconds since receipt</>}</td>
          <td className="p-2">{report ? `${prefix}${report.connection.toLowerCase()}` : 'Unknown'}</td><td className="p-2">{report ? `${prefix}${report.subscription.toLowerCase()}` : 'Unknown'}</td>
          <td className="p-2">{report ? `${prefix}${report.frame === 'READY' ? 'player reports ready' : 'not reported ready'}` : 'Unknown'}</td>
          <td className="p-2">{report ? `${prefix}${report.audio.toLowerCase()}` : 'Unknown'}</td><td className="p-2">{report ? `${prefix}${report.fallback_ready ? 'player reports ready' : 'player reports unavailable'}` : 'Unknown'}{report?.fallback_reason && <><br />{report.fallback_reason}</>}</td></tr>;
      })}</tbody></table></div></>;
}

export function LiveTargetReports({ actorId, occurrence }: { actorId: string; occurrence: LiveRuntimeOccurrence }) {
  const [open, setOpen] = useState(false), [, updateTime] = useState(0);
  const query = useQuery({ queryKey: ['live-target-reports', actorId, occurrence.id, occurrence.run?.id ?? null, occurrence.run?.generation ?? null],
    queryFn: async ({ signal }) => { const started = performance.now(), wall = Date.now();
      return { value: await getLiveTargetReports(occurrence.id, { screenIds: occurrence.screen_ids, run: occurrence.run }, signal), started, wall }; },
    enabled: open && Boolean(actorId), retry: false, staleTime: 0, refetchInterval: open ? 3000 : false });
  useEffect(() => { if (!open) return; const timer = setInterval(() => updateTime(value => value + 1), 1000); return () => clearInterval(timer); }, [open]);
  const sample = query.data, elapsed = sample ? performance.now() - sample.started : 0;
  const uncertain = sample ? elapsed < 0 || Math.abs(Date.now() - sample.wall - elapsed) > 1500 : false;
  const forbidden = query.error instanceof ApiError && [401, 403].includes(query.error.status);
  return <section className="space-y-2" aria-label="Player-reported live target diagnostics"><Button variant="outline" size="sm" onClick={() => setOpen(value => !value)} aria-expanded={open}>
    {open ? 'Hide player reports' : 'Show player reports'}</Button>
    {open && <div className="space-y-3 rounded border p-3"><p className="text-sm">These are player reports for the frozen approved audience. Connection, subscription, frame and audio are separate declarations; none proves physical display, audible sound or proof-of-play.</p>
      <Button variant="outline" size="sm" disabled={query.isFetching} onClick={() => void query.refetch()}>Refresh player reports</Button>
      {query.isError && <p role="alert" className="text-sm text-destructive">{forbidden ? 'Current access no longer permits these reports.' : 'Current reports could not be refreshed. Retained reports become unknown after ten seconds.'}</p>}
      {query.isLoading && <p role="status">Loading current player reports…</p>}
      {sample && !forbidden && <LiveTargetReportTable value={sample.value} elapsedMs={elapsed} clockUncertain={uncertain} />}
    </div>}
  </section>;
}
