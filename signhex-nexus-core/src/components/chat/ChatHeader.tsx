import { Hash, Link2, Lock, UserRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ChatConversationListItem } from "@/api/types";

interface ChatHeaderProps {
  conversation?: ChatConversationListItem;
  onOpenSettings?: () => void;
  onShareLink?: () => void;
  isSharingLink?: boolean;
}

const getIcon = (type?: ChatConversationListItem["type"]) => {
  if (type === "FORUM_OPEN") return Hash;
  if (type === "GROUP_CLOSED") return Lock;
  return UserRound;
};

const getTitle = (conversation?: ChatConversationListItem) => {
  if (!conversation) return "Select a conversation";
  if (conversation.type === "DM") return conversation.title || "Direct Message";
  return conversation.title || conversation.topic || conversation.purpose || conversation.id;
};

export function ChatHeader({
  conversation,
  onOpenSettings,
  onShareLink,
  isSharingLink = false,
}: ChatHeaderProps) {
  const Icon = getIcon(conversation?.type);

  return (
    <div className="flex items-center justify-between border-b px-4 py-3">
      <div className="flex items-center gap-3">
        <div className="rounded-md bg-muted p-2">
          <Icon className="h-4 w-4" />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold">{getTitle(conversation)}</h2>
            {conversation?.state === "ARCHIVED" && <Badge variant="outline">ARCHIVED</Badge>}
          </div>
          {conversation && (
            <p className="text-xs text-muted-foreground">
              {conversation.type === "DM"
                ? "Direct Message"
                : conversation.topic || conversation.purpose || "Chat conversation"}
            </p>
          )}
        </div>
      </div>
      {conversation && (
        <div className="flex items-center gap-2">
          {conversation.state !== "DELETED" && onShareLink ? (
            <Button size="sm" variant="outline" onClick={onShareLink} disabled={isSharingLink}>
              <Link2 className="mr-2 h-4 w-4" />
              {isSharingLink ? "Sharing..." : "Share link"}
            </Button>
          ) : null}
          <Button size="sm" variant="outline" onClick={onOpenSettings}>
            Details
          </Button>
        </div>
      )}
    </div>
  );
}
