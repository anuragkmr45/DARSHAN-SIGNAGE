import { describe, expect, it } from 'vitest';
import { encodeTargetNativeAuthorityRequest, parseTargetNativeAuthorityResult,
  parseTargetNativeAuthorityRequest, type TargetNativeAuthorityRequest } from './target-native-authority-contracts';
import { TargetNativeResourceAuthorityClient, type SupervisorPrivateNativeAuthorityChannel } from './target-native-resource-authority';

const digest = (character: string) => character.repeat(64);
const challengeNonce = '0123456789abcdef0123456789abcdef';
const request = (overrides: Partial<TargetNativeAuthorityRequest> = {}): TargetNativeAuthorityRequest => ({
  format: 'darshan-recovery-target-native-authority-v2', kind: 'ACQUIRE', operation: 'PREPARE',
  installationId: '10000000-0000-4000-8000-000000000001', siteId: 'fixture_site',
  hostInstallationId: '20000000-0000-4000-8000-000000000002',
  operationId: '30000000-0000-4000-8000-000000000003', generation: 9n,
  targetSetId: digest('a'), targetHandle: 'rtea:v1:target:abcdefghijklmnop', profileSha256: digest('b'),
  enrollmentSha256: digest('c'), admissionSha256: digest('d'), outerEnvelopeSha256: digest('e'),
  requestSha256: digest('f'), authorizationSha256: digest('1'), deadlineUnixMs: 1_001_000n,
  supervisorInstanceSha256: digest('2'), supervisorGeneration: 7n, reconciledGeneration: 7n, challengeNonce, ...overrides,
});
const sessionToken = 'a'.repeat(64);
const result = (overrides: Record<string, string> = {}, bound = request(), token = sessionToken) => Buffer.from([
  'format=darshan-recovery-target-native-authority-result-v2', 'kind=ACQUIRED', 'outcome=LEASED',
  `session_handle=rtea:v1:session:${token}`,
  `lease_proof_sha256=${createHash('sha256').update(encodeTargetNativeAuthorityRequest(bound)).update(token).digest('hex')}`,
  `authority_instance_sha256=${digest('2')}`, 'supervisor_generation=7',
  'reconciliation_required=false', 'sanitized_code=OK', `challenge_nonce=${bound.challengeNonce}`,
].map((line) => {
  const key = line.slice(0, line.indexOf('=')); return `${key}=${overrides[key] ?? line.slice(line.indexOf('=') + 1)}`;
}).join('\n') + '\n');

describe('native target authority contracts', () => {
  it('emits one fixed bounded canonical frame with every fencing binding', () => {
    const bytes = encodeTargetNativeAuthorityRequest(request());
    expect(bytes.toString()).toContain('outer_envelope_sha256=');
    expect(bytes.toString()).toContain('request_sha256=');
    expect(bytes.toString()).toContain('reconciled_generation=7\n');
    expect(bytes.toString()).not.toMatch(/(?:path|argv|endpoint|environment|credential|secret|PURGE)/i);
  });

  it('rejects mutation before current-instance reconciliation and accepts readonly observation', () => {
    expect(() => encodeTargetNativeAuthorityRequest(request({ reconciledGeneration: 6n }))).toThrow(/reconciliation/i);
    expect(() => encodeTargetNativeAuthorityRequest(request({ operation: 'INSPECT', reconciledGeneration: 6n }))).not.toThrow();
  });

  it.each([
    ['partial', result().subarray(0, -1)], ['trailing', Buffer.concat([result(), Buffer.from('x')])],
    ['noncanonical number', result({ supervisor_generation: '07' })], ['unknown field', Buffer.concat([result(), Buffer.from('x=y\n')])],
  ])('rejects %s result frames', (_name, bytes) => expect(() => parseTargetNativeAuthorityResult(bytes)).toThrow());

  it('holds one lease until explicit release and binds the native result', async () => {
    let released = 0; const challenges = [challengeNonce, '3123456789abcdef0123456789abcdef'];
    const channel: SupervisorPrivateNativeAuthorityChannel = {
      descriptor: 9,
      acquire: async (frame) => result({}, parseTargetNativeAuthorityRequest(frame)),
      release: async () => { released += 1; }, invalidate: async () => undefined,
    };
    const client = TargetNativeResourceAuthorityClient.createTestOnly(channel, () => 1_000_000n, () => challenges.shift()!); const controller = new AbortController();
    const lease = await client.acquire(request(), controller.signal);
    await expect(client.acquire(request(), controller.signal)).rejects.toThrow(/already active/);
    await lease.release(); await lease.release(); expect(released).toBe(1);
    const next = await client.acquire(request(), controller.signal); await next.release(); expect(released).toBe(2);
  });

  it('rejects a non-private descriptor shape and cancellation before admission', async () => {
    expect(() => new TargetNativeResourceAuthorityClient({ descriptor: 2,
      acquire: async () => result(), release: async () => undefined, invalidate: async () => undefined })).toThrow(/private descriptor/);
    const channel: SupervisorPrivateNativeAuthorityChannel = { descriptor: 9,
      acquire: async () => result(), release: async () => undefined, invalidate: async () => undefined };
    const client = TargetNativeResourceAuthorityClient.createTestOnly(channel, () => 1_000_000n, () => challengeNonce); const controller = new AbortController(); controller.abort();
    await expect(client.acquire(request(), controller.signal)).rejects.toThrow();
  });

  it('rejects authority-instance, generation, operation, and unsafe sanitized-result substitution', async () => {
    for (const bytes of [result({ authority_instance_sha256: digest('4') }), result({ supervisor_generation: '8' }),
      result({ outcome: 'READONLY' }), result({ sanitized_code: 'FAILED' })]) {
      const channel: SupervisorPrivateNativeAuthorityChannel = { descriptor: 9,
        acquire: async () => bytes, release: async () => undefined, invalidate: async () => undefined };
      await expect(TargetNativeResourceAuthorityClient.createTestOnly(channel, () => 1_000_000n, () => challengeNonce)
        .acquire(request(), new AbortController().signal)).rejects.toThrow();
    }
  });

  it('rejects a canonical lease replayed from a different exact request binding', async () => {
    const other = request({ operationId: '40000000-0000-4000-8000-000000000004' }); let released = 0;
    const channel: SupervisorPrivateNativeAuthorityChannel = { descriptor: 9,
      acquire: async () => result({}, other), release: async () => { released += 1; }, invalidate: async () => undefined };
    await expect(TargetNativeResourceAuthorityClient.createTestOnly(channel, () => 1_000_000n, () => challengeNonce)
      .acquire(request(), new AbortController().signal)).rejects.toThrow(/exact request binding/);
    expect(released).toBe(1);
  });

  it('rechecks deadline and cancellation after acquisition and releases the acquired session', async () => {
    for (const mode of ['deadline', 'abort'] as const) {
      let released = 0; let calls = 0; const controller = new AbortController();
      const channel: SupervisorPrivateNativeAuthorityChannel = { descriptor: 9,
        acquire: async () => { if (mode === 'abort') controller.abort(); return result(); },
        release: async () => { released += 1; }, invalidate: async () => undefined };
      const client = TargetNativeResourceAuthorityClient.createTestOnly(channel,
        () => mode === 'deadline' && calls++ > 0 ? 1_001_001n : 1_000_000n, () => challengeNonce);
      await expect(client.acquire(request(), controller.signal)).rejects.toThrow(); expect(released).toBe(1);
    }
  });

  it('retains a recoverable active handle when release fails', async () => {
    let fail = true; const channel: SupervisorPrivateNativeAuthorityChannel = { descriptor: 9,
      acquire: async () => result(), release: async () => { if (fail) throw new Error('release failed'); }, invalidate: async () => undefined };
    const client = TargetNativeResourceAuthorityClient.createTestOnly(channel, () => 1_000_000n, () => challengeNonce);
    const lease = await client.acquire(request(), new AbortController().signal);
    await expect(lease.release()).rejects.toThrow(/release failed/);
    await expect(client.acquire(request(), new AbortController().signal)).rejects.toThrow(/already active/);
    fail = false; await client.releaseActive();
  });

  it('invalidates the private descriptor when a dispatched response has no recoverable session handle', async () => {
    let invalidated = 0; const channel: SupervisorPrivateNativeAuthorityChannel = { descriptor: 9,
      acquire: async () => Buffer.from('bad\n'), release: async () => undefined,
      invalidate: async () => { invalidated += 1; } };
    const client = TargetNativeResourceAuthorityClient.createTestOnly(channel, () => 1_000_000n, () => challengeNonce);
    await expect(client.acquire(request(), new AbortController().signal)).rejects.toThrow(); expect(invalidated).toBe(1);
    await expect(client.acquire(request(), new AbortController().signal)).rejects.toThrow(/invalidated/);
  });

  it('serializes idempotent release for the immutable lease handle and cannot clear a newer lease', async () => {
    let acquisitions = 0; const released: string[] = []; const challenges = [challengeNonce, '1123456789abcdef0123456789abcdef'];
    const channel: SupervisorPrivateNativeAuthorityChannel = { descriptor: 9,
      acquire: async (frame) => { const bound = parseTargetNativeAuthorityRequest(frame); const token = (++acquisitions).toString(16).padStart(64, 'a'); return result({}, bound, token); },
      release: async (handle) => { await Promise.resolve(); released.push(handle); }, invalidate: async () => undefined };
    const client = TargetNativeResourceAuthorityClient.createTestOnly(channel, () => 1_000_000n, () => challenges.shift()!);
    const first = await client.acquire(request(), new AbortController().signal);
    await Promise.all([first.release(), first.release(), first.release()]); expect(released).toEqual([first.result.sessionHandle]);
    const second = await client.acquire(request(), new AbortController().signal); await first.release();
    await expect(client.acquire(request(), new AbortController().signal)).rejects.toThrow(/already active/);
    await second.release(); expect(released).toEqual([first.result.sessionHandle, second.result.sessionHandle]);
  });

  it('freezes the canonical request before dispatch and caller mutation cannot extend its deadline or alter proof checks', async () => {
    let resolve!: () => void; const gate = new Promise<void>((done) => { resolve = done; }); let released = 0; let calls = 0;
    const mutable = request(); const channel: SupervisorPrivateNativeAuthorityChannel = { descriptor: 9,
      acquire: async (frame) => { const bound = parseTargetNativeAuthorityRequest(frame); await gate; return result({}, bound); },
      release: async () => { released += 1; }, invalidate: async () => undefined };
    const client = TargetNativeResourceAuthorityClient.createTestOnly(channel, () => calls++ === 0 ? 1_000_000n : 1_001_001n, () => challengeNonce);
    const pending = client.acquire(mutable, new AbortController().signal); mutable.deadlineUnixMs = 9_999_999n;
    mutable.outerEnvelopeSha256 = digest('9'); mutable.operation = 'INSPECT'; resolve();
    await expect(pending).rejects.toThrow(/deadline/i); expect(released).toBe(1);
  });

  it('never reuses a challenge and rejects an identical-request released response replay', async () => {
    let oldResponse: Buffer | undefined; let releases = 0;
    const repeatedChallenge = () => challengeNonce; const channel: SupervisorPrivateNativeAuthorityChannel = { descriptor: 9,
      acquire: async (frame) => oldResponse ??= result({}, parseTargetNativeAuthorityRequest(frame)),
      release: async () => { releases += 1; }, invalidate: async () => undefined };
    const client = TargetNativeResourceAuthorityClient.createTestOnly(channel, () => 1_000_000n, repeatedChallenge);
    const first = await client.acquire(request(), new AbortController().signal); await first.release();
    await expect(client.acquire(request(), new AbortController().signal)).rejects.toThrow(/challenge was already used/);
    expect(releases).toBe(1);
    oldResponse = undefined; const challenges = [challengeNonce, '2123456789abcdef0123456789abcdef'];
    const replayClient = TargetNativeResourceAuthorityClient.createTestOnly(channel, () => 1_000_000n, () => challenges.shift()!);
    const accepted = await replayClient.acquire(request(), new AbortController().signal); await accepted.release();
    await expect(replayClient.acquire(request(), new AbortController().signal)).rejects.toThrow(/exact request binding/);
  });
});
import { createHash } from 'node:crypto';
