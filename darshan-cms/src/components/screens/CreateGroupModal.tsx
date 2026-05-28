import { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Check } from "lucide-react";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { screensApi } from "@/api/domains/screens";
import { queryKeys } from "@/api/queryKeys";
import { useSafeMutation } from "@/hooks/useSafeMutation";
import { toast } from "sonner";
import type { Screen } from "@/api/types";

interface CreateGroupModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

export function CreateGroupModal({ open, onOpenChange }: CreateGroupModalProps) {
    const queryClient = useQueryClient();
    const [formState, setFormState] = useState({
        name: "",
        description: "",
    });
    const [selectedScreenIds, setSelectedScreenIds] = useState<string[]>([]);

    // Fetch all screens
    const { data: allScreensData, isLoading: isLoadingScreens } = useQuery({
        queryKey: queryKeys.screens,
        queryFn: () => screensApi.list({ page: 1, limit: 100 }),
        enabled: open,
    });

    // Fetch all groups
    const { data: screenGroupsData, isLoading: isLoadingGroups } = useQuery({
        queryKey: queryKeys.screenGroups,
        queryFn: () => screensApi.listGroups({ page: 1, limit: 100 }),
        enabled: open,
    });

    // Filter out screens that are already assigned to any group
    const availableScreens = useMemo(() => {
        const allScreens = allScreensData?.items ?? [];
        const groups = screenGroupsData?.items ?? [];

        // Collect all screen IDs that are already in groups
        const assignedScreenIds = new Set<string>();
        groups.forEach(group => {
            (group.screen_ids || []).forEach(screenId => {
                assignedScreenIds.add(screenId);
            });
        });

        // Filter out screens that are already assigned
        return allScreens.filter(screen => !assignedScreenIds.has(screen.id));
    }, [allScreensData, screenGroupsData]);

    const createGroup = useSafeMutation({
        mutationFn: (payload: {
            name: string;
            description?: string;
            screen_ids?: string[]
        }) => screensApi.createGroup(payload),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: queryKeys.screenGroups });
            queryClient.invalidateQueries({ queryKey: queryKeys.screens });
            queryClient.invalidateQueries({ queryKey: queryKeys.screensOverview({ includeMedia: true }) });
            toast.success("Group created successfully");
            handleClose();
        },
    }, "Unable to create group.");

    const handleClose = () => {
        setFormState({ name: "", description: "" });
        setSelectedScreenIds([]);
        onOpenChange(false);
    };

    const handleToggleScreen = (screenId: string) => {
        setSelectedScreenIds((prev) =>
            prev.includes(screenId)
                ? prev.filter((id) => id !== screenId)
                : [...prev, screenId]
        );
    };

    const handleSubmit = () => {
        const payload = {
            name: formState.name.trim(),
            description: formState.description.trim() || undefined,
            screen_ids: selectedScreenIds.length > 0 ? selectedScreenIds : undefined,
        };
        createGroup.mutate(payload);
    };

    const isLoading = isLoadingScreens || isLoadingGroups;

    return (
        <Dialog open={open} onOpenChange={handleClose}>
            <DialogContent className="max-w-2xl overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>Create Screen Group</DialogTitle>
                    <DialogDescription>
                        Group screens together for easier management and scheduling. Only screens not assigned to any group are available for selection.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 py-4">
                    <div className="space-y-2">
                        <Label htmlFor="group-name">Group Name</Label>
                        <Input
                            id="group-name"
                            value={formState.name}
                            onChange={(e) =>
                                setFormState((prev) => ({ ...prev, name: e.target.value }))
                            }
                            placeholder="e.g., Ground Floor Displays"
                        />
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="group-description">Description (Optional)</Label>
                        <Input
                            id="group-description"
                            value={formState.description}
                            onChange={(e) =>
                                setFormState((prev) => ({ ...prev, description: e.target.value }))
                            }
                            placeholder="e.g., All screens in the entrance area"
                        />
                    </div>

                    <div className="space-y-2">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <Label>Select Available Screens</Label>
                            <Badge variant="secondary">
                                {selectedScreenIds.length} selected
                            </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground">
                            Only screens not assigned to any group are shown
                        </p>

                        {isLoading ? (
                            <div className="space-y-2">
                                <Skeleton className="h-16 w-full" />
                                <Skeleton className="h-16 w-full" />
                                <Skeleton className="h-16 w-full" />
                            </div>
                        ) : availableScreens.length === 0 ? (
                            <Card className="p-8 text-center">
                                <p className="text-muted-foreground">No available screens to add</p>
                                <p className="text-xs text-muted-foreground mt-1">
                                    All screens are already assigned to groups
                                </p>
                            </Card>
                        ) : (
                            <div className="border rounded-lg divide-y max-h-64 overflow-y-auto">
                                {availableScreens.map((screen) => {
                                    const { id, name, location, status } = screen;
                                    const isSelected = selectedScreenIds.includes(id);

                                    return (
                                        <div
                                            key={id}
                                            className="flex cursor-pointer flex-col gap-3 p-3 transition-colors hover:bg-accent sm:flex-row sm:items-center"
                                            onClick={() => handleToggleScreen(id)}
                                        >
                                            <Checkbox
                                                checked={isSelected}
                                                onCheckedChange={() => handleToggleScreen(id)}
                                                onClick={(e) => e.stopPropagation()}
                                            />
                                            <div className="flex-1 min-w-0">
                                                <p className="font-medium truncate">{name}</p>
                                                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                                                    <span className="truncate">{location || "No location"}</span>
                                                    <span>•</span>
                                                    <Badge
                                                        variant={status === "ACTIVE" ? "default" : "secondary"}
                                                        className="text-[10px] px-1 py-0"
                                                    >
                                                        {status || "Unknown"}
                                                    </Badge>
                                                </div>
                                                <p className="text-[10px] text-muted-foreground font-mono mt-0.5">
                                                    {id}
                                                </p>
                                            </div>
                                            {isSelected && (
                                                <Check className="h-4 w-4 text-primary flex-shrink-0" />
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </div>

                <DialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                    <Button variant="outline" onClick={handleClose} disabled={createGroup.isPending}>
                        Cancel
                    </Button>
                    <Button
                        onClick={handleSubmit}
                        disabled={createGroup.isPending || !formState.name.trim()}
                    >
                        <Plus className="h-4 w-4 mr-2" />
                        {createGroup.isPending ? "Creating..." : "Create Group"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
