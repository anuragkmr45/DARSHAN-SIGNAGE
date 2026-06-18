import { apiClient } from "../apiClient";
import { endpoints } from "../endpoints";
import type { Department, PaginatedResponse, PaginationParams } from "../types";

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

export const departmentsApi = {
  list: (params?: PaginationParams) =>
    apiClient
      .request<
        PaginatedResponse<Department> | { items?: Department[]; pagination?: { page?: number; limit?: number; total?: number } }
      >({
        path: endpoints.departments.base,
        method: "GET",
        query: params,
      })
      .then((response) => normalizePaginatedResponse(response, params?.page ?? 1, params?.limit ?? 10)),

  create: (payload: { name: string; description?: string }) =>
    apiClient.request<Department>({
      path: endpoints.departments.base,
      method: "POST",
      body: payload,
    }),

  getById: (id: string) =>
    apiClient.request<Department>({
      path: endpoints.departments.byId(id),
      method: "GET",
    }),

  update: (id: string, payload: Partial<{ name: string; description?: string }>) =>
    apiClient.request<Department>({
      path: endpoints.departments.byId(id),
      method: "PATCH",
      body: payload,
    }),

  remove: (id: string) =>
    apiClient.request<void>({
      path: endpoints.departments.byId(id),
      method: "DELETE",
    }),
};
