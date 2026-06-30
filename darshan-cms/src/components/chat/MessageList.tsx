import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, RefreshCcw, SendHorizontal, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { resolveMediaDisplayName } from "@/lib/media";
import type { ChatMessage, MediaAsset } from "@/api/types";
import type { ChatPendingUiMessage } from "@/components/chat/types";
import { MessageItem } from "@/components/chat/MessageItem";
import { MediaPreview } from "@/components/common/MediaPreview";
import { formatChatTime } from "@/lib/chatTime";

interface MessageListProps {
  conversationId?: string;
  messages: ChatMessage[];
  currentUserId?: string;
  canMutate?: boolean;
  lastReadSeq?: number;
  newMessagesFromSeq?: number | null;
  focusMessageId?: string | null;
  mentionDisplayById?: Record<string, string>;
  pendingMessages?: ChatPendingUiMessage[];
  attachmentMediaById?: Record<string, MediaAsset>;
  isLoading?: boolean;
  canFetchNewer?: boolean;
  isFetchingNewer?: boolean;
  isUpToDate?: boolean;
  onFetchNewer?: () => void;
  onRetryPendingMessage?: (localId: string) => void;
  onDiscardPendingMessage?: (localId: string) => void;
  onMentionClick?: (userId: string) => void;
  onReply?: (messageId: string) => void;
  onReact?: (messageId: string, emoji: string, op: "add" | "remove") => void;
  onEdit?: (messageId: string, text: string) => void;
  onDelete?: (messageId: string) => void;
  onTogglePin?: (messageId: string, shouldPin: boolean) => void;
  onBookmark?: (messageId: string) => void;
  isMessagePinned?: (messageId: string) => boolean;
  isMessageBookmarked?: (messageId: string) => boolean;
  canEditMessage?: (message: ChatMessage) => boolean;
  canDeleteMessage?: (message: ChatMessage) => boolean;
}

const WINDOW_SIZE = 300;
const dateKey = (isoDate: string) => new Date(isoDate).toDateString();

export function MessageList({
  conversationId,
  messages,
  currentUserId,
  canMutate = true,
  lastReadSeq,
  newMessagesFromSeq,
  focusMessageId,
  mentionDisplayById = {},
  pendingMessages = [],
  attachmentMediaById = {},
  isLoading = false,
  canFetchNewer = true,
  isFetchingNewer = false,
  isUpToDate = false,
  onFetchNewer,
  onRetryPendingMessage,
  onDiscardPendingMessage,
  onMentionClick,
  onReply,
  onReact,
  onEdit,
  onDelete,
  onTogglePin,
  onBookmark,
  isMessagePinned,
  isMessageBookmarked,
  canEditMessage,
  canDeleteMessage,
}: MessageListProps) {
  const messageRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [visibleCount, setVisibleCount] = useState(WINDOW_SIZE);
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);
  const [focusNotLoaded, setFocusNotLoaded] = useState(false);
  const [focusCalloutDismissed, setFocusCalloutDismissed] = useState(false);

  useEffect(() => {
    setVisibleCount(WINDOW_SIZE);
    setHighlightedMessageId(null);
    setFocusNotLoaded(false);
    setFocusCalloutDismissed(false);
  }, [conversationId]);

  const sortedMessages = useMemo(() => [...messages].sort((a, b) => a.seq - b.seq), [messages]);
  const shouldWindow = !focusMessageId;
  const visibleMessages = useMemo(() => {
    if (!shouldWindow) return sortedMessages;
    return sortedMessages.slice(Math.max(0, sortedMessages.length - visibleCount));
  }, [shouldWindow, sortedMessages, visibleCount]);

  const hasLocalOlder = shouldWindow && visibleMessages.length < sortedMessages.length;
  const sortedPendingMessages = useMemo(
    () => [...pendingMessages].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()),
    [pendingMessages],
  );

  useEffect(() => {
    if (!focusMessageId) {
      setHighlightedMessageId(null);
      setFocusNotLoaded(false);
      setFocusCalloutDismissed(false);
      return;
    }

    const targetExists = visibleMessages.some((message) => message.id === focusMessageId);
    if (!targetExists) {
      setFocusNotLoaded(true);
      return;
    }

    setFocusNotLoaded(false);
    setHighlightedMessageId(focusMessageId);
    const targetNode = messageRefs.current[focusMessageId];
    targetNode?.scrollIntoView({ behavior: "smooth", block: "center" });

    const timer = window.setTimeout(() => {
      setHighlightedMessageId((current) => (current === focusMessageId ? null : current));
    }, 3000);
    return () => window.clearTimeout(timer);
  }, [focusMessageId, visibleMessages]);

  if (isLoading) {
    return <div className="p-4 text-sm text-muted-foreground">Loading messages...</div>;
  }

  if (visibleMessages.length === 0 && sortedPendingMessages.length === 0) {
    return <div className="p-4 text-sm text-muted-foreground">No messages yet.</div>;
  }

  return (
    <div className="space-y-3 p-3">
      {(hasLocalOlder || canFetchNewer) && (
        <div className="flex flex-wrap items-center justify-center gap-2">
          {hasLocalOlder && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setVisibleCount((prev) => prev + WINDOW_SIZE)}
              aria-label="Show more loaded messages"
            >
              Show more loaded messages
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={onFetchNewer}
            disabled={!canFetchNewer || isFetchingNewer}
            aria-label="Check for new messages"
          >
            {isFetchingNewer ? "Checking..." : "Check for new messages"}
          </Button>
          {isUpToDate && <span className="text-xs text-muted-foreground">Up to date</span>}
        </div>
      )}

      {focusMessageId && focusNotLoaded && !focusCalloutDismissed && (
        <div className="rounded-md border border-primary/40 bg-primary/5 px-3 py-2 text-xs text-primary">
          <p>Message not loaded. Older-pagination support is required to fetch earlier messages.</p>
          <div className="mt-2 flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={onFetchNewer} aria-label="Check for new messages">
              Check for new messages
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setFocusCalloutDismissed(true)} aria-label="Dismiss focus warning">
              Dismiss
            </Button>
          </div>
        </div>
      )}

      {visibleMessages.map((message, index) => {
        const prevMessage = visibleMessages[index - 1];
        const showDateSeparator = !prevMessage || dateKey(prevMessage.created_at) !== dateKey(message.created_at);
        const showUnreadMarker =
          typeof lastReadSeq === "number" &&
          lastReadSeq > 0 &&
          message.seq > lastReadSeq &&
          (!prevMessage || prevMessage.seq <= lastReadSeq);
        const showNewMessagesMarker =
          typeof newMessagesFromSeq === "number" &&
          message.seq >= newMessagesFromSeq &&
          (!prevMessage || prevMessage.seq < newMessagesFromSeq);

        return (
          <Fragment key={message.id}>
            {showDateSeparator && (
              <div className="flex items-center gap-3 py-1 text-xs text-muted-foreground">
                <div className="h-px flex-1 bg-border" />
                <span>{formatChatTime(message.created_at, { includeDate: true, includeTime: false })}</span>
                <div className="h-px flex-1 bg-border" />
              </div>
            )}
            {showUnreadMarker && (
              <div className="rounded-md border border-primary/40 bg-primary/5 px-3 py-1 text-xs font-medium text-primary">
                Unread messages
              </div>
            )}
            {showNewMessagesMarker && (
              <div className="rounded-md border border-primary/50 bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
                New messages
              </div>
            )}
            <div
              ref={(node) => {
                messageRefs.current[message.id] = node;
              }}
              className={highlightedMessageId === message.id ? "rounded-md ring-2 ring-primary/50" : ""}
            >
              <MessageItem
                message={message}
                currentUserId={currentUserId}
                canMutate={canMutate}
                isPinned={isMessagePinned?.(message.id) ?? false}
                isBookmarked={isMessageBookmarked?.(message.id) ?? false}
                canEditMessage={canEditMessage?.(message)}
                canDeleteMessage={canDeleteMessage?.(message)}
                mentionDisplayById={mentionDisplayById}
                onMentionClick={onMentionClick}
                attachmentMediaById={attachmentMediaById}
                onReply={onReply}
                onReact={onReact}
                onEdit={onEdit}
                onDelete={onDelete}
                onTogglePin={onTogglePin}
                onBookmark={onBookmark}
              />
            </div>
          </Fragment>
        );
      })}

      {sortedPendingMessages.map((pending) => (
        <div key={pending.localId} className="rounded-md border border-dashed p-3">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span className="font-medium">{pending.status === "sending" ? "Sending…" : "Failed to send"}</span>
            <span>{formatChatTime(pending.createdAt, { includeDate: false })}</span>
          </div>
          <p className="mt-2 whitespace-pre-wrap break-words text-sm">{pending.text || "(attachment message)"}</p>
          {pending.attachmentMediaIds.length > 0 && (
            <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {pending.attachmentMediaIds.map((mediaId) => {
                const media = attachmentMediaById[mediaId];
                return (
                  <div key={`${pending.localId}-${mediaId}`} className="rounded-md border p-2">
                    <MediaPreview
                      media={media}
                      url={media?.media_url}
                      type={media?.content_type}
                      alt={resolveMediaDisplayName(media) || mediaId}
                      className="h-20 w-full"
                    />
                    <p className="mt-1 truncate text-xs text-muted-foreground">
                      {resolveMediaDisplayName(media) || mediaId}
                    </p>
                  </div>
                );
              })}
            </div>
          )}
          {pending.errorMessage && (
            <p className="mt-2 flex items-center gap-1 text-xs text-destructive">
              <AlertCircle className="h-3.5 w-3.5" />
              {pending.errorMessage}
            </p>
          )}
          <div className="mt-2 flex items-center gap-2">
            {pending.status === "failed" && (
              <Button size="sm" variant="outline" onClick={() => onRetryPendingMessage?.(pending.localId)}>
                <RefreshCcw className="mr-1 h-3.5 w-3.5" />
                Retry
              </Button>
            )}
            {pending.status === "sending" && (
              <Button size="sm" variant="outline" disabled>
                <SendHorizontal className="mr-1 h-3.5 w-3.5" />
                Sending
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              className="text-destructive"
              onClick={() => onDiscardPendingMessage?.(pending.localId)}
            >
              <Trash2 className="mr-1 h-3.5 w-3.5" />
              Discard
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}
