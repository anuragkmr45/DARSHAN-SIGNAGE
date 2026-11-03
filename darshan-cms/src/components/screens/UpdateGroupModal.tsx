import { useState, useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Save, Trash2 } from "lucide-react";
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
import { Skeleton } from "@/components/ui/skeleton";
import { screensApi } from "@/api/domains/screens";
import { queryKeys } from "@/api/queryKeys";
import { useSafeMutation } from "@/hooks/useSafeMutation";
import { toast } from "sonner";
import { screenDeletionBlockers } from "./screenDeletionBlockers";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { GroupScreenPicker } from "./GroupScreenPicker";

interface UpdateGroupModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    groupId: string;
    canDelete: boolean;
}

export function UpdateGroupModal({ open, onOpenChange, groupId, canDelete }: UpdateGroupModalProps) {
    const queryClient = useQueryClient();
    const [formState, setFormState] = useState({
        name: "",
        description: "",
    });
    const [selectedScreenIds, setSelectedScreenIds] = useState<string[]>([]);
    const [pickerReady, setPickerReady] = useState(false);
    const initializedGroupId = useRef<string | null>(null);
    const [confirmGroupDelete, setConfirmGroupDelete] = useState(false);
    const [deleteBlockers, setDeleteBlockers] = useState<string[]>([]);

    const { data: groupData, isLoading: isLoadingGroup, isFetching: isFetchingGroup, isError: isGroupError, refetch: refetchGroup } = useQuery({
        queryKey: ["screen-group", groupId],
        queryFn: () => screensApi.getGroupById(groupId),
        enabled: open && !!groupId,
    });

    useEffect(() => {
        if (open && groupData && !isFetchingGroup && initializedGroupId.current !== groupId) {
            setFormState({
                name: groupData.name || "",
                description: groupData.description || "",
            });
            setSelectedScreenIds(groupData.screen_ids || []);
            initializedGroupId.current = groupId;
        }
    }, [groupData, groupId, isFetchingGroup, open]);

    const updateGroup = useSafeMutation({
        mutationFn: (payload: {
            name: string;
            description?: string;
            screen_ids?: string[]
        }) => screensApi.updateGroup(groupId, payload),
        onSuccess: () => {
            setConfirmGroupDelete(false);
            setDeleteBlockers([]);
            queryClient.invalidateQueries({ queryKey: queryKeys.screenGroups });
            queryClient.invalidateQueries({ queryKey: queryKeys.screens });
            queryClient.invalidateQueries({ queryKey: queryKeys.screensOverview({ includeMedia: true }) });
            queryClient.invalidateQueries({ queryKey: ["screen-group", groupId] });
            toast.success("Group updated successfully");
            handleClose();
        },
        onError: (error) => setDeleteBlockers(screenDeletionBlockers(error)),
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
        onError: (error) => setDeleteBlockers(screenDeletionBlockers(error)),
    }, "Unable to delete group.");

    const handleClose = () => {
        initializedGroupId.current = null;
        setConfirmGroupDelete(false);
        setDeleteBlockers([]);
        setFormState({ name: "", description: "" });
        setSelectedScreenIds([]);
        onOpenChange(false);
    };

    const handleSubmit = () => {
        const payload = {
            name: formState.name.trim(),
            description: formState.description.trim() || undefined,
            screen_ids: selectedScreenIds,
        };
        updateGroup.mutate(payload);
    };

    const handleDelete = () => {
        setDeleteBlockers([]);
        setConfirmGroupDelete(true);
    };

    const isLoading = isLoadingGroup || (!isGroupError && initializedGroupId.current !== groupId);

    return (
      <>
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
                ) : isGroupError || !groupData ? (
                    <div role="alert" className="flex items-center gap-3 py-4 text-sm text-destructive">
                        Screen Group details are unavailable.
                        <Button variant="outline" size="sm" onClick={() => void refetchGroup()}>Retry</Button>
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

                        <GroupScreenPicker open={open && Boolean(groupData)} groupId={groupId}
                            enabled={Boolean(groupData)} selectedScreenIds={selectedScreenIds}
                            onChange={setSelectedScreenIds} onReadyChange={setPickerReady} />
                    </div>
                )}

                <DialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
                    {canDelete ? <Button
                        variant="destructive"
                        onClick={handleDelete}
                        disabled={deleteGroup.isPending || updateGroup.isPending}
                        className="w-full sm:mr-auto sm:w-auto"
                    >
                        <Trash2 className="h-4 w-4 mr-2" />
                        {deleteGroup.isPending ? "Deleting..." : "Delete Group"}
                    </Button> : null}
                    <Button
                        variant="outline"
                        onClick={handleClose}
                        disabled={updateGroup.isPending || deleteGroup.isPending}
                    >
                        Cancel
                    </Button>
                    <Button
                        onClick={handleSubmit}
                        disabled={updateGroup.isPending || deleteGroup.isPending || isGroupError || !groupData || !formState.name.trim() || !pickerReady}
                    >
                        <Save className="h-4 w-4 mr-2" />
                        {updateGroup.isPending ? "Saving..." : "Save Changes"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
        <ConfirmDialog
          open={canDelete && confirmGroupDelete}
          title={`Delete ${groupData?.name ?? "group"}?`}
          description="Delete is allowed only after current and future references are removed. The server checks again when you confirm."
          confirmLabel="Delete Group"
          onConfirm={() => deleteGroup.mutate()}
          onCancel={() => { if (!deleteGroup.isPending) { setConfirmGroupDelete(false); setDeleteBlockers([]); } }}
          isLoading={deleteGroup.isPending}
        >
          {deleteBlockers.length > 0 && (
            <div role="alert" className="rounded-md border border-destructive/40 p-3 text-sm">
              <p className="font-medium">Remove these references, then retry:</p>
              <ul className="list-disc pl-5">{deleteBlockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul>
            </div>
          )}
        </ConfirmDialog>
      </>
    );
}
