import { describe, expect, it } from "vitest";
import { isDifferentAuthenticatedUser } from "./authIdentity";

describe("refreshed authentication identity", () => {
  it("fails closed only when two known authenticated identities differ", () => {
    expect(isDifferentAuthenticatedUser("user-a", "user-b")).toBe(true);
    expect(isDifferentAuthenticatedUser("user-a", "user-a")).toBe(false);
    expect(isDifferentAuthenticatedUser("user-a", undefined)).toBe(false);
    expect(isDifferentAuthenticatedUser(undefined, "user-b")).toBe(false);
  });
});
