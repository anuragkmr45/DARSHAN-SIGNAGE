import { Button } from "@/components/ui/button";

interface EmptyStateProps {
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function EmptyState({ title, description, actionLabel, onAction }: EmptyStateProps) {
  return (
    <div className="rounded-lg border-2 border-dashed px-4 py-10 text-center sm:px-6 sm:py-12">
      <p className="text-lg font-semibold text-foreground">{title}</p>
      {description && <p className="mt-2 text-sm text-muted-foreground sm:text-base">{description}</p>}
      {actionLabel && onAction && (
        <Button className="mt-4 w-full sm:w-auto" onClick={onAction}>
          {actionLabel}
        </Button>
      )}
    </div>
  );
}
