import { createHash } from 'crypto';
import { config } from '@/config';
import { recordDeviceSocketAuthReplay } from '@/observability/metrics';
import { ValkeyCommandClient } from '@/realtime/valkey-resp-client';
import { createLogger } from '@/utils/logger';

const logger = createLogger('device-socket-replay');
const DEVICE_SOCKET_REPLAY_PREFIX = 'DARSHAN_DEVICE_SOCKET_AUTH_V1';
const DEVICE_SOCKET_REPLAY_ACTION = 'CONNECT';
export const DEVICE_SOCKET_REPLAY_NAMESPACE = '/device';

export type DeviceSocketReplayReason =
  | 'stored'
  | 'replay_detected'
  | 'disabled'
  | 'store_unavailable'
  | 'store_error'
  | 'unknown';

export type DeviceSocketReplayResult =
  | { ok: true; result: 'accepted'; reason: 'stored' }
  | { ok: true; result: 'bypassed'; reason: 'disabled' }
  | { ok: true; result: 'error'; reason: 'store_unavailable' | 'store_error' }
  | { ok: false; result: 'rejected'; reason: 'replay_detected' }
  | { ok: false; result: 'error'; reason: 'store_unavailable' | 'store_error' };

export type DeviceSocketReplayCommandClient = {
  command(parts: Array<string | number>): Promise<string | number | null | unknown[]>;
  close(): Promise<void>;
};

export type DeviceSocketReplayStore = {
  storeNonce(input: {
    deviceId: string;
    serial: string;
    nonce: string;
    ttlMs: number;
  }): Promise<{ status: 'stored' | 'replay' | 'unavailable' | 'error' }>;
  close(): Promise<void>;
};

export class ValkeyDeviceSocketReplayStore implements DeviceSocketReplayStore {
  private readonly client: DeviceSocketReplayCommandClient;

  constructor(
    private readonly options: {
      url?: string;
      namespace: string;
      tlsEnabled: boolean;
      commandTimeoutMs: number;
      client?: DeviceSocketReplayCommandClient;
    }
  ) {
    this.client =
      options.client ??
      new ValkeyCommandClient({
        url: options.url,
        tlsEnabled: options.tlsEnabled,
        commandTimeoutMs: options.commandTimeoutMs,
      });
  }

  async storeNonce(input: { deviceId: string; serial: string; nonce: string; ttlMs: number }) {
    if (!this.options.url) {
      return { status: 'unavailable' as const };
    }

    try {
      const result = await this.client.command([
        'SET',
        buildDeviceSocketReplayKey(this.options.namespace, buildDeviceSocketReplayHash(input)),
        '1',
        'NX',
        'PX',
        input.ttlMs,
      ]);

      if (result === 'OK') return { status: 'stored' as const };
      if (result === null) return { status: 'replay' as const };
      return { status: 'error' as const };
    } catch {
      return { status: 'error' as const };
    }
  }

  async close() {
    await this.client.close();
  }
}

let defaultReplayStore: DeviceSocketReplayStore | null = null;

export function buildDeviceSocketReplayHash(input: { deviceId: string; serial: string; nonce: string }) {
  return createHash('sha256')
    .update(
      [
        DEVICE_SOCKET_REPLAY_PREFIX,
        DEVICE_SOCKET_REPLAY_ACTION,
        DEVICE_SOCKET_REPLAY_NAMESPACE,
        input.deviceId,
        input.serial,
        input.nonce,
      ].join('\n')
    )
    .digest('hex');
}

export function buildDeviceSocketReplayKey(namespace: string, hash: string) {
  return `${namespace}:device-socket-auth-replay:v1:${hash}`;
}

export function createDeviceSocketReplayStore() {
  return new ValkeyDeviceSocketReplayStore({
    url: config.VALKEY_URL,
    namespace: config.VALKEY_NAMESPACE,
    tlsEnabled: config.VALKEY_TLS_ENABLED,
    commandTimeoutMs: config.REALTIME_VALKEY_PUBLISH_TIMEOUT_MS,
  });
}

function getDefaultReplayStore() {
  if (!defaultReplayStore) {
    defaultReplayStore = createDeviceSocketReplayStore();
  }
  return defaultReplayStore;
}

export async function resetDeviceSocketReplayStoreForTests() {
  await defaultReplayStore?.close();
  defaultReplayStore = null;
}

export async function checkDeviceSocketReplay(
  input: {
    deviceId: string;
    serial: string;
    nonce: string;
  },
  options: {
    enabled: boolean;
    ttlMs: number;
    failClosed: boolean;
    namespace?: string;
    store?: DeviceSocketReplayStore;
  }
): Promise<DeviceSocketReplayResult> {
  const namespace = options.namespace ?? DEVICE_SOCKET_REPLAY_NAMESPACE;

  if (!options.enabled) {
    recordDeviceSocketAuthReplay({ namespace, result: 'bypassed', reason: 'disabled' });
    return { ok: true, result: 'bypassed', reason: 'disabled' };
  }

  const store = options.store ?? getDefaultReplayStore();
  const storeResult = await store.storeNonce({
    deviceId: input.deviceId,
    serial: input.serial,
    nonce: input.nonce,
    ttlMs: options.ttlMs,
  });

  if (storeResult.status === 'stored') {
    recordDeviceSocketAuthReplay({ namespace, result: 'accepted', reason: 'stored' });
    return { ok: true, result: 'accepted', reason: 'stored' };
  }

  if (storeResult.status === 'replay') {
    recordDeviceSocketAuthReplay({ namespace, result: 'rejected', reason: 'replay_detected' });
    logger.warn({ category: 'replay_detected' }, 'Device socket auth replay rejected');
    return { ok: false, result: 'rejected', reason: 'replay_detected' };
  }

  const reason = storeResult.status === 'unavailable' ? 'store_unavailable' : 'store_error';
  recordDeviceSocketAuthReplay({ namespace, result: 'error', reason });
  logger.warn(
    { category: reason, fail_closed: options.failClosed },
    reason === 'store_unavailable'
      ? 'Device socket auth replay store unavailable'
      : 'Device socket auth replay store error'
  );

  if (options.failClosed) {
    return { ok: false, result: 'error', reason };
  }

  return { ok: true, result: 'error', reason };
}
