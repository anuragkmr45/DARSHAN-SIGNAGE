import { useEffect, useRef, useState, type ComponentProps } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "@/api/apiClient";
import { liveSessionsApi } from "@/api/domains/liveSessions";
import { presentationsApi } from "@/api/domains/presentations";
import { liveFallbacksApi } from "@/api/domains/liveFallbacks";
import type { LiveDraftReview, LiveFallbackPreview } from "@/api/liveTypes";
import type { LiveSession, Presentation } from "@/api/types";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { StepScheduleDetails } from "@/components/schedule-creator/StepScheduleDetails";
import { LiveTargetPicker } from "./LiveTargetPicker";
import { LiveDraftReviewConsent } from "./LiveDraftReviewConsent";
import { PreparedLiveFallbackPreview } from "./PreparedLiveFallbackPreview";
import { preparedLivePreview } from "@/lib/liveFallbackPreview";
import { instantFromLocalInput, liveDraftReviewPayload, liveDraftStorageKey, localDateTime, newLiveDraftJournal, restoreLiveDraftJournal, serializeLiveDraftJournal,
  type LiveDraftForm, type LiveDraftJournal } from "@/lib/liveScheduleDraft";
import { createUuid } from "@/lib/uuid";

async function allSources(): Promise<LiveSession[]> {
  const rows = new Map<string, LiveSession>(); let page = 1, pages = 1;
  while (page <= pages) { const result = await liveSessionsApi.list({ page, limit: 100, active_only: true });
    result.items.forEach(row => rows.set(row.id, row)); if (!result.items.length) break;
    pages = result.pagination.pages; page++; }
  return [...rows.values()];
}
async function allPresentations(): Promise<Presentation[]> {
  const rows = new Map<string, Presentation>(); let page = 1, pages = 1;
  while (page <= pages) { const result = await presentationsApi.list({ page, limit: 100 });
    result.items.forEach(row => rows.set(row.id, row)); if (!result.items.length) break;
    pages = Math.ceil(result.total / 100); page++; }
  return [...rows.values()];
}
function loadJournal(actorId: string) {
  try { return restoreLiveDraftJournal(sessionStorage.getItem(liveDraftStorageKey(actorId))); }
  catch { return restoreLiveDraftJournal(null); }
}
const errorText = (error: unknown) => {
  const message = error instanceof Error ? error.message : "The operation could not be completed. Please retry.";
  if (!(error instanceof ApiError) || !error.details || typeof error.details !== "object") return message;
  const ids = (error.details as { unsupported_screen_ids?: unknown }).unsupported_screen_ids;
  return error.code === "LIVE_PLAYER_UNSUPPORTED" && Array.isArray(ids) && ids.every(id => typeof id === "string")
    ? `${message} Unsupported screen IDs: ${ids.join(", ")}.` : message;
};

export function LiveScheduleWizard({ actorId, canReadGroups, onClose, onSubmitted }: {
  actorId: string; canReadGroups: boolean; onClose: () => void; onSubmitted: (requestId: string) => void;
}) {
  const client = useQueryClient(), [journal, setJournal] = useState(() => loadJournal(actorId));
  const [step, setStep] = useState(0), [error, setError] = useState<string | null>(null), [busy, setBusy] = useState<string | null>(null);
  const [review, setReview] = useState<LiveDraftReview | null>(null), [preview, setPreview] = useState<LiveFallbackPreview | null>(null), [accepted, setAccepted] = useState(false);
  const [editableSaved, setEditableSaved] = useState<boolean | null>(null), [retired, setRetired] = useState(false), [resetConfirmation, setResetConfirmation] = useState(false);
  const browserTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const inFlight = useRef(false), active = useRef(true), form = journal.form;
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const save = (next: LiveDraftJournal) => {
    // Write retry identity synchronously BEFORE sending a mutation. If browser
    // storage is unavailable, leave the server untouched and show the error.
    sessionStorage.setItem(liveDraftStorageKey(actorId), serializeLiveDraftJournal(next));
    setJournal(next);
  };
  const run = async (label: string, action: () => Promise<void>) => {
    if (inFlight.current) return; inFlight.current = true; setBusy(label); setError(null);
    try { await action(); } catch (failure) { if (active.current) setError(errorText(failure)); }
    finally { inFlight.current = false; if (active.current) setBusy(null); }
  };
  const unresolved = Boolean(journal.pending_review || journal.pending_submit);
  const needsSavedLoad = journal.draft_revision > 0 && editableSaved === null;
  // Submitting the confirmed review is a separate permission from editing its
  // saved schedule. A create-only author can still acknowledge and submit it.
  const reviewLocked = Boolean(busy) || unresolved || needsSavedLoad;
  const locked = reviewLocked || editableSaved === false;
  const update = (changes: Partial<LiveDraftForm>) => {
    if (locked || inFlight.current) return;
    try { save({ ...journal, form: { ...form, ...changes } }); setReview(null); setPreview(null); setAccepted(false); setError(null); }
    catch { setError("The browser could not save this draft. Check browser storage before continuing."); }
  };
  const sources = useQuery({ queryKey: ["live-authoring-sources", actorId], queryFn: allSources, retry: false, staleTime: 0 });
  const presentations = useQuery({ queryKey: ["live-authoring-presentations", actorId], queryFn: allPresentations, retry: false, staleTime: 0 });
  const source = useQuery({ queryKey: ["live-authoring-source", actorId, form.live_session_id], queryFn: () => liveSessionsApi.getById(form.live_session_id),
    enabled: Boolean(form.live_session_id), retry: false, staleTime: 0 });
  const preparation = useQuery({ queryKey: ["live-authoring-preparation", actorId, form.preparation_id],
    queryFn: () => liveFallbacksApi.get(form.preparation_id), enabled: Boolean(form.preparation_id), retry: false, staleTime: 0,
    refetchInterval: query => query.state.status !== "error" && ["PENDING", "PROCESSING"].includes(query.state.data?.state ?? "") ? 3000 : false });
  const prepare = () => void run("prepare", async () => {
    const result = await liveFallbacksApi.prepare(form.presentation_id, preparation.data?.state === "FAILED"); if (!active.current) return;
    save({ ...journal, form: { ...form, preparation_id: result.id } }); setReview(null); setPreview(null); setAccepted(false);
    client.setQueryData(["live-authoring-preparation", actorId, result.id], result);
  });
  const reviewDraft = () => void run("review", async () => {
    if (journal.pending_submit) throw new Error("Resolve the previous submission before changing this draft.");
    const input = journal.pending_review ?? liveDraftReviewPayload({ ...form, timezone: browserTimezone }, journal.draft_revision);
    const nextPreview = await liveFallbacksApi.preview(input.preparation_id); preparedLivePreview(nextPreview);
    if (!active.current) return;
    const pending: LiveDraftJournal = { ...journal, pending_review: input }; save(pending);
    const result = await liveFallbacksApi.reviewDraft(journal.draft_id, input); if (!active.current) return;
    const policy = result.items[0];
    if (!policy || policy.fallback.preparation_id !== nextPreview.preparation_id || policy.fallback.source_fingerprint !== nextPreview.source_fingerprint) {
      throw new Error("The prepared fallback changed while reviewing. Reload the saved draft and review again.");
    }
    save({ ...pending, draft_revision: result.draft_revision, pending_review: null });
    setEditableSaved(result.can_edit);
    setReview(result); setPreview(nextPreview); setAccepted(false); setStep(3);
  });
  const refreshPreview = () => void run("preview", async () => {
    const result = await liveFallbacksApi.preview(form.preparation_id); preparedLivePreview(result); if (!active.current) return;
    if (review && result.source_fingerprint !== review.items[0]?.fallback.source_fingerprint) {
      setReview(null); setAccepted(false); throw new Error("The fallback changed. Prepare and review its current revision again.");
    }
    setPreview(result);
  });
  const reload = () => void run("reload", async () => {
    try {
      const result = await liveFallbacksApi.getDraft(journal.draft_id); if (!active.current) return;
      if (result.submitted_request_id) { sessionStorage.removeItem(liveDraftStorageKey(actorId)); onSubmitted(result.submitted_request_id); return; }
      const loadedForm = { ...result.form, description: result.form.description ?? "" };
      // A creator without update permission can re-open the SAME review,
      // but cannot turn a create grant into an edit of the saved item.
      const readonlyRetry = result.can_edit ? null : { ...loadedForm, request_id: result.review_request_id, expected_revision: result.draft_revision - 1 };
      save({ ...journal, draft_revision: result.draft_revision, form: loadedForm, pending_review: readonlyRetry, pending_submit: null });
      setEditableSaved(result.can_edit); setRetired(false); setReview(null); setPreview(null); setAccepted(false); setStep(0);
    } catch (failure) {
      if (failure instanceof ApiError && active.current && (failure.code === "LIVE_DRAFT_RETIRED" || failure.status === 404)) {
        if (journal.draft_revision === 0 && failure.status === 404) {
          save({ ...journal, pending_review: null, pending_submit: null }); setEditableSaved(null); setStep(0); return;
        }
        setRetired(true); throw new Error("The backend confirms this saved draft is no longer available. Start a new draft to continue.");
      }
      throw failure;
    }
  });
  const submit = () => void run("submit", async () => {
    const input = journal.pending_submit ?? (review && accepted ? { request_id: createUuid(), expected_revision: journal.draft_revision,
      expected_live_fingerprint: review.approval_fingerprint, notes: journal.notes.trim() || undefined } : null);
    if (!input) throw new Error("Review the prepared files and approved audience before submitting.");
    save({ ...journal, pending_submit: input });
    const result = await liveFallbacksApi.submitDraft(journal.draft_id, input); if (!active.current) return;
    sessionStorage.removeItem(liveDraftStorageKey(actorId));
    void client.invalidateQueries({ queryKey: ["schedule-requests"] }); onSubmitted(result.id);
  });
  const sourceReady = Boolean(source.data?.id === form.live_session_id && source.data.is_active && !source.isError && !preparation.isError &&
    preparation.data?.presentation_id === form.presentation_id && preparation.data?.state === "READY");
  const updateDetails: ComponentProps<typeof StepScheduleDetails>["onUpdate"] = values => {
    try { update({ ...(values.scheduleName !== undefined ? { name: values.scheduleName } : {}), ...(values.scheduleDescription !== undefined ? { description: values.scheduleDescription } : {}),
      timezone: browserTimezone, ...(values.startAt !== undefined ? { start_at: instantFromLocalInput(values.startAt) } : {}),
      ...(values.endAt !== undefined ? { end_at: instantFromLocalInput(values.endAt) } : {}), ...(values.priority !== undefined ? { priority: values.priority } : {}) }); }
    catch (failure) { setError(errorText(failure)); }
  };
  return <Dialog open onOpenChange={value => { if (!value && !inFlight.current) onClose(); }}><DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-5xl">
    <DialogHeader><DialogTitle>Schedule live event</DialogTitle><DialogDescription>Schedule full-screen live playback with a prepared offline fallback in the DARSHAN desktop player.</DialogDescription></DialogHeader>
    <ol className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">{["Source and fallback", "Screens", "Window", "Review"].map((label, index) => <li key={label} className={`rounded-lg border px-3 py-2 ${step === index ? "border-primary font-semibold" : "text-muted-foreground"}`} aria-current={step === index ? "step" : undefined}>{index + 1}. {label}</li>)}</ol>
    {(journal.draft_revision > 0 || unresolved) && <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-sm"><span>{editableSaved === false ? "Your current permissions allow submitting this review but do not allow editing the saved schedule item. Re-open the same review or start a new draft." : unresolved ? "A server change is not yet confirmed. Retry the same request or reload the saved draft before editing." : `Saved draft revision ${journal.draft_revision}. Reloading replaces this form with its latest saved values.`}</span>
      <Button size="sm" variant="outline" onClick={reload} disabled={Boolean(busy)}>Reload saved draft</Button></div>}
    {resetConfirmation && <div className="space-y-3 rounded-lg border p-4 text-sm" role="alert"><p>Start a new draft? The previous saved schedule and any request history are retained. This replaces the draft saved in this browser tab.</p>
      <div className="flex gap-2"><Button variant="outline" onClick={() => setResetConfirmation(false)}>Keep current draft</Button><Button onClick={() => {
        try { save(newLiveDraftJournal()); setEditableSaved(null); setRetired(false); setReview(null); setPreview(null); setAccepted(false); setStep(0); setError(null); setResetConfirmation(false); }
        catch { setError("The browser could not save a new draft."); }
      }} disabled={Boolean(busy) || unresolved && !retired}>Start new draft</Button></div></div>}
    {error && <p role="alert" className="rounded-lg border border-destructive/40 p-3 text-sm text-destructive">{error}</p>}
    {step === 0 && <div className="space-y-5">
      <div className="space-y-2"><Label htmlFor="live-draft-source">Live source</Label><select id="live-draft-source" className="h-10 w-full rounded border bg-background px-3 text-sm" value={form.live_session_id} disabled={locked || sources.isFetching}
        onChange={event => update({ live_session_id: event.target.value })}><option value="">Choose an enabled source</option>{sources.data?.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select>
        {sources.isError && <Button variant="outline" onClick={() => void sources.refetch()}>Retry loading sources</Button>}
        {source.isError && <p role="alert" className="text-sm text-destructive">The selected source is unavailable. Choose another source or refresh.</p>}
        {source.data && <p className="text-sm text-muted-foreground">Presenter ***{source.data.presenter_user_id.slice(-8)} · Microphone {source.data.microphone ? "allowed" : "off"} · Captured audio {source.data.screen_share_audio ? "allowed" : "off"}. These permissions are reviewed before publication.</p>}</div>
      <div className="space-y-2"><Label htmlFor="live-draft-fallback">Required fallback presentation</Label><select id="live-draft-fallback" className="h-10 w-full rounded border bg-background px-3 text-sm" value={form.presentation_id} disabled={locked || presentations.isFetching}
        onChange={event => update({ presentation_id: event.target.value, preparation_id: "" })}><option value="">Choose a fallback presentation</option>{presentations.data?.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select>
        {presentations.isError && <Button variant="outline" onClick={() => void presentations.refetch()}>Retry loading fallback presentations</Button>}
        <p className="text-sm text-muted-foreground">Use an existing image, document or video presentation. Webpages use their frozen preview image. The live stream fills the screen; the fallback keeps its own approved layout.</p></div>
      <div className="flex flex-wrap items-center gap-3"><Button variant="outline" disabled={locked || !form.presentation_id || ["PENDING", "PROCESSING"].includes(preparation.data?.state ?? "")} onClick={prepare}>
        {busy === "prepare" ? "Preparing…" : preparation.data?.state === "FAILED" ? "Retry failed preparation" : "Prepare immutable fallback"}</Button>
        <span role="status" className="text-sm">{preparation.isError ? "Preparation needs refreshing" : preparation.data?.state ?? "Not prepared"}</span>
        {form.preparation_id && <Button size="sm" variant="outline" onClick={() => void preparation.refetch()} disabled={Boolean(busy)}>Refresh preparation status</Button>}</div>
      {preparation.isError && <p role="alert" className="text-sm text-destructive">{errorText(preparation.error)} Prepare the current fallback again if it changed.</p>}
      {preparation.data?.state === "FAILED" && <p role="alert" className="text-sm text-destructive">Preparation failed ({preparation.data.failure_code ?? "unknown reason"}). Retry after resolving the media problem.</p>}
      {preparation.data?.dispatch_pending && <p className="text-sm text-muted-foreground">Accepted by the backend; waiting for the preparation worker.</p>}
      <p className="text-sm text-muted-foreground">Players must download and verify the complete fallback before joining live. Missing or corrupt fallback shows “Content unavailable.”</p>
    </div>}
    {step === 1 && <LiveTargetPicker actorId={actorId} screenIds={form.screen_ids} groupIds={form.screen_group_ids} canReadGroups={canReadGroups} disabled={locked}
      onChange={(screen_ids, screen_group_ids) => update({ screen_ids, screen_group_ids })} />}
    {step === 2 && <fieldset disabled={locked}><StepScheduleDetails scheduleName={form.name} scheduleDescription={form.description} timezone={browserTimezone} fixedInputTimezone={browserTimezone}
      startAt={localDateTime(form.start_at)} endAt={localDateTime(form.end_at)} priority={form.priority} hasSelectedTargets={Boolean(form.screen_ids.length || form.screen_group_ids.length)}
      onUpdate={updateDetails} /></fieldset>}
    {step === 3 && review && preview && <div className="space-y-4"><div className="grid gap-3 rounded-lg border p-4 text-sm sm:grid-cols-2">
      <p><strong>{form.name}</strong><br />{new Date(review.items[0].start_at).toLocaleString()} to {new Date(review.items[0].end_at).toLocaleString()}</p>
      <p>{review.items[0].screen_ids.length} distinct approved screens · Presenter ***{review.items[0].presenter_user_id.slice(-8)}<br />Microphone {review.items[0].microphone ? "allowed" : "off"} · Captured audio {review.items[0].screen_share_audio ? "allowed" : "off"}</p>
      <details className="sm:col-span-2"><summary className="cursor-pointer">Review concrete screen IDs and group references</summary><p className="mt-2 break-all font-mono text-xs">Screens: {review.items[0].screen_ids.join(", ")}<br />Groups: {review.items[0].screen_group_ids.join(", ") || "None"}</p></details></div>
      <PreparedLiveFallbackPreview preview={preview} onRefresh={refreshPreview} refreshing={busy === "preview"} />
      <p className="text-sm text-muted-foreground">Submission checks screen and broadcast capacity again. A changed source, fallback, audience or window requires a fresh review. Submission requests approval; it does not start broadcasting.</p>
      <LiveDraftReviewConsent busy={Boolean(busy)} unresolved={unresolved} needsSavedLoad={needsSavedLoad} editableSaved={editableSaved}
        notes={journal.notes} accepted={accepted} onAcceptedChange={setAccepted}
        onNotesChange={notes => { try { save({ ...journal, notes }); } catch { setError("The browser could not save the approval notes."); } }} />
    </div>}
    <div className="flex flex-wrap justify-between gap-2 border-t pt-4"><div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => { setStep(Math.max(0, step - 1)); setAccepted(false); }} disabled={locked || step === 0}>Back</Button>
      <Button variant="outline" onClick={() => setResetConfirmation(true)} disabled={Boolean(busy) || unresolved && !retired}>New draft</Button></div>
      <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => { if (!inFlight.current) onClose(); }} disabled={Boolean(busy)}>Save draft and close</Button>
        {journal.pending_submit ? <Button onClick={submit} disabled={Boolean(busy) || retired}>Retry same submission</Button> : journal.pending_review ? <Button onClick={reviewDraft} disabled={Boolean(busy) || retired}>Retry same review</Button>
          : step < 2 ? <Button onClick={() => setStep(value => value + 1)} disabled={locked || step === 0 && !sourceReady || step === 1 && !form.screen_ids.length && !form.screen_group_ids.length}>Next</Button>
          : step === 2 ? <Button onClick={reviewDraft} disabled={Boolean(busy) || !sourceReady}>Review live event</Button>
          : <Button onClick={submit} disabled={Boolean(busy) || !accepted || !review || !preview}>Submit live event for approval</Button>}</div></div>
  </DialogContent></Dialog>;
}
