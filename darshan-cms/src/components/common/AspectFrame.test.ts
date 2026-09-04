import { describe, expect, it } from "vitest";
import { canonicalAspectRatio, parseAspectRatio } from "./aspectRatio";

describe("AspectFrame ratio parsing", () => {
  it("supports arbitrary reduced and decimal ratios", () => {
    expect(parseAspectRatio("24:10")).toBe(2.4);
    expect(parseAspectRatio("4.5:1.5")).toBe(3);
    expect(canonicalAspectRatio("24:10")).toBe("12:5");
  });

  it("rejects invalid or non-positive ratios", () => {
    expect(parseAspectRatio("16x9")).toBeNull();
    expect(parseAspectRatio("0:9")).toBeNull();
  });
});
