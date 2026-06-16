import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "./apiClient";
import { resetCmsRuntimeConfigForTests, setCmsRuntimeConfigForTests } from "@/config/runtimeConfig";

const runtimeConfig = {
  source: "runtime-config" as const,
  environment: {
    name: "onprem-qa",
    deploymentId: "qa-lab-1",
    cmsId: "cms-a",
  },
  api: {
    baseUrl: "https://runtime-api.cms.test",
  },
  realtime: {
    socketBaseUrl: "https://runtime-ws.cms.test",
    socketTransports: ["websocket" as const],
  },
  diagnostics: {
    showEnvironmentIdentity: true,
  },
};

describe("ApiClient runtime config", () => {
  afterEach(() => {
    resetCmsRuntimeConfigForTests();
    vi.unstubAllGlobals();
  });

  it("resolves the API base URL at request time from runtime config", async () => {
    setCmsRuntimeConfigForTests(runtimeConfig);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: {
        get: vi.fn(() => "application/json"),
      },
      json: vi.fn().mockResolvedValue({ success: true }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new ApiClient();
    await client.request<{ success: boolean }>({ path: "/screens", method: "GET" });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://runtime-api.cms.test/api/v1/screens",
      expect.objectContaining({
        method: "GET",
        credentials: "include",
      }),
    );
  });
});
