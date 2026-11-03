import { useEffect, useMemo, useState } from "react";
import { BookmarkPlus, CornerDownRight, MoreHorizontal, Pencil, Pin, PinOff, SmilePlus, Trash2 } from "lucide-react";
import { MediaPreview } from "@/components/common/MediaPreview";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { Input } from "@/components/ui/input";
import { formatChatTime } from "@/lib/chatTime";
import type { ChatMessage, MediaAsset } from "@/api/types";
import { resolveMediaDisplayName } from "@/lib/media";

interface MessageItemProps {
  message: ChatMessage;
  currentUserId?: string;
  canMutate?: boolean;
  attachmentMediaById?: Record<string, MediaAsset>;
  mentionDisplayById?: Record<string, string>;
  onMentionClick?: (userId: string) => void;
  isPinned?: boolean;
  isBookmarked?: boolean;
  canEditMessage?: boolean;
  canDeleteMessage?: boolean;
  onReply?: (messageId: string) => void;
  onReact?: (messageId: string, emoji: string, op: "add" | "remove") => void;
  onEdit?: (messageId: string, text: string) => Promise<void> | void;
  onDelete?: (messageId: string) => void;
  onTogglePin?: (messageId: string, shouldPin: boolean) => void;
  onBookmark?: (messageId: string) => void;
}

const mentionPattern = /(@[0-9a-fA-F-]{36})/g;
const mentionTokenPattern = /^@([0-9a-fA-F-]{36})$/;

const renderMessageText = (
  content: string,
  mentionDisplayById: Record<string, string>,
  currentUserId: string,
  onMentionClick?: (userId: string) => void,
) => {
  const parts = content.split(mentionPattern);
  return parts.map((part, index) => {
    const tokenMatch = part.match(mentionTokenPattern);
    if (!tokenMatch) {
      return <span key={`${part}-${index}`}>{part}</span>;
    }

    const userId = tokenMatch[1];
    const label = `@${mentionDisplayById[userId] || "User"}`;
    if (userId === currentUserId || !onMentionClick) return <span key={`${part}-${index}`}>{label}</span>;
    return (
      <button
        key={`${part}-${index}`}
        type="button"
        className="font-medium text-primary hover:underline"
        onClick={() => onMentionClick?.(userId)}
        aria-label={`Open DM with ${label}`}
      >
        {label}
      </button>
    );
  });
};

const getAttachmentId = (attachment: string | ChatMessage["attachments"][number]) => {
  if (typeof attachment === "string") return attachment;
  return attachment?.media_asset_id || attachment?.media_id || attachment?.mediaId;
};

export function MessageItem({
  message,
  currentUserId,
  canMutate = true,
  attachmentMediaById = {},
  mentionDisplayById = {},
  onMentionClick,
  isPinned = false,
  isBookmarked = false,
  canEditMessage,
  canDeleteMessage,
  onReply,
  onReact,
  onEdit,
  onDelete,
  onTogglePin,
  onBookmark,
}: MessageItemProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(message.body_text || "");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [editPending, setEditPending] = useState(false);
  const [viewer, setViewer] = useState<{
    media?: MediaAsset;
    url?: string;
    type?: string;
    alt?: string;
  } | null>(null);
  const attachments = Array.isArray(message.attachments) ? message.attachments : [];
  const isDeleted = Boolean(message.deleted_at);
  const isMine = currentUserId ? currentUserId === message.sender_id : false;
  const canEditResolved = Boolean(onEdit) && canMutate && (typeof canEditMessage === "boolean" ? canEditMessage : isMine);
  const canDeleteResolved = Boolean(onDelete) && canMutate && (typeof canDeleteMessage === "boolean" ? canDeleteMessage : isMine);

  useEffect(() => {
    if (!isEditing) setDraft(message.body_text || "");
  }, [isEditing, message.body_text]);

  const reactionsByEmoji = useMemo(() => {
    const map = new Map<string, Set<string>>();
    (message.reactions ?? []).forEach((reaction) => {
      if (!map.has(reaction.emoji)) map.set(reaction.emoji, new Set());
      map.get(reaction.emoji)?.add(reaction.user_id);
    });
    return map;
  }, [message.reactions]);

  useEffect(() => {
    if (isDeleted && viewer) {
      setViewer(null);
    }
  }, [isDeleted, viewer]);

  const senderLabel = mentionDisplayById[message.sender_id] || message.sender_id;

  return (
    <div className="space-y-2 rounded-md border bg-background p-3" data-chat-message-id={message.id}>
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <div className="flex items-center gap-2">
          <span className="font-medium text-foreground">{senderLabel}</span>
          <span>#{message.seq}</span>
          {message.edited_at && !isDeleted && (
            <Badge variant="outline" aria-label="Message edited">
              edited {formatChatTime(message.edited_at, { includeDate: false })}
            </Badge>
          )}
          {message.thread_reply_count ? <Badge variant="secondary">{message.thread_reply_count} replies</Badge> : null}
          {isPinned && <Badge variant="secondary">Pinned</Badge>}
        </div>
        <span>{formatChatTime(message.created_at)}</span>
      </div>

      {isDeleted ? (
        <div className="rounded-md bg-muted/70 p-2 text-sm italic text-muted-foreground">
          This message was deleted.
        </div>
      ) : isEditing ? (
        <div className="flex items-center gap-2">
          <Input value={draft} onChange={(event) => setDraft(event.target.value)} aria-label="Edit message text" />
          <Button
            size="sm"
            onClick={() => {
              setEditPending(true);
              void Promise.resolve().then(() => onEdit?.(message.id, draft.trim()))
                .then(() => setIsEditing(false))
                .catch(() => undefined)
                .finally(() => setEditPending(false));
            }}
            disabled={!draft.trim() || editPending}
          >
            {editPending ? "Saving…" : "Save"}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setIsEditing(false)} disabled={editPending}>
            Cancel
          </Button>
        </div>
      ) : (
        <div className="whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground">
          {renderMessageText(message.body_text || "", mentionDisplayById, currentUserId, onMentionClick)}
        </div>
      )}

      {!isDeleted && attachments.length > 0 && (
        <div className="grid grid-cols-1 gap-2 pt-1 sm:grid-cols-2">
          {attachments.map((attachment, index) => {
            const attachmentId = getAttachmentId(attachment);
            const media = attachmentId ? attachmentMediaById[attachmentId] : undefined;
            const trustedUrl =
              media?.media_url ||
              (typeof attachment === "object" ? attachment.media_url || undefined : undefined);
            const attachmentLabel =
              resolveMediaDisplayName(media) ||
              (typeof attachment === "object" ? attachment.filename || "Attachment" : attachmentId || "Attachment");

            return (
              <div
                key={attachmentId || `${message.id}-attachment-${index}`}
                className="space-y-2 rounded-md border p-2"
              >
                <MediaPreview
                  media={media}
                  url={trustedUrl}
                  type={media?.content_type || (typeof attachment === "object" ? attachment.content_type : undefined)}
                  alt={attachmentLabel}
                  className="h-36 w-full"
                />
                <div className="truncate text-xs text-muted-foreground">
                  {attachmentLabel}
                </div>
                {trustedUrl && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      setViewer({
                        media,
                        url: trustedUrl,
                        type:
                          media?.content_type ||
                          (typeof attachment === "object" ? attachment.content_type : undefined),
                        alt: attachmentLabel,
                      })
                    }
                    aria-label="View attachment in wide modal"
                  >
                    View
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {!isDeleted && (
        <div className="flex flex-wrap items-center gap-2">
          {Array.from(reactionsByEmoji.entries()).map(([emoji, users]) => {
            const reactedByMe = currentUserId ? users.has(currentUserId) : false;
            return (
              <button
                key={`${message.id}-${emoji}`}
                type="button"
                className={`rounded-full border px-2 py-0.5 text-xs ${
                  reactedByMe ? "border-primary bg-primary/10 text-primary" : "border-border"
                }`}
                onClick={() => onReact?.(message.id, emoji, reactedByMe ? "remove" : "add")}
                disabled={!canMutate}
                aria-label={`React with ${emoji}`}
              >
                {emoji} {users.size}
              </button>
            );
          })}

          {onReply && <Button size="sm" variant="ghost" onClick={() => onReply(message.id)} aria-label="Reply in thread">
            <CornerDownRight className="mr-1 h-3.5 w-3.5" />
            Reply
          </Button>}

          {onReact && <Button size="sm" variant="ghost" onClick={() => onReact(message.id, ":thumbsup:", "add")} disabled={!canMutate} aria-label="Add reaction">
            <SmilePlus className="mr-1 h-3.5 w-3.5" />
            React
          </Button>}

          {(canEditResolved || canDeleteResolved || onTogglePin || onBookmark) && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="ghost" aria-label="More message actions">
                  <MoreHorizontal className="mr-1 h-3.5 w-3.5" />
                  More
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                {canEditResolved && (
                  <DropdownMenuItem onSelect={() => setIsEditing(true)}>
                    <Pencil className="mr-2 h-4 w-4" />Edit message
                  </DropdownMenuItem>
                )}
                {onTogglePin && (
                  <DropdownMenuItem disabled={!canMutate} onSelect={() => onTogglePin(message.id, !isPinned)}>
                    {isPinned ? <PinOff className="mr-2 h-4 w-4" /> : <Pin className="mr-2 h-4 w-4" />}
                    {isPinned ? "Unpin message" : "Pin message"}
                  </DropdownMenuItem>
                )}
                {onBookmark && (
                  <DropdownMenuItem disabled={!canMutate || isBookmarked} onSelect={() => onBookmark(message.id)}>
                    <BookmarkPlus className="mr-2 h-4 w-4" />{isBookmarked ? "Bookmarked" : "Bookmark message"}
                  </DropdownMenuItem>
                )}
                {canDeleteResolved && (
                  <DropdownMenuItem className="text-destructive" onSelect={() => setDeleteOpen(true)}>
                    <Trash2 className="mr-2 h-4 w-4" />Delete message
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      )}

      <ConfirmDialog
        open={deleteOpen}
        title="Delete this message?"
        description="The message will disappear from the conversation. An authorized administrator may still restore it."
        confirmLabel="Delete message"
        onConfirm={() => { setDeleteOpen(false); onDelete?.(message.id); }}
        onCancel={() => setDeleteOpen(false)}
      />

      <Dialog open={Boolean(viewer) && !isDeleted} onOpenChange={(open) => !open && setViewer(null)}>
        <DialogContent className="h-[90vh] w-[95vw] max-w-6xl p-4">
          <DialogHeader>
            <DialogTitle>{viewer?.alt || "Attachment preview"}</DialogTitle>
          </DialogHeader>
          <div className="min-h-0 flex-1">
            <MediaPreview
              media={viewer?.media}
              url={viewer?.url}
              type={viewer?.type}
              alt={viewer?.alt}
              className="h-full w-full object-contain"
            />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
