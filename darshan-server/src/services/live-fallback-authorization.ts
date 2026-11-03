import type { MutationAuthorizationContext } from '@/auth/mutation-authorization';
import { AppError } from '@/utils/app-error';

/** This is auxiliary authoring work, in addition to record-bound library reads.
 * Durable jobs must recheck it as well as the initiating HTTP request. */
export function assertCanPrepareLiveFallback(context: Pick<MutationAuthorizationContext, 'ability'>) {
  if (!context.ability.can('create', 'ScheduleItem') && !context.ability.can('create', 'LiveBroadcast') &&
      !context.ability.can('manage', 'Schedule') && !context.ability.can('publish', 'ScheduleRequest')) {
    throw AppError.forbidden();
  }
}
