import { AlertTriangle, Ban, Lock } from "lucide-react";
import { formatChatTime } from "@/lib/chatTime";

interface ChatStatusBannerProps {
  mode: "READ_ONLY" | "MUTED" | "BANNED";
  message?: string;
  until?: string | null;
  className?: string;
}

const modeMeta: Record<
  ChatStatusBannerProps["mode"],
  { icon: typeof Lock; title: string; tone: string }
> = {
  READ_ONLY: {
    icon: Lock,
    title: "Conversation is archived (read-only).",
    tone: "border-amber-500/50 bg-amber-500/10 text-amber-700",
  },
  MUTED: {
    icon: AlertTriangle,
    title: "You are muted in this conversation.",
    tone: "border-amber-500/50 bg-amber-500/10 text-amber-700",
  },
  BANNED: {
    icon: Ban,
    title: "You no longer have access to this conversation.",
    tone: "border-destructive/50 bg-destructive/10 text-destructive",
  },
};

export function ChatStatusBanner({
  mode,
  message,
  until,
  className,
}: ChatStatusBannerProps) {
  const meta = modeMeta[mode];
  const Icon = meta.icon;
  const untilText = until ? formatChatTime(until) : null;

  return (
    <div
      className={`sticky top-0 z-10 mx-4 mt-3 rounded-md border px-3 py-2 text-sm ${meta.tone} ${className ?? ""}`}
      aria-label="Chat status banner"
    >
      <p className="flex items-center gap-2 font-medium">
        <Icon className="h-4 w-4" />
        {message || meta.title}
      </p>
      {untilText && (
        <p className="mt-1 text-xs opacity-90">
          Until: {untilText}
        </p>
      )}
    </div>
  );
}
