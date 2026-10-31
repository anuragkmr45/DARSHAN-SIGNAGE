import { apiClient } from "../apiClient";
import { endpoints } from "../endpoints";
import type { PaginatedResponse, PaginationParams, User, UserManagementOptions } from "../types";

export interface InviteUserPayload {
  email: string;
  role_id: User["role_id"];
  department_id?: string;
}

export interface InviteUserResponse {
  email: string;
  invite_token: string;
  invite_expires_at: string;
}

export interface UserInvitation {
  id: string;
  email?: string;
  role?: User["role"] | null;
  department_id?: string | null;
  invited_at?: string | null;
  invite_expires_at?: string | null;
  invite_status?: string | null;
  can_replace?: boolean;
  is_active?: boolean;
  created_at?: string;
  updated_at?: string;
}

export type InvitationListParams = PaginationParams & {
  status?: string;
  email?: string;
  role?: "ADMIN" | "OPERATOR" | "DEPARTMENT";
  department_id?: string;
  invited_before?: string;
  invited_after?: string;
};

export interface CreateUserPayload {
  email: string;
  role_id: User["role_id"];
  department_id?: string;
  password?: string;
  first_name?: string;
  last_name?: string;
}

export type UpdateUserPayload = Partial<Omit<User, "role">> & { role_id?: User["role_id"] };

/** The edit forms' None choice must be sent as null, not omitted. */
export const departmentUpdateValue = (value?: string): string | null => value?.trim() || null;

const normalizePaginatedResponse = <T>(
  payload: PaginatedResponse<T> | { items?: T[]; pagination?: { page?: number; limit?: number; total?: number } },
  fallbackPage = 1,
  fallbackLimit = 10,
): PaginatedResponse<T> => {
  if ("page" in payload && "limit" in payload && "total" in payload) {
    return payload;
  }

  return {
    items: payload.items ?? [],
    page: payload.pagination?.page ?? fallbackPage,
    limit: payload.pagination?.limit ?? fallbackLimit,
    total: payload.pagination?.total ?? (payload.items?.length ?? 0),
  };
};

export const usersApi = {
  managementOptions: () => apiClient.request<UserManagementOptions>({
    path: endpoints.users.managementOptions,
    method: "GET",
  }),
  create: (payload: CreateUserPayload) =>
    apiClient.request<User>({
      path: endpoints.users.base,
      method: "POST",
      body: payload,
    }),

  invite: (payload: InviteUserPayload) =>
    apiClient.request<InviteUserResponse>({
      path: endpoints.users.invite,
      method: "POST",
      body: payload,
    }),

  replaceInvite: (inviteId: string, expectedUpdatedAt: string) =>
    apiClient.request<InviteUserResponse>({
      path: endpoints.users.replaceInvite(inviteId),
      method: "POST",
      body: { expected_updated_at: expectedUpdatedAt },
    }),

  listInvitations: (params?: InvitationListParams) =>
    apiClient
      .request<
        PaginatedResponse<UserInvitation> | { items?: UserInvitation[]; pagination?: { page?: number; limit?: number; total?: number } }
      >({
        path: endpoints.users.invite,
        method: "GET",
        query: params,
      })
      .then((response) => normalizePaginatedResponse(response, params?.page ?? 1, params?.limit ?? 10)),

  activate: (payload: { token: string; password: string }) =>
    apiClient.request<{ success: true; user_id: string }>({
      path: endpoints.users.activate,
      method: "POST",
      body: payload,
    }),

  resetPassword: (userId: string) =>
    apiClient.request<{ temp_password: string }>({
      path: endpoints.users.resetPassword(userId),
      method: "POST",
    }),

  list: (
    params?: PaginationParams & {
      role_id?: string;
      role?: string;
      department_id?: string;
      is_active?: boolean;
    },
  ) =>
    apiClient
      .request<PaginatedResponse<User> | { items?: User[]; pagination?: { page?: number; limit?: number; total?: number } }>({
        path: endpoints.users.base,
        method: "GET",
        query: params,
      })
      .then((response) => normalizePaginatedResponse(response, params?.page ?? 1, params?.limit ?? 10)),

  getById: (userId: string) =>
    apiClient.request<User>({
      path: endpoints.users.byId(userId),
      method: "GET",
    }),

  update: (userId: string, payload: UpdateUserPayload) =>
    apiClient.request<User>({
      path: endpoints.users.byId(userId),
      method: "PATCH",
      body: payload,
    }),

  remove: (userId: string) =>
    apiClient.request<void>({
      path: endpoints.users.byId(userId),
      method: "DELETE",
    }),
};
