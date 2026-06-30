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
    <div className="flex flex-col gap-4 rounded-xl border border-border bg-card/80 p-4 shadow-sm sm:flex-row sm:items-start sm:justify-between sm:p-5">
      <div className="min-w-0">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Workspace</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">{title}</h1>
        {description && <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">{description}</p>}
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
