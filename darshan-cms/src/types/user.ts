import type { RoleId } from "@/api/types";

export interface UserFormData {
    email: string;
    password?: string;
    first_name: string;
    last_name: string;
    role_id: RoleId;
    department_id?: string;
    is_active?: boolean;
}

export interface InviteFormData {
    email: string;
    role_id: RoleId;
    department_id?: string;
}
