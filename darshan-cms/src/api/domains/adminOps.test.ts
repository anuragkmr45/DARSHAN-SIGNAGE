import { beforeEach, describe, expect, it, vi } from "vitest";

const requestMock = vi.fn();

vi.mock("@/api/apiClient", () => ({
  apiClient: {
    request: requestMock,
  },
}));

describe("admin ops domain clients", () => {
  beforeEach(() => {
    requestMock.mockReset();
  });

  it("unwraps the API key list envelope for the page layer", async () => {
    requestMock.mockResolvedValue({
      items: [{ id: "key-1", name: "Primary key" }],
      page: 1,
      limit: 100,
      total: 1,
    });

    const { apiKeysApi } = await import("@/api/domains/apiKeys");
    await expect(apiKeysApi.list()).resolves.toEqual([{ id: "key-1", name: "Primary key" }]);
  });

  it("unwraps webhook list responses into an array", async () => {
    requestMock.mockResolvedValue({
      items: [{ id: "hook-1", name: "Deploy hook", target_url: "https://example.test" }],
    });

    const { webhooksApi } = await import("@/api/domains/webhooks");
    await expect(webhooksApi.list()).resolves.toEqual([
      { id: "hook-1", name: "Deploy hook", target_url: "https://example.test" },
    ]);
  });

  it("returns the active SSO config instead of the raw list envelope", async () => {
    requestMock.mockResolvedValue({
      items: [{ id: "sso-1", provider: "oidc", issuer: "https://issuer.example.test", client_id: "cms" }],
    });

    const { ssoApi } = await import("@/api/domains/ssoConfig");
    await expect(ssoApi.getActive()).resolves.toEqual({
      id: "sso-1",
      provider: "oidc",
      issuer: "https://issuer.example.test",
      client_id: "cms",
    });
  });
});
