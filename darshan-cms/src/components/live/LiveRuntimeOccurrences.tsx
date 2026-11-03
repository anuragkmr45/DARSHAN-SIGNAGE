import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ApiError } from '@/api/apiClient';
import { createLiveAdminIntent, liveRuntimeApi, sendLiveAdminIntent, type LiveAdminIntent } from '@/api/domains/liveRuntime';
import type { LiveRuntimeOccurrence } from '@/api/liveRuntimeTypes';
import { useAuthorization } from '@/hooks/useAuthorization';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { createUuid } from '@/lib/uuid';
import { LiveTargetReports } from './LiveTargetReports';
import { serverLiveReportingWindow } from '@/lib/liveTargetReports';

const message = (error: unknown) => error instanceof Error ? error.message : 'The live action could not be confirmed. Reload its current state.';
export function LiveRuntimeOccurrenceCard({ occurrence, actorId, mayPublish, mayManage, onPresent, onChanged, onPending }: {
  occurrence: LiveRuntimeOccurrence; actorId: string; mayPublish: boolean; mayManage: boolean;
  onPresent: (id: string) => void; onChanged: () => void; onPending: (id: string, row?: LiveRuntimeOccurrence) => void;
}) {
  const [latest, setLatest] = useState<LiveRuntimeOccurrence | null>(null), [kind, setKind] = useState<LiveAdminIntent['kind'] | null>(null);
  const [reason, setReason] = useState(''), [intent, setIntent] = useState<LiveAdminIntent | null>(null), [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState<string | null>(null), working = useRef(false), active = useRef(true);
  const [forget, setForget] = useState(false);
  const row = latest && latest.control_revision > occurrence.control_revision ? latest : occurrence;
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  useEffect(() => { onPending(occurrence.id, intent ? occurrence : undefined); return () => onPending(occurrence.id); }, [intent, occurrence, onPending]);
  const manage = mayManage && row.can_manage;
  const send = async () => {
    if (working.current || !manage || !kind) return;
    working.current = true; setBusy(true); setError(null);
    try {
      const command = intent ?? createLiveAdminIntent(row, kind, reason, (await liveRuntimeApi.epoch(createUuid())).epoch_id);
      if (!active.current) return;
      setIntent(command);
      const result = await sendLiveAdminIntent(command); if (!active.current) return;
      setLatest(result); setIntent(null); setKind(null); setReason('');
      setNotice(command.kind === 'STOP' ? 'Disable/stop accepted. Check the run state while media teardown completes.' : 'Occurrence enabled. A presenter must explicitly start a new attempt when eligible.'); onChanged();
    } catch (failure) { if (active.current) setError(failure); }
    finally { working.current = false; if (active.current) setBusy(false); }
  };
  const reload = async () => {
    if (working.current) return; working.current = true; setBusy(true);
    try { const result = await liveRuntimeApi.get(row.id); if (active.current) { setLatest(result); setNotice('Current state reloaded. The pending action and retry identity are still retained.'); } }
    catch (failure) { if (active.current) setError(failure); }
    finally { working.current = false; if (active.current) setBusy(false); }
  };
  const open = (value: LiveAdminIntent['kind']) => { setKind(value); setError(null); setNotice(null); if (!intent) setReason(''); };
  const reviewLatest = async () => {
    if (working.current || !intent || !manage) return; working.current = true; setBusy(true);
    try {
      const epoch = await liveRuntimeApi.epoch(createUuid()); if (!active.current) return;
      setIntent(createLiveAdminIntent(row, intent.kind, intent.body.reason, epoch.epoch_id)); setError(null);
      setNotice('Latest authority and revision selected for the same requested action. Confirm explicitly to send it.');
    } catch (failure) { if (active.current) setError(failure); }
    finally { working.current = false; if (active.current) setBusy(false); }
  };
  return <article className="space-y-3 rounded-lg border p-4" aria-label={`Live occurrence ${row.id}`}>
    <div className="flex flex-wrap items-center gap-2"><Badge>Published LIVE window</Badge><Badge variant="outline">{row.enabled ? 'Enabled' : 'Disabled'}</Badge><Badge variant="secondary">{row.run?.state ?? 'Not started'}</Badge></div>
    <p className="break-all font-mono text-xs">Occurrence {row.id}<br />Source {row.live_session_id}<br />Presenter {row.presenter_user_id}</p>
    <p className="text-sm">{new Date(row.start_at).toISOString()} → {new Date(row.end_at).toISOString()} (UTC)<br />{row.screen_ids.length} approved screens · Microphone {row.microphone ? 'allowed' : 'off'} · Captured audio {row.screen_share_audio ? 'allowed' : 'off'}</p>
    <p className="text-sm text-muted-foreground">Start currently {row.can_start ? 'eligible' : 'unavailable'} · Control revision {row.control_revision}. Run state does not confirm that every player is showing frames.</p>
    {row.run && <p className="break-all font-mono text-xs">Run {row.run.id} · Generation {row.run.generation}{row.run.owns_current_attempt ? ' · Owned by this document' : ''}</p>}
    <div className="flex flex-wrap gap-2">
      {mayPublish && row.presenter_user_id === actorId && <Button variant="outline" size="sm" disabled={busy || Boolean(intent)} onClick={() => onPresent(row.id)}>Open presenter controls</Button>}
      {intent ? <Button variant="outline" size="sm" onClick={() => setKind(intent.kind)}>Resume pending administrative action</Button> : manage && <>
        {row.enabled ? <Button variant="destructive" size="sm" onClick={() => open('STOP')}>Disable and stop</Button> : <Button variant="outline" size="sm" onClick={() => open('ENABLE')}>Re-enable occurrence</Button>}
      </>}
    </div>
    <LiveTargetReports actorId={actorId} occurrence={row} />
    {notice && <p role="status" className="text-sm">{notice}</p>}
    <Dialog open={kind !== null} onOpenChange={open => { if (!open && !working.current) setKind(null); }}><DialogContent>
      <DialogHeader><DialogTitle>{kind === 'STOP' ? 'Disable and stop this occurrence' : 'Re-enable this occurrence'}</DialogTitle>
        <DialogDescription>{kind === 'STOP' ? 'Blocks new starts and revokes the current attempt. Capacity stays occupied until teardown is confirmed.' : 'Allows a future explicit presenter start. This does not start or resume broadcasting.'}</DialogDescription></DialogHeader>
      <p className="break-all text-xs">Occurrence {row.id} · Current revision {row.control_revision}{intent ? ` · Pending revision ${intent.body.expected_control_revision}` : ''}</p>
      <Label htmlFor={`live-admin-reason-${row.id}`}>Administrative reason</Label><Textarea id={`live-admin-reason-${row.id}`} value={intent?.body.reason ?? reason} onChange={event => setReason(event.target.value)} maxLength={1000} disabled={busy || Boolean(intent)} />
      {error && <div role="alert" className="space-y-2 text-sm text-destructive"><p>{message(error)}</p>
        <p>{error instanceof ApiError && error.status === 409 ? 'The control changed. Your requested action is retained. Reload and explicitly review a new revision.' : 'The response does not prove whether the action committed. Retry the same request or reload current state.'}</p></div>}
      {intent && <Button variant="outline" onClick={() => void reload()} disabled={busy}>Reload current state; keep pending action</Button>}
      {intent && latest && <Button variant="outline" disabled={busy || !manage} onClick={() => void reviewLatest()}>Review latest authority and revision for the same action</Button>}
      {intent && <div className="space-y-2 text-sm"><p>Discarding the local retry record does not cancel or undo a server request that may already have committed.</p>
        {forget ? <div className="flex gap-2"><Button variant="outline" disabled={busy} onClick={() => setForget(false)}>Keep retry record</Button>
          <Button variant="destructive" disabled={busy} onClick={() => { setIntent(null); setKind(null); setError(null); setForget(false); setNotice('Local retry record discarded. Reload current state before requesting another action.'); onChanged(); }}>Discard local retry record</Button></div>
          : <Button variant="outline" disabled={busy} onClick={() => setForget(true)}>Review discarding local retry record</Button>}</div>}
      {!manage && <p role="alert" className="text-sm text-destructive">Your current access does not allow this administrative action.</p>}
      <div className="flex justify-end gap-2"><Button variant="outline" disabled={busy} onClick={() => setKind(null)}>{intent ? 'Keep pending action and close' : 'Cancel'}</Button>
        <Button disabled={busy || !manage || (!intent && !reason.trim())} variant={kind === 'STOP' ? 'destructive' : 'default'} onClick={() => void send()}>{busy ? 'Waiting for confirmation…' : intent ? 'Retry same administrative request' : 'Confirm administrative action'}</Button></div>
    </DialogContent></Dialog>
  </article>;
}

export function LiveRuntimeOccurrences({ actorId, onPresent }: { actorId: string; onPresent: (occurrenceId: string) => void }) {
  const { can, isLoading } = useAuthorization(), allowed = !isLoading && (can('read', 'LiveBroadcast') || can('publish', 'LiveBroadcast') || can('manage', 'LiveBroadcast'));
  const [page, setPage] = useState(1), [pendingState, setPending] = useState<{ actorId: string; rows: Record<string, LiveRuntimeOccurrence> }>(() => ({ actorId, rows: {} }));
  const pending: Record<string, LiveRuntimeOccurrence> = pendingState.actorId === actorId ? pendingState.rows : {};
  const [dates, setDates] = useState({ from: '', until: '' });
  const [window, setWindow] = useState<{ from: string; until: string } | null>(null), [error, setError] = useState<string | null>(null), [clockRefresh, refreshClock] = useState(0);
  useEffect(() => {
    const controller = new AbortController(); let current = true;
    setWindow(null); setDates({ from: '', until: '' }); setError(null);
    if (allowed && actorId) void liveRuntimeApi.epoch(createUuid(), controller.signal).then(epoch => { if (!current) return;
      const dates = serverLiveReportingWindow(epoch.server_now); setDates(dates); setWindow(dates);
    }).catch(() => { if (current) setError('Backend time could not be verified. Retry the current server window before listing occurrences.'); });
    return () => { current = false; controller.abort(); };
  }, [actorId, allowed, clockRefresh]);
  useEffect(() => { setPending({ actorId, rows: {} }); setPage(1); }, [actorId]);
  const onPending = useCallback((id: string, row?: LiveRuntimeOccurrence) => setPending(current => {
    if (current.actorId !== actorId) return row ? { actorId, rows: { [id]: row } } : current;
    if (row) return current.rows[id] === row ? current : { actorId, rows: { ...current.rows, [id]: row } };
    if (!current.rows[id]) return current; const next = { ...current.rows }; delete next[id]; return { actorId, rows: next };
  }), [actorId]);
  const params = { page, page_size: 25, from: `${window?.from ?? ''}T00:00:00.000Z`, until: `${window?.until ?? ''}T00:00:00.000Z` };
  const query = useQuery({ queryKey: ['live-runtime-occurrences', actorId, params], queryFn: () => liveRuntimeApi.list(params), enabled: allowed && Boolean(actorId) && Boolean(window), retry: false, staleTime: 0, refetchInterval: allowed && window ? 3000 : false });
  const rows = [...(query.data?.items ?? []), ...Object.values(pending).filter(row => !query.data?.items.some(item => item.id === row.id))];
  const locked = Object.keys(pending).length > 0, pages = Math.max(1, Math.ceil((query.data?.total ?? 0) / 25));
  const apply = () => { const from = Date.parse(`${dates.from}T00:00:00Z`), until = Date.parse(`${dates.until}T00:00:00Z`);
    if (!Number.isFinite(from) || !Number.isFinite(until) || until <= from || until - from > 366 * 86_400_000) { setError('Choose an increasing UTC window of at most 366 days.'); return; }
    setWindow(dates); setPage(1); setError(null);
  };
  if (!allowed) return null;
  return <section className="space-y-4" aria-label="Live runtime occurrences"><div><h2 className="text-lg font-semibold">Published live occurrences</h2>
    <p className="text-sm text-muted-foreground">Current and future active publications in the selected UTC window. Ended and taken-down publications are excluded. This list never joins or subscribes to a live room.</p></div>
    <div className="flex flex-wrap items-end gap-3"><div><Label htmlFor="live-list-from">Window from (UTC)</Label><Input type="date" id="live-list-from" value={dates.from} disabled={locked || !window} onChange={event => setDates({ ...dates, from: event.target.value })} /></div>
      <div><Label htmlFor="live-list-until">Window until (UTC, exclusive)</Label><Input type="date" id="live-list-until" value={dates.until} disabled={locked || !window} onChange={event => setDates({ ...dates, until: event.target.value })} /></div>
      <Button variant="outline" onClick={apply} disabled={locked || !window}>Apply reporting window</Button><Button variant="outline" onClick={() => void query.refetch()} disabled={query.isFetching || !window}>Refresh live occurrences</Button>
      <Button variant="outline" disabled={locked} onClick={() => { setPage(1); refreshClock(value => value + 1); }}>Use current server window</Button></div>
    {(error || query.isError) && <p role="alert" className="text-sm text-destructive">{error ?? message(query.error)}</p>}
    {locked && <p className="text-sm">Pending administrative actions remain visible, including rows that leave the current page. Resolve them before changing the reporting window.</p>}
    {!window ? !error && <p role="status">Loading authenticated backend time…</p> : query.isLoading ? <p role="status">Loading current live occurrences…</p> : rows.length ? <div className="grid gap-4 xl:grid-cols-2">{rows.map(row => <LiveRuntimeOccurrenceCard key={`${actorId}:${row.id}`} occurrence={row} actorId={actorId} mayPublish={can('publish', 'LiveBroadcast')} mayManage={can('manage', 'LiveBroadcast')}
      onPresent={onPresent} onChanged={() => void query.refetch()} onPending={onPending} />)}</div> : !query.isError && <p>No active published live occurrences were found in this window.</p>}
    <div className="flex items-center justify-between gap-3"><Button variant="outline" disabled={locked || page <= 1 || query.isFetching} onClick={() => setPage(value => value - 1)}>Previous live page</Button>
      <span className="text-sm">Page {page} of {pages} · {query.data?.total ?? 0} matching occurrences</span><Button variant="outline" disabled={locked || page >= pages || query.isFetching} onClick={() => setPage(value => value + 1)}>Next live page</Button></div>
  </section>;
}
