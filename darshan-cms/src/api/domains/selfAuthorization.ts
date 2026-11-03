import { z } from 'zod';
import { apiClient, ApiError } from '../apiClient';
import { endpoints } from '../endpoints';

export interface VisibilityCapability { action: string; subject: string }
export interface SelfAuthorization { version: 1; user_id: string; role: { id: string; name: string }; department_id: string | null; department_ids: string[]; capabilities: VisibilityCapability[] }
const uuid = z.string().uuid().transform(value => value.toLowerCase());
const schema = z.object({ version: z.literal(1), user_id: uuid, role: z.object({ id: uuid, name: z.string().min(1).max(100) }).strict(),
  department_id: uuid.nullable(), department_ids: z.array(uuid), capabilities: z.array(z.object({ action: z.string().min(1).max(100), subject: z.string().min(1).max(100) }).strict()) }).strict();
export async function getSelfAuthorization(userId: string, signal?: AbortSignal): Promise<SelfAuthorization> {
  const result = schema.safeParse(await apiClient.request({ path: endpoints.auth.authorization, method: 'GET', signal }));
  if (!result.success || result.data.user_id !== userId.toLowerCase()) throw new ApiError({ status: 502, code: 'AUTHORIZATION_RESPONSE_INVALID', message: 'Your current permissions could not be verified. Sign in again or retry.' });
  return result.data as SelfAuthorization;
}
/** Exact server-evaluated visibility pairs. Do not reinterpret conditions or
 * expand wildcard grants in the browser. Resource APIs make the final decision. */
export const canWithCapabilities = (capabilities: VisibilityCapability[], action: string, subject: string) =>
  capabilities.some(capability => capability.action === action && capability.subject === subject);
