import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useBlocker, useNavigate, useParams, useLocation } from "react-router-dom";
import { ArrowLeft, Copy, Grid3X3, Move, Plus, Save, Trash2, Undo2, Redo2, MousePointer2, Pencil, ZoomIn, ZoomOut } from "lucide-react";
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
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { useDebounce } from "@/hooks/use-debounce";
import { useSafeMutation } from "@/hooks/useSafeMutation";
import { screensApi } from "@/api/domains/screens";
import { layoutsApi } from "@/api/domains/layouts";
import type { LayoutCreatePayload, LayoutItem, LayoutSlot, ScreenAspectRatio } from "@/api/types";
import { canvasDimensions, drawSlot, moveSlot, nextSlotId, placeNewSlot, resizeSlot, slotsOverlap, updateSlotNumber } from "@/lib/layoutEditorGeometry";

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

const GRID_OPTIONS = [
  { label: "5%", value: 0.05 },
  { label: "10%", value: 0.1 },
  { label: "20%", value: 0.2 },
] as const;

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

const snapToStep = (value: number, step: number) => {
  if (!step || step <= 0) return Number(clamp01(value).toFixed(3));
  return Number(clamp01(Math.round(value / step + 1e-9) * step).toFixed(3));
};

const getInputStep = (gridStep: number, snapToGrid: boolean) => (snapToGrid ? gridStep : 0.01);

const LayoutEditor = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const canvasRef = useRef<HTMLDivElement>(null);
  const canvasViewportRef = useRef<HTMLDivElement>(null);
  const [canvasViewportWidth, setCanvasViewportWidth] = useState(320);
  const [zoom, setZoom] = useState(1);

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
  const slotsRef = useRef<LayoutSlot[]>([]);
  const [slotHistory, setSlotHistory] = useState<{ past: LayoutSlot[][]; future: LayoutSlot[][] }>({ past: [], future: [] });
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const allowSavedNavigationRef = useRef(false);
  const blocker = useBlocker(({ currentLocation, nextLocation }) =>
    isDirty &&
    !allowSavedNavigationRef.current &&
    (currentLocation.pathname !== nextLocation.pathname ||
      currentLocation.search !== nextLocation.search ||
      currentLocation.hash !== nextLocation.hash),
  );
  const [showGrid, setShowGrid] = useState(true);
  const [snapToGrid, setSnapToGrid] = useState(true);
  const [gridStep, setGridStep] = useState<number>(0.1);
  const [isJsonOpen, setIsJsonOpen] = useState(false);
  const [numericDraft, setNumericDraft] = useState({ x: "", y: "", w: "", h: "" });
  const [slotIdDraft, setSlotIdDraft] = useState("");

  useEffect(() => {
    if (!isDirty) return;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, [isDirty]);

  const commitSlots = useCallback((next: LayoutSlot[]) => {
    const previous = slotsRef.current;
    if (JSON.stringify(previous) === JSON.stringify(next)) return;
    setSlotHistory((history) => ({ past: [...history.past, previous].slice(-50), future: [] }));
    slotsRef.current = next;
    setSlots(next);
    setIsDirty(true);
  }, []);

  const undoSlots = useCallback(() => {
    const previous = slotHistory.past.at(-1);
    if (!previous) return;
    const current = slotsRef.current;
    setSlotHistory({ past: slotHistory.past.slice(0, -1), future: [current, ...slotHistory.future] });
    slotsRef.current = previous;
    setSlots(previous);
    if (selectedSlotId && !previous.some((slot) => slot.id === selectedSlotId)) setSelectedSlotId(null);
    setIsDirty(true);
  }, [selectedSlotId, slotHistory]);

  const redoSlots = useCallback(() => {
    const next = slotHistory.future[0];
    if (!next) return;
    const current = slotsRef.current;
    setSlotHistory({ past: [...slotHistory.past, current].slice(-50), future: slotHistory.future.slice(1) });
    slotsRef.current = next;
    setSlots(next);
    if (selectedSlotId && !next.some((slot) => slot.id === selectedSlotId)) setSelectedSlotId(null);
    setIsDirty(true);
  }, [selectedSlotId, slotHistory]);

  const layoutQuery = useQuery({
    enabled: isEditMode && !!id,
    queryKey: ["layout", id],
    queryFn: () => layoutsApi.getById(id!),
    retry: false,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (!layoutQuery.data) return;
    setName(layoutQuery.data.name);
    setDescription(layoutQuery.data.description ?? "");
    setAspectRatio(layoutQuery.data.aspect_ratio);
    setSlots(layoutQuery.data.spec.slots);
    slotsRef.current = layoutQuery.data.spec.slots;
    setSlotHistory({ past: [], future: [] });
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
  const drawStartRef = useRef<{ x: number; y: number } | null>(null);

  // Dragging/resizing state
  const dragStateRef = useRef<{
    type: "move" | "resize";
    slotId: string;
    startX: number;
    startY: number;
    originalSlot: LayoutSlot;
    handle?: string;
  } | null>(null);
  const activePointerId = useRef<number | null>(null);
  const gestureStartSlots = useRef<LayoutSlot[] | null>(null);

  useEffect(() => {
    const viewport = canvasViewportRef.current;
    if (!viewport) return;
    const measure = () => setCanvasViewportWidth(viewport.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);

  const selectedSlot = slots.find((s) => s.id === selectedSlotId);

  useEffect(() => {
    setNumericDraft(selectedSlot
      ? { x: String(selectedSlot.x), y: String(selectedSlot.y), w: String(selectedSlot.w), h: String(selectedSlot.h) }
      : { x: "", y: "", w: "", h: "" });
    setSlotIdDraft(selectedSlot?.id ?? "");
  }, [selectedSlot]);

  // Check for overlapping slots
  const hasOverlaps = slots.some((slot, i) =>
    slots.some((other, j) => i !== j && slotsOverlap(slot, other))
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

  const showGridMarkers = showGrid && canvasViewportWidth >= 500;
  const canvasPadding = canvasViewportWidth < 640 ? 24 : 32;
  const canvasWidth = Math.max(120, Math.min(640, canvasViewportWidth - canvasPadding - (showGridMarkers ? 52 : 8))) * zoom;
  const fittedCanvas = canvasDimensions(aspectRatio, canvasWidth);
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
      await queryClient.invalidateQueries({ queryKey: ["layouts"] });
      if (isEditMode) {
        await queryClient.invalidateQueries({ queryKey: ["layout", id] });
      }
      toast({
        title: isEditMode ? "Layout updated" : "Layout created",
        description: `"${name}" has been saved successfully.`,
      });
      setIsDirty(false);
      allowSavedNavigationRef.current = true;
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
    navigate(defaultReturnPath);
  };

  const handleAddSlot = () => {
    const newSlot = placeNewSlot(slotsRef.current);
    if (!newSlot) {
      toast({ title: "No open area", description: "Move or resize an existing slot before adding another.", variant: "destructive" });
      return;
    }
    commitSlots([...slotsRef.current, newSlot]);
    setSelectedSlotId(newSlot.id);
    setIsDrawing(false);
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

  const handleCanvasPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!isDrawing || activePointerId.current !== null) return;
    activePointerId.current = event.pointerId;
    canvasRef.current?.setPointerCapture(event.pointerId);
    const coords = getCanvasCoordinates(event.clientX, event.clientY, snapToGrid);
    drawStartRef.current = coords;
    setDrawStart(coords);
    setDrawCurrent(coords);
  };

  const handleCanvasPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (activePointerId.current !== e.pointerId) return;
    if (isDrawing && drawStartRef.current) {
      const coords = getCanvasCoordinates(e.clientX, e.clientY, snapToGrid);
      setDrawCurrent(coords);
    } else if (dragStateRef.current) {
      const dragState = dragStateRef.current;
      const coords = getCanvasCoordinates(e.clientX, e.clientY, snapToGrid);
      const deltaX = coords.x - dragState.startX;
      const deltaY = coords.y - dragState.startY;
      const next = (gestureStartSlots.current ?? slotsRef.current).map((slot) => {
        if (slot.id !== dragState.slotId) return slot;
        const step = snapToGrid ? gridStep : 0;
        return dragState.type === "move"
          ? moveSlot(dragState.originalSlot, deltaX, deltaY, step)
          : resizeSlot(dragState.originalSlot, deltaX, deltaY, step);
      });
      slotsRef.current = next;
      setSlots(next);
    }
  };

  const finishPointerGesture = (event: React.PointerEvent<HTMLDivElement>, cancelled = false) => {
    if (activePointerId.current !== event.pointerId) return;
    if (canvasRef.current?.hasPointerCapture(event.pointerId)) canvasRef.current.releasePointerCapture(event.pointerId);
    activePointerId.current = null;

    if (isDrawing && drawStartRef.current && !cancelled) {
      const minDrawSize = Math.max(snapToGrid ? gridStep : 0.02, 0.02);
      const end = getCanvasCoordinates(event.clientX, event.clientY, snapToGrid);
      const newSlot = drawSlot(nextSlotId(slotsRef.current), drawStartRef.current, end, minDrawSize);
      if (newSlot && slotsRef.current.every((slot) => !slotsOverlap(newSlot, slot))) {
        commitSlots([...slotsRef.current, newSlot]);
        setSelectedSlotId(newSlot.id);
        setIsDrawing(false);
      } else {
        toast({ title: "Could not draw slot", description: newSlot ? "Choose an area that does not overlap another slot." : "Drag to make a larger slot.", variant: "destructive" });
      }
    }
    if (gestureStartSlots.current) {
      const before = gestureStartSlots.current;
      if (cancelled) {
        slotsRef.current = before;
        setSlots(before);
      } else if (JSON.stringify(before) !== JSON.stringify(slotsRef.current)) {
        setSlotHistory((history) => ({ past: [...history.past, before].slice(-50), future: [] }));
        setIsDirty(true);
      }
    }
    gestureStartSlots.current = null;
    dragStateRef.current = null;
    drawStartRef.current = null;
    setDrawStart(null);
    setDrawCurrent(null);
  };

  const handleSlotPointerDown = (e: React.PointerEvent<HTMLDivElement>, slot: LayoutSlot, type: "move" | "resize", handle?: string) => {
    if (isDrawing) return;
    e.stopPropagation();
    canvasRef.current?.focus();
    setSelectedSlotId(slot.id);
    if (activePointerId.current !== null) return;
    activePointerId.current = e.pointerId;
    canvasRef.current?.setPointerCapture(e.pointerId);
    gestureStartSlots.current = slotsRef.current;
    const coords = getCanvasCoordinates(e.clientX, e.clientY, snapToGrid);
    dragStateRef.current = {
      type,
      slotId: slot.id,
      startX: coords.x,
      startY: coords.y,
      originalSlot: { ...slot },
      handle,
    };
  };

  const handleDeleteSlot = (slotId: string) => {
    commitSlots(slotsRef.current.filter((s) => s.id !== slotId));
    if (selectedSlotId === slotId) {
      setSelectedSlotId(null);
    }
  };

  const updateSlotProperty = (slotId: string, property: "id" | "x" | "y" | "w" | "h", value: string | number) => {
    const next = slotsRef.current.map((slot) => {
        if (slot.id !== slotId) return slot;
        if (property === "id") {
          return { ...slot, id: String(value) };
        }
        const numValue = typeof value === "string" ? Number(value) : value;
        return updateSlotNumber(slot, property, numValue, snapToGrid ? gridStep : 0);
      });
    commitSlots(next);
    if (property === "id" && slotId === selectedSlotId) {
      setSelectedSlotId(String(value));
    }
  };

  const handleUpdateSlotProperty = (property: "id" | "x" | "y" | "w" | "h", value: string | number) => {
    if (!selectedSlotId) return;
    updateSlotProperty(selectedSlotId, property, value);
  };

  const commitNumericDraft = (property: "x" | "y" | "w" | "h") => {
    if (!selectedSlot) return;
    const value = Number(numericDraft[property]);
    if (numericDraft[property].trim() && Number.isFinite(value)) {
      handleUpdateSlotProperty(property, value);
    } else {
      setNumericDraft((current) => ({ ...current, [property]: String(selectedSlot[property]) }));
    }
  };

  const commitSlotId = () => {
    if (!selectedSlot) return;
    const nextId = slotIdDraft.trim();
    if (!nextId || slotsRef.current.some((slot) => slot.id === nextId && slot.id !== selectedSlot.id)) {
      setSlotIdDraft(selectedSlot.id);
      toast({ title: "Slot name unavailable", description: "Use a unique, nonempty slot name.", variant: "destructive" });
      return;
    }
    handleUpdateSlotProperty("id", nextId);
  };

  const handleCopyJson = async () => {
    const json = JSON.stringify({ slots }, null, 2);
    await navigator.clipboard.writeText(json);
    toast({
      title: "Copied",
      description: "JSON specification copied to clipboard.",
    });
  };

  const markDirty = () => setIsDirty(true);

  const nudgeSelectedSlot = useCallback((deltaX: number, deltaY: number) => {
    if (!selectedSlotId) return;
    const step = snapToGrid ? gridStep : 0;
    commitSlots(slotsRef.current.map((slot) => slot.id === selectedSlotId
      ? moveSlot(slot, deltaX, deltaY, step)
      : slot));
  }, [commitSlots, gridStep, selectedSlotId, snapToGrid]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target?.isContentEditable) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) redoSlots();
        else undoSlots();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") {
        event.preventDefault();
        redoSlots();
        return;
      }
      if (!selectedSlotId || !target?.closest("[data-layout-editor-keyboard]")) return;

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
  }, [gridStep, nudgeSelectedSlot, redoSlots, selectedSlotId, snapToGrid, undoSlots]);

  const debouncedSearchTerm = debouncedAspectRatioSearch.trim();
  const isSearchActive = Boolean(debouncedSearchTerm);

  const { data: aspectRatioResponse, isFetching: isAspectRatiosLoading } = useQuery({
    queryKey: ["screen-aspect-ratios", debouncedSearchTerm],
    queryFn: () =>
      screensApi.listAspectRatios({
        search: debouncedSearchTerm || undefined,
        configured_only: true,
      }),
    placeholderData: keepPreviousData,
  });

  const aspectRatioOptions = useMemo<ScreenAspectRatio[]>(() => {
    const resolved = mergeAspectRatioOptions(aspectRatioResponse);
    if (isSearchActive) {
      return resolved;
    }
    return resolved;
  }, [aspectRatioResponse, isSearchActive]);

  if (isEditMode && !layoutQuery.data) {
    if (layoutQuery.isError) {
      return (
        <div className="mx-auto max-w-xl space-y-4 rounded-xl border bg-card p-6">
          <h1 className="text-xl font-semibold">Layout unavailable</h1>
          <p className="text-sm text-muted-foreground">The layout could not be loaded. Retry before making changes.</p>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void layoutQuery.refetch()}>Retry loading</Button>
            <Button variant="outline" onClick={handleCancel}>Back to layouts</Button>
          </div>
        </div>
      );
    }
    return <div role="status" className="rounded-xl border bg-card p-6 text-sm text-muted-foreground">Loading layout…</div>;
  }

  return (
    <div className="space-y-6">
      {/* Top Bar */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-center gap-4">
          <Button variant="ghost" size="icon" onClick={handleCancel} aria-label="Back to layouts">
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
        {/* Required details come before the canvas on a phone. */}
        <div className="order-1 min-w-0 space-y-6 lg:col-start-1 lg:row-start-1">
          <Card className="layout-editor-group">
            <CardHeader className="px-0 sm:px-0">
              <CardTitle>Layout Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 px-0 sm:px-0">
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
          <Card className="layout-editor-group">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 px-0 pb-2 sm:px-0">
              <CardTitle className="text-base">Slots ({slots.length})</CardTitle>
              <Button size="sm" variant="outline" onClick={handleAddSlot}>
                <Plus className="mr-1 h-3 w-3" />
                Add
              </Button>
            </CardHeader>
            <CardContent className="px-0 sm:px-0">
              {slots.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">
                  No slots yet. Add a slot, or choose Draw to place one on the canvas.
                </p>
              ) : (
                <div className="space-y-2">
                  {slots.map((slot) => (
                    <button
                      type="button"
                      key={slot.id}
                      data-layout-editor-keyboard
                      className={`flex w-full flex-wrap items-center justify-between gap-2 rounded-md border p-2 text-left transition-colors ${
                        selectedSlotId === slot.id
                          ? "border-primary bg-primary/5"
                          : "hover:bg-muted/50"
                      }`}
                      onClick={() => setSelectedSlotId(slot.id)}
                      aria-pressed={selectedSlotId === slot.id}
                    >
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-sm bg-primary/60" />
                        <span className="text-sm font-medium">{slot.id}</span>
                      </div>
                      <Badge variant="secondary" className="text-xs">
                        {Math.round(slot.w * 100)}% × {Math.round(slot.h * 100)}%
                      </Badge>
                    </button>
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
        <div className="order-2 min-w-0 space-y-4 lg:col-span-2 lg:col-start-2 lg:row-start-1">
          {/* Canvas Controls */}
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-col gap-1">
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant={!isDrawing ? "secondary" : "outline"}
                  onClick={() => setIsDrawing(false)}
                  aria-pressed={!isDrawing}
                >
                  <MousePointer2 className="mr-1 h-3 w-3" />
                  Select
                </Button>
                <Button
                  size="sm"
                  variant={isDrawing ? "secondary" : "outline"}
                  onClick={() => setIsDrawing(true)}
                  aria-pressed={isDrawing}
                >
                  <Pencil className="mr-1 h-3 w-3" />
                  Draw
                </Button>
                <Button
                  size="sm"
                  variant="outline"
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
                <Button size="sm" variant="outline" onClick={undoSlots} disabled={slotHistory.past.length === 0}>
                  <Undo2 className="mr-1 h-3 w-3" />
                  Undo
                </Button>
                <Button size="sm" variant="outline" onClick={redoSlots} disabled={slotHistory.future.length === 0}>
                  <Redo2 className="mr-1 h-3 w-3" />
                  Redo
                </Button>
                <div className="flex items-center gap-1" aria-label="Canvas zoom">
                  <Button size="sm" variant="outline" aria-label="Zoom out" onClick={() => setZoom((value) => Math.max(1, value - 0.5))} disabled={zoom === 1}>
                    <ZoomOut className="h-3 w-3" />
                  </Button>
                  <span className="min-w-9 text-center text-xs">{Math.round(zoom * 100)}%</span>
                  <Button size="sm" variant="outline" aria-label="Zoom in" onClick={() => setZoom((value) => Math.min(2, value + 0.5))} disabled={zoom === 2}>
                    <ZoomIn className="h-3 w-3" />
                  </Button>
                </div>
              </div>
              <span className="text-xs text-muted-foreground">
                Add makes a slot in open space. Draw lets you place one. Snap applies to drawing, moving, resizing, and numeric edits.
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
            <span>Focus the canvas or a layer, then use arrow keys to move it. Hold Shift for larger steps.</span>
          </div>

          {/* Canvas */}
          <Card>
            <CardContent ref={canvasViewportRef} className="overflow-x-auto p-3 sm:p-4" data-testid="layout-canvas-viewport">
              <div className="mx-auto min-w-max w-fit">
                {showGridMarkers && (
                  <div className="mb-2 ml-10 relative" style={{ width: fittedCanvas.width }}>
                    {gridMarkers.filter((marker) => marker.position > 0 && marker.position < 100 && Math.round(marker.position) % 10 === 0).map((marker) => (
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
                  {showGridMarkers && (
                    <div className="relative shrink-0" style={{ width: 36, height: fittedCanvas.height }}>
                      {gridMarkers.filter((marker) => marker.position > 0 && marker.position < 100 && Math.round(marker.position) % 10 === 0).map((marker) => (
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
                    data-testid="layout-canvas"
                    data-layout-editor-keyboard
                    tabIndex={0}
                    role="group"
                    aria-label="Layout canvas"
                    className={`relative border-2 border-dashed rounded-lg overflow-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                      isDrawing ? "cursor-crosshair" : "cursor-default"
                    }`}
                    style={{
                      width: fittedCanvas.width,
                      height: fittedCanvas.height,
                      backgroundColor: "hsl(var(--muted))",
                      touchAction: "none",
                    }}
                    onPointerDown={handleCanvasPointerDown}
                    onPointerMove={handleCanvasPointerMove}
                    onPointerUp={finishPointerGesture}
                    onPointerCancel={(event) => finishPointerGesture(event, true)}
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
                        data-testid={`layout-slot-${slot.id}`}
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
                        onPointerDown={(e) => handleSlotPointerDown(e, slot, "move")}
                      >
                        <div className="absolute top-1 left-1 px-1.5 py-0.5 bg-background/90 rounded text-xs font-medium">
                          {slot.id}
                        </div>

                        {selectedSlotId === slot.id && (
                          <div
                            data-testid={`resize-slot-${slot.id}`}
                            className="absolute bottom-0 right-0 h-6 w-6 bg-primary rounded-tl cursor-se-resize sm:h-4 sm:w-4"
                            role="button"
                            aria-label={`Resize ${slot.id}`}
                            onPointerDown={(e) => handleSlotPointerDown(e, slot, "resize", "se")}
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
            <Card className="layout-editor-group">
              <CardHeader className="px-0 pb-3 sm:px-0">
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
              <CardContent className="space-y-4 px-0 sm:px-0">
                <div className="space-y-2">
                  <Label htmlFor="slot-id">Slot ID</Label>
                  <Input
                    id="slot-id"
                    value={slotIdDraft}
                    onChange={(e) => setSlotIdDraft(e.target.value)}
                    onBlur={commitSlotId}
                    onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
                  />
                  {hasDuplicateIds && duplicateIds.some((d) => d.id === selectedSlot.id) && (
                    <p className="text-sm text-destructive">Duplicate ID detected.</p>
                  )}
                </div>
                <Separator />
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="slot-x">X ({Math.round(selectedSlot.x * 100)}%)</Label>
                    <Input
                      id="slot-x"
                      type="number"
                      step={inputStep}
                      min="0"
                      max={1 - selectedSlot.w}
                      value={numericDraft.x}
                      onChange={(e) => setNumericDraft((current) => ({ ...current, x: e.target.value }))}
                      onBlur={() => commitNumericDraft("x")}
                      onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="slot-y">Y ({Math.round(selectedSlot.y * 100)}%)</Label>
                    <Input
                      id="slot-y"
                      type="number"
                      step={inputStep}
                      min="0"
                      max={1 - selectedSlot.h}
                      value={numericDraft.y}
                      onChange={(e) => setNumericDraft((current) => ({ ...current, y: e.target.value }))}
                      onBlur={() => commitNumericDraft("y")}
                      onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="slot-w">Width ({Math.round(selectedSlot.w * 100)}%)</Label>
                    <Input
                      id="slot-w"
                      type="number"
                      step={inputStep}
                      min="0.01"
                      max={1 - selectedSlot.x}
                      value={numericDraft.w}
                      onChange={(e) => setNumericDraft((current) => ({ ...current, w: e.target.value }))}
                      onBlur={() => commitNumericDraft("w")}
                      onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="slot-h">Height ({Math.round(selectedSlot.h * 100)}%)</Label>
                    <Input
                      id="slot-h"
                      type="number"
                      step={inputStep}
                      min="0.01"
                      max={1 - selectedSlot.y}
                      value={numericDraft.h}
                      onChange={(e) => setNumericDraft((current) => ({ ...current, h: e.target.value }))}
                      onBlur={() => commitNumericDraft("h")}
                      onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* JSON Preview */}
          <Collapsible open={isJsonOpen} onOpenChange={setIsJsonOpen}>
            <Card className="layout-editor-group">
              <CardHeader className="flex flex-row items-center justify-between gap-2 px-0 sm:px-0">
                <CardTitle className="text-base">Layout data</CardTitle>
                <div className="flex flex-wrap items-center gap-2">
                  <Button size="sm" variant="outline" onClick={handleCopyJson}>
                    <Copy className="mr-1 h-3 w-3" />
                    Copy JSON
                  </Button>
                  <CollapsibleTrigger asChild>
                    <Button size="sm" variant="ghost">{isJsonOpen ? "Hide details" : "Show details"}</Button>
                  </CollapsibleTrigger>
                </div>
              </CardHeader>
              <CollapsibleContent>
                <CardContent className="px-0 sm:px-0">
                  <pre className="max-h-72 overflow-auto rounded-md bg-muted/40 p-3 text-xs">{JSON.stringify({ slots }, null, 2)}</pre>
                </CardContent>
              </CollapsibleContent>
            </Card>
          </Collapsible>
        </div>

      </div>

      {/* Unsaved Changes Dialog */}
      <ConfirmDialog
        open={blocker.state === "blocked"}
        title="Unsaved changes"
        description="You have unsaved changes. Are you sure you want to leave without saving?"
        confirmLabel="Leave"
        cancelLabel="Stay"
        onConfirm={() => blocker.proceed?.()}
        onCancel={() => blocker.reset?.()}
      />
    </div>
  );
};

export default LayoutEditor;
