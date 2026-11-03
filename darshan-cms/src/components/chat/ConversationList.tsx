import { MessageCircle, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import type { ChatConversationListItem } from "@/api/types";

interface ConversationListProps {
  conversations: ChatConversationListItem[];
  mentionDisplayById?: Record<string, string>;
  selectedConversationId?: string;
  search: string;
  onSearch: (value: string) => void;
  onSelect: (conversationId: string) => void;
  isLoading?: boolean;
  errorMessage?: string;
  onRetry?: () => void;
}

const GROUPS: Array<{ key: ChatConversationListItem["type"]; label: string }> = [
  { key: "FORUM_OPEN", label: "Forums" },
  { key: "GROUP_CLOSED", label: "Private Groups" },
  { key: "DM", label: "Direct Messages" },
];

const getConversationTitle = (conversation: ChatConversationListItem) => {
  if (conversation.type === "DM") return conversation.title || "Direct Message";
  return conversation.title || conversation.topic || conversation.purpose || conversation.id;
};

const getLastMessagePreview = (conversation: ChatConversationListItem, mentionDisplayById: Record<string, string>) => {
  const last = conversation.last_message;
  if (!last) return "No messages yet";
  if (last.deleted_at) return "This message was deleted.";
  return last.body_text?.replace(/@([0-9a-fA-F-]{36})/g, (_token, id: string) => `@${mentionDisplayById[id] || "User"}`) || "Attachment";
};

export function ConversationList({
  conversations,
  mentionDisplayById = {},
  selectedConversationId,
  search,
  onSearch,
  onSelect,
  isLoading = false,
  errorMessage,
  onRetry,
}: ConversationListProps) {
  const filtered = conversations.filter((conversation) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    const haystack = [
      conversation.id,
      conversation.title,
      conversation.topic,
      conversation.purpose,
      conversation.last_message?.deleted_at ? null : conversation.last_message?.body_text,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return haystack.includes(q);
  });

  return (
    <div className="flex h-full min-h-0 flex-col bg-card">
      <div className="border-b p-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => onSearch(event.target.value)}
            placeholder="Search chats..."
            aria-label="Search conversations"
            className="pl-9"
          />
        </div>
      </div>

      <ScrollArea className="flex-1 overscroll-contain">
        <div className="space-y-4 px-2 py-3">
          {isLoading && <p className="px-3 py-6 text-sm text-muted-foreground" role="status">Loading conversations…</p>}
          {errorMessage && (
            <div className="space-y-2 px-3 py-6">
              <p className="text-sm text-destructive">Could not load conversations. {errorMessage}</p>
              {onRetry && <Button size="sm" variant="outline" onClick={onRetry}>Retry</Button>}
            </div>
          )}
          {GROUPS.map((group) => {
            const items = filtered.filter((conversation) => conversation.type === group.key);
            if (!items.length) return null;

            return (
              <div key={group.key} className="space-y-1">
                <p className="px-3 py-1 text-xs font-medium text-muted-foreground">
                  {group.label}
                </p>
                {items.map((conversation) => {
                  const isSelected = selectedConversationId === conversation.id;
                  const unreadCount = conversation.unread_count ?? 0;
                  const isArchived = conversation.state === "ARCHIVED";

                  return (
                    <button
                      key={conversation.id}
                      type="button"
                      onClick={() => onSelect(conversation.id)}
                      aria-current={isSelected ? "page" : undefined}
                      className={`w-full rounded-md px-3 py-3 text-left transition-colors ${
                        isSelected
                          ? "bg-primary/10"
                          : "hover:bg-muted/60"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 space-y-1">
                          <div className="flex items-center gap-2">
                            <MessageCircle className="h-3.5 w-3.5 text-muted-foreground" />
                            <p className="truncate text-sm font-medium">{getConversationTitle(conversation)}</p>
                          </div>
                          <p className="truncate text-xs text-muted-foreground">
                            {getLastMessagePreview(conversation, mentionDisplayById)}
                          </p>
                        </div>
                        <div className="flex flex-col items-end gap-1">
                          {isArchived && <Badge variant="outline">Archived</Badge>}
                          {unreadCount > 0 && <Badge>{unreadCount}</Badge>}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            );
          })}

          {!isLoading && !errorMessage && filtered.length === 0 && (
            <div className="p-6 text-center text-sm text-muted-foreground">
              No conversations found.
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
