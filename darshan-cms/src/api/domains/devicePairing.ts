import { apiClient } from "../apiClient";
import { endpoints } from "../endpoints";
import type {
  DevicePairing,
  DevicePairingRequest,
  PaginatedResponse,
  PaginationParams,
  PairingStatusResponse,
} from "../types";

export const devicePairingApi = {
  // Generate pairing code (for device setup)
  generate: (payload: { device_id?: string; expires_in?: number }) =>
    apiClient.request<DevicePairing>({
      path: endpoints.devicePairing.generate,
      method: "POST",
      body: payload,
    }),

  // Complete pairing (from device side with CSR)
  complete: (payload: { pairing_code: string; csr?: string }) =>
    apiClient.request<DevicePairing>({
      path: endpoints.devicePairing.complete,
      method: "POST",
      body: payload,
    }),

  // List all pairing records (for reviewing pending/used/expired codes)
  list: (params?: PaginationParams) =>
    apiClient.request<PaginatedResponse<DevicePairing>>({
      path: endpoints.devicePairing.base,
      method: "GET",
      query: params,
    }),

  status: (deviceId: string) =>
    apiClient.request<PairingStatusResponse>({
      path: endpoints.devicePairing.status,
      method: "GET",
      query: { device_id: deviceId },
    }),

  recovery: (deviceId: string) =>
    apiClient.request<{
      device_id: string;
      screen?: PairingStatusResponse["screen"];
      active_pairing?: PairingStatusResponse["active_pairing"];
      certificate?: PairingStatusResponse["certificate"];
      recovery?: {
        auth_state?: string;
        reason?: string;
        recommended_action?: string;
      };
    }>({
      path: endpoints.devicePairing.recovery(deviceId),
      method: "GET",
    }),

  startRecovery: (deviceId: string, payload?: { expires_in?: number }) =>
    apiClient.request<{
      id: string;
      pairing_code: string;
      expires_at: string;
      expires_in: number;
      recovery?: {
        mode?: "RECOVERY" | string | null;
        recommended_action?: string | null;
        device_id?: string;
        screen?: PairingStatusResponse["screen"];
      } | null;
    }>({
      path: endpoints.devicePairing.recovery(deviceId),
      method: "POST",
      body: payload,
    }),

  // Device pairing request (from screen device)
  request: (payload: DevicePairingRequest) =>
    apiClient.request<DevicePairing>({
      path: "/device-pairing/request",
      method: "POST",
      body: payload,
    }),

  // Confirm pairing (from CMS)
  confirm: (payload: { pairing_code: string; name: string; location?: string }) =>
    apiClient.request<{ message: string; pairing: DevicePairing; recovery?: DevicePairing["recovery"] }>({
      path: "/device-pairing/confirm",
      method: "POST",
      body: payload,
    }),
};
