import { apiClient } from "../apiClient";
import { endpoints } from "../endpoints";
import type {
  ScheduleReservationPreviewPayload,
  ScheduleReservationPreviewResponse,
} from "../types";

export const scheduleReservationsApi = {
  preview: (payload: ScheduleReservationPreviewPayload) =>
    apiClient.request<ScheduleReservationPreviewResponse>({
      path: endpoints.scheduleReservations.preview,
      method: "POST",
      body: payload,
    }),
};
