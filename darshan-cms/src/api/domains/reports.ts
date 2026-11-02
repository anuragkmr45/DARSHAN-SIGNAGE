import { apiClient } from "../apiClient";
import { endpoints } from "../endpoints";
import type {
  OfflineScreensReport,
  AvailabilityReport,
  ReportSummary,
  ScheduleActivityReport,
  StorageReport,
  SystemHealthReport,
} from "../types";

export const reportsApi = {
  getSummary: () =>
    apiClient.request<ReportSummary>({
      path: endpoints.reports.summary,
      method: "GET",
    }),

  getAvailability: (days: number) =>
    apiClient.request<AvailabilityReport>({
      path: endpoints.reports.availability,
      method: "GET",
      query: { days },
    }),

  getScheduleActivity: (params?: { days?: number }) =>
    apiClient.request<ScheduleActivityReport>({
      path: endpoints.reports.schedules,
      method: "GET",
      query: params,
    }),

  getTrends: () =>
    apiClient.request<Record<string, unknown>>({
      path: endpoints.reports.trends,
      method: "GET",
    }),

  getOfflineScreens: () =>
    apiClient.request<OfflineScreensReport>({
      path: endpoints.reports.offlineScreens,
      method: "GET",
    }),

  getStorageReport: () =>
    apiClient.request<StorageReport>({
      path: endpoints.reports.storage,
      method: "GET",
    }),

  getSystemHealth: () =>
    apiClient.request<SystemHealthReport>({
      path: endpoints.reports.systemHealth,
      method: "GET",
    }),

  exportPdf: () =>
    apiClient.request<Blob>({
      path: endpoints.reports.export,
      method: "GET",
      responseType: "blob",
      headers: { Accept: "application/pdf" },
    }),
};
