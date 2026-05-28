interface TypingIndicatorProps {
  userIds?: string[];
  userDisplayById?: Record<string, string>;
}

export function TypingIndicator({ userIds = [], userDisplayById = {} }: TypingIndicatorProps) {
  if (userIds.length === 0) return null;
  const labels = userIds.map((id) => userDisplayById[id] || id);

  return (
    <div className="px-4 py-1 text-xs text-muted-foreground">
      {labels.length === 1
        ? `${labels[0]} is typing...`
        : `${labels.slice(0, 2).join(", ")} ${labels.length > 2 ? `+${labels.length - 2} others ` : ""}are typing...`}
    </div>
  );
}
