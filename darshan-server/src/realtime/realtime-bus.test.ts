import { afterEach, describe, expect, it } from 'vitest';
import { resolveValkeyUrl } from '@/config';
import { InMemoryDeviceNodeRegistry, ValkeyDeviceNodeRegistry } from '@/realtime/device-node-registry';
import { InMemoryRealtimeBus, ValkeyRealtimeBus } from '@/realtime/realtime-bus';
import {
  initializeRealtimeFanout,
  publishWakeToDevice,
  registerDeviceForFanout,
  resetRealtimeFanoutForTests,
} from '@/realtime/realtime-fanout';
import { resetObservabilityMetricsForTests } from '@/observability/metrics';

describe('realtime bus and Valkey fanout safety', () => {
  afterEach(async () => {
    await resetRealtimeFanoutForTests();
    resetObservabilityMetricsForTests();
  });

  it('publishes notification-only messages through the in-memory bus', async () => {
    const bus = new InMemoryRealtimeBus();
    const received: unknown[] = [];
    await bus.subscribeNode('node-a', (message) => {
      received.push(message);
    });

    const result = await bus.publishToNode('node-a', {
      type: 'COMMAND_AVAILABLE',
      device_id: 'device-1',
      command_hint: { command_id: 'command-1' },
    });

    expect(result).toMatchObject({ status: 'published' });
    expect(received).toEqual([
      {
        type: 'COMMAND_AVAILABLE',
        device_id: 'device-1',
        command_hint: { command_id: 'command-1' },
      },
    ]);
  });

  it('enforces the WebSocket notification hard payload limit before publishing', async () => {
    const bus = new ValkeyRealtimeBus({
      url: undefined,
      namespace: 'test',
      tlsEnabled: false,
      publishTimeoutMs: 50,
      reconnectMinMs: 10,
      reconnectMaxMs: 20,
      pubsubEnabled: true,
    });

    const result = await bus.publishToNode('node-a', {
      type: 'COMMAND_AVAILABLE',
      device_id: 'device-1',
      data: 'x'.repeat(40_000),
    });

    expect(result.status).toBe('payload_too_large');
  });

  it('returns unavailable instead of throwing when Valkey is not configured', async () => {
    const bus = new ValkeyRealtimeBus({
      url: undefined,
      namespace: 'test',
      tlsEnabled: false,
      publishTimeoutMs: 50,
      reconnectMinMs: 10,
      reconnectMaxMs: 20,
      pubsubEnabled: true,
    });

    const result = await bus.publishToNode('node-a', {
      type: 'COMMAND_AVAILABLE',
      device_id: 'device-1',
    });

    expect(result).toMatchObject({
      status: 'unavailable',
      reason: 'VALKEY_URL is not configured',
    });
  });

  it('prefers VALKEY_URL and keeps REDIS_URL only as an explicit compatibility alias', () => {
    expect(
      resolveValkeyUrl({
        VALKEY_URL: 'redis://valkey.internal:6379',
        REDIS_URL: 'redis://legacy.internal:6379',
        REDIS_URL_ALIAS_FOR_VALKEY: true,
      })
    ).toBe('redis://valkey.internal:6379');

    expect(
      resolveValkeyUrl({
        REDIS_URL: 'redis://legacy.internal:6379',
        REDIS_URL_ALIAS_FOR_VALKEY: true,
      })
    ).toBe('redis://legacy.internal:6379');

    expect(
      resolveValkeyUrl({
        REDIS_URL: 'redis://legacy.internal:6379',
        REDIS_URL_ALIAS_FOR_VALKEY: false,
      })
    ).toBeUndefined();
  });

  it('tracks device-to-node mappings with TTL in the in-memory registry', async () => {
    const registry = new InMemoryDeviceNodeRegistry();
    await registry.registerDeviceNode('device-1', 'node-a', 60_000);

    expect(await registry.getDeviceNode('device-1')).toBe('node-a');
    expect(await registry.unregisterDeviceNode('device-1', 'node-b')).toBe(false);
    expect(await registry.getDeviceNode('device-1')).toBe('node-a');
    expect(await registry.unregisterDeviceNode('device-1', 'node-a')).toBe(true);
    expect(await registry.getDeviceNode('device-1')).toBeNull();
  });

  it('handles Valkey device-node registry unavailability without throwing', async () => {
    const registry = new ValkeyDeviceNodeRegistry({
      url: undefined,
      namespace: 'test',
      tlsEnabled: false,
      commandTimeoutMs: 50,
    });

    expect(await registry.registerDeviceNode('device-1', 'node-a')).toBe(false);
    expect(await registry.getDeviceNode('device-1')).toBeNull();
    expect(await registry.unregisterDeviceNode('device-1', 'node-a')).toBe(false);
  });

  it('routes a command wake from registry lookup to the subscribed local node handler', async () => {
    const received: unknown[] = [];
    await initializeRealtimeFanout((message) => {
      received.push(message);
    }, { force: true });
    await registerDeviceForFanout('device-1');

    const result = await publishWakeToDevice('device-1', {
      type: 'COMMAND_AVAILABLE',
      device_id: 'device-1',
      command_hint: { command_id: 'command-1' },
    });

    expect(result.status).toBe('published');
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({
      type: 'COMMAND_AVAILABLE',
      device_id: 'device-1',
      command_hint: { command_id: 'command-1' },
    });
  });

  it('falls back cleanly when no device node mapping exists', async () => {
    await initializeRealtimeFanout(() => undefined, { force: true });

    const result = await publishWakeToDevice('missing-device', {
      type: 'COMMAND_AVAILABLE',
      device_id: 'missing-device',
    });

    expect(result).toEqual({ status: 'node_missing' });
  });
});
