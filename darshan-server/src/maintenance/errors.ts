export type MaintenanceErrorCode =
  | 'MAINTENANCE_ADMISSION_CLOSED'
  | 'MAINTENANCE_CAPTURE_ACTIVE'
  | 'MAINTENANCE_CAPTURE_EMERGENCY_ACTIVE'
  | 'MAINTENANCE_CAPTURE_NOT_FOUND'
  | 'MAINTENANCE_CAPTURE_FENCED'
  | 'MAINTENANCE_CAPTURE_NOT_DRAINED'
  | 'MAINTENANCE_CAPTURE_DEADLINE_EXPIRED'
  | 'MAINTENANCE_CAPTURE_ATTEMPT_MISMATCH'
  | 'MAINTENANCE_OPERATION_NOT_FOUND'
  | 'MAINTENANCE_OPERATION_NOT_OWNER'
  | 'MAINTENANCE_OPERATION_NOT_UNCERTAIN'
  | 'MAINTENANCE_OPERATION_OUTCOME_UNCERTAIN';

const RETRYABLE_CODES = new Set<MaintenanceErrorCode>([
  'MAINTENANCE_ADMISSION_CLOSED',
  'MAINTENANCE_CAPTURE_ACTIVE',
  'MAINTENANCE_CAPTURE_EMERGENCY_ACTIVE',
  'MAINTENANCE_CAPTURE_NOT_DRAINED',
]);

export class MaintenanceCoordinatorError extends Error {
  readonly retryable: boolean;

  constructor(
    public readonly code: MaintenanceErrorCode,
    message: string,
    public readonly details?: Readonly<Record<string, unknown>>
  ) {
    super(message);
    this.name = 'MaintenanceCoordinatorError';
    this.retryable = RETRYABLE_CODES.has(code);
  }
}

/**
 * A handler uses this only when it cannot determine whether its database or
 * object-storage side effects completed. Ordinary business errors are not
 * ambiguous and must not use this type.
 */
export class MaintenanceOutcomeUncertainError extends MaintenanceCoordinatorError {
  constructor(message: string, details?: Readonly<Record<string, unknown>>) {
    super('MAINTENANCE_OPERATION_OUTCOME_UNCERTAIN', message, details);
    this.name = 'MaintenanceOutcomeUncertainError';
  }
}
