import { config } from '../config/index.js';
import { recordDeviceNodeRegistryMiss, recordDeviceNodeRegistryWrite, recordRealtimeBusFallback, } from '../observability/metrics.js';
import { ValkeyCommandClient } from './valkey-resp-client.js';
import { createLogger } from '../utils/logger.js';
const logger = createLogger('device-node-registry');
function memoryKey(deviceId) {
    return deviceId;
}
export class InMemoryDeviceNodeRegistry {
    provider = 'memory';
    mappings = new Map();
    async registerDeviceNode(deviceId, nodeId, ttlMs = config.REALTIME_DEVICE_NODE_TTL_MS) {
        this.mappings.set(memoryKey(deviceId), { nodeId, expiresAt: Date.now() + ttlMs });
        recordDeviceNodeRegistryWrite('memory', 'register', 'success');
        return true;
    }
    async refreshDeviceNode(deviceId, nodeId, ttlMs = config.REALTIME_DEVICE_NODE_TTL_MS) {
        return await this.registerDeviceNode(deviceId, nodeId, ttlMs);
    }
    async unregisterDeviceNode(deviceId, nodeId) {
        const current = this.mappings.get(memoryKey(deviceId));
        if (current?.nodeId === nodeId) {
            this.mappings.delete(memoryKey(deviceId));
            recordDeviceNodeRegistryWrite('memory', 'unregister', 'success');
            return true;
        }
        return false;
    }
    async getDeviceNode(deviceId) {
        const current = this.mappings.get(memoryKey(deviceId));
        if (!current || current.expiresAt <= Date.now()) {
            this.mappings.delete(memoryKey(deviceId));
            recordDeviceNodeRegistryMiss('memory');
            return null;
        }
        return current.nodeId;
    }
    async close() {
        this.mappings.clear();
    }
}
export class ValkeyDeviceNodeRegistry {
    options;
    provider = 'valkey';
    client;
    constructor(options) {
        this.options = options;
        this.client = new ValkeyCommandClient({
            url: options.url,
            tlsEnabled: options.tlsEnabled,
            caCertPath: options.caCertPath,
            commandTimeoutMs: options.commandTimeoutMs,
        });
    }
    async registerDeviceNode(deviceId, nodeId, ttlMs = config.REALTIME_DEVICE_NODE_TTL_MS) {
        return await this.writeNode('register', deviceId, nodeId, ttlMs);
    }
    async refreshDeviceNode(deviceId, nodeId, ttlMs = config.REALTIME_DEVICE_NODE_TTL_MS) {
        return await this.writeNode('refresh', deviceId, nodeId, ttlMs);
    }
    async unregisterDeviceNode(deviceId, nodeId) {
        if (!this.options.url) {
            recordDeviceNodeRegistryWrite('valkey', 'unregister', 'unavailable');
            recordRealtimeBusFallback('valkey_unavailable');
            return false;
        }
        try {
            const result = await this.client.command([
                'EVAL',
                "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end",
                1,
                this.key(deviceId),
                nodeId,
            ]);
            recordDeviceNodeRegistryWrite('valkey', 'unregister', 'success');
            return Number(result ?? 0) > 0;
        }
        catch (error) {
            recordDeviceNodeRegistryWrite('valkey', 'unregister', 'error');
            recordRealtimeBusFallback('valkey_unavailable');
            logger.warn({ err: error }, 'Valkey device-node unregister failed');
            return false;
        }
    }
    async getDeviceNode(deviceId) {
        if (!this.options.url) {
            recordDeviceNodeRegistryMiss('valkey');
            recordRealtimeBusFallback('valkey_unavailable');
            return null;
        }
        try {
            const result = await this.client.command(['GET', this.key(deviceId)]);
            if (typeof result === 'string' && result.length > 0) {
                return result;
            }
            recordDeviceNodeRegistryMiss('valkey');
            return null;
        }
        catch (error) {
            recordDeviceNodeRegistryMiss('valkey');
            recordRealtimeBusFallback('valkey_unavailable');
            logger.warn({ err: error }, 'Valkey device-node lookup failed');
            return null;
        }
    }
    async close() {
        await this.client.close();
    }
    key(deviceId) {
        return `${this.options.namespace}:realtime:device-node:${deviceId}`;
    }
    async writeNode(operation, deviceId, nodeId, ttlMs) {
        if (!this.options.url) {
            recordDeviceNodeRegistryWrite('valkey', operation, 'unavailable');
            recordRealtimeBusFallback('valkey_unavailable');
            return false;
        }
        try {
            await this.client.command(['SET', this.key(deviceId), nodeId, 'PX', ttlMs]);
            recordDeviceNodeRegistryWrite('valkey', operation, 'success');
            return true;
        }
        catch (error) {
            recordDeviceNodeRegistryWrite('valkey', operation, 'error');
            recordRealtimeBusFallback('valkey_unavailable');
            logger.warn({ err: error }, 'Valkey device-node write failed');
            return false;
        }
    }
}
export function createDeviceNodeRegistry() {
    if (config.REALTIME_BUS_PROVIDER === 'valkey') {
        return new ValkeyDeviceNodeRegistry({
            url: config.VALKEY_URL,
            namespace: config.VALKEY_NAMESPACE,
            tlsEnabled: config.VALKEY_TLS_ENABLED,
            caCertPath: config.VALKEY_CA_CERT_PATH,
            commandTimeoutMs: config.REALTIME_VALKEY_PUBLISH_TIMEOUT_MS,
        });
    }
    return new InMemoryDeviceNodeRegistry();
}
