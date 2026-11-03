import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
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
import { screensApi } from "@/api/domains/screens";
import { queryKeys } from "@/api/queryKeys";
import { useSafeMutation } from "@/hooks/useSafeMutation";
import { toast } from "sonner";
import { GroupScreenPicker } from "./GroupScreenPicker";

interface CreateGroupModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    canReadGroups: boolean;
}

export function CreateGroupModal({ open, onOpenChange, canReadGroups }: CreateGroupModalProps) {
    const queryClient = useQueryClient();
    const [formState, setFormState] = useState({
        name: "",
        description: "",
    });
    const [selectedScreenIds, setSelectedScreenIds] = useState<string[]>([]);
    const [pickerReady, setPickerReady] = useState(!canReadGroups);

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

    const handleSubmit = () => {
        const payload = {
            name: formState.name.trim(),
            description: formState.description.trim() || undefined,
            screen_ids: selectedScreenIds.length > 0 ? selectedScreenIds : undefined,
        };
        createGroup.mutate(payload);
    };

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

                    <GroupScreenPicker open={open} enabled={canReadGroups}
                        selectedScreenIds={selectedScreenIds} onChange={setSelectedScreenIds}
                        onReadyChange={setPickerReady} />
                </div>

                <DialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                    <Button variant="outline" onClick={handleClose} disabled={createGroup.isPending}>
                        Cancel
                    </Button>
                    <Button
                        onClick={handleSubmit}
                        disabled={createGroup.isPending || !formState.name.trim() || !pickerReady}
                    >
                        <Plus className="h-4 w-4 mr-2" />
                        {createGroup.isPending ? "Creating..." : "Create Group"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
