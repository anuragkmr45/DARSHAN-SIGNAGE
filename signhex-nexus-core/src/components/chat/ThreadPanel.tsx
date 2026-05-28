import { useMemo, useState } from "react";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { MessageItem } from "@/components/chat/MessageItem";
import { useChatThread } from "@/hooks/chat/useChatQueries";
import type { ChatMessage, MediaAsset } from "@/api/types";
import { ChatStatusBanner } from "@/components/chat/ChatStatusBanner";

interface ThreadPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversationId?: string;
  threadRootId?: string;
  rootMessage?: ChatMessage;
  currentUserId?: string;
  canMutate?: boolean;
  mentionDisplayById?: Record<string, string>;
  onMentionClick?: (userId: string) => void;
  statusBannerMode?: "READ_ONLY" | "MUTED" | "BANNED";
  statusBannerMessage?: string;
  statusBannerUntil?: string;
  attachmentMediaById?: Record<string, MediaAsset>;
  onReplySubmit: (payload: { text: string; replyTo: string; alsoToChannel: boolean }) => Promise<void> | void;
}

export function ThreadPanel({
  open,
  onOpenChange,
  conversationId,
  threadRootId,
  rootMessage,
  currentUserId,
  canMutate = true,
  mentionDisplayById = {},
  onMentionClick,
  statusBannerMode,
  statusBannerMessage,
  statusBannerUntil,
  attachmentMediaById = {},
  onReplySubmit,
}: ThreadPanelProps) {
  const [draft, setDraft] = useState("");
  const [alsoToChannel, setAlsoToChannel] = useState(false);
  const threadQuery = useChatThread(conversationId, threadRootId);
  const orderedReplies = useMemo(
    () => [...threadQuery.items].sort((a, b) => b.seq - a.seq),
    [threadQuery.items],
  );

  const submit = async () => {
    if (!threadRootId || !draft.trim() || !canMutate) return;
    await onReplySubmit({ text: draft.trim(), replyTo: threadRootId, alsoToChannel });
    setDraft("");
    setAlsoToChannel(false);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full max-w-[520px] p-0">
        <SheetHeader className="border-b px-4 py-3">
          <SheetTitle>Thread</SheetTitle>
          <SheetDescription>Replies stay grouped under the selected message.</SheetDescription>
        </SheetHeader>

        <div className="flex h-full min-h-0 flex-col">
          {statusBannerMode && (
            <ChatStatusBanner
              mode={statusBannerMode}
              message={statusBannerMessage}
              until={statusBannerUntil}
              className="mx-3 mt-3"
            />
          )}
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
            {rootMessage && (
              <div>
                <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Parent Message</p>
                <MessageItem
                  message={rootMessage}
                  currentUserId={currentUserId}
                  canMutate={canMutate}
                  mentionDisplayById={mentionDisplayById}
                  onMentionClick={onMentionClick}
                  attachmentMediaById={attachmentMediaById}
                />
              </div>
            )}

            <div>
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="text-xs font-semibold uppercase text-muted-foreground">Replies</p>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void threadQuery.fetchNewer()}
                    disabled={threadQuery.isFetchingNewer}
                    aria-label="Check for new thread replies"
                  >
                    {threadQuery.isFetchingNewer ? "Checking..." : "Check for new"}
                  </Button>
                  {threadQuery.isUpToDate && (
                    <span className="text-xs text-muted-foreground">Up to date</span>
                  )}
                </div>
              </div>
              {threadQuery.isLoading ? (
                <p className="text-sm text-muted-foreground">Loading thread...</p>
              ) : orderedReplies.length === 0 ? (
                <p className="text-sm text-muted-foreground">No replies yet.</p>
              ) : (
                <div className="space-y-2">
                  {orderedReplies.map((message) => (
                    <MessageItem
                      key={message.id}
                      message={message}
                      currentUserId={currentUserId}
                      canMutate={canMutate}
                      mentionDisplayById={mentionDisplayById}
                      onMentionClick={onMentionClick}
                      attachmentMediaById={attachmentMediaById}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="border-t p-3">
            <Textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  onOpenChange(false);
                  return;
                }
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void submit();
                }
              }}
              placeholder="Reply in thread..."
              disabled={!canMutate}
              aria-label="Thread reply composer"
            />
            <div className="mt-2 flex items-center justify-between gap-3">
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <Checkbox
                  checked={alsoToChannel}
                  onCheckedChange={(checked) => setAlsoToChannel(Boolean(checked))}
                  disabled={!canMutate || !threadRootId}
                  aria-label="Also send thread reply to main chat"
                />
                Also send to main chat
              </label>
              <Button onClick={() => void submit()} disabled={!canMutate || !draft.trim()} aria-label="Send thread reply">
                <Send className="mr-1 h-4 w-4" />
                Reply
              </Button>
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
