import { useId, useState } from "react";
import type { FormEvent } from "react";
import type { LiveSession, User } from "@/api/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { getContentOwnershipLabel } from "@/lib/access";
import { eligibleLivePresenters, livePresenterLabel, liveSourceCreatePayload, liveSourceError, liveSourceUpdatePayload,
  liveSourceValues, type LiveSourceError, type LiveSourceValues } from "@/lib/liveSources";

export function LiveSourceErrorNotice({ error }: { error: LiveSourceError }) {
  return <Alert variant="destructive"><AlertTitle>{error.title}</AlertTitle><AlertDescription>
    <p>{error.message}</p>
    {error.blockers.length > 0 && <ul className="mt-2 list-disc pl-5">{error.blockers.map(blocker =>
      <li key={blocker.label}>{blocker.label}: {blocker.count}</li>)}</ul>}
  </AlertDescription></Alert>;
}

interface LiveSourceFormProps {
  source?: LiveSession | null;
  actor?: User | null;
  editable: boolean;
  viewOnly?: boolean;
  pending: boolean;
  canReadDirectory: boolean;
  presenters: User[];
  directoryLoading?: boolean;
  directoryFailed?: boolean;
  onRefreshDirectory: () => void;
  onSubmit: (values: LiveSourceValues, baseline: LiveSession | null) => Promise<void>;
  onClose: (refresh?: boolean) => void;
  onReload?: () => Promise<void>;
}

export function LiveSourceForm({ source = null, actor, editable, viewOnly = false, pending, canReadDirectory, presenters,
  directoryLoading, directoryFailed, onRefreshDirectory, onSubmit, onClose, onReload }: LiveSourceFormProps) {
  // The revision belongs to the form's loaded snapshot, never a background
  // refetch. Explicit Reload remounts this form after reviewing/discarding edits.
  const [baseline] = useState(source);
  const [values, setValues] = useState(() => liveSourceValues(source, actor?.id));
  const [error, setError] = useState<LiveSourceError | null>(null);
  const [reloading, setReloading] = useState(false);
  const id = useId();
  const disabled = !editable || pending || reloading;
  const eligible = eligibleLivePresenters(presenters, baseline);
  const choices = canReadDirectory ? eligible : baseline ? [] : actor ? [actor] : [];
  const hasSelected = choices.some(user => user.id === values.presenter_user_id);
  const selectedLabel = values.presenter_user_id === actor?.id && actor ? livePresenterLabel(actor)
    : baseline?.presenter_user_id === values.presenter_user_id ? "Assigned presenter (not in your active directory)" : "Selected presenter unavailable";
  let changed = true;
  try { if (baseline) changed = Object.keys(liveSourceUpdatePayload(baseline, values)).length > 1; } catch { /* Form validation reports on submit. */ }
  const change = (patch: Partial<LiveSourceValues>) => {
    setValues(previous => ({ ...previous, ...patch }));
    if (!error?.stale && !error?.uncertain) setError(null);
  };
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (disabled || error?.stale || error?.uncertain) return;
    try { liveSourceCreatePayload(values); await onSubmit(values, baseline); }
    catch (failure) { setError(liveSourceError(failure, "save")); }
  };
  const reload = async () => {
    if (!onReload) return;
    setReloading(true);
    try { await onReload(); } catch (failure) { setError(liveSourceError(failure, "load")); }
    finally { setReloading(false); }
  };
  return <form onSubmit={submit} className="space-y-5">
    {baseline && <p className="text-sm text-muted-foreground">
      {getContentOwnershipLabel({ ownership: baseline.ownership ?? undefined }) ?? "Ownership unavailable"} · Loaded revision {baseline.revision}
    </p>}
    {!editable && <p className="text-sm text-muted-foreground">{viewOnly ? "Viewing source details." : "This source is read-only with your current access."}</p>}
    {error && <LiveSourceErrorNotice error={error} />}
    <div className="space-y-2"><Label htmlFor={`${id}-name`}>Source name</Label>
      <Input id={`${id}-name`} value={values.name} onChange={event => change({ name: event.target.value })} maxLength={255} required disabled={disabled} />
    </div>
    <div className="space-y-2"><Label htmlFor={`${id}-description`}>Description</Label>
      <Textarea id={`${id}-description`} value={values.description} onChange={event => change({ description: event.target.value })} maxLength={4000} rows={3} disabled={disabled} />
    </div>
    <div className="space-y-2"><Label htmlFor={`${id}-presenter`}>Presenter</Label>
      <select id={`${id}-presenter`} value={values.presenter_user_id} onChange={event => change({ presenter_user_id: event.target.value })}
        className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm disabled:opacity-60" required
        disabled={disabled || !canReadDirectory || directoryLoading} aria-describedby={`${id}-presenter-help`}>
        <option value="">Choose a presenter</option>
        {!hasSelected && values.presenter_user_id && <option value={values.presenter_user_id}>{selectedLabel}</option>}
        {choices.map(user => <option key={user.id} value={user.id}>{livePresenterLabel(user)}</option>)}
      </select>
      <p id={`${id}-presenter-help`} className="text-xs text-muted-foreground">
        {!canReadDirectory ? baseline ? "User directory access is needed to change the assigned presenter." : "You can select your account. User directory access is needed to choose another presenter."
          : directoryLoading ? "Loading active presenters…" : "Only active users visible in your directory are offered. Current department membership is checked when saving."}
      </p>
      {canReadDirectory && !disabled && <div className="flex items-center gap-2">
        {directoryFailed && <span role="status" className="text-xs text-destructive">The user directory could not be loaded.</span>}
        <Button type="button" size="sm" variant="outline" onClick={onRefreshDirectory} disabled={directoryLoading}>Refresh presenters</Button>
      </div>}
    </div>
    <div className="space-y-3 rounded-lg border p-4">
      <div className="flex items-center justify-between gap-4"><Label htmlFor={`${id}-microphone`}>Allow microphone</Label>
        <Switch id={`${id}-microphone`} checked={values.microphone} onCheckedChange={checked => change({ microphone: checked })} disabled={disabled} /></div>
      <div className="flex items-center justify-between gap-4"><Label htmlFor={`${id}-capture-audio`}>Allow captured audio</Label>
        <Switch id={`${id}-capture-audio`} checked={values.screen_share_audio} onCheckedChange={checked => change({ screen_share_audio: checked })} disabled={disabled} /></div>
      <p className="text-xs text-muted-foreground">These permissions limit presenter capture choices. Audio availability also depends on the browser.</p>
    </div>
    <div className="flex items-center justify-between gap-4"><Label htmlFor={`${id}-active`}>Enable for new schedules</Label>
      <Switch id={`${id}-active`} checked={values.is_active} onCheckedChange={checked => change({ is_active: checked })} disabled={disabled} /></div>
    <p className="text-xs text-muted-foreground">Ownership is assigned from your access when the source is created. Presenter and audio changes require fresh schedule approval. Schedule preflight checks presenter, fallback and target readiness.</p>
    {error?.stale && onReload && <div className="space-y-2">
      <p className="text-xs text-muted-foreground">Reload replaces unsaved changes with the latest saved version.</p>
      <Button type="button" variant="outline" onClick={() => void reload()} disabled={pending || reloading}>{reloading ? "Reloading…" : "Reload latest source"}</Button>
    </div>}
    <div className="flex flex-wrap justify-end gap-2">
      <Button type="button" variant="outline" onClick={() => onClose(Boolean(error?.uncertain))} disabled={pending}>{error?.uncertain ? "Close and refresh list" : editable ? "Cancel" : "Close"}</Button>
      {editable && <Button type="submit" disabled={pending || reloading || !values.name.trim() || !values.presenter_user_id || !changed || Boolean(error?.stale || error?.uncertain)}>
        {pending ? "Saving…" : baseline ? "Save changes" : "Create live source"}
      </Button>}
    </div>
  </form>;
}
