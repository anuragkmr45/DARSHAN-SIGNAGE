import { ControlledRecoveryError } from './contracts';
import { RECOVERY_APP_VALIDATION_CASES, type RecoveryAppValidationAdapter, type RecoveryAppValidationCase } from './packet2';

export interface FixedApplicationValidationExecutor {
  proveIsolation(input: { operationId: string; generation: string; signal?: AbortSignal }): Promise<{ egressBlocked: boolean; productionCredentialsAbsent: boolean; targetsEvidenceSha256: string }>;
  execute(input: { operationId: string; generation: string; test: RecoveryAppValidationCase; signal?: AbortSignal }): Promise<{ passed: boolean; evidenceSha256: string }>;
  stop(input: { operationId: string; generation: string; signal?: AbortSignal }): Promise<void>;
}

export class FixedRecoveryAppValidationAdapter implements RecoveryAppValidationAdapter {
  private readonly completed = new Set<RecoveryAppValidationCase>();
  constructor(private readonly operationId: string, private readonly generation: string,
    private readonly executor: FixedApplicationValidationExecutor, private readonly signal?: AbortSignal) {}
  proveIsolation() { return this.executor.proveIsolation({ operationId: this.operationId, generation: this.generation, signal: this.signal }); }
  async runCase(test: RecoveryAppValidationCase) {
    if (!RECOVERY_APP_VALIDATION_CASES.includes(test)) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_APP_CASE_UNAPPROVED', 'Application validation case is outside the fixed catalog.');
    const result = await this.executor.execute({ operationId: this.operationId, generation: this.generation, test, signal: this.signal });
    if (result.passed) this.completed.add(test); return result;
  }
  async stopIsolatedApplication() {
    await this.executor.stop({ operationId: this.operationId, generation: this.generation, signal: this.signal });
  }
  missingCases(): RecoveryAppValidationCase[] { return RECOVERY_APP_VALIDATION_CASES.filter((test) => !this.completed.has(test)); }
}
