import { describe, expect, it } from 'vitest';
import { AppError } from '@/utils/app-error';
import { normalizePairingStatusError } from './device-telemetry';

describe('recovery pairing-status normalization', () => {
  it('preserves quarantine as an identity-retaining review result instead of INVALID_TOKEN', () => {
    const normalized = normalizePairingStatusError(new AppError({
      statusCode: 403,
      code: 'FORBIDDEN',
      message: 'review required',
      details: { reason: 'RECOVERY_PAIRING_REVIEW_REQUIRED', recovery_generation: '11111111-1111-4111-8111-111111111111' },
    })) as AppError;
    expect(normalized.statusCode).toBe(403);
    expect(normalized.code).toBe('RECOVERY_PAIRING_REVIEW_REQUIRED');
    expect(normalized.details).toMatchObject({
      status: 'RECOVERY_PAIRING_REVIEW_REQUIRED',
      recovery_generation: '11111111-1111-4111-8111-111111111111',
    });
  });
});
