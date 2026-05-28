import { describe, expect, it } from 'vitest';
import { ValkeyDeviceNodeRegistry } from '@/realtime/device-node-registry';
import { ValkeyRealtimeBus } from '@/realtime/realtime-bus';

const valkeyUrl = process.env.VALKEY_URL;

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe.runIf(Boolean(valkeyUrl))('Valkey realtime fanout integration', () => {
  it('routes node B wake notification to node A subscriber through Valkey Pub/Sub', async () => {
    const namespace = `signhex:test:${Date.now()}`;
    const nodeABus = new ValkeyRealtimeBus({
      url: valkeyUrl,
      namespace,
      tlsEnabled: false,
      publishTimeoutMs: 500,
      reconnectMinMs: 50,
      reconnectMaxMs: 250,
      pubsubEnabled: true,
    });
    const nodeBBus = new ValkeyRealtimeBus({
      url: valkeyUrl,
      namespace,
      tlsEnabled: false,
      publishTimeoutMs: 500,
      reconnectMinMs: 50,
      reconnectMaxMs: 250,
      pubsubEnabled: true,
    });
    const registry = new ValkeyDeviceNodeRegistry({
      url: valkeyUrl,
      namespace,
      tlsEnabled: false,
      commandTimeoutMs: 500,
    });

    const received = new Promise<unknown>((resolve) => {
      void nodeABus.subscribeNode('node-a', (message) => resolve(message));
    });
    await delay(100);

    await registry.registerDeviceNode('device-1', 'node-a', 30_000);
    const nodeId = await registry.getDeviceNode('device-1');
    expect(nodeId).toBe('node-a');

    const publishResult = await nodeBBus.publishToNode(nodeId!, {
      type: 'COMMAND_AVAILABLE',
      device_id: 'device-1',
      command_hint: { command_id: 'command-1' },
    });

    expect(publishResult.status).toBe('published');
    await expect(received).resolves.toMatchObject({
      type: 'COMMAND_AVAILABLE',
      device_id: 'device-1',
      command_hint: { command_id: 'command-1' },
    });

    await registry.unregisterDeviceNode('device-1', 'node-a');
    await Promise.all([nodeABus.close(), nodeBBus.close(), registry.close()]);
  });

  it('does not throw when the configured Valkey endpoint is unavailable', async () => {
    const registry = new ValkeyDeviceNodeRegistry({
      url: 'redis://127.0.0.1:6399',
      namespace: 'signhex:test:unavailable',
      tlsEnabled: false,
      commandTimeoutMs: 50,
    });

    await expect(registry.getDeviceNode('device-1')).resolves.toBeNull();
    await registry.close();
  });
});
