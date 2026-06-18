import { createHash, randomUUID } from 'crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { getRecentLogs } from '@/utils/logger';
import { getObservabilityRegistry, resetObservabilityMetricsForTests } from '@/observability/metrics';
import {
  buildDeviceSocketReplayHash,
  buildDeviceSocketReplayKey,
  checkDeviceSocketReplay,
  ValkeyDeviceSocketReplayStore,
  type DeviceSocketReplayCommandClient,
  type DeviceSocketReplayStore,
} from '@/realtime/device-socket-replay';

class FakeCommandClient implements DeviceSocketReplayCommandClient {
  readonly calls: Array<Array<string | number>> = [];

  constructor(private readonly responses: Array<string | number | null | unknown[] | Error>) {}

  async command(parts: Array<string | number>) {
    this.calls.push(parts);
    const next = this.responses.shift();
    if (next instanceof Error) throw next;
    return next ?? null;
  }

  async close() {
    return undefined;
  }
}

class ExpiringReplayStore implements DeviceSocketReplayStore {
  readonly calls: Array<{ deviceId: string; serial: string; nonce: string; ttlMs: number }> = [];
  private readonly entries = new Map<string, number>();

  constructor(private readonly nowMs: () => number) {}

  async storeNonce(input: { deviceId: string; serial: string; nonce: string; ttlMs: number }) {
    this.calls.push(input);
    const key = `${input.deviceId}:${input.serial}:${input.nonce}`;
    const expiresAt = this.entries.get(key);
    if (expiresAt && expiresAt > this.nowMs()) {
      return { status: 'replay' as const };
    }
    this.entries.set(key, this.nowMs() + input.ttlMs);
    return { status: 'stored' as const };
  }

  async close() {
    this.entries.clear();
  }
}

describe('device socket replay protection', () => {
  beforeEach(() => {
    resetObservabilityMetricsForTests();
  });

  it('builds a hashed socket-specific replay key without raw identifiers', () => {
    const deviceId = randomUUID();
    const serial = 'serial-for-replay-test';
    const nonce = 'a'.repeat(32);
    const hash = buildDeviceSocketReplayHash({ deviceId, serial, nonce });
    const expected = createHash('sha256')
      .update(['DARSHAN_DEVICE_SOCKET_AUTH_V1', 'CONNECT', '/device', deviceId, serial, nonce].join('\n'))
      .digest('hex');
    const key = buildDeviceSocketReplayKey('darshan:test', hash);

    expect(hash).toBe(expected);
    expect(hash).toHaveLength(64);
    expect(key).toBe(`darshan:test:device-socket-auth-replay:v1:${hash}`);
    expect(key).not.toContain(deviceId);
    expect(key).not.toContain(serial);
    expect(key).not.toContain(nonce);
  });

  it('stores first-use nonces through Valkey SET NX PX', async () => {
    const client = new FakeCommandClient(['OK']);
    const store = new ValkeyDeviceSocketReplayStore({
      url: 'redis://127.0.0.1:6379',
      namespace: 'darshan:test',
      tlsEnabled: false,
      commandTimeoutMs: 50,
      client,
    });
    const deviceId = randomUUID();
    const serial = 'serial-for-valkey-set';
    const nonce = 'b'.repeat(32);

    const result = await store.storeNonce({ deviceId, serial, nonce, ttlMs: 123_000 });

    expect(result).toEqual({ status: 'stored' });
    expect(client.calls).toEqual([
      [
        'SET',
        buildDeviceSocketReplayKey('darshan:test', buildDeviceSocketReplayHash({ deviceId, serial, nonce })),
        '1',
        'NX',
        'PX',
        123_000,
      ],
    ]);
  });

  it('treats missing Valkey SET NX responses as replay attempts', async () => {
    const client = new FakeCommandClient([null]);
    const store = new ValkeyDeviceSocketReplayStore({
      url: 'redis://127.0.0.1:6379',
      namespace: 'darshan:test',
      tlsEnabled: false,
      commandTimeoutMs: 50,
      client,
    });

    await expect(
      store.storeNonce({
        deviceId: randomUUID(),
        serial: 'serial-for-valkey-replay',
        nonce: 'c'.repeat(32),
        ttlMs: 300_000,
      })
    ).resolves.toEqual({ status: 'replay' });
  });

  it('accepts duplicates after TTL expiry when the store expires entries', async () => {
    let now = 10_000;
    const store = new ExpiringReplayStore(() => now);
    const input = {
      deviceId: randomUUID(),
      serial: 'serial-for-ttl',
      nonce: 'd'.repeat(32),
    };

    await expect(
      checkDeviceSocketReplay(input, {
        enabled: true,
        ttlMs: 100,
        failClosed: false,
        store,
      })
    ).resolves.toEqual({ ok: true, result: 'accepted', reason: 'stored' });
    await expect(
      checkDeviceSocketReplay(input, {
        enabled: true,
        ttlMs: 100,
        failClosed: false,
        store,
      })
    ).resolves.toEqual({ ok: false, result: 'rejected', reason: 'replay_detected' });

    now += 101;

    await expect(
      checkDeviceSocketReplay(input, {
        enabled: true,
        ttlMs: 100,
        failClosed: false,
        store,
      })
    ).resolves.toEqual({ ok: true, result: 'accepted', reason: 'stored' });
  });

  it('bypasses replay protection when disabled without touching the store', async () => {
    const store = new ExpiringReplayStore(() => Date.now());

    await expect(
      checkDeviceSocketReplay(
        {
          deviceId: randomUUID(),
          serial: 'serial-for-disabled',
          nonce: 'e'.repeat(32),
        },
        {
          enabled: false,
          ttlMs: 300_000,
          failClosed: true,
          store,
        }
      )
    ).resolves.toEqual({ ok: true, result: 'bypassed', reason: 'disabled' });
    expect(store.calls).toHaveLength(0);
  });

  it('handles Valkey unavailability with fail-open and fail-closed modes', async () => {
    const store = new ValkeyDeviceSocketReplayStore({
      url: undefined,
      namespace: 'darshan:test',
      tlsEnabled: false,
      commandTimeoutMs: 50,
      client: new FakeCommandClient([]),
    });
    const input = {
      deviceId: randomUUID(),
      serial: 'serial-for-unavailable',
      nonce: 'f'.repeat(32),
    };

    await expect(
      checkDeviceSocketReplay(input, {
        enabled: true,
        ttlMs: 300_000,
        failClosed: false,
        store,
      })
    ).resolves.toEqual({ ok: true, result: 'error', reason: 'store_unavailable' });
    await expect(
      checkDeviceSocketReplay(input, {
        enabled: true,
        ttlMs: 300_000,
        failClosed: true,
        store,
      })
    ).resolves.toEqual({ ok: false, result: 'error', reason: 'store_unavailable' });
  });

  it('handles Valkey store errors with fail-open and fail-closed modes', async () => {
    const store = new ValkeyDeviceSocketReplayStore({
      url: 'redis://127.0.0.1:6379',
      namespace: 'darshan:test',
      tlsEnabled: false,
      commandTimeoutMs: 50,
      client: new FakeCommandClient([new Error('raw valkey error'), new Error('raw valkey error')]),
    });
    const input = {
      deviceId: randomUUID(),
      serial: 'serial-for-error',
      nonce: '0'.repeat(32),
    };

    await expect(
      checkDeviceSocketReplay(input, {
        enabled: true,
        ttlMs: 300_000,
        failClosed: false,
        store,
      })
    ).resolves.toEqual({ ok: true, result: 'error', reason: 'store_error' });
    await expect(
      checkDeviceSocketReplay(input, {
        enabled: true,
        ttlMs: 300_000,
        failClosed: true,
        store,
      })
    ).resolves.toEqual({ ok: false, result: 'error', reason: 'store_error' });
  });

  it('records bounded replay metrics and redacted replay logs', async () => {
    const deviceId = randomUUID();
    const serial = 'serial-for-log-redaction';
    const nonce = '1'.repeat(32);
    const store = new ExpiringReplayStore(() => Date.now());

    await checkDeviceSocketReplay(
      { deviceId, serial, nonce },
      { enabled: true, ttlMs: 300_000, failClosed: false, store }
    );
    await checkDeviceSocketReplay(
      { deviceId, serial, nonce },
      { enabled: true, ttlMs: 300_000, failClosed: false, store }
    );

    const output = await getObservabilityRegistry().metrics();
    const replayLog = getRecentLogs({ level: 'warn', limit: 10 }).find(
      (entry) => entry.message === 'Device socket auth replay rejected'
    );
    const encodedLog = JSON.stringify(replayLog ?? {});
    const replayKey = buildDeviceSocketReplayKey('darshan:test', buildDeviceSocketReplayHash({ deviceId, serial, nonce }));

    expect(output).toContain(
      'darshan_server_device_socket_auth_replay_total{namespace="/device",result="accepted",reason="stored"} 1'
    );
    expect(output).toContain(
      'darshan_server_device_socket_auth_replay_total{namespace="/device",result="rejected",reason="replay_detected"} 1'
    );
    expect(replayLog?.context).toEqual({ category: 'replay_detected' });
    expect(encodedLog).not.toContain(deviceId);
    expect(encodedLog).not.toContain(serial);
    expect(encodedLog).not.toContain(nonce);
    expect(encodedLog).not.toContain(replayKey);
  });
});
