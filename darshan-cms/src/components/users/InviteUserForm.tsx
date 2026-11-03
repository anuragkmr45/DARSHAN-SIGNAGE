import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DialogFooter } from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Info, Loader2 } from "lucide-react";
import { departmentsApi } from "@/api/domains/departments";
import type { InviteFormData } from "@/types/user";
import { useRolesList } from "@/hooks/useRolesApi";
import { mapUsersErrorToUx } from "@/lib/usersErrors";
import { useAppSelector } from "@/store/hooks";
import { canAssignUserRole } from "@/lib/access";
import { useAuthorization } from "@/hooks/useAuthorization";
import { AdditionalDepartmentsPicker } from "@/components/users/AdditionalDepartmentsPicker";

interface InviteUserFormProps {
    onSubmit: (data: InviteFormData) => void;
    onCancel: () => void;
    isLoading: boolean;
}

export function InviteUserForm({ onSubmit, onCancel, isLoading }: InviteUserFormProps) {
    const currentUser = useAppSelector((state) => state.auth.user);
    const { can } = useAuthorization();
    const canManageUsersGlobally = can("manage", "User");
    const canPickDepartment = canManageUsersGlobally && can("read", "Department");
    const [formData, setFormData] = useState<InviteFormData>({
        email: "",
        role_id: "",
        department_id: !canPickDepartment ? currentUser?.department_id || "" : "",
        additional_department_ids: [],
    });

    const { data: departmentsData, isLoading: isDepartmentsLoading } = useQuery({
        queryKey: ["departments", "all"],
        queryFn: departmentsApi.listAll,
        enabled: canPickDepartment,
    });

    const { data: rolesData, isLoading: isRolesLoading, error: rolesError } = useRolesList();
    const roles = useMemo(
        () =>
            (rolesData?.items ?? []).filter((role) =>
                canAssignUserRole(currentUser, role, canManageUsersGlobally, formData.department_id),
            ),
        [canManageUsersGlobally, currentUser, formData.department_id, rolesData?.items],
    );
    const rolesErrorMessage = rolesError ? mapUsersErrorToUx(rolesError, "Failed to load roles") : null;
    const currentDepartmentLabel = currentUser?.department_id ? "Assigned to your department" : "No department assigned";

    useEffect(() => {
        if (!formData.role_id && roles.length > 0) {
            setFormData((prev) => ({ ...prev, role_id: roles[0].id }));
        }
    }, [formData.role_id, roles]);

    const departments = departmentsData || [];
    const isOperatorRole = roles.find((role) => role.id === formData.role_id)?.name === "OPERATOR";

    const handleSubmit = () => {
        onSubmit({
            ...formData,
            additional_department_ids: canManageUsersGlobally && isOperatorRole
                ? formData.additional_department_ids ?? [] : undefined,
        });
    };

    const updateField = (field: keyof InviteFormData, value: string) => {
        setFormData((prev) => ({ ...prev, [field]: value }));
    };

    const isValid = formData.email.trim() && Boolean(formData.role_id);

    return (
        <div className="space-y-4 py-2">
            <Alert>
                <Info className="h-4 w-4" />
                <AlertDescription className="text-xs">
                    DARSHAN will create a one-time activation code. Copy it after saving and share it through your approved channel. No email is sent.
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
                <Label htmlFor="invite-department">Primary department (optional)</Label>
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
                        onValueChange={(value: string) => setFormData((prev) => ({
                            ...prev,
                            department_id: value === "none" ? "" : value,
                            additional_department_ids: value === "none"
                                ? [] : (prev.additional_department_ids ?? []).filter((id) => id !== value),
                        }))}
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
                                    {dept.description && (
                                        <span className="text-xs text-muted-foreground ml-2">
                                            - {dept.description}
                                        </span>
                                    )}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                )}
            </div>

            {canPickDepartment && isOperatorRole ? (
                <AdditionalDepartmentsPicker
                    departments={departments}
                    primaryDepartmentId={formData.department_id ?? ""}
                    value={formData.additional_department_ids ?? []}
                    onChange={(ids) => setFormData((prev) => ({ ...prev, additional_department_ids: ids }))}
                    disabled={isLoading || isDepartmentsLoading}
                />
            ) : null}

            <DialogFooter>
                <Button type="button" variant="outline" onClick={onCancel} disabled={isLoading}>
                    Cancel
                </Button>
                <Button onClick={handleSubmit} disabled={isLoading || !isValid}>
                    {isLoading ? "Creating..." : "Create Invitation"}
                </Button>
            </DialogFooter>
        </div>
    );
}
