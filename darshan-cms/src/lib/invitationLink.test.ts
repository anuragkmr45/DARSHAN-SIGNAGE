import { describe, expect, it } from "vitest";
import { invitationActivationLink } from "./invitationLink";

describe("invitationActivationLink", () => {
  it("keeps the one-time token in a fragment, not the server request path", () => {
    const link = invitationActivationLink("https://cms.example.test", "a+b/c");
    const url = new URL(link);
    expect(url.pathname).toBe("/activate");
    expect(url.search).toBe("");
    expect(new URLSearchParams(url.hash.slice(1)).get("token")).toBe("a+b/c");
  });
});
