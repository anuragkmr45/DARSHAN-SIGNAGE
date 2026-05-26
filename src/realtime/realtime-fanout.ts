import { config } from '@/config';
import {
  recordRealtimeBusFallback,
  recordRealtimeBusNodeMessage,
} from '@/observability/metrics';
import { createDeviceNodeRegistry, DeviceNodeRegistry } from '@/realtime/device-node-registry';
import { createRealtimeBus, RealtimeBus, RealtimeWakeMessage } from '@/realtime/realtime-bus';
import { getRealtimeNodeId } from '@/realtime/realtime-node';
import { createLogger } from '@/utils/logger';

const logger = createLogger('realtime-fanout');

type FanoutState = {
  nodeId: string;
  bus: RealtimeBus;
  deviceNodes: DeviceNodeRegistry;
  initialized: boolean;
};

let state: FanoutState | null = null;

export type PublishDeviceWakeResult =
  | { status: 'published'; nodeId: string }
  | { status: 'node_missing' }
  | { status: 'unavailable'; reason: string }
  | { status: 'payload_too_large'; reason: string };

export function getRealtimeFanoutState() {
  if (!state) {
    state = {
      nodeId: getRealtimeNodeId(),
      bus: createRealtimeBus(),
      deviceNodes: createDeviceNodeRegistry(),
      initialized: false,
    };
  }
  return state;
}

export async function initializeRealtimeFanout(
  onNodeMessage: (message: RealtimeWakeMessage) => void | Promise<void>,
  options: { force?: boolean } = {}
) {
  if (!options.force && (!config.REALTIME_SYNC_ENABLED || config.REALTIME_BUS_PROVIDER === 'memory')) {
    return getRealtimeFanoutState();
  }

  const current = getRealtimeFanoutState();
  if (current.initialized) return current;

  await current.bus.subscribeNode(current.nodeId, onNodeMessage);
  await current.bus.subscribeBroadcast(onNodeMessage);
  current.initialized = true;
  return current;
}

export async function registerDeviceForFanout(deviceId: string) {
  const current = getRealtimeFanoutState();
  return await current.deviceNodes.registerDeviceNode(deviceId, current.nodeId, config.REALTIME_DEVICE_NODE_TTL_MS);
}

export async function refreshDeviceForFanout(deviceId: string) {
  const current = getRealtimeFanoutState();
  return await current.deviceNodes.refreshDeviceNode(deviceId, current.nodeId, config.REALTIME_DEVICE_NODE_TTL_MS);
}

export async function unregisterDeviceForFanout(deviceId: string) {
  const current = getRealtimeFanoutState();
  return await current.deviceNodes.unregisterDeviceNode(deviceId, current.nodeId);
}

export async function publishWakeToDevice(deviceId: string, message: RealtimeWakeMessage): Promise<PublishDeviceWakeResult> {
  const current = getRealtimeFanoutState();
  const nodeId = await current.deviceNodes.getDeviceNode(deviceId);
  if (!nodeId) {
    recordRealtimeBusFallback('device_node_missing');
    return { status: 'node_missing' };
  }

  const result = await current.bus.publishToNode(nodeId, message);
  if (result.status === 'published') {
    return { status: 'published', nodeId };
  }
  if (result.status === 'payload_too_large') {
    return result;
  }

  return {
    status: 'unavailable',
    reason: result.reason,
  };
}

export async function closeRealtimeFanout() {
  if (!state) return;
  await Promise.all([state.bus.close(), state.deviceNodes.close()]);
  state = null;
}

export function handleLocalFanoutDelivery(message: RealtimeWakeMessage, deliver: (message: RealtimeWakeMessage) => number) {
  try {
    const delivered = deliver(message);
    recordRealtimeBusNodeMessage(delivered > 0 ? 'delivered' : 'socket_missing', message.type ?? 'unknown');
    return delivered;
  } catch (error) {
    recordRealtimeBusNodeMessage('error', message.type ?? 'unknown');
    logger.warn({ err: error }, 'Realtime fanout local delivery failed');
    return 0;
  }
}

export async function resetRealtimeFanoutForTests() {
  await closeRealtimeFanout();
}
