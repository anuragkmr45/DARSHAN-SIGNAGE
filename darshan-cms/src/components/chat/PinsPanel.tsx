import { PinOff } from "lucide-react";
import type { ChatPin } from "@/api/types";
import { Button } from "@/components/ui/button";

interface PinsPanelProps {
  pins: ChatPin[];
  isLoading?: boolean;
  canMutate?: boolean;
  onJumpToMessage?: (messageId: string) => void;
  onUnpinMessage?: (messageId: string) => void;
}

export function PinsPanel({
  pins,
  isLoading = false,
  canMutate = false,
  onJumpToMessage,
  onUnpinMessage,
}: PinsPanelProps) {
  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading pinned messages...</p>;
  }

  if (pins.length === 0) {
    return (
      <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
        No pinned messages yet.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {pins.map((pin) => {
        const bodyText = pin.message?.body_text;
        const isDeleted = pin.message?.deleted_at;
        return (
          <div key={pin.id} className="rounded-md border p-3">
            <p className="text-sm">
              {isDeleted ? "This pinned message was deleted." : bodyText || "Pinned message"}
            </p>
            <div className="mt-2 flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => onJumpToMessage?.(pin.message_id)}
              >
                Jump to message
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={!canMutate}
                onClick={() => onUnpinMessage?.(pin.message_id)}
              >
                <PinOff className="mr-1 h-3.5 w-3.5" />
                Unpin
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
