export function parseAspectRatio(value?: string | null): number | null {
  if (!value) return null;
  const match = /^\s*(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)\s*$/.exec(value);
  if (!match) return null;
  const width = Number(match[1]);
  const height = Number(match[2]);
  return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0 ? width / height : null;
}

export function canonicalAspectRatio(value?: string | null): string | null {
  const ratio = parseAspectRatio(value);
  if (!ratio || !value) return null;
  const [rawWidth, rawHeight] = value.split(":").map((part) => Number(part.trim()));
  if (!Number.isInteger(rawWidth) || !Number.isInteger(rawHeight)) return `${ratio}`;
  const greatestCommonDivisor = (left: number, right: number): number =>
    right ? greatestCommonDivisor(right, left % right) : left;
  const divisor = greatestCommonDivisor(Math.abs(rawWidth), Math.abs(rawHeight)) || 1;
  return `${rawWidth / divisor}:${rawHeight / divisor}`;
}
