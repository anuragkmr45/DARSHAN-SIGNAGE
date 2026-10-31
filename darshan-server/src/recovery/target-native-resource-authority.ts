import { createHash, randomBytes } from 'node:crypto';
import { RecoveryError } from './errors';
import { assertTargetNativeAuthorityDeadline, encodeTargetNativeAuthorityRequest, parseTargetNativeAuthorityRequest,
  parseTargetNativeAuthorityResult, type TargetNativeAuthorityRequest,
  type TargetNativeAuthorityRequestInput, type TargetNativeAuthorityResult } from './target-native-authority-contracts';

/**
 * The transport is deliberately descriptor-shaped and has no pathname,
 * executable, argv, daemon endpoint, environment, credential, or generic exec
 * surface. The native side must verify SO_PEERCRED on an unnamed private Unix
 * SOCK_SEQPACKET descriptor; this TypeScript claim is never sufficient by
 * itself and production does not construct this client in this packet.
 */
export interface SupervisorPrivateNativeAuthorityChannel {
  readonly descriptor: number;
  acquire(frame: Uint8Array, signal: AbortSignal): Promise<Uint8Array>;
  release(sessionHandle: string): Promise<void>;
  invalidate(): Promise<void>;
}

export interface TargetNativeAuthorityLease {
  readonly result: TargetNativeAuthorityResult;
  release(): Promise<void>;
}

export class TargetNativeResourceAuthorityClient {
  private active = false;
  private activeHandle: string | undefined;
  private invalidated = false;
  private readonly releases = new Map<string, Promise<void>>();
  private readonly seenChallenges = new Set<string>();
  private nowUnixMs: () => bigint = () => BigInt(Date.now());
  private mintChallenge: () => string = () => randomBytes(16).toString('hex');

  constructor(private readonly channel: SupervisorPrivateNativeAuthorityChannel) {
    if (!Number.isSafeInteger(channel.descriptor) || channel.descriptor < 3) {
      throw new RecoveryError('RECOVERY_TARGET_AUTH_INVALID',
        'Native authority requires a supervisor-owned private descriptor and kernel peer verification.');
    }
  }

  /** Compile-free in-memory fixture seam. Production construction always uses
   * Date.now() and crypto.randomBytes(16); this factory must never be wired by
   * a runtime selector or constrained native adapter. */
  static createTestOnly(channel: SupervisorPrivateNativeAuthorityChannel, nowUnixMs: () => bigint,
      mintChallenge: () => string): TargetNativeResourceAuthorityClient {
    const client = new TargetNativeResourceAuthorityClient(channel);
    client.nowUnixMs = nowUnixMs; client.mintChallenge = mintChallenge; return client;
  }

  private releaseHandle(handle: string): Promise<void> {
    const existing = this.releases.get(handle); if (existing) return existing;
    const pending = (async () => {
      if (this.activeHandle !== handle) return;
      await this.channel.release(handle);
      if (this.activeHandle === handle) { this.activeHandle = undefined; this.active = false; }
    })();
    this.releases.set(handle, pending);
    void pending.finally(() => { if (this.releases.get(handle) === pending) this.releases.delete(handle); }).catch(() => undefined);
    return pending;
  }

  async releaseActive(): Promise<void> {
    const handle = this.activeHandle;
    if (!handle) {
      if (!this.active) return;
      throw new RecoveryError('RECOVERY_TARGET_EFFECT_AMBIGUOUS', 'Native authority dispatch has no recoverable session handle yet.');
    }
    await this.releaseHandle(handle);
  }

  async acquire(request: TargetNativeAuthorityRequestInput, signal: AbortSignal): Promise<TargetNativeAuthorityLease> {
    if (this.invalidated) throw new RecoveryError('RECOVERY_TARGET_TRANSPORT_FAILED', 'Native authority descriptor is invalidated.');
    if (this.active) throw new RecoveryError('RECOVERY_TARGET_REQUEST_CONFLICT', 'A native authority lease is already active.');
    const challengeNonce = this.mintChallenge();
    if (this.seenChallenges.has(challengeNonce)) {
      throw new RecoveryError('RECOVERY_TARGET_REQUEST_CONFLICT', 'Native authority challenge was already used by this client.');
    }
    this.seenChallenges.add(challengeNonce);
    const frame = encodeTargetNativeAuthorityRequest({ ...request, challengeNonce } as TargetNativeAuthorityRequest);
    const snapshot = parseTargetNativeAuthorityRequest(frame);
    signal.throwIfAborted(); assertTargetNativeAuthorityDeadline(snapshot, this.nowUnixMs()); this.active = true;
    let result: TargetNativeAuthorityResult | undefined; let dispatched = false;
    try {
      const pending = this.channel.acquire(frame, signal); dispatched = true; const bytes = await pending;
      result = parseTargetNativeAuthorityResult(bytes); this.activeHandle = result.sessionHandle;
      const token = result.sessionHandle.slice('rtea:v1:session:'.length);
      const expectedProof = createHash('sha256').update(frame).update(token, 'utf8').digest('hex');
      if (result.authorityInstanceSha256 !== snapshot.supervisorInstanceSha256 ||
          result.supervisorGeneration !== snapshot.supervisorGeneration || result.challengeNonce !== snapshot.challengeNonce ||
          (snapshot.operation === 'INSPECT') !== (result.outcome === 'READONLY') ||
          (snapshot.operation !== 'INSPECT' && result.reconciliationRequired) ||
          result.leaseProofSha256 !== expectedProof) {
        throw new RecoveryError('RECOVERY_TARGET_AUTH_INVALID', 'Native authority result differs from the exact request binding.');
      }
      assertTargetNativeAuthorityDeadline(snapshot, this.nowUnixMs()); signal.throwIfAborted();
    } catch (cause) {
      if (this.activeHandle) {
        try { await this.releaseActive(); }
        catch (releaseCause) {
          throw new RecoveryError('RECOVERY_TARGET_EFFECT_AMBIGUOUS',
            'Native authority response failed after lease acquisition and release did not complete.', { cause: releaseCause });
        }
      } else if (dispatched) {
        try { await this.channel.invalidate(); this.invalidated = true; this.active = false; }
        catch (invalidateCause) {
          throw new RecoveryError('RECOVERY_TARGET_EFFECT_AMBIGUOUS',
            'Native authority dispatch failed without a recoverable handle and descriptor invalidation failed.', { cause: invalidateCause });
        }
      } else { this.active = false; }
      throw cause;
    }
    const leaseHandle = result.sessionHandle; let released = false;
    return { result, release: async () => {
      if (released) return;
      await this.releaseHandle(leaseHandle); released = true;
    } };
  }
}
