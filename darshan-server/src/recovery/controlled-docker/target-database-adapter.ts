import type { DiskArtifactDescriptor } from './streaming-artifacts';
import { ControlledRecoveryError } from './contracts';
import type { DatabaseImportAdapter, DatabaseObservation } from './database';
import type { RecoveryTargetSpecification } from './docker-targets';

export interface FixedDatabaseExecutor {
  observe(input: { specification: RecoveryTargetSpecification; signal?: AbortSignal }): Promise<DatabaseObservation>;
  import(input: { specification: RecoveryTargetSpecification; dump: DiskArtifactDescriptor; argv: readonly ['-X', '--set=ON_ERROR_STOP=1', '--single-transaction'];
    environment: Readonly<Record<string, never>>; credentialMount: 'FIXED_PRIVATE_PGPASS'; signal?: AbortSignal }): Promise<void>;
  resetExactOwned(input: { specification: RecoveryTargetSpecification; signal?: AbortSignal }): Promise<void>;
}

export class TargetDatabaseAdapter implements DatabaseImportAdapter {
  constructor(private readonly specification: RecoveryTargetSpecification, private readonly dump: DiskArtifactDescriptor,
    private readonly executor: FixedDatabaseExecutor) {}
  observe(signal?: AbortSignal): Promise<DatabaseObservation> { return this.executor.observe({ specification: this.specification, signal }); }
  async importDump(input: { dumpFile: string; arguments: readonly string[]; ambientOptions: Readonly<Record<string, never>>; signal?: AbortSignal }): Promise<void> {
    if (input.dumpFile !== this.dump.path || JSON.stringify(input.arguments) !== JSON.stringify(['-X', '--set=ON_ERROR_STOP=1', '--single-transaction']) || Object.keys(input.ambientOptions).length) {
      throw new ControlledRecoveryError('CONTROLLED_RECOVERY_DATABASE_IMPORT_INVALID', 'Database import differs from the fixed sanitized contract.');
    }
    await this.executor.import({ specification: this.specification, dump: this.dump,
      argv: ['-X', '--set=ON_ERROR_STOP=1', '--single-transaction'], environment: {}, credentialMount: 'FIXED_PRIVATE_PGPASS', signal: input.signal });
  }
  resetOwned(signal?: AbortSignal): Promise<void> { return this.executor.resetExactOwned({ specification: this.specification, signal }); }
}
