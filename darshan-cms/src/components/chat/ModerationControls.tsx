import { useState } from "react";
import type { ChatConversationListItem } from "@/api/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatChatTime } from "@/lib/chatTime";

interface ModerationControlsProps {
  conversation?: ChatConversationListItem;
  canModerate: boolean;
  onModerate: (payload: {
    userId: string;
    action: "MUTE" | "UNMUTE" | "BAN" | "UNBAN";
    until?: string;
    reason?: string;
  }) => Promise<void> | void;
}

export function ModerationControls({ conversation, canModerate, onModerate }: ModerationControlsProps) {
  const [userId, setUserId] = useState("");
  const [until, setUntil] = useState("");
  const [reason, setReason] = useState("");

  if (!conversation || conversation.type === "DM" || !canModerate) return null;

  const runAction = async (action: "MUTE" | "UNMUTE" | "BAN" | "UNBAN") => {
    if (!userId.trim()) return;
    await onModerate({
      userId: userId.trim(),
      action,
      until: until || undefined,
      reason: reason || undefined,
    });
  };

  return (
    <div className="space-y-2 rounded-md border bg-card p-3">
      <p className="text-xs font-semibold uppercase text-muted-foreground">Moderation</p>
      <div className="space-y-1">
        <Label>User ID</Label>
        <Input value={userId} onChange={(event) => setUserId(event.target.value)} placeholder="Target user id" />
      </div>
      <div className="space-y-1">
        <Label>Until (optional ISO datetime)</Label>
        <Input value={until} onChange={(event) => setUntil(event.target.value)} placeholder="2026-03-10T10:00:00.000Z" />
        {until && (
          <p className="text-[11px] text-muted-foreground">
            Local time: {formatChatTime(until)}
          </p>
        )}
      </div>
      <div className="space-y-1">
        <Label>Reason (optional)</Label>
        <Input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Reason" />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Button size="sm" variant="outline" onClick={() => void runAction("MUTE")} aria-label="Mute member">
          Mute
        </Button>
        <Button size="sm" variant="outline" onClick={() => void runAction("UNMUTE")} aria-label="Unmute member">
          Unmute
        </Button>
        <Button size="sm" variant="destructive" onClick={() => void runAction("BAN")} aria-label="Ban member">
          Ban
        </Button>
        <Button size="sm" variant="outline" onClick={() => void runAction("UNBAN")} aria-label="Unban member">
          Unban
        </Button>
      </div>
    </div>
  );
}
