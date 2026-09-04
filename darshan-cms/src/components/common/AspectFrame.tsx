import type { CSSProperties, PropsWithChildren } from "react";
import { parseAspectRatio } from "./aspectRatio";

export function AspectFrame({
  aspectRatio,
  className,
  children,
  style,
}: PropsWithChildren<{ aspectRatio?: string | null; className?: string; style?: CSSProperties }>) {
  const ratio = parseAspectRatio(aspectRatio) ?? 16 / 9;
  return (
    <div className={className} style={{ aspectRatio: String(ratio), ...style }}>
      {children}
    </div>
  );
}
