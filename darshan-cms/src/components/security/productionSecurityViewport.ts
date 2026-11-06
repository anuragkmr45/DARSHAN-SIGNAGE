export const DEVTOOLS_VIEWPORT_DELTA_THRESHOLD_PX = 160;

export type ViewportDelta = {
  widthDelta: number;
  heightDelta: number;
};

type ViewportLike = Pick<Window, "outerWidth" | "innerWidth" | "outerHeight" | "innerHeight">;

export const readViewportDelta = (viewport: ViewportLike): ViewportDelta => ({
  widthDelta: Math.abs(viewport.outerWidth - viewport.innerWidth),
  heightDelta: Math.abs(viewport.outerHeight - viewport.innerHeight),
});

export const lowerViewportBaseline = (
  baseline: ViewportDelta,
  current: ViewportDelta,
): ViewportDelta => ({
  widthDelta: Math.min(baseline.widthDelta, current.widthDelta),
  heightDelta: Math.min(baseline.heightDelta, current.heightDelta),
});

export const isLikelyDevtoolsViewportJump = (
  baseline: ViewportDelta,
  current: ViewportDelta,
): boolean =>
  current.widthDelta - baseline.widthDelta > DEVTOOLS_VIEWPORT_DELTA_THRESHOLD_PX ||
  current.heightDelta - baseline.heightDelta > DEVTOOLS_VIEWPORT_DELTA_THRESHOLD_PX;
