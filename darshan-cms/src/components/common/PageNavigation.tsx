import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
} from "@/components/ui/pagination";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ChevronLeft, ChevronRight } from "lucide-react";

type PageNavigationProps = {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  className?: string;
  showPageNumbers?: boolean;
};

const buildPageItems = (currentPage: number, totalPages: number): Array<number | "ellipsis"> => {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }

  if (currentPage <= 4) {
    return [1, 2, 3, 4, 5, "ellipsis", totalPages];
  }

  if (currentPage >= totalPages - 3) {
    return [1, "ellipsis", totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages];
  }

  return [1, "ellipsis", currentPage - 1, currentPage, currentPage + 1, "ellipsis", totalPages];
};

export function PageNavigation({
  currentPage,
  totalPages,
  onPageChange,
  className,
  showPageNumbers = false,
}: PageNavigationProps) {
  const canGoPrevious = currentPage > 1;
  const canGoNext = currentPage < totalPages;
  const pageItems = showPageNumbers ? buildPageItems(currentPage, totalPages) : [];

  return (
    <div className={className}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">
          Page {currentPage} of {totalPages}
        </p>
        <Pagination className="w-full sm:w-auto">
          <PaginationContent className="flex flex-wrap justify-start gap-2 sm:justify-end">
            <PaginationItem>
              <button
                type="button"
                aria-label="Go to previous page"
                disabled={!canGoPrevious}
                className={cn(
                  buttonVariants({ variant: "ghost", size: "default" }),
                  "gap-1 pl-2.5",
                  !canGoPrevious && "pointer-events-none opacity-50",
                )}
                onClick={() => {
                  if (!canGoPrevious) return;
                  onPageChange(currentPage - 1);
                }}
              >
                <ChevronLeft className="h-4 w-4" />
                <span>Previous</span>
              </button>
            </PaginationItem>
            {pageItems.map((item, index) => (
              <PaginationItem key={item === "ellipsis" ? `ellipsis-${index}` : item}>
                {item === "ellipsis" ? (
                  <PaginationEllipsis />
                ) : (
                  <button
                    type="button"
                    aria-current={item === currentPage ? "page" : undefined}
                    className={buttonVariants({
                      variant: item === currentPage ? "outline" : "ghost",
                      size: "icon",
                    })}
                    onClick={() => {
                      if (item === currentPage) return;
                      onPageChange(item);
                    }}
                  >
                    {item}
                  </button>
                )}
              </PaginationItem>
            ))}
            <PaginationItem>
              <button
                type="button"
                aria-label="Go to next page"
                disabled={!canGoNext}
                className={cn(
                  buttonVariants({ variant: "ghost", size: "default" }),
                  "gap-1 pr-2.5",
                  !canGoNext && "pointer-events-none opacity-50",
                )}
                onClick={() => {
                  if (!canGoNext) return;
                  onPageChange(currentPage + 1);
                }}
              >
                <span>Next</span>
                <ChevronRight className="h-4 w-4" />
              </button>
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      </div>
    </div>
  );
}
