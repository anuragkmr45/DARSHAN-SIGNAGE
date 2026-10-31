import { describe, expect, it } from 'vitest';
import { MaintenanceCoordinatorError, MaintenanceOutcomeUncertainError } from './errors';

describe('MaintenanceCoordinatorError', () => {
  it('exposes a stable retryable admission-closed contract', () => {
    const error = new MaintenanceCoordinatorError(
      'MAINTENANCE_ADMISSION_CLOSED',
      'capture in progress'
    );
    expect(error).toMatchObject({
      name: 'MaintenanceCoordinatorError',
      code: 'MAINTENANCE_ADMISSION_CLOSED',
      retryable: true,
    });
  });

  it('does not classify fencing as retryable', () => {
    expect(new MaintenanceCoordinatorError('MAINTENANCE_CAPTURE_FENCED', 'stale capture').retryable).toBe(false);
  });

  it('classifies an active emergency capture rejection as retryable', () => {
    expect(new MaintenanceCoordinatorError(
      'MAINTENANCE_CAPTURE_EMERGENCY_ACTIVE',
      'emergency active'
    )).toMatchObject({
      code: 'MAINTENANCE_CAPTURE_EMERGENCY_ACTIVE',
      retryable: true,
    });
  });

  it('requires an explicit typed error for ambiguous outcomes', () => {
    expect(new MaintenanceOutcomeUncertainError('object write outcome unknown')).toMatchObject({
      code: 'MAINTENANCE_OPERATION_OUTCOME_UNCERTAIN',
      retryable: false,
    });
  });
});
