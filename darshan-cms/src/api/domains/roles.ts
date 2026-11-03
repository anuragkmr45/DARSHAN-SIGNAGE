import { apiClient } from "../apiClient";
import { endpoints } from "../endpoints";
import type { PaginatedApiResponse, PaginatedResponse, PaginationParams, Role } from "../types";

export interface RoleListParams extends PaginationParams {
  search?: string;
}

export interface RolePayload {
  name: string;
  description?: string | null;
  permissions: Role["permissions"];
}

export const rolesApi = {
  list: async (params?: RoleListParams, signal?: AbortSignal): Promise<PaginatedResponse<Role>> => {
    const response = await apiClient.request<PaginatedApiResponse<Role> | PaginatedResponse<Role>>({
      path: endpoints.roles.base,
      method: "GET",
      query: params,
      signal,
    });
    const pagination = "pagination" in response ? response.pagination : response;
    return { items: response.items, page: pagination.page, limit: pagination.limit, total: pagination.total };
  },

  listAll: async (signal?: AbortSignal): Promise<PaginatedResponse<Role>> => {
    const items: Role[] = [];
    const seen = new Set<string>();
    for (let page = 1; page <= 100; page += 1) {
      const result = await rolesApi.list({ page, limit: 100 }, signal);
      const previousCount = items.length;
      for (const role of result.items) {
        if (seen.has(role.id)) continue;
        seen.add(role.id);
        items.push(role);
      }
      if (items.length >= result.total) return { items, page: 1, limit: items.length, total: items.length };
      if (result.items.length < 100 || items.length === previousCount) break;
    }
    throw new Error("The complete role list could not be loaded. Refresh and try again.");
  },

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
