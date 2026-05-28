import { apiClient } from "../apiClient";
import { endpoints } from "../endpoints";
import type { DeviceCommand } from "../types";

export const deviceTelemetryApi = {
  heartbeat: (payload: Record<string, unknown>) =>
    apiClient.request<void>({
      path: endpoints.deviceTelemetry.heartbeat,
      method: "POST",
      body: payload,
    }),

  proofOfPlay: (payload: Record<string, unknown>) =>
    apiClient.request<void>({
      path: endpoints.deviceTelemetry.proofOfPlay,
      method: "POST",
      body: payload,
    }),

  screenshot: (payload: { device_id: string; image: string }) =>
    apiClient.request<void>({
      path: endpoints.deviceTelemetry.screenshot,
      method: "POST",
      body: payload,
    }),

  listCommands: (deviceId: string) =>
    apiClient.request<DeviceCommand[]>({
      path: endpoints.deviceTelemetry.commands(deviceId),
      method: "GET",
    }),

  ackCommand: (deviceId: string, commandId: string) =>
    apiClient.request<void>({
      path: endpoints.deviceTelemetry.ackCommand(deviceId, commandId),
      method: "POST",
    }),
};
