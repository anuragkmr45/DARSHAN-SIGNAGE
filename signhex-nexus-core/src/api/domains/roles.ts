import { apiClient } from "../apiClient";
import { endpoints } from "../endpoints";
import type { PaginatedResponse, PaginationParams, Role } from "../types";

export interface RoleListParams extends PaginationParams {
  search?: string;
}

export interface RolePayload {
  name: string;
  description?: string | null;
  permissions: Role["permissions"];
}

export const rolesApi = {
  list: (params?: RoleListParams) =>
    apiClient.request<PaginatedResponse<Role>>({
      path: endpoints.roles.base,
      method: "GET",
      query: params,
    }),

  create: (payload: RolePayload) =>
    apiClient.request<Role>({
      path: endpoints.roles.base,
      method: "POST",
      body: payload,
    }),

  getById: (roleId: string) =>
    apiClient.request<Role>({
      path: endpoints.roles.byId(roleId),
      method: "GET",
    }),

  update: (roleId: string, payload: RolePayload) =>
    apiClient.request<Role>({
      path: endpoints.roles.byId(roleId),
      method: "PUT",
      body: payload,
    }),

  remove: (roleId: string) =>
    apiClient.request<void>({
      path: endpoints.roles.byId(roleId),
      method: "DELETE",
    }),
};
