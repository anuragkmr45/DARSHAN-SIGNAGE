import { useEffect, useRef, useState } from 'react';
import type { FrozenLivePolicy, LiveApproval } from '@/api/liveTypes';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { PreparedLiveFallbackPreview } from './PreparedLiveFallbackPreview';
import { requestFallbackPreview, validateRequestFallbackPreview, type LiveRequestFallbackPreview } from '@/lib/liveRequestReview';

function FrozenRequestFallback({ requestId, fingerprint, policy }: { requestId: string; fingerprint: string; policy: FrozenLivePolicy }) {
  const [preview, setPreview] = useState<LiveRequestFallbackPreview | null>(null), [error, setError] = useState<string | null>(null), [loading, setLoading] = useState(false);
  const generation = useRef(0), pending = useRef(false);
  useEffect(() => { const epoch = ++generation.current; setPreview(null); setError(null); pending.current = false; setLoading(false);
    return () => { generation.current = epoch + 1; }; }, [requestId, fingerprint, policy.schedule_item_id]);
  const load = async () => {
    if (pending.current) return; pending.current = true; setLoading(true); setError(null);
    const current = generation.current;
    try {
      const result = validateRequestFallbackPreview(await requestFallbackPreview(requestId, policy), requestId, fingerprint, policy);
      if (generation.current === current) setPreview(result);
    } catch (failure) { if (generation.current === current) { setPreview(null); setError(failure instanceof Error ? failure.message : 'The frozen preview is unavailable.'); } }
    finally { if (generation.current === current) { pending.current = false; setLoading(false); } }
  };
  return <div className="space-y-3">
    <p className="text-sm text-muted-foreground">Historical frozen files from this request. Library edits do not replace these bytes. Current access is checked when opening or refreshing the preview.</p>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {preview ? <PreparedLiveFallbackPreview preview={preview} onRefresh={() => void load()} refreshing={loading} />
      : <Button variant="outline" size="sm" disabled={loading} onClick={() => void load()}>{loading ? 'Loading frozen fallback…' : error ? 'Retry frozen fallback preview' : 'Preview approved fallback'}</Button>}
  </div>;
}

export function LiveRequestReview({ requestId, approval }: { requestId: string; approval: LiveApproval }) {
  return <section aria-label="Frozen live approval" className="space-y-4">
    <div><h3 className="font-semibold">Frozen LIVE approval</h3><p className="text-sm text-muted-foreground">Live fills the screen. Its fallback is a separate offline presentation. Approve and Publish recheck current policy; this historical preview does not establish current eligibility or player delivery.</p></div>
    {approval.items.map((policy, index) => <div className="space-y-3 rounded-lg border p-4" key={policy.schedule_item_id}>
      <div className="flex flex-wrap items-center gap-2"><Badge>LIVE broadcast</Badge><span className="font-medium">Item {index + 1}</span><Badge variant="outline">Policy revision {policy.policy_revision}</Badge></div>
      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <div><dt className="text-muted-foreground">Frozen source</dt><dd className="break-all font-mono text-xs">{policy.live_session_id}</dd></div>
        <div><dt className="text-muted-foreground">Assigned presenter</dt><dd className="break-all font-mono text-xs">{policy.presenter_user_id}</dd></div>
        <div><dt className="text-muted-foreground">Approved audio</dt><dd>Microphone {policy.microphone ? 'allowed' : 'off'} · Captured audio {policy.screen_share_audio ? 'allowed' : 'off'}</dd></div>
        <div><dt className="text-muted-foreground">Frozen window (UTC)</dt><dd>{new Date(policy.start_at).toISOString()} → {new Date(policy.end_at).toISOString()}</dd></div>
        <div><dt className="text-muted-foreground">Concrete audience</dt><dd>{policy.screen_ids.length} distinct approved screens (maximum 25)</dd></div>
        <div><dt className="text-muted-foreground">Fallback presentation</dt><dd className="break-all font-mono text-xs">{policy.fallback.manifest.presentation.id}</dd></div>
      </dl>
      <details className="text-sm"><summary className="cursor-pointer">Frozen screen IDs and group references</summary>
        <p className="mt-2 break-all font-mono text-xs">Screens: {policy.screen_ids.join(', ')}<br />Groups: {policy.screen_group_ids.join(', ') || 'None'}</p></details>
      <FrozenRequestFallback requestId={requestId} fingerprint={approval.approval_fingerprint} policy={policy} />
    </div>)}
  </section>;
}
