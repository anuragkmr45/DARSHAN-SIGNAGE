import { useIsFetching, useIsMutating } from "@tanstack/react-query";
import { cn } from "@/lib/utils";

export function GlobalLoader() {
  const isFetching = useIsFetching();
  const isMutating = useIsMutating();
  const isBusy = isFetching + isMutating > 0;

  if (!isBusy) return null;

  return (
    <div className="fixed inset-x-0 top-0 z-50 h-1">
      <div
        className={cn(
          "h-full w-full animate-pulse bg-gradient-to-r from-primary/40 via-primary to-primary/40",
        )}
      />
    </div>
  );
}
