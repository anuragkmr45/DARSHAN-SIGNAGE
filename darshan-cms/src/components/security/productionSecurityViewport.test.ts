import { describe, expect, it } from "vitest";
import {
  DEVTOOLS_VIEWPORT_DELTA_THRESHOLD_PX,
  isLikelyDevtoolsViewportJump,
  lowerViewportBaseline,
  readViewportDelta,
} from "./productionSecurityViewport";

describe("production security viewport heuristic", () => {
  it("treats existing browser chrome as the ordinary baseline", () => {
    const baseline = { widthDelta: 44, heightDelta: 214 };

    expect(isLikelyDevtoolsViewportJump(baseline, baseline)).toBe(false);
  });

  it("ignores ordinary window resizes that preserve browser chrome deltas", () => {
    const before = readViewportDelta({
      outerWidth: 1440,
      innerWidth: 1396,
      outerHeight: 900,
      innerHeight: 686,
    });
    const after = readViewportDelta({
      outerWidth: 1180,
      innerWidth: 1136,
      outerHeight: 760,
      innerHeight: 546,
    });

    expect(after).toEqual(before);
    expect(isLikelyDevtoolsViewportJump(before, after)).toBe(false);
  });

  it("detects a later docked-tools viewport jump on either axis", () => {
    const baseline = { widthDelta: 44, heightDelta: 126 };
    const jump = DEVTOOLS_VIEWPORT_DELTA_THRESHOLD_PX + 1;

    expect(
      isLikelyDevtoolsViewportJump(baseline, {
        widthDelta: baseline.widthDelta + jump,
        heightDelta: baseline.heightDelta,
      }),
    ).toBe(true);
    expect(
      isLikelyDevtoolsViewportJump(baseline, {
        widthDelta: baseline.widthDelta,
        heightDelta: baseline.heightDelta + jump,
      }),
    ).toBe(true);
  });

  it("keeps the smallest observed browser-chrome baseline", () => {
    const initial = { widthDelta: 84, heightDelta: 214 };
    const afterStartupBannerCloses = { widthDelta: 44, heightDelta: 126 };
    const baseline = lowerViewportBaseline(initial, afterStartupBannerCloses);

    expect(baseline).toEqual(afterStartupBannerCloses);
    expect(
      isLikelyDevtoolsViewportJump(baseline, {
        widthDelta: baseline.widthDelta,
        heightDelta: baseline.heightDelta + DEVTOOLS_VIEWPORT_DELTA_THRESHOLD_PX + 1,
      }),
    ).toBe(true);
  });
});
