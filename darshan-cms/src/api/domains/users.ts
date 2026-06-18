import { apiClient } from "../apiClient";
import { endpoints } from "../endpoints";
import type { PaginatedResponse, PaginationParams, User } from "../types";

export interface InviteUserPayload {
  email: string;
  role_id: User["role_id"];
  department_id?: string;
}

export interface UserInvitation {
  id: string;
  email?: string;
  role_id?: User["role_id"];
  role?: User["role"];
  invited_at?: string;
  expires_at?: string;
  status?: string;
}

export interface CreateUserPayload {
  email: string;
  role_id: User["role_id"];
  department_id?: string;
  password?: string;
  first_name?: string;
  last_name?: string;
}

export type UpdateUserPayload = Partial<Omit<User, "role">> & { role_id?: User["role_id"] };

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
  create: (payload: CreateUserPayload) =>
    apiClient.request<User>({
      path: endpoints.users.base,
      method: "POST",
      body: payload,
    }),

  invite: (payload: InviteUserPayload) =>
    apiClient.request<{ invite_token: string; invite_expires_at?: string; temp_password: string }>({
      path: endpoints.users.invite,
      method: "POST",
      body: payload,
    }),

  listInvitations: (
    params?: PaginationParams & { status?: string; email?: string; invited_after?: string; role_id?: string },
  ) =>
    apiClient
      .request<
        PaginatedResponse<UserInvitation> | { items?: UserInvitation[]; pagination?: { page?: number; limit?: number; total?: number } }
      >({
        path: endpoints.users.invite,
        method: "GET",
        query: params,
      })
      .then((response) => normalizePaginatedResponse(response, params?.page ?? 1, params?.limit ?? 10)),

  activate: (payload: { token: string; password: string; role_id?: User["role_id"] }) =>
    apiClient.request<void>({
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
