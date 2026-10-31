import { RecoveryError } from './errors';
import { parseProtectedDockerInventoryV1, targetAuthorityHandleSchema,
  encodeTargetLifecycleCommandV1, parseTargetLifecycleCommandV1, parseTargetLifecycleObservationV1,
  parseTargetLifecycleResultV1, parseTargetResourceAdmissionV1,
  type TargetAuthorityHandle, type TargetLifecycleCommandV1 } from './target-engine-contracts';
import { parseTargetDockerExecutionProfileV1 } from './target-docker-profile';

/**
 * Private authority seam for already-enrolled records and sanitized observation.
 * It deliberately exposes no path, argv, Docker endpoint, credential value, shell,
 * process environment, or generic command execution API. Packet 05B1b3b1a is
 * read-only at this boundary; lifecycle effects remain Packet 05B1b3b1b/05B1b3b2.
 */
export interface TargetResourceAuthority {
  readExecutionProfile(profileHandle: TargetAuthorityHandle, signal?: AbortSignal): Promise<Uint8Array>;
  readProtectedInventory(inventoryHandle: TargetAuthorityHandle, signal?: AbortSignal): Promise<Uint8Array>;
  inspectTarget(targetHandle: TargetAuthorityHandle, signal?: AbortSignal): Promise<Uint8Array>;
}

/**
 * Narrow lifecycle authority used below the already-locked helper. The callback
 * is the authority lock boundary; callers must acquire their engine journal
 * only from inside it. There is deliberately no generic command, argv, path,
 * endpoint, environment, credential-value, remove, quarantine, or purge API.
 */
export interface TargetLifecycleResourceAuthority extends TargetResourceAuthority {
  withLifecycleAuthority<T>(targetHandle: TargetAuthorityHandle, signal: AbortSignal,
    callback: () => Promise<T>): Promise<T>;
  admitExistingResources(targetHandle: TargetAuthorityHandle, signal: AbortSignal): Promise<Uint8Array>;
  executeLifecycleCommand(command: TargetLifecycleCommandV1, signal: AbortSignal): Promise<Uint8Array>;
  observeLifecycle(targetHandle: TargetAuthorityHandle, signal: AbortSignal): Promise<Uint8Array>;
}

export type ScriptedTargetResourceAuthorityRecord = Readonly<{
  operation: 'READ_EXECUTION_PROFILE' | 'READ_PROTECTED_INVENTORY' | 'INSPECT_TARGET' |
    'ADMIT_EXISTING_RESOURCES' | 'EXECUTE_LIFECYCLE_COMMAND' | 'OBSERVE_LIFECYCLE';
  authorityHandle: TargetAuthorityHandle;
  response: Uint8Array;
  command?: TargetLifecycleCommandV1;
}>;

/** Unmistakably non-production deterministic fixture. It performs no host or Docker I/O. */
export class TestOnlyScriptedTargetResourceAuthority implements TargetLifecycleResourceAuthority {
  readonly testOnlyMarker = 'TEST_ONLY_DO_NOT_USE_IN_PRODUCTION' as const;
  private next = 0;

  constructor(private readonly records: readonly ScriptedTargetResourceAuthorityRecord[],
    marker: 'TEST_ONLY_DO_NOT_USE_IN_PRODUCTION') {
    if (marker !== 'TEST_ONLY_DO_NOT_USE_IN_PRODUCTION') {
      throw new RecoveryError('RECOVERY_TARGET_EFFECT_INELIGIBLE', 'Scripted target authority is test-only.');
    }
  }

  private consume(operation: ScriptedTargetResourceAuthorityRecord['operation'], handle: TargetAuthorityHandle,
    signal?: AbortSignal): Uint8Array {
    signal?.throwIfAborted(); targetAuthorityHandleSchema.parse(handle);
    const record = this.records[this.next];
    if (!record || record.operation !== operation || record.authorityHandle !== handle) {
      throw new RecoveryError('RECOVERY_TARGET_REQUEST_CONFLICT',
        'Test-only scripted target authority call differs from its exact script.');
    }
    this.next += 1; return Buffer.from(record.response);
  }

  async readExecutionProfile(profileHandle: TargetAuthorityHandle, signal?: AbortSignal): Promise<Uint8Array> {
    const bytes = this.consume('READ_EXECUTION_PROFILE', profileHandle, signal);
    parseTargetDockerExecutionProfileV1(bytes); return bytes;
  }

  async readProtectedInventory(inventoryHandle: TargetAuthorityHandle, signal?: AbortSignal): Promise<Uint8Array> {
    const bytes = this.consume('READ_PROTECTED_INVENTORY', inventoryHandle, signal);
    parseProtectedDockerInventoryV1(bytes); return bytes;
  }

  async inspectTarget(targetHandle: TargetAuthorityHandle, signal?: AbortSignal): Promise<Uint8Array> {
    return this.consume('INSPECT_TARGET', targetHandle, signal);
  }

  async withLifecycleAuthority<T>(targetHandle: TargetAuthorityHandle, signal: AbortSignal,
    callback: () => Promise<T>): Promise<T> {
    signal.throwIfAborted(); targetAuthorityHandleSchema.parse(targetHandle);
    return callback();
  }

  async admitExistingResources(targetHandle: TargetAuthorityHandle, signal: AbortSignal): Promise<Uint8Array> {
    const bytes = this.consume('ADMIT_EXISTING_RESOURCES', targetHandle, signal);
    parseTargetResourceAdmissionV1(bytes); return bytes;
  }

  async executeLifecycleCommand(command: TargetLifecycleCommandV1, signal: AbortSignal): Promise<Uint8Array> {
    signal.throwIfAborted(); const parsed = parseTargetLifecycleCommandV1(encodeTargetLifecycleCommandV1(command));
    const record = this.records[this.next];
    if (!record || record.operation !== 'EXECUTE_LIFECYCLE_COMMAND' ||
        record.authorityHandle !== parsed.targetHandle || record.command === undefined ||
        !encodeTargetLifecycleCommandV1(record.command).equals(encodeTargetLifecycleCommandV1(parsed))) {
      throw new RecoveryError('RECOVERY_TARGET_REQUEST_CONFLICT',
        'Test-only scripted lifecycle command differs from its exact script.');
    }
    this.next += 1; const bytes = Buffer.from(record.response); parseTargetLifecycleResultV1(bytes); return bytes;
  }

  async observeLifecycle(targetHandle: TargetAuthorityHandle, signal: AbortSignal): Promise<Uint8Array> {
    const bytes = this.consume('OBSERVE_LIFECYCLE', targetHandle, signal);
    parseTargetLifecycleObservationV1(bytes); return bytes;
  }

  assertExhausted(): void {
    if (this.next !== this.records.length) {
      throw new RecoveryError('RECOVERY_STATE_INVALID', 'Test-only scripted target authority has unread records.');
    }
  }
}
