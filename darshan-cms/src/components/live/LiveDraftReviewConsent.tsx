import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

/** A confirmed frozen review can be acknowledged without granting edits to
 * its saved Schedule/Item. Pending writes and unresolved reloads stay blocked. */
export function LiveDraftReviewConsent({ busy, unresolved, needsSavedLoad, editableSaved, notes, accepted, onNotesChange, onAcceptedChange }: {
  busy: boolean; unresolved: boolean; needsSavedLoad: boolean; editableSaved: boolean | null;
  notes: string; accepted: boolean; onNotesChange: (notes: string) => void; onAcceptedChange: (accepted: boolean) => void;
}) {
  const disabled = busy || unresolved || needsSavedLoad;
  return <div className="space-y-3">
    {editableSaved === false && <p className="text-sm text-muted-foreground">This saved schedule is read-only. You can still acknowledge its confirmed frozen review and submit it for approval.</p>}
    <Label htmlFor="live-draft-notes">Approval notes</Label><Textarea id="live-draft-notes" maxLength={4000} value={notes} disabled={disabled}
      onChange={event => onNotesChange(event.target.value)} />
    <label className="flex items-center gap-3 text-sm"><Checkbox aria-label="Acknowledge frozen live review" checked={accepted} disabled={disabled}
      onCheckedChange={value => onAcceptedChange(value === true)} />I reviewed the prepared fallback, presenter, audio permissions and concrete audience.</label>
  </div>;
}
