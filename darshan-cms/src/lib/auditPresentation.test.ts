import { describe, expect, it } from "vitest";
import { formatAuditAction, formatAuditResource } from "./auditPresentation";

describe("audit presentation", () => {
  it("turns recorded action codes into readable event labels", () => {
    expect(formatAuditAction("USER_DELETED", "User")).toBe("User deleted");
    expect(formatAuditAction("SCREEN_UPDATE", "Screen")).toBe("Screen updated");
    expect(formatAuditAction("DELETE", "Screen")).toBe("Screen deleted");
    expect(formatAuditAction("LIVE_SESSION_UPDATE", "LiveBroadcast")).toBe("Live broadcast updated");
  });

  it("keeps unfamiliar events readable without inventing a verb", () => {
    expect(formatAuditAction("PAIR_AGAIN", "Screen")).toBe("Pair again");
    expect(formatAuditAction(null, "Screen")).toBe("Recorded event");
    expect(formatAuditResource("LiveBroadcast")).toBe("Live broadcast");
  });
});
