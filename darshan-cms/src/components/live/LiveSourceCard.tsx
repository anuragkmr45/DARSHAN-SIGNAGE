import type { LiveSession } from "@/api/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { getContentCreatorLabel, getContentOwnershipLabel } from "@/lib/access";

export function LiveSourceCard({ source, canUpdate, canDelete, actorId, onView, onEdit, onDelete }: {
  source: LiveSession; canUpdate: boolean; canDelete: boolean; actorId?: string;
  onView: () => void; onEdit: () => void; onDelete: () => void;
}) {
  const metadata = { ownership: source.ownership ?? undefined };
  return <Card className="flex min-w-0 flex-col"><CardHeader className="space-y-3">
    <div className="flex flex-wrap items-start justify-between gap-2"><CardTitle className="break-words text-lg">{source.name}</CardTitle>
      <Badge variant={source.is_active ? "secondary" : "outline"}>{source.is_active ? "Enabled" : "Disabled"}</Badge></div>
    <p className="text-xs text-muted-foreground">{getContentOwnershipLabel(metadata) ?? "Ownership unavailable"}</p>
  </CardHeader><CardContent className="flex-1 space-y-3">
    <p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">{source.description || "No description"}</p>
    <p className="text-sm">Presenter: {source.presenter_user_id === actorId ? "Your account" : `Assigned user · ***${source.presenter_user_id.slice(-8)}`}</p>
    <div className="flex flex-wrap gap-2"><Badge variant="outline">Microphone {source.microphone ? "allowed" : "off"}</Badge>
      <Badge variant="outline">Captured audio {source.screen_share_audio ? "allowed" : "off"}</Badge></div>
    {getContentCreatorLabel(metadata) && <p className="text-xs text-muted-foreground">{getContentCreatorLabel(metadata)}</p>}
  </CardContent><CardFooter className="flex flex-wrap gap-2">
    <Button variant="outline" size="sm" onClick={onView} aria-label={`View ${source.name}`}>View source</Button>
    {canUpdate && source.permissions?.can_update === true && <Button variant="outline" size="sm" onClick={onEdit} aria-label={`Edit ${source.name}`}>Edit</Button>}
    {canDelete && source.permissions?.can_delete === true && <Button variant="destructive" size="sm" onClick={onDelete} aria-label={`Delete ${source.name}`}>Delete</Button>}
  </CardFooter></Card>;
}
