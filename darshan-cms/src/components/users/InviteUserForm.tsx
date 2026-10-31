import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DialogFooter } from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Info, Loader2 } from "lucide-react";
import { usersApi } from "@/api/domains/users";
import { queryKeys } from "@/api/queryKeys";
import type { InviteFormData } from "@/types/user";
import { mapUsersErrorToUx } from "@/lib/usersErrors";
import { useAppSelector } from "@/store/hooks";
import { useAuthorization } from "@/hooks/useAuthorization";
import {
    canSubmitUserMutation,
    isManagementDepartmentSelectionValid,
} from "@/lib/userProposalAuthorization";

interface InviteUserFormProps {
    onSubmit: (data: InviteFormData) => void;
    onCancel: () => void;
    isLoading: boolean;
}

export function InviteUserForm({ onSubmit, onCancel, isLoading }: InviteUserFormProps) {
    const currentUser = useAppSelector((state) => state.auth.user);
    const { can, canRecord, isLoading: isAuthorizationLoading } = useAuthorization();
    const optionsQuery = useQuery({
        queryKey: queryKeys.userManagementOptions(currentUser?.id),
        queryFn: usersApi.managementOptions,
        enabled: Boolean(currentUser) && can("create", "User"),
    });
    const canPickDepartment = optionsQuery.data?.is_global_user_manager === true;
    const [formData, setFormData] = useState<InviteFormData>({
        email: "",
        role_id: "",
        department_id: !canPickDepartment ? currentUser?.department_id || "" : "",
    });

    const roles = useMemo(() => optionsQuery.data?.roles ?? [], [optionsQuery.data?.roles]);
    const rolesErrorMessage = optionsQuery.error ? mapUsersErrorToUx(optionsQuery.error, "Failed to load account options") : null;
    const isRolesLoading = optionsQuery.isLoading || isAuthorizationLoading;
    const isDepartmentsLoading = optionsQuery.isLoading;
    const currentDepartmentLabel = currentUser?.department_id ? "Assigned to your department" : "No department assigned";

    useEffect(() => {
        if (!formData.role_id && roles.length > 0) {
            setFormData((prev) => ({ ...prev, role_id: roles[0].id }));
        }
    }, [formData.role_id, roles]);

    const departments = optionsQuery.data?.departments ?? [];

    const updateField = (field: keyof InviteFormData, value: string) => {
        setFormData((prev) => ({ ...prev, [field]: value }));
    };

    const departmentSelectionValid = isManagementDepartmentSelectionValid(
        canPickDepartment,
        formData.department_id,
        departments,
    );
    const isValid = formData.email.trim() &&
        roles.some((role) => role.id === formData.role_id) &&
        departmentSelectionValid;
    const proposalAllowed = !isAuthorizationLoading && canSubmitUserMutation(canRecord, "create", null, {
        email: formData.email.trim(),
        role_id: formData.role_id,
        department_id: formData.department_id?.trim() || undefined,
        is_active: true,
    });

    const handleSubmit = () => {
        if (!isValid || !proposalAllowed) return;
        onSubmit(formData);
    };

    return (
        <div className="space-y-4 py-2">
            <Alert>
                <Info className="h-4 w-4" />
                <AlertDescription className="text-xs">
                    The activation link will be shown once after creation. Copy it and share it securely; no email is sent automatically.
                </AlertDescription>
            </Alert>

            <div className="space-y-2">
                <Label htmlFor="invite-email">Email</Label>
                <Input
                    id="invite-email"
                    type="email"
                    value={formData.email}
                    onChange={(e) => updateField("email", e.target.value)}
                    placeholder="user@example.com"
                />
            </div>

            <div className="space-y-2">
                <Label htmlFor="invite-role">Role</Label>
                {isRolesLoading ? (
                    <div className="flex items-center gap-2 p-2 border rounded-md">
                        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                        <span className="text-sm text-muted-foreground">Loading roles...</span>
                    </div>
                ) : rolesErrorMessage ? (
                    <Alert variant="destructive" className="py-2">
                        <Info className="h-4 w-4" />
                        <AlertDescription className="text-xs">{rolesErrorMessage.message}</AlertDescription>
                    </Alert>
                ) : roles.length === 0 ? (
                    <div className="p-2 border rounded-md text-sm text-muted-foreground">
                        No roles available
                    </div>
                ) : (
                    <Select
                        value={formData.role_id}
                        onValueChange={(value: string) => updateField("role_id", value)}
                    >
                        <SelectTrigger id="invite-role">
                            <SelectValue placeholder="Select role" />
                        </SelectTrigger>
                        <SelectContent>
                            {roles.map((role) => (
                                <SelectItem key={role.id} value={role.id}>
                                    {role.name}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                )}
            </div>

            <div className="space-y-2">
                <Label htmlFor="invite-department">Department (Optional)</Label>
                {!canPickDepartment ? (
                    <Input id="invite-department" value={currentDepartmentLabel} disabled />
                ) : isDepartmentsLoading ? (
                    <div className="flex items-center gap-2 p-2 border rounded-md">
                        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                        <span className="text-sm text-muted-foreground">Loading departments...</span>
                    </div>
                ) : departments.length === 0 ? (
                    <div className="p-2 border rounded-md text-sm text-muted-foreground">
                        No departments available
                    </div>
                ) : (
                    <Select
                        value={formData.department_id || "none"}
                        onValueChange={(value: string) => updateField("department_id", value === "none" ? "" : value)}
                        disabled={!canPickDepartment}
                    >
                        <SelectTrigger id="invite-department">
                            <SelectValue placeholder="Select department" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="none">None</SelectItem>
                            {departments.map((dept) => (
                                <SelectItem key={dept.id} value={dept.id}>
                                    {dept.name}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                )}
            </div>

            {optionsQuery.data && !departmentSelectionValid ? (
                <Alert variant="destructive">
                    <Info className="h-4 w-4" />
                    <AlertDescription>
                        {formData.department_id
                            ? "The selected department is no longer available for this invitation."
                            : "No permitted department is available for this invitation."}
                    </AlertDescription>
                </Alert>
            ) : null}

            {Boolean(isValid) && !isAuthorizationLoading && !proposalAllowed ? (
                <Alert variant="destructive">
                    <Info className="h-4 w-4" />
                    <AlertDescription>
                        These invitation details are outside your current permission scope.
                    </AlertDescription>
                </Alert>
            ) : null}

            <DialogFooter>
                <Button type="button" variant="outline" onClick={onCancel} disabled={isLoading}>
                    Cancel
                </Button>
                <Button onClick={handleSubmit} disabled={isLoading || isRolesLoading || !isValid || !proposalAllowed}>
                    {isLoading ? "Creating..." : "Create Invitation Link"}
                </Button>
            </DialogFooter>
        </div>
    );
}
