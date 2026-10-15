export function normalizeVideoLoopEnabled(mediaType: unknown, requested: unknown): boolean {
  return mediaType === 'VIDEO' && requested === true;
}
