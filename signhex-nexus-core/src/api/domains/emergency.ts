import { apiClient } from "../apiClient";
import { endpoints } from "../endpoints";
import type { EmergencyStatus, PaginatedResponse, PaginationParams } from "../types";

export interface EmergencyTriggerPayload {
  emergency_type_id?: string;
  message?: string;
  severity?: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  media_id?: string;
  screen_ids?: string[];
  screen_group_ids?: string[];
  target_all?: boolean;
  expires_at?: string | null;
  audit_note?: string;
}

export const emergencyApi = {
  trigger: (payload: EmergencyTriggerPayload) =>
    apiClient.request<EmergencyStatus>({
      path: endpoints.emergency.trigger,
      method: "POST",
      body: payload,
    }),

  status: () =>
    apiClient.request<EmergencyStatus>({
      path: endpoints.emergency.status,
      method: "GET",
    }),

  clear: (emergencyId: string, payload?: { clear_reason?: string }) =>
    apiClient.request<EmergencyStatus["emergency"]>({
      path: endpoints.emergency.clear(emergencyId),
      method: "POST",
      body: payload,
    }),

  history: (params?: PaginationParams) =>
    apiClient.request<PaginatedResponse<EmergencyStatus>>({
      path: endpoints.emergency.history,
      method: "GET",
      query: params,
    }),
};
