import { z } from 'zod';

const capabilityName = z.string().trim().min(1).max(128);
/** Additive capability contract shared by device HELLO and signed REST
 * heartbeats. Existing HELLO normalization/limits remain unchanged. */
export const playerCapabilitiesSchema = z.object({
  commands: z.array(capabilityName).max(64).optional(),
  features: z.array(capabilityName).max(64).optional(),
  screenshot: z.boolean().optional(),
  log_upload: z.boolean().optional(),
  offline_startup: z.boolean().optional(),
  background_push: z.boolean().optional(),
});
