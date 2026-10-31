#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import { canonicalJson } from '../src/backups/backup-broker-protocol';
import { recoveryDigest, recoveryUuid } from '../src/recovery/contracts';
import { RecoveryError } from '../src/recovery/errors';
import { runRecoveryDiscovery, runRecoveryPlanning } from '../src/recovery/preflight';
import { runRecoveryAbandon, runRecoveryHold, runRecoveryRelease, runRecoveryResume, runRecoverySourceVerification, runRecoveryStatus,
  type RecoveryWorkflowResult } from '../src/recovery/operator-workflow';

const HELP = `Usage:
  recovery-cli discover --config-file PATH [--limit N] [--after-run-id UUID] [--json]
  recovery-cli plan --config-file PATH --run-id UUID --manifest-sha256 SHA256 --plan-output PATH [--operation-id UUID] [--json]
  recovery-cli hold --config-file PATH --plan-file PATH --plan-sha256 SHA256 [--json]
  recovery-cli verify-source --config-file PATH --plan-file PATH --plan-sha256 SHA256 [--json]
  recovery-cli resume --config-file PATH --plan-file PATH --plan-sha256 SHA256 [--json]
  recovery-cli status --config-file PATH --plan-file PATH --plan-sha256 SHA256 [--offline] [--json]
  recovery-cli release --config-file PATH --plan-file PATH --plan-sha256 SHA256 --review-file PATH --review-sha256 SHA256 --confirm-operation-id UUID [--json]
  recovery-cli abandon --config-file PATH --plan-file PATH --plan-sha256 SHA256 --review-file PATH --review-sha256 SHA256 --confirm-operation-id UUID [--json]
`;
const RESULT_FORMAT = 'darshan-recovery-cli-result-v1' as const;

export interface RecoveryCliIo {
  stdout(value: string): void;
  stderr(value: string): void;
}

export interface RecoveryCommandDependencies {
  discover: typeof runRecoveryDiscovery;
  plan: typeof runRecoveryPlanning;
  hold: typeof runRecoveryHold;
  verifySource: typeof runRecoverySourceVerification;
  resume: typeof runRecoveryResume;
  status: typeof runRecoveryStatus;
  release: typeof runRecoveryRelease;
  abandon: typeof runRecoveryAbandon;
}

type RecoveryCommand = 'discover' | 'plan' | 'hold' | 'verify-source' | 'resume' | 'status' | 'release' | 'abandon';

function parseOptions(argv: string[]): { command: RecoveryCommand; json: boolean; offline: boolean; values: Map<string, string> } {
  const [command, ...rest] = argv;
  if (!['discover', 'plan', 'hold', 'verify-source', 'resume', 'status', 'release', 'abandon'].includes(command ?? '')) {
    throw new RecoveryError('RECOVERY_INPUT_INVALID', 'Command is unsupported.');
  }
  const typedCommand = command as RecoveryCommand;
  const allowed = new Set(typedCommand === 'discover'
    ? ['--config-file', '--limit', '--after-run-id', '--json']
    : typedCommand === 'plan' ? ['--config-file', '--run-id', '--manifest-sha256', '--plan-output', '--operation-id', '--json']
      : typedCommand === 'status' ? ['--config-file', '--plan-file', '--plan-sha256', '--offline', '--json']
        : typedCommand === 'release' || typedCommand === 'abandon'
          ? ['--config-file', '--plan-file', '--plan-sha256', '--review-file', '--review-sha256', '--confirm-operation-id', '--json']
        : ['--config-file', '--plan-file', '--plan-sha256', '--json']);
  const values = new Map<string, string>(); let json = false; let offline = false;
  for (let index = 0; index < rest.length; index += 1) {
    const name = rest[index];
    if (!allowed.has(name)) throw new RecoveryError('RECOVERY_INPUT_INVALID', 'Unknown or unsupported command option.');
    if (name === '--json') {
      if (json) throw new RecoveryError('RECOVERY_INPUT_INVALID', 'Command option was repeated.');
      json = true; continue;
    }
    if (name === '--offline') {
      if (offline) throw new RecoveryError('RECOVERY_INPUT_INVALID', 'Command option was repeated.');
      offline = true; continue;
    }
    if (values.has(name)) throw new RecoveryError('RECOVERY_INPUT_INVALID', 'Command option was repeated.');
    const value = rest[index + 1];
    if (value === undefined || value.startsWith('--')) throw new RecoveryError('RECOVERY_INPUT_INVALID', 'Command option requires a value.');
    values.set(name, value); index += 1;
  }
  const required = typedCommand === 'discover' ? ['--config-file'] : typedCommand === 'plan'
    ? ['--config-file', '--run-id', '--manifest-sha256', '--plan-output']
    : typedCommand === 'release' || typedCommand === 'abandon'
      ? ['--config-file', '--plan-file', '--plan-sha256', '--review-file', '--review-sha256', '--confirm-operation-id']
      : ['--config-file', '--plan-file', '--plan-sha256'];
  if (required.some((name) => !values.has(name))) throw new RecoveryError('RECOVERY_INPUT_INVALID', 'Required command option is missing.');
  return { command: typedCommand, json, offline, values };
}

function exitCode(error: RecoveryError): number {
  if (error.code === 'RECOVERY_CANCELLED') return 130;
  if (error.code.startsWith('RECOVERY_INPUT') || error.code === 'RECOVERY_ID_INVALID' ||
      error.code === 'RECOVERY_DIGEST_INVALID' || error.code.startsWith('RECOVERY_REVIEW_') || error.code.includes('JOURNAL_SNAPSHOT')) return 3;
  if (error.code === 'RECOVERY_SOURCE_NOT_FOUND' || error.code.includes('DELETION') || error.code.includes('TOMBSTONED')) return 4;
  if (error.code.startsWith('RECOVERY_PLAN_')) return 6;
  if (error.code === 'RECOVERY_HOLD_RELEASED' || error.code === 'RECOVERY_HOLD_UNCERTAIN' ||
      error.code === 'RECOVERY_BROKER_EFFECT_AMBIGUOUS') return 7;
  if (error.code === 'RECOVERY_DISPOSITION_TRUTH_CONFLICT' || error.code === 'RECOVERY_OPERATION_CLOSED') return 7;
  return 5;
}

function safeError(cause: unknown): { error: RecoveryError; exitCode: number } {
  if (cause instanceof RecoveryError) return { error: cause, exitCode: exitCode(cause) };
  return { error: new RecoveryError('RECOVERY_STATE_INVALID', 'Recovery preflight failed without a safe classified detail.'), exitCode: 5 };
}

function safeCaughtError(cause: unknown, signal?: AbortSignal): { error: RecoveryError; exitCode: number } {
  // A classified workflow result is authoritative even when cancellation also
  // occurred. In particular, dispatched broker mutations must retain their
  // ambiguous/reconciliation exit instead of being rewritten as cancellation.
  if (cause instanceof RecoveryError) return safeError(cause);
  if (signal?.aborted) {
    return safeError(new RecoveryError('RECOVERY_CANCELLED', 'Recovery command was cancelled.'));
  }
  return safeError(cause);
}

function safeMessage(code: string): string {
  if (code === 'RECOVERY_CANCELLED') return 'Recovery command was cancelled; durable state may require supported resume or status review.';
  if (code.startsWith('RECOVERY_INPUT')) return 'Recovery operator input was missing, unsafe, or invalid.';
  if (code.includes('JOURNAL')) return 'Recovery journal evidence was missing, unsafe, corrupt, or conflicting.';
  if (code.startsWith('RECOVERY_SOURCE')) return 'Recovery source evidence was absent, changed, ineligible, or untrusted.';
  if (code.startsWith('RECOVERY_TARGET')) return 'Recovery target metadata was unsupported or changed.';
  if (code.startsWith('RECOVERY_PLAN')) return 'Recovery plan output was invalid, unsafe, or could not be written.';
  if (code.startsWith('RECOVERY_BROKER') || code.startsWith('RECOVERY_HOLD')) return 'Recovery hold truth was unavailable, unsafe, or requires reviewed reconciliation.';
  if (code.startsWith('RECOVERY_REVIEW')) return 'Recovery disposition review was missing, changed, invalid, or conflicting.';
  if (code.startsWith('RECOVERY_DISPOSITION') || code === 'RECOVERY_OPERATION_CLOSED') return 'Recovery operation closure requires exact reviewed reconciliation.';
  return 'Recovery preflight failed with a classified safe error.';
}

function writeJson(io: RecoveryCliIo, value: unknown): void {
  const bytes = canonicalJson(value);
  if (bytes.byteLength > 512 * 1024) throw new RecoveryError('RECOVERY_STATE_INVALID', 'Recovery CLI result exceeded its bounded envelope.');
  io.stdout(bytes.toString('utf8'));
}

export function createRecoveryCommand(dependencies: Partial<RecoveryCommandDependencies> = {}) {
  const resolved: RecoveryCommandDependencies = { discover: dependencies.discover ?? runRecoveryDiscovery,
    plan: dependencies.plan ?? runRecoveryPlanning, hold: dependencies.hold ?? runRecoveryHold,
    verifySource: dependencies.verifySource ?? runRecoverySourceVerification,
    resume: dependencies.resume ?? runRecoveryResume, status: dependencies.status ?? runRecoveryStatus,
    release: dependencies.release ?? runRecoveryRelease, abandon: dependencies.abandon ?? runRecoveryAbandon };
  return async (argv: string[], io: RecoveryCliIo, signal?: AbortSignal): Promise<number> => {
    if (argv.length === 0 || (argv.length === 1 && (argv[0] === '--help' || argv[0] === '-h'))) { io.stdout(HELP); return 0; }
    let jsonRequested = argv.includes('--json');
    try {
      signal?.throwIfAborted();
      const parsed = parseOptions(argv); jsonRequested = parsed.json;
      const configFile = parsed.values.get('--config-file')!;
      const afterRunId = parsed.values.has('--after-run-id')
        ? recoveryUuid(parsed.values.get('--after-run-id')!, 'afterRunId') : undefined;
      const runId = parsed.command === 'plan' ? recoveryUuid(parsed.values.get('--run-id')!, 'runId') : undefined;
      const manifestSha256 = parsed.command === 'plan'
        ? recoveryDigest(parsed.values.get('--manifest-sha256')!, 'manifestSha256') : undefined;
      const operationId = parsed.values.has('--operation-id')
        ? recoveryUuid(parsed.values.get('--operation-id')!, 'operationId') : undefined;
      const workflowInput = { configFile, planFile: parsed.values.get('--plan-file') ?? '',
        planSha256: parsed.values.has('--plan-sha256') ? recoveryDigest(parsed.values.get('--plan-sha256')!, 'planSha256') : '' };
      const confirmationText = parsed.values.get('--confirm-operation-id');
      const confirmationId = confirmationText === undefined ? '' : recoveryUuid(confirmationText, 'confirmOperationId');
      if (confirmationText !== undefined && confirmationText !== confirmationId) {
        throw new RecoveryError('RECOVERY_ID_INVALID', 'confirmOperationId must be canonical lowercase.');
      }
      const dispositionInput = { ...workflowInput, reviewFile: parsed.values.get('--review-file') ?? '',
        reviewSha256: parsed.values.has('--review-sha256') ? recoveryDigest(parsed.values.get('--review-sha256')!, 'reviewSha256') : '',
        confirmOperationId: confirmationId };
      const data = parsed.command === 'discover'
        ? await resolved.discover({ configFile,
          limit: parsed.values.has('--limit') ? (() => {
            const text = parsed.values.get('--limit')!;
            if (!/^[1-9][0-9]{0,2}$/.test(text)) throw new RecoveryError('RECOVERY_INPUT_INVALID', 'Discovery limit must be a canonical decimal integer.');
            return Number(text);
          })() : undefined,
          afterRunId, ...(signal ? { signal } : {}) })
        : parsed.command === 'plan' ? await resolved.plan({ configFile, runId: runId!, manifestSha256: manifestSha256!,
          planOutput: parsed.values.get('--plan-output')!, operationId, ...(signal ? { signal } : {}) })
          : parsed.command === 'hold' ? await resolved.hold({ ...workflowInput, ...(signal ? { signal } : {}) })
            : parsed.command === 'verify-source' ? await resolved.verifySource({ ...workflowInput, ...(signal ? { signal } : {}) })
              : parsed.command === 'resume' ? await resolved.resume({ ...workflowInput, ...(signal ? { signal } : {}) })
                : parsed.command === 'status' ? await resolved.status({ ...workflowInput, offline: parsed.offline, ...(signal ? { signal } : {}) })
                  : parsed.command === 'release' ? await resolved.release({ ...dispositionInput, ...(signal ? { signal } : {}) })
                    : await resolved.abandon({ ...dispositionInput, ...(signal ? { signal } : {}) });
      const safeData = parsed.command === 'discover' ? data : (() => {
        if (parsed.command !== 'plan') {
          const workflow = data as RecoveryWorkflowResult;
          return { operationId: workflow.operationId, phase: workflow.phase, pendingPhase: workflow.pendingPhase,
            failureCode: workflow.failureCode, brokerTruth: workflow.brokerTruth, nextAction: workflow.nextAction,
            closure: workflow.closure };
        }
        const planned = data as Awaited<ReturnType<typeof runRecoveryPlanning>>;
        return { planId: planned.plan.planId, operationId: planned.plan.operationId,
          planSha256: planned.planSha256, sourceRunId: planned.plan.source.runId,
          sourceManifestSha256: planned.plan.source.manifestSha256, targetId: planned.plan.target.targetId,
          targetReleaseId: planned.plan.target.releaseId, journalRevision: planned.journalRevision };
      })();
      if (jsonRequested) writeJson(io, { format: RESULT_FORMAT, command: parsed.command, status: 'SUCCESS',
        code: 'RECOVERY_OK', retryable: false, data: safeData });
      else io.stdout(`${parsed.command} completed successfully.\n`);
      return 0;
    } catch (cause) {
      const safe = safeCaughtError(cause, signal);
      if (jsonRequested) writeJson(io, { format: RESULT_FORMAT, command: ['discover', 'plan', 'hold', 'verify-source', 'resume', 'status', 'release', 'abandon'].includes(argv[0] ?? '') ? argv[0] : null,
        status: 'ERROR', code: safe.error.code, retryable: false, data: null, message: safeMessage(safe.error.code) });
      else io.stderr(`${safe.error.code}: ${safeMessage(safe.error.code)}\n`);
      return safe.exitCode;
    }
  };
}

export async function runRecoveryCli(argv = process.argv.slice(2), io: RecoveryCliIo = {
  stdout: (value) => process.stdout.write(value), stderr: (value) => process.stderr.write(value),
}, dependencies?: Partial<RecoveryCommandDependencies>, signal?: AbortSignal): Promise<number> {
  return createRecoveryCommand(dependencies)(argv, io, signal);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exitCode = await runRecoveryCli();
}
