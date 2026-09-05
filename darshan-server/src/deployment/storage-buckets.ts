/**
 * Complete set of object-storage buckets required by a production runtime.
 *
 * Keep this list side-effect free so bootstrap, readiness, tests and future
 * deployment tooling can share the same authority without accidentally
 * initialising storage clients during import.
 */
export const PRODUCTION_BUCKETS = [
  'media-source',
  'media-staging',
  'media-ready',
  'media-thumbnails',
  'device-screenshots',
  'logs-audit',
  'logs-system',
  'logs-auth',
  'logs-heartbeats',
  'logs-proof-of-play',
  'archives',
] as const;

export type ProductionBucket = (typeof PRODUCTION_BUCKETS)[number];
