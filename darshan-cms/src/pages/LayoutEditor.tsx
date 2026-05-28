import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import { ArrowLeft, Copy, Grid3X3, Move, Plus, Save, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { useToast } from "@/hooks/use-toast";
import { useQuery } from "@tanstack/react-query";
import { useDebounce } from "@/hooks/use-debounce";
import { useSafeMutation } from "@/hooks/useSafeMutation";
import { screensApi } from "@/api/domains/screens";
import { layoutsApi } from "@/api/domains/layouts";
import type { LayoutCreatePayload, LayoutItem, LayoutSlot, ScreenAspectRatio } from "@/api/types";

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

type LayoutEditorLocationState = {
  returnTo?: string;
};

function getAspectRatioDimensions(ratio: string, maxWidth: number): { width: number; height: number } {
  const [w, h] = ratio.split(":").map(Number);
  const aspectRatio = w / h;
  const width = maxWidth;
  const height = maxWidth / aspectRatio;
  return { width, height };
}

function checkOverlap(slot1: LayoutSlot, slot2: LayoutSlot): boolean {
  const x1End = slot1.x + slot1.w;
  const y1End = slot1.y + slot1.h;
  const x2End = slot2.x + slot2.w;
  const y2End = slot2.y + slot2.h;

  return !(slot1.x >= x2End || x1End <= slot2.x || slot1.y >= y2End || y1End <= slot2.y);
}

const GRID_OPTIONS = [
  { label: "5%", value: 0.05 },
  { label: "10%", value: 0.1 },
  { label: "20%", value: 0.2 },
] as const;

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

const snapToStep = (value: number, step: number) => {
  if (!step || step <= 0) return Number(clamp01(value).toFixed(3));
  return Number(clamp01(Math.round(value / step) * step).toFixed(3));
};

const getInputStep = (gridStep: number, snapToGrid: boolean) => (snapToGrid ? gridStep : 0.01);

const LayoutEditor = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();
  const canvasRef = useRef<HTMLDivElement>(null);

  const isEditMode = !!id && id !== "new";
  const locationState = location.state as LayoutEditorLocationState | null;
  const returnTo = locationState?.returnTo;
  const defaultReturnPath = returnTo ?? "/layouts";

  // Form state
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [aspectRatio, setAspectRatio] = useState("16:9");
  const [aspectRatioSearch, setAspectRatioSearch] = useState("");
  const debouncedAspectRatioSearch = useDebounce(aspectRatioSearch, 350);
  const [slots, setSlots] = useState<LayoutSlot[]>([]);
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [showUnsavedDialog, setShowUnsavedDialog] = useState(false);
  const [pendingNavigation, setPendingNavigation] = useState<string | null>(null);
  const [showGrid, setShowGrid] = useState(true);
  const [snapToGrid, setSnapToGrid] = useState(true);
  const [gridStep, setGridStep] = useState<number>(0.1);
  const [isJsonOpen, setIsJsonOpen] = useState(true);

  const layoutQuery = useQuery({
    enabled: isEditMode && !!id,
    queryKey: ["layout", id],
    queryFn: () => layoutsApi.getById(id!),
    retry: false,
  });

  useEffect(() => {
    if (!layoutQuery.data) return;
    setName(layoutQuery.data.name);
    setDescription(layoutQuery.data.description ?? "");
    setAspectRatio(layoutQuery.data.aspect_ratio);
    setSlots(layoutQuery.data.spec.slots);
    setIsDirty(false);
  }, [layoutQuery.data]);

  useEffect(() => {
    if (!layoutQuery.isError) return;
    const message =
      layoutQuery.error instanceof Error ? layoutQuery.error.message : "Unable to load layout.";
    toast({
      title: "Unable to load layout",
      description: message,
      variant: "destructive",
    });
  }, [layoutQuery.isError, layoutQuery.error, toast]);

  // Drawing state
  const [isDrawing, setIsDrawing] = useState(false);
  const [drawStart, setDrawStart] = useState<{ x: number; y: number } | null>(null);
  const [drawCurrent, setDrawCurrent] = useState<{ x: number; y: number } | null>(null);

  // Dragging/resizing state
  const [dragState, setDragState] = useState<{
    type: "move" | "resize";
    slotId: string;
    startX: number;
    startY: number;
    originalSlot: LayoutSlot;
    handle?: string;
  } | null>(null);

  const selectedSlot = slots.find((s) => s.id === selectedSlotId);

  // Check for overlapping slots
  const hasOverlaps = slots.some((slot, i) =>
    slots.some((other, j) => i !== j && checkOverlap(slot, other))
  );
  const [hasShownOverlapToast, setHasShownOverlapToast] = useState(false);

  useEffect(() => {
    if (hasOverlaps && !hasShownOverlapToast) {
      toast({
        title: "Slot overlap detected",
        description: "Some slots overlap. Adjust their positions or sizes before saving.",
        variant: "destructive",
      });
      setHasShownOverlapToast(true);
    }
    if (!hasOverlaps && hasShownOverlapToast) {
      setHasShownOverlapToast(false);
    }
  }, [hasOverlaps, hasShownOverlapToast, toast]);

  // Validation
  const nameError = !name.trim();
  const aspectRatioError = !aspectRatio.trim();
  const slotsError = slots.length === 0;
  const duplicateIds = slots.filter(
    (s, i) => slots.findIndex((o) => o.id === s.id) !== i
  );
  const hasDuplicateIds = duplicateIds.length > 0;

  const canvasWidth = 500;
  const canvasDimensions = getAspectRatioDimensions(aspectRatio, canvasWidth);
  const inputStep = useMemo(() => getInputStep(gridStep, snapToGrid), [gridStep, snapToGrid]);
  const gridMarkers = useMemo(
    () =>
      Array.from({ length: Math.floor(1 / gridStep) + 1 }, (_, index) => {
        const position = Math.min(index * gridStep * 100, 100);
        return {
          key: `${gridStep}-${position}`,
          position,
          label: `${Math.round(position)}%`,
        };
      }),
    [gridStep],
  );

  const saveLayoutMutation = useSafeMutation<
    LayoutItem,
    { id?: string; payload: LayoutCreatePayload }
  >(
    {
      mutationFn: ({ id: layoutId, payload }) =>
        layoutId ? layoutsApi.update(layoutId, payload) : layoutsApi.create(payload),
    },
    "Unable to save layout.",
  );

  const isLayoutLoading = isEditMode && layoutQuery.isLoading;

  const handleSave = async () => {
    if (nameError) {
      toast({
        title: "Validation error",
        description: "Please provide a layout name.",
        variant: "destructive",
      });
      return;
    }

    if (aspectRatioError) {
      toast({
        title: "Validation error",
        description: "Please select an aspect ratio.",
        variant: "destructive",
      });
      return;
    }

    if (slotsError) {
      toast({
        title: "Validation error",
        description: "Add at least one slot before saving this layout.",
        variant: "destructive",
      });
      return;
    }

    if (hasDuplicateIds) {
      toast({
        title: "Validation error",
        description: "Slot IDs must be unique.",
        variant: "destructive",
      });
      return;
    }

    if (hasOverlaps) {
      return;
    }

    const payload: LayoutCreatePayload = {
      name: name.trim(),
      description: description.trim() || undefined,
      aspect_ratio: aspectRatio,
      spec: { slots },
    };

    try {
      await saveLayoutMutation.mutateAsync({
        id: isEditMode ? id : undefined,
        payload,
      });
      toast({
        title: isEditMode ? "Layout updated" : "Layout created",
        description: `"${name}" has been saved successfully.`,
      });
      setIsDirty(false);
      if (returnTo && !isEditMode) {
        navigate(returnTo);
      } else {
        navigate("/layouts");
      }
    } catch {
      // errors handled by useSafeMutation toast
    }
  };

  const handleCancel = () => {
    if (isDirty) {
      setPendingNavigation(defaultReturnPath);
      setShowUnsavedDialog(true);
    } else {
      navigate(defaultReturnPath);
    }
  };

  const confirmNavigation = () => {
    setShowUnsavedDialog(false);
    if (pendingNavigation) {
      navigate(pendingNavigation);
    }
  };

  const handleAddSlot = () => {
    setIsDrawing(true);
    toast({
      title: "Draw mode active",
      description: "Click and drag on the canvas to create a new slot.",
    });
  };

  const getCanvasCoordinates = useCallback(
    (clientX: number, clientY: number, shouldSnap = false) => {
      if (!canvasRef.current) return { x: 0, y: 0 };
      const rect = canvasRef.current.getBoundingClientRect();
      const rawX = clamp01((clientX - rect.left) / rect.width);
      const rawY = clamp01((clientY - rect.top) / rect.height);
      const x = shouldSnap ? snapToStep(rawX, gridStep) : Number(rawX.toFixed(3));
      const y = shouldSnap ? snapToStep(rawY, gridStep) : Number(rawY.toFixed(3));
      return { x, y };
    },
    [gridStep]
  );

  const handleCanvasMouseDown = (e: React.MouseEvent) => {
    if (isDrawing) {
      const coords = getCanvasCoordinates(e.clientX, e.clientY, snapToGrid);
      setDrawStart(coords);
      setDrawCurrent(coords);
    }
  };

  const handleCanvasMouseMove = (e: React.MouseEvent) => {
    if (isDrawing && drawStart) {
      const coords = getCanvasCoordinates(e.clientX, e.clientY, snapToGrid);
      setDrawCurrent(coords);
    } else if (dragState) {
      const coords = getCanvasCoordinates(e.clientX, e.clientY, snapToGrid);
      const deltaX = coords.x - dragState.startX;
      const deltaY = coords.y - dragState.startY;

      setSlots((prev) =>
        prev.map((slot) => {
          if (slot.id !== dragState.slotId) return slot;

          if (dragState.type === "move") {
            const unclampedX = Math.max(0, Math.min(1 - dragState.originalSlot.w, dragState.originalSlot.x + deltaX));
            const unclampedY = Math.max(0, Math.min(1 - dragState.originalSlot.h, dragState.originalSlot.y + deltaY));
            const newX = snapToGrid ? snapToStep(unclampedX, gridStep) : Number(unclampedX.toFixed(3));
            const newY = snapToGrid ? snapToStep(unclampedY, gridStep) : Number(unclampedY.toFixed(3));
            return { ...slot, x: newX, y: newY };
          } else if (dragState.type === "resize" && dragState.handle === "se") {
            const minSize = Math.max(snapToGrid ? gridStep : 0.01, 0.05);
            const unclampedW = Math.max(minSize, Math.min(1 - dragState.originalSlot.x, dragState.originalSlot.w + deltaX));
            const unclampedH = Math.max(minSize, Math.min(1 - dragState.originalSlot.y, dragState.originalSlot.h + deltaY));
            const newW = snapToGrid ? snapToStep(unclampedW, gridStep) : Number(unclampedW.toFixed(3));
            const newH = snapToGrid ? snapToStep(unclampedH, gridStep) : Number(unclampedH.toFixed(3));
            return { ...slot, w: newW, h: newH };
          }
          return slot;
        })
      );
      setIsDirty(true);
    }
  };

  const handleCanvasMouseUp = () => {
    if (isDrawing && drawStart && drawCurrent) {
      const x = Math.min(drawStart.x, drawCurrent.x);
      const y = Math.min(drawStart.y, drawCurrent.y);
      const w = Math.abs(drawCurrent.x - drawStart.x);
      const h = Math.abs(drawCurrent.y - drawStart.y);
      const minDrawSize = Math.max(snapToGrid ? gridStep : 0.02, 0.02);

      if (w >= minDrawSize && h >= minDrawSize) {
        const newSlotId = `slot-${slots.length + 1}`;
        const newSlot: LayoutSlot = {
          id: newSlotId,
          x: Number(x.toFixed(3)),
          y: Number(y.toFixed(3)),
          w: Number(w.toFixed(3)),
          h: Number(h.toFixed(3)),
        };
        setSlots((prev) => [...prev, newSlot]);
        setSelectedSlotId(newSlotId);
        setIsDirty(true);
      }

      setIsDrawing(false);
      setDrawStart(null);
      setDrawCurrent(null);
    }

    if (dragState) {
      setDragState(null);
    }
  };

  const handleSlotMouseDown = (e: React.MouseEvent, slot: LayoutSlot, type: "move" | "resize", handle?: string) => {
    e.stopPropagation();
    setSelectedSlotId(slot.id);
    const coords = getCanvasCoordinates(e.clientX, e.clientY, snapToGrid);
    setDragState({
      type,
      slotId: slot.id,
      startX: coords.x,
      startY: coords.y,
      originalSlot: { ...slot },
      handle,
    });
  };

  const handleDeleteSlot = (slotId: string) => {
    setSlots((prev) => prev.filter((s) => s.id !== slotId));
    if (selectedSlotId === slotId) {
      setSelectedSlotId(null);
    }
    setIsDirty(true);
  };

  const updateSlotProperty = (slotId: string, property: keyof LayoutSlot, value: string | number) => {
    setSlots((prev) =>
      prev.map((slot) => {
        if (slot.id !== slotId) return slot;
        if (property === "id") {
          return { ...slot, id: String(value) };
        }
        const numValue = typeof value === "string" ? parseFloat(value) : value;
        if (isNaN(numValue)) return slot;
        const normalizedValue = property === "w" || property === "h"
          ? Math.max(snapToGrid ? gridStep : 0.01, numValue)
          : numValue;
        const maxValue =
          property === "w"
            ? 1 - slot.x
            : property === "h"
              ? 1 - slot.y
              : 1;
        const clampedValue = Math.max(0, Math.min(maxValue, normalizedValue));
        const nextValue = snapToGrid ? snapToStep(clampedValue, gridStep) : Number(clampedValue.toFixed(3));
        return { ...slot, [property]: nextValue };
      })
    );
    if (property === "id" && slotId === selectedSlotId) {
      setSelectedSlotId(String(value));
    }
    setIsDirty(true);
  };

  const handleUpdateSlotProperty = (property: keyof LayoutSlot, value: string | number) => {
    if (!selectedSlotId) return;
    updateSlotProperty(selectedSlotId, property, value);
  };

  const handleCopyJson = async () => {
    const json = JSON.stringify({ slots }, null, 2);
    await navigator.clipboard.writeText(json);
    toast({
      title: "Copied",
      description: "JSON specification copied to clipboard.",
    });
  };

  const handleSlotSpecFieldChange = (slotId: string, property: keyof LayoutSlot, value: string) => {
    updateSlotProperty(slotId, property, value);
  };

  const markDirty = () => setIsDirty(true);

  const nudgeSelectedSlot = useCallback((deltaX: number, deltaY: number) => {
    if (!selectedSlotId) return;

    setSlots((prev) =>
      prev.map((slot) => {
        if (slot.id !== selectedSlotId) return slot;
        const nextX = Math.max(0, Math.min(1 - slot.w, slot.x + deltaX));
        const nextY = Math.max(0, Math.min(1 - slot.h, slot.y + deltaY));
        return {
          ...slot,
          x: snapToGrid ? snapToStep(nextX, gridStep) : Number(nextX.toFixed(3)),
          y: snapToGrid ? snapToStep(nextY, gridStep) : Number(nextY.toFixed(3)),
        };
      }),
    );
    setIsDirty(true);
  }, [gridStep, selectedSlotId, snapToGrid]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!selectedSlotId) return;

      const target = event.target as HTMLElement | null;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target?.isContentEditable
      ) {
        return;
      }

      const baseStep = snapToGrid ? gridStep : 0.01;
      const multiplier = event.shiftKey ? 5 : 1;
      const step = baseStep * multiplier;

      switch (event.key) {
        case "ArrowLeft":
          event.preventDefault();
          nudgeSelectedSlot(-step, 0);
          break;
        case "ArrowRight":
          event.preventDefault();
          nudgeSelectedSlot(step, 0);
          break;
        case "ArrowUp":
          event.preventDefault();
          nudgeSelectedSlot(0, -step);
          break;
        case "ArrowDown":
          event.preventDefault();
          nudgeSelectedSlot(0, step);
          break;
        default:
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [gridStep, nudgeSelectedSlot, selectedSlotId, snapToGrid]);

  const debouncedSearchTerm = debouncedAspectRatioSearch.trim();
  const isSearchActive = Boolean(debouncedSearchTerm);

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

  return (
    <div className="space-y-6">
      {/* Top Bar */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-center gap-4">
          <Button variant="ghost" size="icon" onClick={handleCancel}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <span>Settings</span>
              <span>/</span>
              <span>Layouts</span>
              <span>/</span>
              <span className="truncate text-foreground">{isEditMode ? name || "Edit Layout" : "New Layout"}</span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight mt-1">
              {isEditMode ? name || "Edit Layout" : "New Layout"}
            </h1>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={handleCancel}>
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={
              saveLayoutMutation.isPending ||
              isLayoutLoading ||
              hasOverlaps ||
              nameError ||
              aspectRatioError ||
              slotsError
            }
          >
            <Save className="mr-2 h-4 w-4" />
            {saveLayoutMutation.isPending ? "Saving..." : "Save"}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Left Column: Form + Slots List */}
        <div className="min-w-0 space-y-6">
          {/* Form */}
          <Card>
            <CardHeader>
              <CardTitle>Layout Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">Name *</Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    markDirty();
                  }}
                  placeholder="Enter layout name"
                  className={nameError && isDirty ? "border-destructive" : ""}
                />
                {nameError && isDirty && (
                  <p className="text-sm text-destructive">Name is required.</p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="description">Description</Label>
                <Textarea
                  id="description"
                  value={description}
                  onChange={(e) => {
                    setDescription(e.target.value);
                    markDirty();
                  }}
                  placeholder="Optional description"
                  rows={3}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="aspect-ratio">Aspect Ratio *</Label>
                <Select
                  value={aspectRatio}
                  onValueChange={(v) => {
                    setAspectRatio(v);
                    markDirty();
                    setAspectRatioSearch("");
                  }}
                  onOpenChange={(open) => {
                    if (!open) {
                      setAspectRatioSearch("");
                    }
                  }}
                >
                  <SelectTrigger id="aspect-ratio">
                    <SelectValue />
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
                {aspectRatioError && isDirty && (
                  <p className="text-sm text-destructive">Aspect ratio is required.</p>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Slots List */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-base">Slots ({slots.length})</CardTitle>
              <Button size="sm" variant="outline" onClick={handleAddSlot}>
                <Plus className="mr-1 h-3 w-3" />
                Add
              </Button>
            </CardHeader>
            <CardContent>
              {slots.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">
                  No slots yet. Click "Add" to draw one on the canvas.
                </p>
              ) : (
                <div className="space-y-2">
                  {slots.map((slot) => (
                    <div
                      key={slot.id}
                      className={`flex flex-wrap items-center justify-between gap-2 rounded-md border p-2 transition-colors ${
                        selectedSlotId === slot.id
                          ? "border-primary bg-primary/5"
                          : "hover:bg-muted/50"
                      }`}
                      onClick={() => setSelectedSlotId(slot.id)}
                    >
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-sm bg-primary/60" />
                        <span className="text-sm font-medium">{slot.id}</span>
                      </div>
                      <Badge variant="secondary" className="text-xs">
                        {Math.round(slot.w * 100)}% × {Math.round(slot.h * 100)}%
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
              {slotsError && isDirty && (
                <p className="mt-3 text-sm text-destructive text-center">
                  At least one slot is required before saving.
                </p>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Center Column: Canvas */}
        <div className="min-w-0 space-y-4 lg:col-span-2">
          {/* Canvas Controls */}
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-col gap-1">
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant={isDrawing ? "default" : "outline"}
                  onClick={handleAddSlot}
                >
                  <Plus className="mr-1 h-3 w-3" />
                  Add Slot
                </Button>
                <Button
                  size="sm"
                  variant={showGrid ? "secondary" : "outline"}
                  onClick={() => setShowGrid(!showGrid)}
                >
                  <Grid3X3 className="mr-1 h-3 w-3" />
                  Grid
                </Button>
                <Button
                  size="sm"
                  variant={snapToGrid ? "secondary" : "outline"}
                  onClick={() => setSnapToGrid((prev) => !prev)}
                >
                  <Move className="mr-1 h-3 w-3" />
                  Snap
                </Button>
                <Select
                  value={String(gridStep)}
                  onValueChange={(value) => setGridStep(Number(value))}
                >
                  <SelectTrigger className="h-9 w-full sm:w-[110px]" aria-label="Grid density">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {GRID_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={String(option.value)}>
                        {option.label} grid
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <span className="text-xs text-muted-foreground">
                Grid shows reference lines. Snap locks draw, move, and resize actions to the selected grid.
              </span>
            </div>
            <Badge variant="outline">{aspectRatio}</Badge>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Badge variant="outline">Grid {Math.round(gridStep * 100)}%</Badge>
            <Badge variant={snapToGrid ? "secondary" : "outline"}>
              Snap {snapToGrid ? "on" : "off"}
            </Badge>
            {selectedSlot && (
              <Badge variant="outline">
                {selectedSlot.id}: x {Math.round(selectedSlot.x * 100)}% · y {Math.round(selectedSlot.y * 100)}% ·
                w {Math.round(selectedSlot.w * 100)}% · h {Math.round(selectedSlot.h * 100)}%
              </Badge>
            )}
            <span>Arrow keys move the selected slot. Hold Shift for larger nudges.</span>
          </div>

          {/* Canvas */}
          <Card>
            <CardContent className="overflow-x-auto p-4">
              <div className="mx-auto min-w-max w-fit">
                {showGrid && (
                  <div className="mb-2 ml-10 relative" style={{ width: canvasDimensions.width }}>
                    {gridMarkers.map((marker) => (
                      <span
                        key={`top-${marker.key}`}
                        className="absolute -translate-x-1/2 rounded bg-background/95 px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground shadow-sm"
                        style={{ left: `${marker.position}%` }}
                      >
                        {marker.label}
                      </span>
                    ))}
                  </div>
                )}

                <div className="flex items-start gap-2">
                  {showGrid && (
                    <div className="relative shrink-0" style={{ width: 36, height: canvasDimensions.height }}>
                      {gridMarkers.map((marker) => (
                        <span
                          key={`side-${marker.key}`}
                          className="absolute right-0 -translate-y-1/2 rounded bg-background/95 px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground shadow-sm"
                          style={{ top: `${marker.position}%` }}
                        >
                          {marker.label}
                        </span>
                      ))}
                    </div>
                  )}

                  <div
                    ref={canvasRef}
                    className={`relative border-2 border-dashed rounded-lg overflow-hidden ${
                      isDrawing ? "cursor-crosshair" : "cursor-default"
                    }`}
                    style={{
                      width: canvasDimensions.width,
                      height: canvasDimensions.height,
                      backgroundColor: "hsl(var(--muted))",
                    }}
                    onMouseDown={handleCanvasMouseDown}
                    onMouseMove={handleCanvasMouseMove}
                    onMouseUp={handleCanvasMouseUp}
                    onMouseLeave={handleCanvasMouseUp}
                  >
                    {showGrid && (
                      <div
                        className="absolute inset-0 pointer-events-none opacity-30"
                        style={{
                          backgroundImage:
                            "linear-gradient(to right, hsl(var(--border)) 1px, transparent 1px), linear-gradient(to bottom, hsl(var(--border)) 1px, transparent 1px)",
                          backgroundSize: `${gridStep * 100}% ${gridStep * 100}%`,
                        }}
                      />
                    )}

                    {slots.map((slot) => (
                      <div
                        key={slot.id}
                        className={`absolute border-2 rounded transition-shadow ${
                          selectedSlotId === slot.id
                            ? "border-primary shadow-lg z-10"
                            : "border-primary/50 hover:border-primary"
                        }`}
                        style={{
                          left: `${slot.x * 100}%`,
                          top: `${slot.y * 100}%`,
                          width: `${slot.w * 100}%`,
                          height: `${slot.h * 100}%`,
                          backgroundColor: "hsl(var(--primary) / 0.15)",
                        }}
                        onMouseDown={(e) => handleSlotMouseDown(e, slot, "move")}
                      >
                        <div className="absolute top-1 left-1 px-1.5 py-0.5 bg-background/90 rounded text-xs font-medium">
                          {slot.id}
                        </div>

                        {selectedSlotId === slot.id && (
                          <div
                            className="absolute bottom-0 right-0 w-3 h-3 bg-primary rounded-tl cursor-se-resize"
                            onMouseDown={(e) => handleSlotMouseDown(e, slot, "resize", "se")}
                          />
                        )}
                      </div>
                    ))}

                    {isDrawing && drawStart && drawCurrent && (
                      <div
                        className="absolute border-2 border-dashed border-primary bg-primary/20 pointer-events-none"
                        style={{
                          left: `${Math.min(drawStart.x, drawCurrent.x) * 100}%`,
                          top: `${Math.min(drawStart.y, drawCurrent.y) * 100}%`,
                          width: `${Math.abs(drawCurrent.x - drawStart.x) * 100}%`,
                          height: `${Math.abs(drawCurrent.y - drawStart.y) * 100}%`,
                        }}
                      >
                        <div className="absolute left-1 top-1 rounded bg-background/90 px-1.5 py-0.5 text-[10px] text-foreground">
                          {Math.round(Math.abs(drawCurrent.x - drawStart.x) * 100)}% × {Math.round(Math.abs(drawCurrent.y - drawStart.y) * 100)}%
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Slot Inspector */}
          {selectedSlot && (
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">Slot Properties</CardTitle>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => handleDeleteSlot(selectedSlot.id)}
                  >
                    <Trash2 className="mr-1 h-3 w-3" />
                    Delete
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="slot-id">Slot ID</Label>
                  <Input
                    id="slot-id"
                    value={selectedSlot.id}
                    onChange={(e) => handleUpdateSlotProperty("id", e.target.value)}
                  />
                  {hasDuplicateIds && duplicateIds.some((d) => d.id === selectedSlot.id) && (
                    <p className="text-sm text-destructive">Duplicate ID detected.</p>
                  )}
                </div>
                <Separator />
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="slot-x">X ({Math.round(selectedSlot.x * 100)}%)</Label>
                    <Input
                      id="slot-x"
                      type="number"
                      step={inputStep}
                      min="0"
                      max="1"
                      value={selectedSlot.x}
                      onChange={(e) => handleUpdateSlotProperty("x", e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="slot-y">Y ({Math.round(selectedSlot.y * 100)}%)</Label>
                    <Input
                      id="slot-y"
                      type="number"
                      step={inputStep}
                      min="0"
                      max="1"
                      value={selectedSlot.y}
                      onChange={(e) => handleUpdateSlotProperty("y", e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="slot-w">Width ({Math.round(selectedSlot.w * 100)}%)</Label>
                    <Input
                      id="slot-w"
                      type="number"
                      step={inputStep}
                      min="0"
                      max="1"
                      value={selectedSlot.w}
                      onChange={(e) => handleUpdateSlotProperty("w", e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="slot-h">Height ({Math.round(selectedSlot.h * 100)}%)</Label>
                    <Input
                      id="slot-h"
                      type="number"
                      step={inputStep}
                      min="0"
                      max="1"
                      value={selectedSlot.h}
                      onChange={(e) => handleUpdateSlotProperty("h", e.target.value)}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* JSON Preview */}
          <Collapsible open={isJsonOpen} onOpenChange={setIsJsonOpen}>
            <Card>
              <CollapsibleTrigger asChild>
                <CardHeader className="cursor-pointer hover:bg-muted/50 transition-colors">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">JSON Specification</CardTitle>
                    <div className="flex items-center gap-2">
                      <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); handleCopyJson(); }}>
                        <Copy className="mr-1 h-3 w-3" />
                        Copy JSON
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={(e) => {
                          e.stopPropagation();
                          setIsJsonOpen((prev) => !prev);
                        }}
                      >
                        {isJsonOpen ? "Close" : "Open"}
                      </Button>
                    </div>
                  </div>
                </CardHeader>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <CardContent>
                  <div className="space-y-4">
                    {slots.map((slot) => (
                      <div key={slot.id} className="space-y-3 rounded border border-muted/40 bg-muted/20 p-3">
                        <div className="flex items-center justify-between">
                          <p className="text-sm font-medium text-foreground">{slot.id}</p>
                          <Badge variant="outline" className="text-xs">
                            {Math.round(slot.w * 100)}% × {Math.round(slot.h * 100)}%
                          </Badge>
                        </div>
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                          <div className="space-y-1">
                            <Label className="text-xs text-muted-foreground">X ({(slot.x * 100).toFixed(0)}%)</Label>
                            <Input
                              type="number"
                              step={inputStep}
                              min="0"
                              max="1"
                              value={slot.x}
                              onChange={(event) => handleSlotSpecFieldChange(slot.id, "x", event.target.value)}
                            />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs text-muted-foreground">Y ({(slot.y * 100).toFixed(0)}%)</Label>
                            <Input
                              type="number"
                              step={inputStep}
                              min="0"
                              max="1"
                              value={slot.y}
                              onChange={(event) => handleSlotSpecFieldChange(slot.id, "y", event.target.value)}
                            />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs text-muted-foreground">Width ({(slot.w * 100).toFixed(0)}%)</Label>
                            <Input
                              type="number"
                              step={inputStep}
                              min="0"
                              max="1"
                              value={slot.w}
                              onChange={(event) => handleSlotSpecFieldChange(slot.id, "w", event.target.value)}
                            />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs text-muted-foreground">Height ({(slot.h * 100).toFixed(0)}%)</Label>
                            <Input
                              type="number"
                              step={inputStep}
                              min="0"
                              max="1"
                              value={slot.h}
                              onChange={(event) => handleSlotSpecFieldChange(slot.id, "h", event.target.value)}
                            />
                          </div>
                        </div>
                      </div>
                    ))}
                    {slots.length === 0 && (
                      <p className="text-sm text-muted-foreground">No slots defined yet. Draw or add one to get started.</p>
                    )}
                  </div>
                </CardContent>
              </CollapsibleContent>
            </Card>
          </Collapsible>
        </div>
      </div>

      {/* Unsaved Changes Dialog */}
      <ConfirmDialog
        open={showUnsavedDialog}
        title="Unsaved changes"
        description="You have unsaved changes. Are you sure you want to leave without saving?"
        confirmLabel="Leave"
        cancelLabel="Stay"
        onConfirm={confirmNavigation}
        onCancel={() => setShowUnsavedDialog(false)}
      />
    </div>
  );
};

export default LayoutEditor;
