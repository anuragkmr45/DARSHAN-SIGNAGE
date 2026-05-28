import { describe, expect, it } from "vitest";
import {
  formatBytes,
  formatPercent,
  getMachineRoleLabel,
  getMachineStatusTone,
  getServiceStatusTone,
} from "@/lib/observability";

describe("observability helpers", () => {
  it("formats bytes safely", () => {
    expect(formatBytes(undefined)).toBe("—");
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1024)).toBe("1.0 KB");
  });

  it("formats percentages safely", () => {
    expect(formatPercent(null)).toBe("—");
    expect(formatPercent(83.4)).toBe("83%");
    expect(formatPercent(83.44, 1)).toBe("83.4%");
  });

  it("maps machine and service tones", () => {
    expect(getMachineStatusTone("healthy")).toContain("emerald");
    expect(getMachineStatusTone("critical")).toContain("red");
    expect(getServiceStatusTone("up")).toContain("emerald");
    expect(getServiceStatusTone("down")).toContain("red");
  });

  it("maps machine roles to operator labels", () => {
    expect(getMachineRoleLabel("backend")).toBe("Server VM");
    expect(getMachineRoleLabel("cms")).toBe("CMS VM");
    expect(getMachineRoleLabel("development")).toBe("Development Host");
  });
});
