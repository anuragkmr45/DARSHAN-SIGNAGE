import { createHash } from 'node:crypto';
import { canonicalJson } from '../backups/backup-broker-protocol';
import { RecoveryError } from './errors';
import { type TargetNativeAuthorityRequest, type TargetNativeAuthorityResult,
  assertTargetNativeAuthorityDeadline, encodeTargetNativeAuthorityRequest,
  parseTargetNativeAuthorityRequest } from './target-native-authority-contracts';
import { TargetEngineMaterializationJournal, fixedTargetOwnershipLabels, targetOwnershipLabelsSha256,
  type TargetEngineActualResource } from './target-engine-materialization';
import { assertTargetNativeEngineB1Operation, encodeTargetNativeEngineCommandV3,
  encodeTargetNativeEngineProfileV2, parseTargetNativeEngineHandleMapV2,
  parseTargetNativeEngineInspectionV3, targetNativeEngineCommandV3Sha256, targetNativeEngineProfileV2Sha256,
  type TargetNativeEngineCommandV3, type TargetNativeEngineHandleMapEntryV2,
  type TargetNativeEngineInspectionV3, type TargetNativeEngineLifecycleBindingV2,
  type TargetNativeEngineProfileV2 } from './target-native-engine-contracts';

export interface AcquiredTargetNativeEngineAuthority {
  readonly immutableRequest: TargetNativeAuthorityRequest;
  readonly immutableResult: TargetNativeAuthorityResult;
}

/** Descriptor-only bridge. It intentionally exposes no executable path,
 * argv, environment, daemon URL, credential value, or generic command API. */
export interface SupervisorOwnedTargetNativeEngineChannel {
  readonly descriptor: number;
  sessionAlive(sessionHandle: string, signal: AbortSignal): Promise<boolean>;
  dispatchFixed(commandFrame: Uint8Array, sessionHandle: string, signal: AbortSignal): Promise<void>;
  inspectFixed(commandFrame: Uint8Array, sessionHandle: string, signal: AbortSignal): Promise<Uint8Array>;
  joinFixed(sessionHandle: string): Promise<void>;
  cancelAndJoinFixed(sessionHandle: string): Promise<void>;
}

export interface TargetNativeEngineContextV2 {
  readonly authority: AcquiredTargetNativeEngineAuthority;
  readonly binding: TargetNativeEngineLifecycleBindingV2;
  readonly profile: TargetNativeEngineProfileV2;
  readonly handles: readonly TargetNativeEngineHandleMapEntryV2[];
}

function frozenAuthority(value: AcquiredTargetNativeEngineAuthority): AcquiredTargetNativeEngineAuthority {
  const frame = encodeTargetNativeAuthorityRequest(value.immutableRequest);
  const request = parseTargetNativeAuthorityRequest(frame);
  const result = Object.freeze({ ...value.immutableResult });
  const prefix = 'rtea:v1:session:';
  const token = result.sessionHandle.startsWith(prefix) ? result.sessionHandle.slice(prefix.length) : '';
  const expectedProof = createHash('sha256').update(frame).update(token, 'utf8').digest('hex');
  if (!token || result.leaseProofSha256 !== expectedProof || result.outcome !== (request.operation === 'INSPECT' ? 'READONLY' : 'LEASED') ||
      result.challengeNonce !== request.challengeNonce || result.authorityInstanceSha256 !== request.supervisorInstanceSha256 ||
      result.supervisorGeneration !== request.supervisorGeneration || result.reconciliationRequired && request.operation !== 'INSPECT') {
    throw new RecoveryError('RECOVERY_TARGET_AUTH_INVALID',
      'Native engine context requires the exact lease proof derived from its immutable acquired request.');
  }
  return Object.freeze({ immutableRequest: Object.freeze(request), immutableResult: result });
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value); Object.values(value).forEach((entry) => deepFreeze(entry));
  }
  return value;
}

export function targetNativeEngineExpectedConfigurationSha256(profile: TargetNativeEngineProfileV2,
    role: 'NETWORK' | 'POSTGRES' | 'MINIO'): string {
  const fixedConfiguration = role === 'NETWORK' ? profile.network :
    role === 'POSTGRES' ? profile.containers[0] : profile.containers[1];
  return createHash('sha256').update(canonicalJson(fixedConfiguration)).digest('hex');
}

function roleMap(entries: readonly TargetNativeEngineHandleMapEntryV2[]): ReadonlyMap<string, TargetNativeEngineHandleMapEntryV2> {
  return new Map(entries.map((entry) => [entry.role, entry]));
}

export function createTargetNativeEngineContextV2(input: {
  acquired: AcquiredTargetNativeEngineAuthority;
  profile: TargetNativeEngineProfileV2;
  handles: readonly TargetNativeEngineHandleMapEntryV2[];
}): TargetNativeEngineContextV2 {
  const authority = frozenAuthority(input.acquired);
  const profile = deepFreeze(JSON.parse(encodeTargetNativeEngineProfileV2(input.profile).toString('utf8')) as TargetNativeEngineProfileV2);
  const handles = parseTargetNativeEngineHandleMapV2(input.handles); const byRole = roleMap(handles);
  const request = authority.immutableRequest; const result = authority.immutableResult;
  if (result.outcome !== (request.operation === 'INSPECT' ? 'READONLY' : 'LEASED') ||
      result.authorityInstanceSha256 !== request.supervisorInstanceSha256 ||
      result.supervisorGeneration !== request.supervisorGeneration || result.challengeNonce !== request.challengeNonce ||
      request.profileSha256 !== targetNativeEngineProfileV2Sha256(profile) ||
      byRole.get('PROFILE')?.authorityHandle !== profile.authorityHandle ||
      byRole.get('EXECUTABLE')?.authorityHandle !== profile.executable.authorityHandle ||
      byRole.get('CLIENT_CONFIG')?.authorityHandle !== profile.clientConfig.authorityHandle ||
      byRole.get('DAEMON_SOCKET')?.authorityHandle !== profile.daemon.socketAuthorityHandle ||
      byRole.get('NETWORK')?.authorityHandle !== profile.network.networkAuthorityHandle ||
      byRole.get('POSTGRES')?.authorityHandle !== profile.containers[0].containerAuthorityHandle ||
      byRole.get('MINIO')?.authorityHandle !== profile.containers[1].containerAuthorityHandle) {
    throw new RecoveryError('RECOVERY_TARGET_AUTH_BINDING_MISMATCH',
      'Native engine context differs from the acquired immutable request or enrolled handle map.');
  }
  const binding: TargetNativeEngineLifecycleBindingV2 = Object.freeze({
    installationId: request.installationId, siteId: request.siteId, hostInstallationId: request.hostInstallationId,
    operationId: request.operationId, generation: request.generation.toString(), targetSetId: request.targetSetId,
    targetHandle: profile.authorityHandle, outerEnvelopeSha256: request.outerEnvelopeSha256,
    requestSha256: request.requestSha256, authorizationSha256: request.authorizationSha256,
    profileSha256: request.profileSha256, enrollmentSha256: request.enrollmentSha256,
    admissionSha256: request.admissionSha256, authorityInstanceSha256: request.supervisorInstanceSha256,
    authorityDeadlineUnixMs: request.deadlineUnixMs.toString(),
    supervisorGeneration: request.supervisorGeneration.toString(),
  });
  return Object.freeze({ authority, binding, profile, handles });
}

export class TestOnlyTargetNativeEngineClient {
  private constructor(private readonly channel: SupervisorOwnedTargetNativeEngineChannel,
    private readonly materialization: TargetEngineMaterializationJournal,
    private readonly nowUnixMs: () => bigint) {
    if (!Number.isSafeInteger(channel.descriptor) || channel.descriptor < 3) {
      throw new RecoveryError('RECOVERY_TARGET_AUTH_INVALID', 'Native engine requires a supervisor-owned private descriptor.');
    }
  }

  static createTestOnly(channel: SupervisorOwnedTargetNativeEngineChannel,
      materialization: TargetEngineMaterializationJournal, nowUnixMs: () => bigint): TestOnlyTargetNativeEngineClient {
    return new TestOnlyTargetNativeEngineClient(channel, materialization, nowUnixMs);
  }

  private async fresh(context: TargetNativeEngineContextV2, signal: AbortSignal, commandDeadlineUnixMs?: bigint): Promise<void> {
    const effectiveDeadline = commandDeadlineUnixMs === undefined ? context.authority.immutableRequest.deadlineUnixMs :
      commandDeadlineUnixMs < context.authority.immutableRequest.deadlineUnixMs ? commandDeadlineUnixMs :
        context.authority.immutableRequest.deadlineUnixMs;
    signal.throwIfAborted(); assertTargetNativeAuthorityDeadline(context.authority.immutableRequest, this.nowUnixMs());
    if (this.nowUnixMs() >= effectiveDeadline) {
      throw new RecoveryError('RECOVERY_TARGET_PROTOCOL_INVALID', 'Native engine effective deadline has expired.');
    }
    if (!await this.channel.sessionAlive(context.authority.immutableResult.sessionHandle, signal)) {
      throw new RecoveryError('RECOVERY_TARGET_EFFECT_AMBIGUOUS', 'Native authority session or fencing generation is no longer live.');
    }
    signal.throwIfAborted(); assertTargetNativeAuthorityDeadline(context.authority.immutableRequest, this.nowUnixMs());
    if (this.nowUnixMs() >= effectiveDeadline) {
      throw new RecoveryError('RECOVERY_TARGET_PROTOCOL_INVALID', 'Native engine effective deadline expired across an awaited boundary.');
    }
  }

  private resolve(context: TargetNativeEngineContextV2, operation: string): {
    role: 'NETWORK' | 'POSTGRES' | 'MINIO' | null; handle: string;
  } {
    assertTargetNativeEngineB1Operation(operation);
    const role = operation === 'INSPECT_TARGET' ? null : operation === 'ENSURE_INTERNAL_NETWORK' ? 'NETWORK'
      : operation === 'CREATE_POSTGRES' ? 'POSTGRES' : 'MINIO';
    const map = roleMap(context.handles); const handle = role ? map.get(role)?.authorityHandle : context.profile.authorityHandle;
    if (!handle || !handle.startsWith('tra:v1:')) {
      throw new RecoveryError('RECOVERY_TARGET_AUTH_INVALID', 'Native engine role did not resolve through the enrolled tra:v1 map.');
    }
    if (role === 'POSTGRES' && !map.get('POSTGRES_PASSWORD')?.admitted || role === 'MINIO' &&
        (!map.get('MINIO_ROOT_PASSWORD')?.admitted || !map.get('MINIO_ROOT_USER')?.admitted)) {
      throw new RecoveryError('RECOVERY_TARGET_EFFECT_INELIGIBLE', 'Create requires already admitted credential references.');
    }
    return { role, handle };
  }

  private command(context: TargetNativeEngineContextV2, input: {
    commandId: string; operation: string; commandNonce: string; materializationHeadSha256: string; deadlineUnixMs: bigint;
  }): TargetNativeEngineCommandV3 {
    const now = this.nowUnixMs();
    if (input.deadlineUnixMs <= now || input.deadlineUnixMs > context.authority.immutableRequest.deadlineUnixMs) {
      throw new RecoveryError('RECOVERY_TARGET_PROTOCOL_INVALID',
        'Native engine command deadline must be fresh and no later than the acquired authority deadline.');
    }
    const resolved = this.resolve(context, input.operation);
    const command = {
      format: 'darshan-recovery-target-native-engine-command-v3' as const, commandId: input.commandId,
      operation: input.operation as TargetNativeEngineCommandV3['operation'], role: resolved.role,
      authorityHandle: context.profile.authorityHandle, targetHandle: context.profile.authorityHandle,
      binding: context.binding, resourceAuthorityHandle: resolved.handle, commandNonce: input.commandNonce,
      materializationHeadSha256: input.materializationHeadSha256, deadlineUnixMs: input.deadlineUnixMs.toString(),
    };
    encodeTargetNativeEngineCommandV3(command); return Object.freeze(command);
  }

  private validateInspection(context: TargetNativeEngineContextV2, command: TargetNativeEngineCommandV3,
      inspection: TargetNativeEngineInspectionV3): void {
    if (!canonicalJson(inspection.binding).equals(canonicalJson(context.binding)) ||
        inspection.targetHandle !== context.profile.authorityHandle ||
        inspection.command.commandSha256 !== targetNativeEngineCommandV3Sha256(command) ||
        inspection.command.operation !== command.operation || inspection.command.role !== command.role ||
        inspection.command.resourceAuthorityHandle !== command.resourceAuthorityHandle ||
        inspection.command.commandNonce !== command.commandNonce ||
        inspection.command.materializationHeadSha256 !== command.materializationHeadSha256) {
      throw new RecoveryError('RECOVERY_TARGET_AUTH_BINDING_MISMATCH',
        'Inspection differs from the exact acquired context and materialization command.');
    }
  }

  async inspect(context: TargetNativeEngineContextV2, input: {
    commandId: string; commandNonce: string; materializationHeadSha256: string; deadlineUnixMs: bigint; signal: AbortSignal;
  }): Promise<TargetNativeEngineInspectionV3> {
    const command = this.command(context, { ...input, operation: 'INSPECT_TARGET' });
    const frame = encodeTargetNativeEngineCommandV3(command); await this.fresh(context, input.signal, input.deadlineUnixMs);
    let bytes: Uint8Array; let cause: unknown;
    try { bytes = await this.channel.inspectFixed(frame, context.authority.immutableResult.sessionHandle, input.signal); }
    catch (error) { cause = error; bytes = Buffer.alloc(0); }
    try { await this.channel.joinFixed(context.authority.immutableResult.sessionHandle); }
    catch (joinCause) {
      throw new RecoveryError('RECOVERY_TARGET_EFFECT_AMBIGUOUS',
        'Readonly native inspection did not prove negative descendant liveness.', { cause: joinCause });
    }
    await this.fresh(context, input.signal, input.deadlineUnixMs);
    if (cause) throw cause;
    const inspection = parseTargetNativeEngineInspectionV3(bytes); this.validateInspection(context, command, inspection);
    return inspection;
  }

  async create(context: TargetNativeEngineContextV2, input: {
    commandId: string; operation: 'ENSURE_INTERNAL_NETWORK' | 'CREATE_POSTGRES' | 'CREATE_MINIO';
    commandNonce: string; materializationHeadSha256: string; deadlineUnixMs: bigint; signal: AbortSignal;
  }): Promise<{ readonly inspection: TargetNativeEngineInspectionV3; readonly actual: TargetEngineActualResource }> {
    if (context.authority.immutableRequest.operation !== 'PREPARE' ||
        context.authority.immutableResult.outcome !== 'LEASED') {
      throw new RecoveryError('RECOVERY_TARGET_EFFECT_INELIGIBLE', 'Readonly native authority cannot create resources.');
    }
    const command = this.command(context, input); const frame = encodeTargetNativeEngineCommandV3(command);
    await this.fresh(context, input.signal, input.deadlineUnixMs);
    const intent = await this.materialization.publishIntent(command, input.signal);
    await this.fresh(context, input.signal, input.deadlineUnixMs);
    let dispatchCause: unknown;
    try {
      try { await this.channel.dispatchFixed(frame, context.authority.immutableResult.sessionHandle, input.signal); }
      catch (cause) { dispatchCause = cause; }
      try { await this.channel.cancelAndJoinFixed(context.authority.immutableResult.sessionHandle); }
      catch (joinCause) {
        throw new RecoveryError('RECOVERY_TARGET_EFFECT_AMBIGUOUS',
          'Native engine dispatch did not prove negative descendant liveness.', { cause: joinCause });
      }
      await this.fresh(context, input.signal, input.deadlineUnixMs);
      if (dispatchCause) {
        throw new RecoveryError('RECOVERY_TARGET_EFFECT_AMBIGUOUS',
          'Native engine dispatch may have launched before its response was lost.', { cause: dispatchCause });
      }
      let inspectionBytes: Uint8Array; let inspectionCause: unknown;
      try { inspectionBytes = await this.channel.inspectFixed(frame, context.authority.immutableResult.sessionHandle, input.signal); }
      catch (cause) { inspectionCause = cause; inspectionBytes = Buffer.alloc(0); }
      try { await this.channel.joinFixed(context.authority.immutableResult.sessionHandle); }
      catch (joinCause) {
        throw new RecoveryError('RECOVERY_TARGET_EFFECT_AMBIGUOUS',
          'Post-create inspection did not prove negative descendant liveness.', { cause: joinCause });
      }
      await this.fresh(context, input.signal, input.deadlineUnixMs);
      if (inspectionCause) throw inspectionCause;
      const inspection = parseTargetNativeEngineInspectionV3(inspectionBytes); this.validateInspection(context, command, inspection);
      const observed = command.role === 'NETWORK' ? inspection.network : command.role === 'POSTGRES'
        ? inspection.postgres : inspection.minio;
      const expectedContainer = command.role === 'POSTGRES' ? context.profile.containers[0] :
        command.role === 'MINIO' ? context.profile.containers[1] : undefined;
      const expectedImageId = expectedContainer?.image.imageId ?? null;
      const expectedImageConfigSha256 = expectedContainer?.image.imageConfigSha256 ?? null;
      const expectedConfigurationSha256 = targetNativeEngineExpectedConfigurationSha256(context.profile, command.role!);
      const labels = fixedTargetOwnershipLabels({ operationId: intent.operationId, targetHandle: intent.targetHandle,
        generation: intent.generation, role: intent.role, resourceAuthorityHandle: intent.resourceAuthorityHandle,
        profileSha256: intent.profileSha256, commandNonce: intent.commandNonce });
      if (!inspection.observationComplete || Object.values(inspection.enumerationComplete).some((complete) => !complete) ||
          observed.state !== 'CREATED' || observed.configuration !== 'MATCH' || observed.resourceId === null ||
          observed.errorSha256 !== null || observed.ownerLabelsSha256 !== targetOwnershipLabelsSha256(labels) ||
          observed.daemonIdentitySha256 === null ||
          observed.daemonIdentitySha256 !== context.profile.daemon.daemonIdentitySha256 ||
          observed.imageId !== expectedImageId || observed.imageConfigSha256 !== expectedImageConfigSha256 ||
          observed.effectiveConfigurationSha256 !== expectedConfigurationSha256 || observed.consumerIds.length !== 0) {
        throw new RecoveryError('RECOVERY_TARGET_EFFECT_AMBIGUOUS',
          'Created resource evidence differs from the exact enrolled daemon, image, configuration, ownership, or consumer state.');
      }
      await this.fresh(context, input.signal, input.deadlineUnixMs);
      const actual: TargetEngineActualResource = {
        resourceId: observed.resourceId, imageId: observed.imageId, imageConfigSha256: observed.imageConfigSha256,
        effectiveConfigurationSha256: observed.effectiveConfigurationSha256,
        ownerLabelsSha256: observed.ownerLabelsSha256,
        consumerSetSha256: createHash('sha256').update(canonicalJson([...observed.consumerIds].sort())).digest('hex'),
        daemonIdentitySha256: observed.daemonIdentitySha256,
      };
      await this.materialization.publishReceipt({ intent, inspection, actual, outcome: 'COMPLETE', signal: input.signal });
      await this.fresh(context, input.signal, input.deadlineUnixMs);
      return Object.freeze({ inspection, actual: Object.freeze(actual) });
    } catch (cause) {
      if (cause instanceof RecoveryError && cause.code === 'RECOVERY_TARGET_EFFECT_AMBIGUOUS') throw cause;
      throw new RecoveryError('RECOVERY_TARGET_EFFECT_AMBIGUOUS',
        'Native engine dispatch may have reached the daemon; authoritative reconciliation is required.', { cause });
    }
  }
}

