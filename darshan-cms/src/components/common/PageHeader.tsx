import { Button } from "@/components/ui/button";

interface PageHeaderProps {
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
  actionDisabled?: boolean;
  actionIcon?: React.ReactNode;
  trailingContent?: React.ReactNode;
}

export function PageHeader({
  title,
  description,
  actionLabel,
  onAction,
  actionDisabled,
  actionIcon,
  trailingContent,
}: PageHeaderProps) {
  return (
    <div className="flex flex-col gap-3 border-b border-border pb-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">{title}</h1>
        {description && <p className="mt-1 max-w-3xl text-sm leading-5 text-muted-foreground">{description}</p>}
      </div>
      <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
        {trailingContent}
        {actionLabel && onAction && (
          <Button onClick={onAction} disabled={actionDisabled} className="w-full gap-2 sm:w-auto">
            {actionIcon}
            {actionLabel}
          </Button>
        )}
      </div>
    </div>
  );
}
