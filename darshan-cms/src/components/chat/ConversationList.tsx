import { MessageCircle, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { ChatConversationListItem } from "@/api/types";

interface ConversationListProps {
  conversations: ChatConversationListItem[];
  selectedConversationId?: string;
  search: string;
  onSearch: (value: string) => void;
  onSelect: (conversationId: string) => void;
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

export function ConversationList({
  conversations,
  selectedConversationId,
  search,
  onSearch,
  onSelect,
}: ConversationListProps) {
  const filtered = conversations.filter((conversation) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    const haystack = [
      conversation.id,
      conversation.title,
      conversation.topic,
      conversation.purpose,
      conversation.last_message?.body_text,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return haystack.includes(q);
  });

  return (
    <div className="flex h-full min-h-0 flex-col rounded-lg border bg-card">
      <div className="border-b p-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => onSearch(event.target.value)}
            placeholder="Search chats..."
            className="pl-9"
          />
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="space-y-4 p-3">
          {GROUPS.map((group) => {
            const items = filtered.filter((conversation) => conversation.type === group.key);
            if (!items.length) return null;

            return (
              <div key={group.key} className="space-y-1">
                <p className="px-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
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
                      className={`w-full rounded-md border px-3 py-2 text-left transition-colors ${
                        isSelected
                          ? "border-primary bg-primary/10"
                          : "border-transparent hover:border-border hover:bg-muted/60"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 space-y-1">
                          <div className="flex items-center gap-2">
                            <MessageCircle className="h-3.5 w-3.5 text-muted-foreground" />
                            <p className="truncate text-sm font-medium">{getConversationTitle(conversation)}</p>
                          </div>
                          <p className="truncate text-xs text-muted-foreground">
                            {conversation.last_message?.body_text || "No messages yet"}
                          </p>
                        </div>
                        <div className="flex flex-col items-end gap-1">
                          {isArchived && <Badge variant="outline">ARCHIVED</Badge>}
                          {unreadCount > 0 && <Badge>{unreadCount}</Badge>}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            );
          })}

          {filtered.length === 0 && (
            <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
              No conversations found.
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
