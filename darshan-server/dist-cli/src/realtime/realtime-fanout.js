import { config } from '../config/index.js';
import { recordRealtimeBusFallback, recordRealtimeBusNodeMessage, recordRealtimeSocketServerEvent, } from '../observability/metrics.js';
import { createDeviceNodeRegistry } from './device-node-registry.js';
import { createRealtimeBus } from './realtime-bus.js';
import { getRealtimeNodeId } from './realtime-node.js';
import { createLogger } from '../utils/logger.js';
const logger = createLogger('realtime-fanout');
let state = null;
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
export async function initializeRealtimeFanout(onNodeMessage, options = {}) {
    if (!options.force && (!config.REALTIME_SYNC_ENABLED || config.REALTIME_BUS_PROVIDER === 'memory')) {
        return getRealtimeFanoutState();
    }
    const current = getRealtimeFanoutState();
    if (current.initialized)
        return current;
    await current.bus.subscribeNode(current.nodeId, onNodeMessage);
    await current.bus.subscribeBroadcast(onNodeMessage);
    current.initialized = true;
    return current;
}
export async function registerDeviceForFanout(deviceId) {
    const current = getRealtimeFanoutState();
    return await current.deviceNodes.registerDeviceNode(deviceId, current.nodeId, config.REALTIME_DEVICE_NODE_TTL_MS);
}
export async function refreshDeviceForFanout(deviceId) {
    const current = getRealtimeFanoutState();
    return await current.deviceNodes.refreshDeviceNode(deviceId, current.nodeId, config.REALTIME_DEVICE_NODE_TTL_MS);
}
export async function unregisterDeviceForFanout(deviceId) {
    const current = getRealtimeFanoutState();
    return await current.deviceNodes.unregisterDeviceNode(deviceId, current.nodeId);
}
export async function publishWakeToDevice(deviceId, message) {
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
    if (!state)
        return;
    await Promise.all([state.bus.close(), state.deviceNodes.close()]);
    state = null;
}
export function handleLocalFanoutDelivery(message, deliver) {
    try {
        const delivered = deliver(message);
        recordRealtimeBusNodeMessage(delivered > 0 ? 'delivered' : 'socket_missing', message.type ?? 'unknown');
        if (delivered > 0) {
            recordRealtimeSocketServerEvent(config.REALTIME_DEVICE_NAMESPACE, message.type ?? 'unknown', delivered);
        }
        return delivered;
    }
    catch (error) {
        recordRealtimeBusNodeMessage('error', message.type ?? 'unknown');
        logger.warn({ err: error }, 'Realtime fanout local delivery failed');
        return 0;
    }
}
export async function resetRealtimeFanoutForTests() {
    await closeRealtimeFanout();
}
