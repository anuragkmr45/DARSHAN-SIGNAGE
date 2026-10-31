import { randomUUID } from 'node:crypto';
import { canonicalJson } from '../backups/backup-broker-protocol';
import { sha256RecoveryBytes, type RecoveryPlanV3, type RecoveryPlanV4 } from './contracts';
import { RecoveryError } from './errors';
import { encodeTargetHelperRequest, parseTargetHelperResponse, targetHelperResponseMatchesRequest,
  type TargetHelperOperation, type TargetHelperRequest, type TargetHelperResponse } from './target-helper-protocol';

export interface RecoveryTargetTransport {
  request(bytes: Uint8Array, signal?: AbortSignal): Promise<Uint8Array>;
}

export interface RecoveryTargetClientResult {
  request: TargetHelperRequest;
  response: TargetHelperResponse;
  receiptSha256: string;
}

export class RecoveryTargetRejectedError extends RecoveryError {
  constructor(public readonly result: RecoveryTargetClientResult,
    public readonly definitePreEffect: boolean) {
    super(definitePreEffect ? 'RECOVERY_TARGET_NOT_READY' : 'RECOVERY_TARGET_EFFECT_AMBIGUOUS',
      `Target helper rejected ${result.request.operation}: ${result.response.ok ? 'UNKNOWN' : result.response.error.code}.`);
    this.name = 'RecoveryTargetRejectedError';
  }
}

export class RecoveryTargetClient {
  constructor(private readonly options: { transport: RecoveryTargetTransport; uuid?: () => string }) {}

  buildRequest(input: {
    operation: TargetHelperOperation;
    plan: RecoveryPlanV3 | RecoveryPlanV4;
    planSha256: string;
    authorizationSha256: string;
    expectedHelperSequence: number | null;
    requestId?: string;
  }): TargetHelperRequest {
    const preparation = input.plan.targetPreparation;
    return {
      format: 'darshan-recovery-target-helper-v1', requestId: input.requestId ?? (this.options.uuid ?? randomUUID)(),
      operation: input.operation, operationId: input.plan.operationId, siteId: input.plan.source.siteId,
      hostInstallationId: preparation.hostInstallationId, planSha256: input.planSha256,
      targetSetId: preparation.targetSetId, generation: preparation.generation,
      targetSpecificationSha256: preparation.targetSpecificationSha256,
      authorizationSha256: input.authorizationSha256, expectedHelperSequence: input.expectedHelperSequence,
    };
  }

  async send(request: TargetHelperRequest, signal?: AbortSignal): Promise<RecoveryTargetClientResult> {
    signal?.throwIfAborted();
    const responseBytes = await this.options.transport.request(encodeTargetHelperRequest(request), signal);
    const response = parseTargetHelperResponse(responseBytes);
    if (!targetHelperResponseMatchesRequest(response, request)) {
      throw new RecoveryError('RECOVERY_TARGET_RECEIPT_MISMATCH', 'Target-helper response does not bind the exact request and target generation.');
    }
    const receiptSha256 = sha256RecoveryBytes(canonicalJson(response));
    if (!response.ok) {
      if (response.error.code === 'TARGET_REQUEST_CONFLICT') {
        throw new RecoveryError('RECOVERY_TARGET_REQUEST_CONFLICT', `Target helper rejected ${request.operation}: ${response.error.code}.`);
      }
      const result = { request, response, receiptSha256 };
      const definitePreEffect = ['TARGET_SEQUENCE_CONFLICT', 'TARGET_ACTION_NOT_ALLOWED', 'TARGET_ENGINE_FAILED',
        'TARGET_STATE_CONFLICT'].includes(response.error.code);
      throw new RecoveryTargetRejectedError(result, definitePreEffect);
    }
    return { request, response, receiptSha256 };
  }

  async request(input: {
    operation: TargetHelperOperation;
    plan: RecoveryPlanV3 | RecoveryPlanV4;
    planSha256: string;
    authorizationSha256: string;
    expectedHelperSequence: number | null;
    signal?: AbortSignal;
  }): Promise<RecoveryTargetClientResult> {
    return this.send(this.buildRequest(input), input.signal);
  }
}
