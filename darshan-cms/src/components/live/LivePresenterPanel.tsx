import { useEffect, useRef, useState } from 'react';
import { store } from '@/store/store';
import { useAuthorization } from '@/hooks/useAuthorization';
import { LivePresenterController, type PresenterSnapshot } from '@/lib/livePresenterController';
import { browserPresenterMedia } from '@/lib/livePresenterMedia';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';

const initial = (): PresenterSnapshot => ({ phase: 'LOADING', message: 'Loading current presenter eligibility…', capture: false, captureGeneration: 0,
  localFrame: false, mediaConnected: false, publishAcknowledged: false, microphonePresent: false, capturedAudioPresent: false,
  audioDegraded: false, pendingStart: false, pendingStop: false, pickerPending: false });
export function LivePresenterPanel({ actorId, occurrenceId, onClose }: { actorId: string; occurrenceId: string; onClose: () => void }) {
  const { can, isLoading } = useAuthorization(), allowed = !isLoading && can('publish', 'LiveBroadcast');
  const [state, setState] = useState(initial), [microphone, setMicrophone] = useState(false), [capturedAudio, setCapturedAudio] = useState(false);
  const controller = useRef<LivePresenterController>(), video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (!allowed) return;
    const auth = store.getState().auth, actor = auth.user;
    if (!actor || actor.id !== actorId) return;
    const current = new LivePresenterController({ actorId, occurrenceId, media: browserPresenterMedia,
      isSessionCurrent: () => { const next = store.getState().auth; return next.user === actor && next.user?.id === actorId && next.apiKey === auth.apiKey; } });
    controller.current = current; const unsubscribe = current.subscribe(setState);
    // Redux subscribers run synchronously on logout/account replacement.
    // Normal token refresh preserves the user object and server JTI.
    const unsubscribeAuth = store.subscribe(() => { const next = store.getState().auth; if (next.user !== actor || next.apiKey !== auth.apiKey) current.dispose(); });
    const leave = () => current.dispose();
    window.addEventListener('pagehide', leave); window.addEventListener('beforeunload', leave); document.addEventListener('freeze', leave);
    void current.load();
    return () => { current.dispose(); unsubscribe(); unsubscribeAuth(); window.removeEventListener('pagehide', leave); window.removeEventListener('beforeunload', leave); document.removeEventListener('freeze', leave); if (controller.current === current) controller.current = undefined; };
  }, [actorId, occurrenceId, allowed]);
  useEffect(() => {
    const element = video.current, current = controller.current;
    if (!element || !current) return;
    element.muted = true; element.srcObject = current.getPreviewStream();
    let frame: number | undefined;
    if (state.capture) {
      void element.play().catch(() => undefined);
      if (element.requestVideoFrameCallback) frame = element.requestVideoFrameCallback(() => { if (element.videoWidth > 0 && element.videoHeight > 0) current.localFrame(state.captureGeneration); });
    }
    return () => { if (frame !== undefined) element.cancelVideoFrameCallback?.(frame); element.pause(); element.srcObject = null; };
  }, [state.capture, state.captureGeneration]);
  const close = () => { controller.current?.dispose(); onClose(); };
  const busy = ['CHOOSING', 'STARTING', 'PREPARING', 'CONNECTING', 'PUBLISHING', 'RECONNECTING'].includes(state.phase);
  const canChoose = allowed && Boolean(state.occurrence?.can_start && state.preflight?.ready) && !busy && !state.pendingStart && !state.pendingStop && !state.pickerPending && !['STALE', 'EXPIRED'].includes(state.phase);
  const canStart = allowed && state.capture && !state.pendingStop && !busy && Boolean(state.pendingStart || state.occurrence?.can_start && state.preflight?.ready);
  const canStop = state.capture || state.pickerPending || Boolean(state.occurrence?.run?.owns_current_attempt) || state.pendingStop;
  return <Dialog open onOpenChange={open => { if (!open) close(); }}><DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-4xl">
    <DialogHeader><DialogTitle>Presenter controls</DialogTitle><DialogDescription>Publish your chosen screen into this scheduled occurrence. This panel is a local preview and never subscribes to a live room.</DialogDescription></DialogHeader>
    <div className="flex flex-wrap items-center gap-2"><Badge>{state.phase}</Badge><Badge variant="outline">Backend run: {state.occurrence?.run?.state ?? 'not started'}</Badge></div>
    <p role={['ERROR', 'STALE', 'EXPIRED'].includes(state.phase) ? 'alert' : 'status'} className="text-sm">{allowed ? state.message : isLoading ? 'Checking current permissions…' : 'Your current access does not allow presenting live.'}</p>
    {state.occurrence && <div className="rounded border p-3 text-sm"><p>{new Date(state.occurrence.start_at).toISOString()} → {new Date(state.occurrence.end_at).toISOString()} (UTC)</p>
      <p>{state.occurrence.screen_ids.length} approved screens · Business eligibility: {state.occurrence.can_start ? 'eligible' : 'unavailable'}</p>
      <p>Media preflight: {state.preflight?.ready ? 'ready' : state.preflight ? state.preflight.reason.toLowerCase().replaceAll('_', ' ') : 'checking'}</p>
      {state.preflight && <p className="text-xs text-muted-foreground">Advisory check {new Date(state.preflight.checked_at).toISOString()}; Start rechecks all authority and capacity.</p>}
      <p className="break-all font-mono text-xs">Occurrence {occurrenceId}<br />Assigned presenter {state.occurrence.presenter_user_id}</p></div>}
    <div className="flex flex-wrap gap-4 text-sm"><label className="flex items-center gap-2"><Checkbox checked={microphone} disabled={!state.occurrence?.microphone || busy || state.capture} onCheckedChange={value => setMicrophone(value === true)} />Include approved microphone</label>
      <label className="flex items-center gap-2"><Checkbox checked={capturedAudio} disabled={!state.occurrence?.screen_share_audio || busy || state.capture} onCheckedChange={value => setCapturedAudio(value === true)} />Request approved captured audio</label></div>
    <p className="text-xs text-muted-foreground">Audio is optional and starts off. Captured audio also depends on the chosen surface, browser and operating system. An unavailable microphone requires an explicit retry without it.</p>
    <video ref={video} muted playsInline controls={false} className="aspect-video w-full rounded border bg-black" aria-label="Muted local capture preview" />
    <dl className="grid gap-2 text-sm sm:grid-cols-2"><div><dt>Local preview first frame</dt><dd>{state.localFrame ? 'Decoded locally' : 'Not confirmed'}</dd></div>
      <div><dt>Media connection</dt><dd>{state.mediaConnected ? 'Connected' : 'Not connected'}</dd></div><div><dt>SDK video publication</dt><dd>{state.publishAcknowledged ? 'Acknowledged' : 'Not acknowledged'}</dd></div>
      <div><dt>Actual capture audio</dt><dd>Microphone {state.microphonePresent ? 'present' : 'absent'} · Captured audio {state.capturedAudioPresent ? 'present' : 'absent'}{state.audioDegraded ? ' · publication degraded' : ''}</dd></div></dl>
    <p className="rounded border p-3 text-sm">Local preview, backend RUNNING and SDK publication do not confirm player display. Player frame telemetry and proof-of-play are separate evidence. Stop/close ends all local tracks immediately; server teardown may still be pending.</p>
    {(state.pendingStart || state.pendingStop) && <p className="text-sm">An action is not yet confirmed. Its exact request and authority are retained in this panel. Reload does not silently replace it or resume publishing.</p>}
    <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={!canChoose} onClick={() => void controller.current?.choose({ microphone, capturedAudio })}>Choose screen for local preview</Button>
      {state.phase === 'ERROR' && state.message.startsWith('Microphone') && <Button variant="outline" disabled={!canChoose} onClick={() => { setMicrophone(false); void controller.current?.choose({ microphone: false, capturedAudio }); }}>Retry without microphone</Button>}
      <Button disabled={!canStart} onClick={() => void controller.current?.start()}>{state.pendingStart ? 'Retry exact Start request' : 'Start broadcast explicitly'}</Button>
      <Button variant="destructive" disabled={!canStop} onClick={() => void controller.current?.stop()}>{state.pendingStop ? 'Retry exact Stop request' : 'Stop sharing now'}</Button>
      <Button variant="outline" disabled={state.pickerPending || state.phase === 'STARTING'} onClick={() => void controller.current?.load()}>Reload current eligibility</Button>
      {!state.capture && !state.pickerPending && ['STOPPED', 'EXPIRED', 'ERROR'].includes(state.phase) && <Button variant="outline" onClick={() => void controller.current?.reviewNewAttempt()}>Review a new explicit attempt</Button>}
      <Button variant="outline" onClick={close}>Stop local capture and close</Button></div>
  </DialogContent></Dialog>;
}
