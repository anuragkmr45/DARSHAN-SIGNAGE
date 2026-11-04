import type { LiveSession } from "@/api/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getContentCreatorLabel, getContentOwnershipLabel } from "@/lib/access";

export function LiveSourceCard({ source, canUpdate, canDelete, actorId, onView, onEdit, onDelete }: {
  source: LiveSession; canUpdate: boolean; canDelete: boolean; actorId?: string;
  onView: () => void; onEdit: () => void; onDelete: () => void;
}) {
  const metadata = { ownership: source.ownership ?? undefined };
  return <article className="flex min-w-0 flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between" aria-label={`Live source ${source.name}`}>
    <div className="min-w-0 space-y-1.5">
      <div className="flex flex-wrap items-center gap-2"><h3 className="break-words font-semibold">{source.name}</h3>
        <Badge variant={source.is_active ? "secondary" : "outline"}>{source.is_active ? "Enabled" : "Disabled"}</Badge></div>
      {source.description && <p className="line-clamp-2 whitespace-pre-wrap break-words text-sm text-muted-foreground">{source.description}</p>}
      <p className="text-sm text-muted-foreground">Presenter: {source.presenter_user_id === actorId ? "Your account" : `Assigned user · ***${source.presenter_user_id.slice(-8)}`}</p>
      <p className="text-xs text-muted-foreground">{getContentOwnershipLabel(metadata) ?? "Ownership unavailable"}
        {getContentCreatorLabel(metadata) ? ` · ${getContentCreatorLabel(metadata)}` : ""}
        {` · Microphone ${source.microphone ? "allowed" : "off"} · Captured audio ${source.screen_share_audio ? "allowed" : "off"}`}</p>
    </div>
    <div className="flex shrink-0 flex-wrap gap-1 sm:justify-end">
      <Button variant="outline" size="sm" onClick={onView} aria-label={`View ${source.name}`}>View</Button>
      {canUpdate && source.permissions?.can_update === true && <Button variant="ghost" size="sm" onClick={onEdit} aria-label={`Edit ${source.name}`}>Edit</Button>}
      {canDelete && source.permissions?.can_delete === true && <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={onDelete} aria-label={`Delete ${source.name}`}>Delete</Button>}
    </div>
  </article>;
}
