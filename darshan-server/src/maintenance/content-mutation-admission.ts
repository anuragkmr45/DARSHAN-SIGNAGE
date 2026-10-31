import { config as appConfig } from '@/config';
import { getDatabasePool, registerDatabaseShutdownHook } from '@/db';
import { MaintenanceCoordinator } from './coordinator';
import { MaintenanceCoordinatorError } from './errors';
import { MaintenanceOperationScope } from './operation-scope';

type AdmissionScope = Pick<MaintenanceOperationScope, 'run'>;

export type MaintenanceMutationAttempt<T> =
  | { admitted: true; value: T }
  | { admitted: false };

/**
 * Admission boundary for mutations discovered below otherwise-readable HTTP
 * and socket paths. A fresh scope instance still reuses an active outer permit
 * through MaintenanceOperationScope's process-global async context.
 */
export class ContentMutationAdmission {
  constructor(
    private readonly scope: AdmissionScope,
    private readonly siteKey: string,
  ) {}

  async run<T>(operationKind: string, work: () => Promise<T>): Promise<T> {
    return this.scope.run({ siteKey: this.siteKey, operationKind }, () => work());
  }

  async tryRun<T>(operationKind: string, work: () => Promise<T>): Promise<MaintenanceMutationAttempt<T>> {
    let workStarted = false;
    try {
      const value = await this.scope.run(
        { siteKey: this.siteKey, operationKind },
        () => {
          workStarted = true;
          return work();
        },
      );
      return { admitted: true, value };
    } catch (error) {
      if (
        !workStarted &&
        error instanceof MaintenanceCoordinatorError &&
        error.code === 'MAINTENANCE_ADMISSION_CLOSED'
      ) {
        return { admitted: false };
      }
      throw error;
    }
  }
}

let admission: ContentMutationAdmission | null = null;

export function getContentMutationAdmission(): ContentMutationAdmission {
  if (admission) return admission;
  const pool = getDatabasePool();
  if (!pool) {
    throw new Error('Database pool is not initialized; content mutation admission cannot be evaluated.');
  }
  admission = new ContentMutationAdmission(
    new MaintenanceOperationScope(new MaintenanceCoordinator(pool)),
    appConfig.BACKUP_SITE_ID ?? 'local',
  );
  registerDatabaseShutdownHook('maintenance-content-mutation-admission', () => { admission = null; });
  return admission;
}

export function runWithContentMutationAdmission<T>(operationKind: string, work: () => Promise<T>): Promise<T> {
  return getContentMutationAdmission().run(operationKind, work);
}

export function tryRunWithContentMutationAdmission<T>(
  operationKind: string,
  work: () => Promise<T>,
): Promise<MaintenanceMutationAttempt<T>> {
  return getContentMutationAdmission().tryRun(operationKind, work);
}
