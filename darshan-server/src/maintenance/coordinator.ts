import type { Pool } from 'pg';
import type { DbExecutor } from '@/db';
import {
  MaintenanceStore,
  type AdmissionInput,
  type BeginCaptureInput,
  type CaptureIdentity,
  type EmergencyPreemptionResult,
  type MaintenanceOperation,
  type MaintenanceSiteState,
} from './store';

export interface OperationPermit {
  readonly operationId: string;
  readonly ownerToken: string;
  readonly siteKey: string;
  readonly generation: number;
  readonly operationKind: string;
}

export class MaintenanceCoordinator {
  readonly store: MaintenanceStore;

  constructor(pool: Pool) {
    this.store = new MaintenanceStore(pool);
  }

  async admit(input: AdmissionInput): Promise<OperationPermit> {
    const operation = await this.store.admitOperation(input);
    return this.toPermit(operation);
  }

  async heartbeat(permit: OperationPermit, leaseSeconds?: number): Promise<boolean> {
    return this.store.heartbeatOperation(permit.operationId, permit.ownerToken, leaseSeconds);
  }

  async complete(permit: OperationPermit): Promise<void> {
    await this.store.completeOperation(permit.operationId, permit.ownerToken);
  }

  async markUncertain(permit: OperationPermit): Promise<void> {
    await this.store.markOperationUncertain(permit.operationId, permit.ownerToken);
  }

  async beginCapture(input: BeginCaptureInput): Promise<CaptureIdentity> {
    const state = await this.store.beginCapture(input);
    return this.captureIdentity(state);
  }

  async enterCopying(identity: CaptureIdentity): Promise<MaintenanceSiteState> {
    return this.store.enterCopying(identity);
  }

  async seal(identity: CaptureIdentity, stagingInventoryDigest: string): Promise<MaintenanceSiteState> {
    return this.store.sealCapture(identity, stagingInventoryDigest);
  }

  async abort(identity: CaptureIdentity): Promise<MaintenanceSiteState> {
    return this.store.abortCapture(identity);
  }

  async preemptForEmergency(
    executor: DbExecutor,
    siteKey: string
  ): Promise<EmergencyPreemptionResult> {
    return this.store.preemptForEmergencyInExecutor(executor, siteKey);
  }

  private toPermit(operation: MaintenanceOperation): OperationPermit {
    return {
      operationId: operation.id,
      ownerToken: operation.owner_token,
      siteKey: operation.site_key,
      generation: Number(operation.generation),
      operationKind: operation.operation_kind,
    };
  }

  private captureIdentity(state: MaintenanceSiteState): CaptureIdentity {
    if (!state.capture_id || !state.backup_run_id || !state.backup_attempt_id || !state.capture_owner) {
      throw new Error('Capture state is missing its authority identity.');
    }
    return {
      siteKey: state.site_key,
      captureId: state.capture_id,
      generation: Number(state.generation),
      backupRunId: state.backup_run_id,
      backupAttemptId: state.backup_attempt_id,
      owner: state.capture_owner,
    };
  }
}
