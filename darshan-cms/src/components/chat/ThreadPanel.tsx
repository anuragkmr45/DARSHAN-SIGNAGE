import { useMemo, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import { ArrowLeft, Send } from "lucide-react";
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
import { chatApi } from "@/api/domains/chat";
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
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [channelChoices, setChannelChoices] = useState<Record<string, boolean>>({});
  const draftKey = `${conversationId ?? ""}:${threadRootId ?? ""}`;
  const draft = drafts[draftKey] ?? "";
  const alsoToChannel = channelChoices[draftKey] ?? false;
  const setDraft = (value: string) => setDrafts((current) => ({ ...current, [draftKey]: value }));
  const setAlsoToChannel = (value: boolean) => setChannelChoices((current) => ({ ...current, [draftKey]: value }));
  const threadQuery = useChatThread(conversationId, threadRootId);
  const resolvedRootMessage = threadQuery.data?.pages?.[0]?.rootMessage ?? rootMessage;
  const canReply = canMutate && !threadQuery.isLoading && !threadQuery.isError;
  const orderedReplies = useMemo(
    () => [...threadQuery.items].sort((a, b) => b.seq - a.seq),
    [threadQuery.items],
  );
  const replyMediaIds = useMemo(() => Array.from(new Set([
    ...(resolvedRootMessage ? [resolvedRootMessage] : []),
    ...threadQuery.items,
  ].flatMap((message) =>
    (message.attachments ?? []).map((attachment) => typeof attachment === "string"
      ? attachment
      : attachment.media_asset_id || attachment.media_id || attachment.mediaId).filter((id): id is string => Boolean(id))
  ))), [resolvedRootMessage, threadQuery.items]);
  const replyMediaQueries = useQueries({
    queries: replyMediaIds.map((mediaId) => ({
      queryKey: ["media", "chat", conversationId, mediaId],
      queryFn: () => chatApi.getAttachmentMedia(conversationId!, mediaId),
      enabled: Boolean(open && conversationId),
      staleTime: 60_000,
      retry: 1,
    })),
  });
  const resolvedAttachmentMediaById = useMemo(() => {
    const result = { ...attachmentMediaById };
    replyMediaIds.forEach((mediaId, index) => {
      const media = replyMediaQueries[index]?.data;
      if (media) result[mediaId] = media;
    });
    return result;
  }, [attachmentMediaById, replyMediaIds, replyMediaQueries]);

  const submit = async () => {
    if (!threadRootId || !draft.trim() || !canReply) return;
    try {
      await onReplySubmit({ text: draft.trim(), replyTo: threadRootId, alsoToChannel });
      setDraft("");
      setAlsoToChannel(false);
    } catch {
      // The parent displays the error; keep this thread's draft for retry.
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex h-[100dvh] w-full max-w-none flex-col p-0 sm:max-w-[520px]">
        <SheetHeader className="border-b px-4 py-3 pr-12 text-left">
          <Button size="sm" variant="ghost" className="w-fit sm:hidden" onClick={() => onOpenChange(false)}>
            <ArrowLeft className="mr-1 h-4 w-4" />
            Conversation
          </Button>
          <SheetTitle>Thread</SheetTitle>
          <SheetDescription className="sr-only">Replies grouped under the selected message.</SheetDescription>
        </SheetHeader>

        <div className="flex min-h-0 flex-1 flex-col">
          {statusBannerMode && (
            <ChatStatusBanner
              mode={statusBannerMode}
              message={statusBannerMessage}
              until={statusBannerUntil}
              className="mx-3 mt-3"
            />
          )}
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain p-3">
            {resolvedRootMessage && (
              <div>
                <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Parent Message</p>
                <MessageItem
                  message={resolvedRootMessage}
                  currentUserId={currentUserId}
                  canMutate={canMutate}
                  mentionDisplayById={mentionDisplayById}
                  onMentionClick={onMentionClick}
                  attachmentMediaById={resolvedAttachmentMediaById}
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
                    disabled={threadQuery.isLoading || threadQuery.isError || threadQuery.isFetchingNewer}
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
              ) : threadQuery.isError ? (
                <div role="alert" className="space-y-2 rounded-lg border p-3 text-sm">
                  <p>Couldn’t load this thread. Your reply draft is still here.</p>
                  <Button size="sm" variant="outline" onClick={() => void threadQuery.refetch()}>Retry thread</Button>
                </div>
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
                      attachmentMediaById={resolvedAttachmentMediaById}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="border-t p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
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
              disabled={!canReply}
              aria-label="Thread reply composer"
            />
            <div className="mt-2 flex items-center justify-between gap-3">
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <Checkbox
                  checked={alsoToChannel}
                  onCheckedChange={(checked) => setAlsoToChannel(Boolean(checked))}
                  disabled={!canReply || !threadRootId}
                  aria-label="Also send thread reply to main chat"
                />
                Also send to main chat
              </label>
              <Button onClick={() => void submit()} disabled={!canReply || !draft.trim()} aria-label="Send thread reply">
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
