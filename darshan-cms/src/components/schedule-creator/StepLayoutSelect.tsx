import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, LayoutGrid, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { SearchBar } from "@/components/common/SearchBar";
import { LoadingIndicator } from "@/components/common/LoadingIndicator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useQuery } from "@tanstack/react-query";
import { layoutsApi } from "@/api/domains/layouts";
import { screensApi } from "@/api/domains/screens";
import { queryKeys } from "@/api/queryKeys";
import { useDebounce } from "@/hooks/use-debounce";
import type { ScreenAspectRatio } from "@/api/types";
import type { Layout } from "@/pages/Layouts";

interface StepLayoutSelectProps {
  selectedLayout: Layout | null;
  onSelectLayout: (layout: Layout) => void;
}

const LAYOUTS_PER_PAGE = 100;

const mergeAspectRatioOptions = (response?: { items?: ScreenAspectRatio[]; defaults?: ScreenAspectRatio[] }) => {
  const combined = [...(response?.items ?? []), ...(response?.defaults ?? [])];
  const seen = new Set<string>();

  return combined.filter((option): option is ScreenAspectRatio & { aspect_ratio: string } => {
    if (!option.aspect_ratio) return false;
    if (seen.has(option.aspect_ratio)) return false;
    seen.add(option.aspect_ratio);
    return true;
  });
};

export function StepLayoutSelect({ selectedLayout, onSelectLayout }: StepLayoutSelectProps) {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState("");
  const [aspectFilter, setAspectFilter] = useState("All");
  const [aspectRatioSearch, setAspectRatioSearch] = useState("");

  const trimmedSearchQuery = searchQuery.trim();
  const aspectRatioQuery = aspectFilter === "All" ? undefined : aspectFilter;
  const debouncedAspectRatioSearch = useDebounce(aspectRatioSearch, 350);
  const debouncedSearchTerm = debouncedAspectRatioSearch.trim();
  const isSearchActive = Boolean(debouncedSearchTerm);

  const { data: layoutsResponse, isLoading: isLayoutsLoading, isError: isLayoutsError } = useQuery({
    queryKey: queryKeys.layouts({
      page: 1,
      limit: LAYOUTS_PER_PAGE,
      search: trimmedSearchQuery || undefined,
      aspect_ratio: aspectRatioQuery,
    }),
    queryFn: () =>
      layoutsApi.list({
        page: 1,
        limit: LAYOUTS_PER_PAGE,
        search: trimmedSearchQuery || undefined,
        aspect_ratio: aspectRatioQuery,
      }),
    keepPreviousData: true,
    refetchOnMount: "always",
  });

  const { data: aspectRatioResponse, isFetching: isAspectRatiosLoading } = useQuery({
    queryKey: ["screen-aspect-ratios", debouncedSearchTerm],
    queryFn: () =>
      screensApi.listAspectRatios({
        search: debouncedSearchTerm || undefined,
        configured_only: true,
      }),
    keepPreviousData: true,
  });

  const aspectRatioOptions = useMemo<ScreenAspectRatio[]>(() => {
    const resolved = mergeAspectRatioOptions(aspectRatioResponse);
    if (isSearchActive) {
      return resolved;
    }
    return resolved;
  }, [aspectRatioResponse, isSearchActive]);

  const layouts = layoutsResponse?.items ?? [];

  const handleNewLayout = () => {
    navigate("/layouts/new", { state: { returnTo: "/schedule/new" } });
  };

  const renderLayoutPreview = (layout: Layout) => {
    const aspectRatio = layout.aspect_ratio === "9:16" ? 9 / 16 : 16 / 9;
    const previewWidth = 120;
    const previewHeight = previewWidth / aspectRatio;

    return (
      <div
        className="relative border rounded bg-muted/30"
        style={{ width: previewWidth, height: previewHeight }}
      >
        {layout.spec.slots.map((slot) => (
          <div
            key={slot.id}
            className="absolute border border-primary/50 bg-primary/10 flex items-center justify-center text-[8px] text-muted-foreground overflow-hidden"
            style={{
              left: `${slot.x * 100}%`,
              top: `${slot.y * 100}%`,
              width: `${slot.w * 100}%`,
              height: `${slot.h * 100}%`,
            }}
          >
            {slot.id}
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">Choose a Layout</h2>
          <p className="text-sm text-muted-foreground">
            Select an existing layout or create a new one
          </p>
        </div>
        <Button onClick={handleNewLayout}>
          <Plus className="h-4 w-4 mr-2" />
          New Layout
        </Button>
      </div>

      {/* Filters */}
      <div className="flex gap-4 flex-wrap">
        <div className="flex-1 min-w-[200px]">
          <SearchBar placeholder="Search layouts..." onSearch={setSearchQuery} />
        </div>
        <Select
          value={aspectFilter}
          onValueChange={(value) => {
            setAspectFilter(value);
            setAspectRatioSearch("");
          }}
          onOpenChange={(open) => {
            if (!open) {
              setAspectRatioSearch("");
            }
          }}
        >
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="Aspect Ratio" />
          </SelectTrigger>
          <SelectContent>
            <div className="px-3 pt-3 pb-2">
              <Input
                value={aspectRatioSearch}
                onChange={(event) => setAspectRatioSearch(event.target.value)}
                placeholder="Search aspect ratios..."
                className="h-9"
                onPointerDown={(event) => event.stopPropagation()}
                onMouseDown={(event) => event.stopPropagation()}
              />
            </div>
            <SelectItem value="All">All aspect ratios</SelectItem>
            {isAspectRatiosLoading && (
              <div className="px-3 py-2 text-sm text-muted-foreground">Searching...</div>
            )}
            {aspectRatioOptions.length === 0 && !isAspectRatiosLoading && (
              <div className="px-3 py-2 text-sm text-muted-foreground">
                No aspect ratios found.
              </div>
            )}
            {aspectRatioOptions.map((option) => (
              <SelectItem
                key={`${option.id ?? option.aspect_ratio}-${option.aspect_ratio}`}
                value={option.aspect_ratio}
              >
                <div className="flex flex-col gap-0.5">
                  <span className="font-medium">{option.aspect_ratio}</span>
                  {(option.aspect_ratio_name || option.name) &&
                    (option.aspect_ratio_name || option.name) !== option.aspect_ratio && (
                    <span className="text-xs text-muted-foreground">
                      {option.aspect_ratio_name || option.name}
                    </span>
                  )}
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Layout grid */}
      {isLayoutsLoading ? (
        <div className="flex justify-center py-12">
          <LoadingIndicator label="Loading layouts..." />
        </div>
      ) : isLayoutsError ? (
        <div className="text-center py-12">
          <LayoutGrid className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
          <p className="text-sm text-destructive">Unable to load layouts right now.</p>
          <Button variant="link" onClick={handleNewLayout}>
            Create a new layout
          </Button>
        </div>
      ) : layouts.length === 0 ? (
        <div className="text-center py-12">
          <LayoutGrid className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
          <p className="text-muted-foreground">No layouts found</p>
          <Button variant="link" onClick={handleNewLayout}>
            Create your first layout
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {layouts.map((layout) => {
            const isSelected = selectedLayout?.id === layout.id;
            return (
              <Card
                key={layout.id}
                onClick={() => onSelectLayout(layout)}
                className={`p-4 cursor-pointer transition-all hover:shadow-md ${
                  isSelected ? "ring-2 ring-primary border-primary" : "hover:border-primary/50"
                }`}
              >
                <div className="flex items-start gap-4">
                  {renderLayoutPreview(layout)}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold truncate">{layout.name}</h3>
                      {isSelected && <Check className="h-4 w-4 text-primary flex-shrink-0" />}
                    </div>
                    <p className="text-sm text-muted-foreground line-clamp-2 mt-1">
                      {layout.description || "No description"}
                    </p>
                    <div className="flex gap-2 mt-2">
                      <Badge variant="outline">{layout.aspect_ratio}</Badge>
                      <Badge variant="secondary">{layout.spec.slots.length} slots</Badge>
                    </div>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
