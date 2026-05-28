import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DialogFooter } from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircle, Eye, EyeOff, Loader2 } from "lucide-react";
import { departmentsApi } from "@/api/domains/departments";
import type { User } from "@/api/types";
import type { UserFormData } from "@/types/user";
import { useRolesList } from "@/hooks/useRolesApi";
import { mapUsersErrorToUx } from "@/lib/usersErrors";
import { useAppSelector } from "@/store/hooks";
import { canManageUserTarget, isAdminLike } from "@/lib/access";

interface UserFormProps {
    user?: User | null;
    onSubmit: (data: UserFormData) => void;
    onCancel: () => void;
    isLoading: boolean;
}

export function UserForm({ user, onSubmit, onCancel, isLoading }: UserFormProps) {
    const currentUser = useAppSelector((state) => state.auth.user);
    const [showPassword, setShowPassword] = useState(false);
    const [formData, setFormData] = useState<UserFormData>({
        email: user?.email || "",
        password: "",
        first_name: user?.first_name || "",
        last_name: user?.last_name || "",
        role_id: user?.role_id || "",
        department_id: user?.department_id || "",
        is_active: user?.is_active ?? true,
    });

    const canPickDepartment = isAdminLike(currentUser?.role);
    const { data: departmentsData, isLoading: isDepartmentsLoading } = useQuery({
        queryKey: ["departments"],
        queryFn: () => departmentsApi.list({ page: 1, limit: 100 }),
        enabled: canPickDepartment,
    });

    const { data: rolesData, isLoading: isRolesLoading, error: rolesError } = useRolesList();
    const roles = useMemo(
        () =>
            (rolesData?.items ?? []).filter((role) =>
                canManageUserTarget(currentUser, role.name, currentUser?.department_id),
            ),
        [currentUser, rolesData?.items],
    );
    const rolesErrorMessage = rolesError ? mapUsersErrorToUx(rolesError, "Failed to load roles") : null;

    useEffect(() => {
        setFormData({
            email: user?.email || "",
            password: "",
            first_name: user?.first_name || "",
            last_name: user?.last_name || "",
            role_id: user?.role_id || "",
            department_id: currentUser?.role === "DEPARTMENT" ? currentUser.department_id || "" : user?.department_id || "",
            is_active: user?.is_active ?? true,
        });
    }, [currentUser?.department_id, currentUser?.role, user]);

    useEffect(() => {
        if (!formData.role_id && roles.length > 0) {
            setFormData((prev) => ({ ...prev, role_id: roles[0].id }));
        }
    }, [formData.role_id, roles]);

    const departments = departmentsData?.items || [];
    const currentDepartmentLabel = currentUser?.department_id ? "Assigned to your department" : "No department assigned";

    const handleSubmit = () => {
        onSubmit(formData);
    };

    const updateField = (field: keyof UserFormData, value: string | boolean) => {
        setFormData((prev) => ({ ...prev, [field]: value }));
    };

    const isValid =
        formData.email.trim() &&
        formData.first_name.trim() &&
        formData.last_name.trim() &&
        Boolean(formData.role_id);
    const requiresPassword = !user && !formData.password;

    // Password validation
    const validatePassword = (password: string) => {
        if (!password) return { valid: false, message: "" };

        const hasUpper = /[A-Z]/.test(password);
        const hasLower = /[a-z]/.test(password);
        const hasNumber = /[0-9]/.test(password);
        const hasSpecial = /[!@#$%^&*(),.?":{}|<>]/.test(password);
        const isLongEnough = password.length >= 8;

        const missing = [];
        if (!hasUpper) missing.push("uppercase letter");
        if (!hasLower) missing.push("lowercase letter");
        if (!hasNumber) missing.push("number");
        if (!hasSpecial) missing.push("special character");
        if (!isLongEnough) missing.push("at least 8 characters");

        return {
            valid: hasUpper && hasLower && hasNumber && hasSpecial && isLongEnough,
            message: missing.length > 0 ? `Missing: ${missing.join(", ")}` : ""
        };
    };

    const passwordValidation = !user ? validatePassword(formData.password || "") : { valid: true, message: "" };

    return (
        <div className="space-y-4 py-2">
            <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                    id="email"
                    type="email"
                    value={formData.email}
                    onChange={(e) => updateField("email", e.target.value)}
                    placeholder="user@example.com"
                />
            </div>

            {!user && (
                <div className="space-y-2">
                    <Label htmlFor="password">Password</Label>
                    <div className="relative">
                        <Input
                            id="password"
                            type={showPassword ? "text" : "password"}
                            value={formData.password || ""}
                            onChange={(e) => updateField("password", e.target.value)}
                            placeholder="Enter password (min 8 chars)"
                            className="pr-10"
                        />
                        <button
                            type="button"
                            onClick={() => setShowPassword(!showPassword)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                        >
                            {showPassword ? (
                                <EyeOff className="h-4 w-4" />
                            ) : (
                                <Eye className="h-4 w-4" />
                            )}
                        </button>
                    </div>
                    {formData.password && !passwordValidation.valid && (
                        <Alert variant="destructive" className="py-2">
                            <AlertCircle className="h-4 w-4" />
                            <AlertDescription className="text-xs">
                                {passwordValidation.message}
                            </AlertDescription>
                        </Alert>
                    )}
                    <p className="text-xs text-muted-foreground">
                        Must include: uppercase, lowercase, number, special character (!@#$%^&*), min 8 characters
                    </p>
                </div>
            )}

            <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                    <Label htmlFor="first_name">First Name</Label>
                    <Input
                        id="first_name"
                        value={formData.first_name}
                        onChange={(e) => updateField("first_name", e.target.value)}
                        placeholder="John"
                    />
                </div>

                <div className="space-y-2">
                    <Label htmlFor="last_name">Last Name</Label>
                    <Input
                        id="last_name"
                        value={formData.last_name}
                        onChange={(e) => updateField("last_name", e.target.value)}
                        placeholder="Doe"
                    />
                </div>
            </div>

            <div className="space-y-2">
                <Label htmlFor="role">Role</Label>
                {isRolesLoading ? (
                    <div className="flex items-center gap-2 p-2 border rounded-md">
                        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                        <span className="text-sm text-muted-foreground">Loading roles...</span>
                    </div>
                ) : rolesErrorMessage ? (
                    <Alert variant="destructive" className="py-2">
                        <AlertCircle className="h-4 w-4" />
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
                        <SelectTrigger id="role">
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
                <Label htmlFor="department_id">Department (Optional)</Label>
                {!canPickDepartment ? (
                    <Input id="department_id" value={currentDepartmentLabel} disabled />
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
                        <SelectTrigger id="department_id">
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

            <DialogFooter>
                <Button type="button" variant="outline" onClick={onCancel} disabled={isLoading}>
                    Cancel
                </Button>
                <Button
                    onClick={handleSubmit}
                    disabled={isLoading || !isValid || requiresPassword || (!user && !passwordValidation.valid)}
                >
                    {isLoading ? "Saving..." : user ? "Update User" : "Create User"}
                </Button>
            </DialogFooter>
        </div>
    );
}
