import { apiClient } from "../apiClient";
import { endpoints } from "../endpoints";
import type { AuditLog, PaginatedResponse, PaginationParams } from "../types";

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

export const auditLogsApi = {
  list: (
    params?: PaginationParams & {
      user_id?: string;
      resource_type?: string;
      action?: string;
      start_date?: string;
      end_date?: string;
    },
  ) =>
    apiClient
      .request<
        PaginatedResponse<AuditLog> | { items?: AuditLog[]; pagination?: { page?: number; limit?: number; total?: number } }
      >({
        path: endpoints.auditLogs.base,
        method: "GET",
        query: params,
      })
      .then((response) => normalizePaginatedResponse(response, params?.page ?? 1, params?.limit ?? 10)),

  getById: (auditLogId: string) =>
    apiClient.request<AuditLog>({
      path: endpoints.auditLogs.byId(auditLogId),
      method: "GET",
    }),

  exportPdf: (
    params?: PaginationParams & {
      user_id?: string;
      resource_type?: string;
      action?: string;
      start_date?: string;
      end_date?: string;
    },
  ) =>
    apiClient.request<Blob>({
      path: endpoints.auditLogs.export,
      method: "GET",
      query: params,
      responseType: "blob",
      headers: { Accept: "application/pdf" },
    }),
};
