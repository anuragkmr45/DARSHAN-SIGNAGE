import { describe, expect, it, vi } from 'vitest';
import { createRecoveryCommand } from '../../scripts/recovery-cli';
import { RecoveryError } from './errors';

function io() { const stdout: string[] = []; const stderr: string[] = []; return { stdout, stderr,
  value: { stdout: (text: string) => stdout.push(text), stderr: (text: string) => stderr.push(text) } }; }

describe('recovery CLI', () => {
  it('emits exactly one versioned JSON result and maps argv to injected discovery', async () => {
    const output = io(); const discover = vi.fn().mockResolvedValue({ candidates: [], nextAfterRunId: null, journalRevision: 2 });
    const exit = await createRecoveryCommand({ discover })(['discover', '--config-file', '/config', '--limit', '3', '--json'], output.value);
    expect(exit).toBe(0); expect(output.stdout).toHaveLength(1); expect(output.stderr).toEqual([]);
    expect(JSON.parse(output.stdout[0])).toMatchObject({ format: 'darshan-recovery-cli-result-v1', command: 'discover',
      status: 'SUCCESS', code: 'RECOVERY_OK', retryable: false });
    expect(discover).toHaveBeenCalledWith({ configFile: '/config', limit: 3, afterRunId: undefined });
  });

  it('redacts thrown secrets, emits no raw path in plan JSON, and has deterministic exits', async () => {
    const secret = 'SECRET-CANARY-DO-NOT-PRINT'; const failure = io();
    const exit = await createRecoveryCommand({ discover: async () => { throw new RecoveryError('RECOVERY_INPUT_INVALID', secret); } })(
      ['discover', '--config-file', `/tmp/${secret}`, '--json'], failure.value);
    expect(exit).toBe(3); expect(failure.stdout).toHaveLength(1); expect(failure.stdout[0]).not.toContain(secret); expect(failure.stderr).toEqual([]);
    const planOutput = `/private/${secret}/plan.json`; const success = io(); const plan = {
      plan: { planId: '11111111-1111-4111-8111-111111111111', operationId: '22222222-2222-4222-8222-222222222222',
        source: { runId: '33333333-3333-4333-8333-333333333333', manifestSha256: 'a'.repeat(64) },
        target: { targetId: 'darshan-server-release-01', releaseId: 'release-01' } }, planSha256: 'b'.repeat(64), planOutput, journalRevision: 8,
    } as never;
    expect(await createRecoveryCommand({ plan: async () => plan })(['plan', '--config-file', '/c', '--run-id', '33333333-3333-4333-8333-333333333333',
      '--manifest-sha256', 'a'.repeat(64), '--plan-output', planOutput, '--json'], success.value)).toBe(0);
    expect(success.stdout[0]).not.toContain('/private'); expect(success.stdout[0]).not.toContain(secret);
  });

  it('prints help without importing application configuration or requiring runtime environment', async () => {
    const output = io(); expect(await createRecoveryCommand()(['--help'], output.value)).toBe(0);
    expect(output.stdout.join('')).toContain('recovery-cli discover'); expect(output.stderr).toEqual([]);
  });

  it('returns the bounded cancellation envelope before dispatch', async () => {
    const output = io(); const controller = new AbortController();
    controller.abort(new RecoveryError('RECOVERY_CANCELLED', 'SECRET-CANCELLATION-DETAIL'));
    const discover = vi.fn();
    const exit = await createRecoveryCommand({ discover })(['discover', '--config-file', '/config', '--json'], output.value, controller.signal);
    expect(exit).toBe(130); expect(discover).not.toHaveBeenCalled(); expect(output.stderr).toEqual([]);
    expect(output.stdout[0]).not.toContain('SECRET-CANCELLATION-DETAIL');
    expect(JSON.parse(output.stdout[0])).toMatchObject({ code: 'RECOVERY_CANCELLED', status: 'ERROR' });
  });

  it('normalizes an unclassified read-only abort to cancellation', async () => {
    const output = io(); const controller = new AbortController();
    const discover = vi.fn(async () => {
      controller.abort();
      controller.signal.throwIfAborted();
    });
    const exit = await createRecoveryCommand({ discover })(['discover', '--config-file', '/config', '--json'], output.value, controller.signal);
    expect(exit).toBe(130); expect(discover).toHaveBeenCalledTimes(1); expect(output.stderr).toEqual([]);
    expect(JSON.parse(output.stdout[0])).toMatchObject({ code: 'RECOVERY_CANCELLED', status: 'ERROR' });
  });

  it('preserves dispatched mutation ambiguity when the signal is also aborted', async () => {
    const output = io(); const controller = new AbortController();
    const hold = vi.fn(async () => {
      controller.abort(new RecoveryError('RECOVERY_CANCELLED', 'signal reason'));
      throw new RecoveryError('RECOVERY_BROKER_EFFECT_AMBIGUOUS', 'SECRET-DISPATCHED-DETAIL');
    });
    const exit = await createRecoveryCommand({ hold })(['hold', '--config-file', '/config', '--plan-file', '/plan',
      '--plan-sha256', 'a'.repeat(64), '--json'], output.value, controller.signal);
    expect(exit).toBe(7); expect(hold).toHaveBeenCalledTimes(1); expect(output.stderr).toEqual([]);
    expect(output.stdout[0]).not.toContain('SECRET-DISPATCHED-DETAIL');
    expect(JSON.parse(output.stdout[0])).toMatchObject({ code: 'RECOVERY_BROKER_EFFECT_AMBIGUOUS', status: 'ERROR' });
  });

  it('allows help only as the sole argument and keeps --json misuse in one versioned JSON envelope', async () => {
    const output = io(); const exit = await createRecoveryCommand()(['--json', '--help'], output.value);
    expect(exit).toBe(3); expect(output.stdout).toHaveLength(1); expect(output.stderr).toEqual([]);
    expect(output.stdout[0]).not.toContain('Usage:');
    expect(JSON.parse(output.stdout[0])).toMatchObject({ format: 'darshan-recovery-cli-result-v1', status: 'ERROR',
      code: 'RECOVERY_INPUT_INVALID' });
  });

  it.each([
    [['discover', '--config-file', '/c', '--limit', '1e2', '--json'], 'RECOVERY_INPUT_INVALID'],
    [['discover', '--config-file', '/c', '--after-run-id', 'not-a-uuid', '--json'], 'RECOVERY_ID_INVALID'],
    [['plan', '--config-file', '/c', '--run-id', '33333333-3333-4333-8333-333333333333', '--manifest-sha256', 'bad',
      '--plan-output', '/p', '--json'], 'RECOVERY_DIGEST_INVALID'],
    [['release', '--config-file', '/c', '--plan-file', '/p', '--plan-sha256', 'a'.repeat(64), '--review-file', '/r',
      '--review-sha256', 'b'.repeat(64), '--confirm-operation-id', '22222222-2222-4222-8222-22222222222A', '--json'], 'RECOVERY_ID_INVALID'],
  ] as const)('maps malformed identifiers, digests, and limits to the input exit category', async (argv, code) => {
    const output = io(); const exit = await createRecoveryCommand()(Array.from(argv), output.value);
    expect(exit).toBe(3); expect(output.stdout).toHaveLength(1); expect(JSON.parse(output.stdout[0])).toMatchObject({ code });
  });

  it('parses hold, verify-source, resume, and offline status without exposing lifecycle fences', async () => {
    const canary = 'SECRET-CANARY-OWNER-FENCE-PATH';
    const base = { operationId: '22222222-2222-4222-8222-222222222222', phase: 'SOURCE_HELD' as const,
      pendingPhase: null, failureCode: null, brokerTruth: 'ACTIVE' as const, nextAction: 'VERIFY_SOURCE' as const,
      ownerToken: canary, fenceToken: canary, configFile: `/private/${canary}` };
    const hold = vi.fn().mockResolvedValue(base); const verifySource = vi.fn().mockResolvedValue({ ...base, phase: 'SOURCE_VERIFIED' });
    const resume = vi.fn().mockResolvedValue(base); const status = vi.fn().mockResolvedValue({ ...base, brokerTruth: 'UNKNOWN' });
    for (const command of ['hold', 'verify-source', 'resume'] as const) {
      const output = io(); const exit = await createRecoveryCommand({ hold, verifySource, resume, status })([command,
        '--config-file', '/config', '--plan-file', '/plan', '--plan-sha256', 'a'.repeat(64), '--json'], output.value);
      expect(exit).toBe(0); expect(output.stderr).toEqual([]); expect(output.stdout[0]).not.toMatch(/owner|fence|token/i);
      expect(output.stdout[0]).not.toContain(canary); expect(output.stdout[0]).not.toContain('/private');
    }
    const output = io(); expect(await createRecoveryCommand({ status })(['status', '--config-file', '/config',
      '--plan-file', '/plan', '--plan-sha256', 'a'.repeat(64), '--offline', '--json'], output.value)).toBe(0);
    expect(status).toHaveBeenCalledWith({ configFile: '/config', planFile: '/plan', planSha256: 'a'.repeat(64), offline: true });
  });

  it('rejects offline outside status and missing exact plan digest', async () => {
    for (const argv of [
      ['hold', '--config-file', '/c', '--plan-file', '/p', '--plan-sha256', 'a'.repeat(64), '--offline', '--json'],
      ['status', '--config-file', '/c', '--plan-file', '/p', '--json'],
    ]) {
      const output = io(); expect(await createRecoveryCommand()(argv, output.value)).toBe(3);
      expect(JSON.parse(output.stdout[0])).toMatchObject({ code: 'RECOVERY_INPUT_INVALID' });
    }
  });

  it.each(['release', 'abandon'] as const)('requires and forwards exact protected review and confirmation for %s', async (command) => {
    const operationId = '22222222-2222-4222-8222-222222222222';
    const result = { operationId, phase: 'SOURCE_HELD' as const, pendingPhase: null, failureCode: null,
      brokerTruth: command === 'release' ? 'RELEASED' as const : 'UNCERTAIN' as const, nextAction: 'OPERATOR_REVIEW' as const,
      closure: { decisionId: '11111111-1111-4111-8111-111111111111',
        closedAs: command === 'release' ? 'ABORTED_PRE_IMPORT' as const : 'ABANDONED' as const,
        action: command === 'release' ? 'RELEASE' as const : 'MARK_UNCERTAIN' as const, status: 'CONFIRMED' as const, failureCode: null } };
    const disposition = vi.fn().mockResolvedValue(result); const output = io();
    const argv = [command, '--config-file', '/config', '--plan-file', '/plan', '--plan-sha256', 'a'.repeat(64),
      '--review-file', '/protected/review.json', '--review-sha256', 'b'.repeat(64), '--confirm-operation-id', operationId, '--json'];
    expect(await createRecoveryCommand(command === 'release' ? { release: disposition } : { abandon: disposition })(argv, output.value)).toBe(0);
    expect(disposition).toHaveBeenCalledWith({ configFile: '/config', planFile: '/plan', planSha256: 'a'.repeat(64),
      reviewFile: '/protected/review.json', reviewSha256: 'b'.repeat(64), confirmOperationId: operationId });
    expect(output.stdout[0]).not.toContain('/protected');
    expect(JSON.parse(output.stdout[0])).toMatchObject({ command, data: { operationId, closure: { status: 'CONFIRMED' } } });
  });

  it('maps invalid review to input exit, contradictory terminal truth to reconciliation exit, and uses neutral text', async () => {
    const operationId = '22222222-2222-4222-8222-222222222222';
    const argv = ['release', '--config-file', '/c', '--plan-file', '/p', '--plan-sha256', 'a'.repeat(64),
      '--review-file', '/r', '--review-sha256', 'b'.repeat(64), '--confirm-operation-id', operationId, '--json'];
    for (const [code, expectedExit] of [['RECOVERY_REVIEW_INVALID', 3], ['RECOVERY_DISPOSITION_TRUTH_CONFLICT', 7]] as const) {
      const output = io(); const release = async () => { throw new RecoveryError(code, 'SECRET-CANARY'); };
      expect(await createRecoveryCommand({ release })(argv, output.value)).toBe(expectedExit);
      expect(output.stdout[0]).not.toContain('SECRET-CANARY'); expect(JSON.parse(output.stdout[0])).toMatchObject({ code });
    }
    const output = io(); const release = vi.fn().mockResolvedValue({ operationId, phase: 'SOURCE_HELD', pendingPhase: null,
      failureCode: null, brokerTruth: 'RELEASED', nextAction: 'NONE', closure: null });
    expect(await createRecoveryCommand({ release })(argv.slice(0, -1), output.value)).toBe(0);
    expect(output.stdout).toEqual(['release completed successfully.\n']);
  });
});
