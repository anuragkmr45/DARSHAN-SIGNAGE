import { useState, useMemo, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Save, Check, Trash2 } from "lucide-react";
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
import type { ScreenGroup } from "@/api/types";

interface UpdateGroupModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    groupId: string;
}

export function UpdateGroupModal({ open, onOpenChange, groupId }: UpdateGroupModalProps) {
    const queryClient = useQueryClient();
    const [formState, setFormState] = useState({
        name: "",
        description: "",
    });
    const [selectedScreenIds, setSelectedScreenIds] = useState<string[]>([]);

    const { data: groupData, isLoading: isLoadingGroup } = useQuery({
        queryKey: ["screen-group", groupId],
        queryFn: () => screensApi.getGroupById(groupId),
        enabled: open && !!groupId,
    });

    const { data: allScreensData, isLoading: isLoadingScreens } = useQuery({
        queryKey: queryKeys.screens,
        queryFn: () => screensApi.list({ page: 1, limit: 100 }),
        enabled: open,
    });

    const { data: screenGroupsData, isLoading: isLoadingGroups } = useQuery({
        queryKey: queryKeys.screenGroups,
        queryFn: () => screensApi.listGroups({ page: 1, limit: 100 }),
        enabled: open,
    });

    useEffect(() => {
        if (groupData) {
            setFormState({
                name: groupData.name || "",
                description: groupData.description || "",
            });
            setSelectedScreenIds(groupData.screen_ids || []);
        }
    }, [groupData]);

    const availableScreens = useMemo(() => {
        const allScreens = allScreensData?.items ?? [];
        const groups = screenGroupsData?.items ?? [];
        const currentScreenIds = groupData?.screen_ids || [];

        // Collect all screen IDs that are in OTHER groups (not this one)
        const assignedScreenIds = new Set<string>();
        groups.forEach(group => {
            // Skip the current group being edited
            if (group.id !== groupId) {
                (group.screen_ids || []).forEach(screenId => {
                    assignedScreenIds.add(screenId);
                });
            }
        });

        // Filter screens: show those not in other groups OR currently in this group
        return allScreens.filter(screen =>
            !assignedScreenIds.has(screen.id) || currentScreenIds.includes(screen.id)
        );
    }, [allScreensData, screenGroupsData, groupData, groupId]);

    const updateGroup = useSafeMutation({
        mutationFn: (payload: {
            name: string;
            description?: string;
            screen_ids?: string[]
        }) => screensApi.updateGroup(groupId, payload),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: queryKeys.screenGroups });
            queryClient.invalidateQueries({ queryKey: queryKeys.screens });
            queryClient.invalidateQueries({ queryKey: queryKeys.screensOverview({ includeMedia: true }) });
            queryClient.invalidateQueries({ queryKey: ["screen-group", groupId] });
            toast.success("Group updated successfully");
            handleClose();
        },
    }, "Unable to update group.");

    const deleteGroup = useSafeMutation({
        mutationFn: () => screensApi.removeGroup(groupId),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: queryKeys.screenGroups });
            queryClient.invalidateQueries({ queryKey: queryKeys.screens });
            queryClient.invalidateQueries({ queryKey: queryKeys.screensOverview({ includeMedia: true }) });
            toast.success("Group deleted successfully");
            handleClose();
        },
    }, "Unable to delete group.");

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
        updateGroup.mutate(payload);
    };

    const handleDelete = () => {
        if (confirm("Are you sure you want to delete this group? This action cannot be undone.")) {
            deleteGroup.mutate();
        }
    };

    const isLoading = isLoadingGroup || isLoadingScreens || isLoadingGroups;

    return (
        <Dialog open={open} onOpenChange={handleClose}>
            <DialogContent className="max-w-2xl overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>Edit Screen Group</DialogTitle>
                    <DialogDescription>
                        Update group details and manage screen assignments.
                    </DialogDescription>
                </DialogHeader>

                {isLoading ? (
                    <div className="space-y-4 py-4">
                        <Skeleton className="h-10 w-full" />
                        <Skeleton className="h-10 w-full" />
                        <Skeleton className="h-32 w-full" />
                    </div>
                ) : (
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
                                <Label>Manage Screens</Label>
                                <Badge variant="secondary">
                                    {selectedScreenIds.length} selected
                                </Badge>
                            </div>
                            <p className="text-xs text-muted-foreground">
                                Select screens to include in this group
                            </p>

                            {availableScreens.length === 0 ? (
                                <Card className="p-8 text-center">
                                    <p className="text-muted-foreground">No screens available</p>
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
                )}

                <DialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
                    <Button
                        variant="destructive"
                        onClick={handleDelete}
                        disabled={deleteGroup.isPending || updateGroup.isPending}
                        className="w-full sm:mr-auto sm:w-auto"
                    >
                        <Trash2 className="h-4 w-4 mr-2" />
                        {deleteGroup.isPending ? "Deleting..." : "Delete Group"}
                    </Button>
                    <Button
                        variant="outline"
                        onClick={handleClose}
                        disabled={updateGroup.isPending || deleteGroup.isPending}
                    >
                        Cancel
                    </Button>
                    <Button
                        onClick={handleSubmit}
                        disabled={updateGroup.isPending || deleteGroup.isPending || !formState.name.trim()}
                    >
                        <Save className="h-4 w-4 mr-2" />
                        {updateGroup.isPending ? "Saving..." : "Save Changes"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
