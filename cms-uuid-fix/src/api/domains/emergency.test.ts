import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { apiClient } from "@/api/apiClient";
import { emergencyApi } from "@/api/domains/emergency";
import * as uuid from "@/lib/uuid";

vi.mock("@/api/apiClient", () => ({
  apiClient: { request: vi.fn() },
}));

const requestMock = vi.mocked(apiClient.request);
const uuidV4Pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("emergency trigger idempotency", () => {
  beforeEach(() => {
    requestMock.mockReset();
    requestMock.mockResolvedValue({});
    vi.stubGlobal("crypto", {
      getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto),
    });
    vi.spyOn(uuid, "createUuid");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  test("uses the shared helper for fresh UUID v4 keys without native randomUUID", async () => {
    expect(globalThis.crypto.randomUUID).toBeUndefined();
    const payload = { message: "Test advisory", target_all: true };

    await emergencyApi.trigger(payload);
    await emergencyApi.trigger(payload);

    expect(uuid.createUuid).toHaveBeenCalledTimes(2);
    expect(requestMock).toHaveBeenCalledWith({
      path: "/emergency/trigger",
      method: "POST",
      body: payload,
      headers: { "Idempotency-Key": expect.stringMatching(uuidV4Pattern) },
    });
    const keys = requestMock.mock.calls.map(([request]) => request.headers?.["Idempotency-Key"]);
    expect(keys[0]).not.toBe(keys[1]);
  });

  test("preserves an explicit operation key across retries without generating another", async () => {
    const payload = { message: "Test advisory", target_all: true };
    const operationKey = "77777777-7777-4777-8777-777777777777";

    await emergencyApi.trigger(payload, operationKey);
    await emergencyApi.trigger(payload, operationKey);

    expect(uuid.createUuid).not.toHaveBeenCalled();
    expect(requestMock).toHaveBeenCalledTimes(2);
    for (const [request] of requestMock.mock.calls) {
      expect(request.headers?.["Idempotency-Key"]).toBe(operationKey);
    }
  });
});
