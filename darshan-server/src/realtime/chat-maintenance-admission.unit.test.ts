import { describe, expect, it } from 'vitest';
import {
  buildChatMaintenanceError,
  classifyChatSocketAdmission,
} from './chat-namespace';
import { MaintenanceCoordinatorError } from '@/maintenance/errors';

describe('chat socket maintenance admission', () => {
  it('gates read markers without blocking subscribe or typing delivery', () => {
    expect(classifyChatSocketAdmission('chat:read')).toBe('GATED_MUTATION');
    expect(classifyChatSocketAdmission('chat:subscribe')).toBe('DELIVERY');
    expect(classifyChatSocketAdmission('chat:typing')).toBe('DELIVERY');
  });

  it('returns the stable retryable acknowledgement contract', () => {
    const now = Date.parse('2026-10-28T10:00:00.000Z');
    expect(buildChatMaintenanceError(new MaintenanceCoordinatorError(
      'MAINTENANCE_ADMISSION_CLOSED',
      'capture active',
      { retryAt: new Date(now + 4_500) },
    ), now)).toMatchObject({
      error: {
        code: 'MAINTENANCE_ADMISSION_CLOSED',
        retryable: true,
        retry_after_seconds: 5,
      },
    });
  });
});
