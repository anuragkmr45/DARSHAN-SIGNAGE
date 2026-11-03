import { ArrowLeft, Hash, Link2, Lock, MoreHorizontal, UserRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { ChatConversationListItem } from "@/api/types";

interface ChatHeaderProps {
  conversation?: ChatConversationListItem;
  onBack?: () => void;
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
  onBack,
  onOpenSettings,
  onShareLink,
  isSharingLink = false,
}: ChatHeaderProps) {
  const Icon = getIcon(conversation?.type);

  return (
    <div className="flex min-w-0 items-center justify-between gap-2 border-b px-3 py-3 sm:px-4">
      <div className="flex min-w-0 items-center gap-2 sm:gap-3">
        {conversation && onBack && (
          <Button size="sm" variant="ghost" className="shrink-0 lg:hidden" onClick={onBack}>
            <ArrowLeft className="mr-1 h-4 w-4" />
            Chats
          </Button>
        )}
        <div className="hidden rounded-md bg-muted p-2 sm:block">
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <h2 className="truncate text-sm font-semibold">{getTitle(conversation)}</h2>
            {conversation?.state === "ARCHIVED" && <Badge variant="outline">ARCHIVED</Badge>}
          </div>
          {conversation && (
            <p className="truncate text-xs text-muted-foreground">
              {conversation.type === "DM"
                ? "Direct Message"
                : conversation.topic || conversation.purpose || "Chat conversation"}
            </p>
          )}
        </div>
      </div>
      {conversation && (
        <>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="outline" className="shrink-0 lg:hidden">
              <MoreHorizontal className="mr-1 h-4 w-4" />
              More
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={onOpenSettings}>Details</DropdownMenuItem>
            {conversation.state !== "DELETED" && onShareLink && (
              <DropdownMenuItem onSelect={onShareLink} disabled={isSharingLink}>Share link</DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
        <div className="hidden shrink-0 items-center gap-2 lg:flex">
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
        </>
      )}
    </div>
  );
}
