import { Button } from "@/components/ui/button";

interface EmptyStateProps {
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function EmptyState({ title, description, actionLabel, onAction }: EmptyStateProps) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-card/70 px-4 py-10 text-center shadow-sm sm:px-6 sm:py-12">
      <div className="mx-auto mb-4 h-1 w-12 rounded-full bg-accent" />
      <p className="text-lg font-semibold text-foreground">{title}</p>
      {description && <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-muted-foreground">{description}</p>}
      {actionLabel && onAction && (
        <Button className="mt-4 w-full sm:w-auto" onClick={onAction}>
          {actionLabel}
        </Button>
      )}
    </div>
  );
}
