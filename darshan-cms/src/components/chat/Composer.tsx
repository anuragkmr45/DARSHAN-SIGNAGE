import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { useQueries } from "@tanstack/react-query";
import { Paperclip, Send, Trash2, UploadCloud, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { MediaPreview } from "@/components/common/MediaPreview";
import { AttachmentPicker } from "@/components/chat/AttachmentPicker";
import { mediaApi } from "@/api/domains/media";
import {
  createLocalPreviewUrl,
  getFriendlyUploadError,
  uploadFileToMedia,
  validateUploadFile,
  waitForMediaReady,
} from "@/components/chat/mediaUpload";
import type { UploadMediaResult } from "@/components/chat/mediaUpload";
import type { ChatPendingAttachment, ComposerUploadItem } from "@/components/chat/types";
import { useToast } from "@/hooks/use-toast";
import { useChatUserDirectory } from "@/hooks/chat/useChatQueries";
import type { ChatMentionPolicy, User } from "@/api/types";
import { resolveMediaDisplayName } from "@/lib/media";

interface ComposerProps {
  disabled?: boolean;
  disabledReason?: string;
  isSending?: boolean;
  replyTo?: string;
  mentionPolicy?: ChatMentionPolicy;
  isAdminMentionAllowed?: boolean;
  onSubmitKeySend?: boolean;
  onTyping?: (isTyping: boolean) => void;
  onSend: (payload: { text: string; replyTo?: string; attachmentMediaIds: string[] }) => Promise<void> | void;
}

const buildLocalId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const formatUploadMb = (bytes?: number) => (typeof bytes === "number" ? `${(bytes / 1024 / 1024).toFixed(2)} MB` : "—");
const isMediaReady = (status?: string) => status === "READY";

export function Composer({
  disabled = false,
  disabledReason,
  isSending = false,
  replyTo,
  mentionPolicy,
  isAdminMentionAllowed = false,
  onSubmitKeySend = true,
  onTyping,
  onSend,
}: ComposerProps) {
  const { toast } = useToast();
  const usersDirectoryQuery = useChatUserDirectory(!disabled);
  const [openPicker, setOpenPicker] = useState(false);
  const [content, setContent] = useState("");
  const [isDragOver, setIsDragOver] = useState(false);
  const [attachments, setAttachments] = useState<ChatPendingAttachment[]>([]);
  const [uploadItems, setUploadItems] = useState<ComposerUploadItem[]>([]);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  const [mentionStart, setMentionStart] = useState<number | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const objectUrlsRef = useRef<Record<string, string>>({});
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    return () => {
      Object.values(objectUrlsRef.current).forEach((url) => URL.revokeObjectURL(url));
      objectUrlsRef.current = {};
    };
  }, []);

  const isUploading = useMemo(
    () => uploadItems.some((item) => item.status === "uploading" || item.status === "queued"),
    [uploadItems],
  );

  const unresolvedAttachmentIds = useMemo(
    () =>
      Array.from(
        new Set(
          attachments
            .filter((attachment) => !attachment.previewUrl)
            .map((attachment) => attachment.mediaId)
            .filter((id) => Boolean(id)),
        ),
      ),
    [attachments],
  );

  const unresolvedAttachmentQueries = useQueries({
    queries: unresolvedAttachmentIds.map((mediaId) => ({
      queryKey: ["media", "composer", mediaId],
      queryFn: () => mediaApi.getById(mediaId),
      staleTime: 60_000,
      retry: 1,
      enabled: Boolean(mediaId),
    })),
  });

  const unresolvedAttachmentById = useMemo(() => {
    const map: Record<string, Awaited<ReturnType<typeof mediaApi.getById>>> = {};
    unresolvedAttachmentIds.forEach((mediaId, index) => {
      const data = unresolvedAttachmentQueries[index]?.data;
      if (data) map[mediaId] = data;
    });
    return map;
  }, [unresolvedAttachmentIds, unresolvedAttachmentQueries]);

  const mentionUsers = useMemo(() => {
    const users = usersDirectoryQuery.data?.users ?? [];
    const query = mentionQuery.trim().toLowerCase();
    const filtered = users.filter((user) => {
      if (!query) return true;
      const name = `${user.first_name || ""} ${user.last_name || ""}`.trim().toLowerCase();
      return (
        user.id.toLowerCase().includes(query) ||
        user.email.toLowerCase().includes(query) ||
        name.includes(query)
      );
    });
    return filtered.slice(0, 8);
  }, [mentionQuery, usersDirectoryQuery.data?.users]);

  const labelForUser = (user: User) =>
    `${user.first_name || ""} ${user.last_name || ""}`.trim() || user.email || user.id;

  const closeMention = () => {
    setMentionOpen(false);
    setMentionQuery("");
    setMentionStart(null);
    setMentionIndex(0);
  };

  const updateMentionState = (nextValue: string, cursorPos: number) => {
    const beforeCursor = nextValue.slice(0, cursorPos);
    const match = beforeCursor.match(/(^|\s)@([a-zA-Z0-9._-]*)$/);
    if (!match) {
      closeMention();
      return;
    }

    const query = match[2] || "";
    const start = cursorPos - query.length - 1;
    setMentionStart(start);
    setMentionQuery(query);
    setMentionOpen(true);
    setMentionIndex(0);
  };

  const selectMentionUser = (userId: string) => {
    if (mentionStart === null || !textareaRef.current) return;
    const cursorPos = textareaRef.current.selectionStart ?? content.length;
    const before = content.slice(0, mentionStart);
    const after = content.slice(cursorPos);
    const token = `@${userId} `;
    const next = `${before}${token}${after}`;
    setContent(next);
    onTyping?.(true);
    closeMention();

    requestAnimationFrame(() => {
      const nextCursorPos = before.length + token.length;
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(nextCursorPos, nextCursorPos);
    });
  };

  const addAttachments = (items: ChatPendingAttachment[]) => {
    setAttachments((prev) => {
      const next = [...prev];
      items.forEach((item) => {
        if (next.some((existing) => existing.mediaId === item.mediaId)) return;
        next.push(item);
      });
      return next;
    });
  };

  const updateUploadItem = (localId: string, updater: (item: ComposerUploadItem) => ComposerUploadItem) => {
    setUploadItems((prev) => prev.map((item) => (item.localId === localId ? updater(item) : item)));
  };

  const uploadFiles = (files: File[]) => {
    files.forEach((file) => {
      const validationError = validateUploadFile(file);
      if (validationError) {
        toast({ title: "Invalid file", description: validationError, variant: "destructive" });
        return;
      }

      const localId = buildLocalId();
      const localPreviewUrl = createLocalPreviewUrl(file);
      if (localPreviewUrl) objectUrlsRef.current[localId] = localPreviewUrl;

      setUploadItems((prev) => [
        {
          localId,
          fileName: file.name,
          contentType: file.type || "application/octet-stream",
          size: file.size,
          progress: 0,
          status: "queued",
          previewUrl: localPreviewUrl,
        },
        ...prev,
      ]);

      updateUploadItem(localId, (item) => ({ ...item, status: "uploading" }));

      uploadFileToMedia(file, {
        onPrepared: (prepared) => {
          const nextPreviewUrl = createLocalPreviewUrl(prepared.file);
          const previousPreviewUrl = objectUrlsRef.current[localId];
          if (previousPreviewUrl && previousPreviewUrl !== nextPreviewUrl) {
            URL.revokeObjectURL(previousPreviewUrl);
          }
          if (nextPreviewUrl) {
            objectUrlsRef.current[localId] = nextPreviewUrl;
          } else {
            delete objectUrlsRef.current[localId];
          }

          updateUploadItem(localId, (item) => ({
            ...item,
            fileName: prepared.file.name,
            contentType: prepared.file.type || item.contentType,
            size: prepared.finalSize,
            previewUrl: nextPreviewUrl ?? item.previewUrl,
            didCompress: prepared.didCompress,
            originalSize: prepared.originalSize,
            finalSize: prepared.finalSize,
            status: "uploading",
          }));
        },
        onProgress: (progress) => {
          updateUploadItem(localId, (item) => ({ ...item, progress, status: "uploading" }));
        },
      })
        .then((result: UploadMediaResult) => {
          const media = result.media;
          if (isMediaReady(media.status)) {
            const objectUrl = objectUrlsRef.current[localId];
            if (objectUrl) {
              URL.revokeObjectURL(objectUrl);
              delete objectUrlsRef.current[localId];
            }

            const nextAttachment: ChatPendingAttachment = {
              mediaId: media.id,
              fileName: resolveMediaDisplayName(media),
              contentType: media.content_type,
              size: media.size,
              previewUrl: media.media_url,
            };

            addAttachments([nextAttachment]);

            updateUploadItem(localId, (item) => ({
              ...item,
              progress: 100,
              status: "uploaded",
              mediaId: media.id,
              previewUrl: media.media_url ?? undefined,
              fileName: resolveMediaDisplayName(media),
              contentType: media.content_type || item.contentType,
              size: media.size ?? result.finalSize,
              didCompress: result.didCompress,
              originalSize: result.originalSize,
              finalSize: result.finalSize,
              error: undefined,
            }));
            return;
          }

          updateUploadItem(localId, (item) => ({
            ...item,
            progress: 100,
            status: "processing",
            mediaId: media.id,
            fileName: resolveMediaDisplayName(media),
            contentType: media.content_type || item.contentType,
            size: media.size ?? result.finalSize,
            didCompress: result.didCompress,
            originalSize: result.originalSize,
            finalSize: result.finalSize,
            error: undefined,
          }));

          toast({
            title: "Upload complete",
            description: `${file.name} uploaded successfully. Waiting for server verification before it can be attached.`,
          });

          void waitForMediaReady(media.id)
            .then((readyMedia) => {
              const objectUrl = objectUrlsRef.current[localId];
              if (objectUrl) {
                URL.revokeObjectURL(objectUrl);
                delete objectUrlsRef.current[localId];
              }

              addAttachments([
                {
                  mediaId: readyMedia.id,
                  fileName: resolveMediaDisplayName(readyMedia),
                  contentType: readyMedia.content_type,
                  size: readyMedia.size,
                  previewUrl: readyMedia.media_url,
                },
              ]);

              updateUploadItem(localId, (item) => ({
                ...item,
                progress: 100,
                status: "uploaded",
                mediaId: readyMedia.id,
                previewUrl: readyMedia.media_url ?? undefined,
                fileName: resolveMediaDisplayName(readyMedia),
                contentType: readyMedia.content_type || item.contentType,
                size: readyMedia.size ?? item.size,
                error: undefined,
              }));
            })
            .catch((error: unknown) => {
              updateUploadItem(localId, (item) => ({
                ...item,
                status: "failed",
                error: getFriendlyUploadError(error),
              }));

              toast({
                title: "Verification failed",
                description: getFriendlyUploadError(error),
                variant: "destructive",
              });
            });
        })
        .catch((error: unknown) => {
          updateUploadItem(localId, (item) => ({
            ...item,
            status: "failed",
            error: getFriendlyUploadError(error),
          }));

          toast({
            title: "Upload failed",
            description: getFriendlyUploadError(error),
            variant: "destructive",
          });
        });
    });
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (disabled) return;

    setIsDragOver(false);
    const files = Array.from(event.dataTransfer.files ?? []);
    if (files.length === 0) return;
    uploadFiles(files);
  };

  const removeAttachment = (mediaId: string) => {
    setAttachments((prev) => prev.filter((item) => item.mediaId !== mediaId));
  };

  const clearAllUploads = () => {
    setUploadItems((prev) => {
      prev.forEach((item) => {
        if (item.previewUrl?.startsWith("blob:")) {
          URL.revokeObjectURL(item.previewUrl);
        }
      });
      return [];
    });

    Object.values(objectUrlsRef.current).forEach((url) => URL.revokeObjectURL(url));
    objectUrlsRef.current = {};
  };

  const clearUploads = () => {
    setUploadItems((prev) => {
      prev.forEach((item) => {
        if (!item.previewUrl?.startsWith("blob:")) return;
        URL.revokeObjectURL(item.previewUrl);
        delete objectUrlsRef.current[item.localId];
      });
      return prev.filter(
        (item) =>
          item.status === "uploading" ||
          item.status === "queued" ||
          item.status === "processing",
      );
    });
  };

  const handleSend = async () => {
    const trimmed = content.trim();
    if (!trimmed && attachments.length === 0) return;
    if (isUploading) return;

    const specialMentionError = (() => {
      const policy = mentionPolicy;
      if (!policy) return null;
      const checks: Array<{ token: "@everyone" | "@channel" | "@here"; rule: "ANY_MEMBER" | "ADMINS_ONLY" | "DISABLED" }> = [
        { token: "@everyone", rule: policy.everyone },
        { token: "@channel", rule: policy.channel },
        { token: "@here", rule: policy.here },
      ];
      for (const check of checks) {
        const pattern = new RegExp(`(^|\\s)${check.token}(\\s|$)`, "i");
        if (!pattern.test(trimmed)) continue;
        if (check.rule === "ANY_MEMBER") continue;
        if (check.rule === "ADMINS_ONLY" && isAdminMentionAllowed) continue;
        return `${check.token} mention is not allowed in this conversation.`;
      }
      return null;
    })();

    if (specialMentionError) {
      toast({
        title: "Mention blocked",
        description: specialMentionError,
        variant: "destructive",
      });
      return;
    }

    try {
      await onSend({
        text: trimmed,
        replyTo,
        attachmentMediaIds: attachments.map((item) => item.mediaId),
      });

      setContent("");
      setAttachments([]);
      clearAllUploads();
      closeMention();
      onTyping?.(false);
    } catch {
      // Parent handles toast/error; keep draft intact for retry.
    }
  };

  return (
    <div
      onDragOver={(event) => {
        event.preventDefault();
        if (!disabled) setIsDragOver(true);
      }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={handleDrop}
      className={`space-y-3 rounded-md border p-3 transition-colors ${
        isDragOver ? "border-primary bg-primary/5" : "border-border"
      }`}
    >
      {attachments.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-semibold uppercase text-muted-foreground">Pending Attachments</h4>
            <Badge variant="secondary">{attachments.length}</Badge>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {attachments.map((attachment) => {
              const resolvedMedia = unresolvedAttachmentById[attachment.mediaId];
              return (
                <div key={attachment.mediaId} className="rounded-md border p-2 flex items-center gap-2">
                  <MediaPreview
                    media={resolvedMedia}
                    url={attachment.previewUrl ?? resolvedMedia?.media_url ?? undefined}
                    type={attachment.contentType ?? resolvedMedia?.content_type}
                    alt={attachment.fileName || resolvedMedia?.filename}
                    className="h-12 w-12"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium truncate">
                      {attachment.fileName || resolvedMedia?.filename}
                    </p>
                    <p className="text-[11px] text-muted-foreground truncate">{attachment.mediaId}</p>
                  </div>
                  <Button variant="ghost" size="icon" onClick={() => removeAttachment(attachment.mediaId)}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {uploadItems.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-semibold uppercase text-muted-foreground">Uploads</h4>
            <Button variant="ghost" size="sm" onClick={clearUploads}>
              <Trash2 className="h-3.5 w-3.5 mr-1" />
              Clear finished
            </Button>
          </div>
          <div className="space-y-2 max-h-36 overflow-auto pr-1">
            {uploadItems.map((item) => (
              <div key={item.localId} className="rounded-md border p-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-medium truncate">{item.fileName}</p>
                  <Badge variant={item.status === "failed" ? "destructive" : "secondary"}>{item.status}</Badge>
                </div>
                <Progress value={item.progress} className="h-1.5 mt-2" />
                {item.didCompress && typeof item.originalSize === "number" && typeof item.finalSize === "number" && (
                  <p className="mt-1 text-[11px] text-emerald-700">
                    Compressed: {formatUploadMb(item.originalSize)} {"->"} {formatUploadMb(item.finalSize)}
                  </p>
                )}
                {item.error && <p className="text-[11px] text-destructive mt-1">{item.error}</p>}
              </div>
            ))}
          </div>
        </div>
      )}

      {isDragOver && (
        <div className="rounded-md border border-dashed border-primary/60 bg-primary/5 p-3 text-center text-xs text-muted-foreground">
          <UploadCloud className="h-4 w-4 inline mr-1" />
          Drop files to upload and attach
        </div>
      )}

      {disabled && disabledReason && (
        <div className="rounded-md border border-dashed border-amber-500/50 bg-amber-500/10 px-3 py-2 text-xs text-amber-700">
          {disabledReason}
        </div>
      )}

      <Textarea
        ref={textareaRef}
        placeholder="Type your message..."
        value={content}
        onChange={(event) => {
          const nextValue = event.target.value;
          const cursorPos = event.target.selectionStart ?? nextValue.length;
          setContent(nextValue);
          onTyping?.(nextValue.length > 0);
          updateMentionState(nextValue, cursorPos);
        }}
        onKeyDown={(event) => {
          if (mentionOpen && mentionUsers.length > 0) {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setMentionIndex((prev) => (prev + 1) % mentionUsers.length);
              return;
            }
            if (event.key === "ArrowUp") {
              event.preventDefault();
              setMentionIndex((prev) => (prev - 1 + mentionUsers.length) % mentionUsers.length);
              return;
            }
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              selectMentionUser(mentionUsers[mentionIndex].id);
              return;
            }
            if (event.key === "Escape") {
              event.preventDefault();
              closeMention();
              return;
            }
          }

          if (event.key === "Enter" && !event.shiftKey && onSubmitKeySend) {
            event.preventDefault();
            void handleSend();
          }
        }}
        onBlur={() => {
          onTyping?.(false);
          window.setTimeout(closeMention, 120);
        }}
        disabled={disabled || isSending}
        aria-label="Message composer"
      />

      {mentionOpen && mentionUsers.length > 0 && (
        <div className="rounded-md border bg-popover p-1 shadow-sm" role="listbox" aria-label="Mention suggestions">
          {mentionUsers.map((user, index) => (
            <button
              key={user.id}
              type="button"
              role="option"
              aria-selected={mentionIndex === index}
              className={`flex w-full items-center justify-between rounded px-2 py-1 text-left text-sm ${
                mentionIndex === index ? "bg-accent text-accent-foreground" : "hover:bg-muted"
              }`}
              onMouseDown={(event) => {
                event.preventDefault();
                selectMentionUser(user.id);
              }}
            >
              <span className="truncate">{labelForUser(user)}</span>
              <span className="ml-2 truncate text-xs text-muted-foreground">@{user.id}</span>
            </button>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setOpenPicker(true)}
          disabled={disabled || isSending}
          aria-label="Attach files"
        >
          <Paperclip className="h-4 w-4 mr-2" />
          Attach
        </Button>

        <Button
          type="button"
          onClick={() => void handleSend()}
          disabled={disabled || isSending || isUploading || (!content.trim() && attachments.length === 0)}
          aria-label="Send message"
        >
          <Send className="h-4 w-4 mr-2" />
          {isSending ? "Sending..." : isUploading ? "Uploading..." : "Send"}
        </Button>
      </div>

      <AttachmentPicker
        open={openPicker}
        onOpenChange={setOpenPicker}
        onAddAttachments={addAttachments}
      />
    </div>
  );
}
