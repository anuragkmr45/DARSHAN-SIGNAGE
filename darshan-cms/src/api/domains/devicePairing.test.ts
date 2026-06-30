import { beforeEach, describe, expect, it, vi } from "vitest";

const requestMock = vi.fn();

vi.mock("@/api/apiClient", () => ({
  apiClient: {
    request: requestMock,
  },
}));

describe("device pairing domain client", () => {
  beforeEach(() => {
    requestMock.mockReset();
  });

  it("requests the Pairing Health orphan report with a bounded limit", async () => {
    requestMock.mockResolvedValue({
      counts: {
        device_certificates: 0,
        device_pairings: 0,
        heartbeats: 0,
        device_commands: 0,
        duplicate_identity_conflicts: 0,
      },
      orphans: {
        device_certificates: [],
        device_pairings: [],
        heartbeats: [],
        device_commands: [],
      },
      duplicate_identity: {
        conflicts: [],
      },
    });

    const { devicePairingApi } = await import("@/api/domains/devicePairing");
    await devicePairingApi.orphans({ limit: 25 });

    expect(requestMock).toHaveBeenCalledWith({
      path: "/device-pairing/orphans",
      method: "GET",
      query: { limit: 25 },
    });
  });

  it("routes duplicate/orphan revoke actions through the admin revoke endpoint", async () => {
    requestMock.mockResolvedValue({
      device_id: "11111111-1111-4111-8111-111111111111",
      status: "PAIRING_REVOKED",
      revoked_certificates: 1,
      invalidated_pairings: 1,
      recommended_action: "PAIR_AGAIN",
    });

    const { devicePairingApi } = await import("@/api/domains/devicePairing");
    await devicePairingApi.revoke("11111111-1111-4111-8111-111111111111", {
      reason: "DUPLICATE_IDENTITY_CONFLICT",
      note: "operator verified copied app data",
    });

    expect(requestMock).toHaveBeenCalledWith({
      path: "/device-pairing/11111111-1111-4111-8111-111111111111/revoke",
      method: "POST",
      body: {
        reason: "DUPLICATE_IDENTITY_CONFLICT",
        note: "operator verified copied app data",
      },
    });
  });
});
