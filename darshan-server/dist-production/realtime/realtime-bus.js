import { config } from '../config/index.js';
import { recordRealtimeBusFallback, recordRealtimeBusNodeMessage, recordRealtimeBusPublish, recordRealtimeBusSubscribeFailure, } from '../observability/metrics.js';
import { ValkeyCommandClient, ValkeySubscriberClient } from './valkey-resp-client.js';
import { createLogger } from '../utils/logger.js';
const logger = createLogger('realtime-bus');
function payloadSizeBytes(message) {
    return Buffer.byteLength(JSON.stringify(message), 'utf8');
}
function validateBusPayload(message) {
    const size = payloadSizeBytes(message);
    if (size > config.WS_NOTIFICATION_MAX_BYTES) {
        return {
            status: 'payload_too_large',
            reason: `Realtime bus payload exceeds ${config.WS_NOTIFICATION_MAX_BYTES} bytes`,
        };
    }
    return null;
}
function channelName(namespace, name) {
    return `${namespace}:${name}`;
}
export class InMemoryRealtimeBus {
    provider = 'memory';
    handlers = new Map();
    async publishToNode(nodeId, message) {
        return await this.publish(channelName('memory', `realtime:node:${nodeId}`), message);
    }
    async publishBroadcast(message) {
        return await this.publish(channelName('memory', 'realtime:broadcast'), message);
    }
    async subscribeNode(nodeId, handler) {
        this.subscribe(channelName('memory', `realtime:node:${nodeId}`), handler);
    }
    async subscribeBroadcast(handler) {
        this.subscribe(channelName('memory', 'realtime:broadcast'), handler);
    }
    async close() {
        this.handlers.clear();
    }
    subscribe(channel, handler) {
        const handlers = this.handlers.get(channel) ?? new Set();
        handlers.add(handler);
        this.handlers.set(channel, handlers);
    }
    async publish(channel, message) {
        const invalid = validateBusPayload(message);
        if (invalid)
            return invalid;
        const handlers = this.handlers.get(channel);
        if (!handlers || handlers.size === 0) {
            return { status: 'published', channel };
        }
        for (const handler of handlers) {
            await handler(message);
        }
        return { status: 'published', channel };
    }
}
export class ValkeyRealtimeBus {
    options;
    provider = 'valkey';
    publisher;
    subscriber;
    constructor(options) {
        this.options = options;
        this.publisher = new ValkeyCommandClient({
            url: options.url,
            tlsEnabled: options.tlsEnabled,
            caCertPath: options.caCertPath,
            commandTimeoutMs: options.publishTimeoutMs,
        });
        this.subscriber = new ValkeySubscriberClient({
            url: options.url,
            tlsEnabled: options.tlsEnabled,
            caCertPath: options.caCertPath,
            commandTimeoutMs: options.publishTimeoutMs,
            reconnectMinMs: options.reconnectMinMs,
            reconnectMaxMs: options.reconnectMaxMs,
        });
    }
    async publishToNode(nodeId, message) {
        return await this.publish(channelName(this.options.namespace, `realtime:node:${nodeId}`), message);
    }
    async publishBroadcast(message) {
        return await this.publish(channelName(this.options.namespace, 'realtime:broadcast'), message);
    }
    async subscribeNode(nodeId, handler) {
        await this.subscribe([channelName(this.options.namespace, `realtime:node:${nodeId}`)], handler);
    }
    async subscribeBroadcast(handler) {
        await this.subscribe([channelName(this.options.namespace, 'realtime:broadcast')], handler);
    }
    async close() {
        await Promise.all([this.publisher.close(), this.subscriber.close()]);
    }
    async publish(channel, message) {
        const invalid = validateBusPayload(message);
        if (invalid) {
            recordRealtimeBusPublish('valkey', 'payload_too_large', message.type);
            return invalid;
        }
        if (!this.options.url || !this.options.pubsubEnabled) {
            const reason = this.options.url ? 'Valkey Pub/Sub disabled' : 'VALKEY_URL is not configured';
            recordRealtimeBusPublish('valkey', 'unavailable', message.type);
            recordRealtimeBusFallback('valkey_unavailable');
            return { status: 'unavailable', reason };
        }
        try {
            await this.publisher.command(['PUBLISH', channel, JSON.stringify(message)]);
            recordRealtimeBusPublish('valkey', 'published', message.type);
            return { status: 'published', channel };
        }
        catch (error) {
            recordRealtimeBusPublish('valkey', 'failed', message.type);
            recordRealtimeBusFallback('valkey_unavailable');
            logger.warn({ err: error, channel }, 'Valkey realtime publish failed; polling fallback remains authoritative');
            return {
                status: 'unavailable',
                reason: error instanceof Error ? error.message : 'Valkey publish failed',
            };
        }
    }
    async subscribe(channels, handler) {
        if (!this.options.url || !this.options.pubsubEnabled) {
            recordRealtimeBusSubscribeFailure('valkey', this.options.url ? 'pubsub_disabled' : 'url_missing');
            return;
        }
        try {
            await this.subscriber.subscribe(channels, (channel, payload) => {
                try {
                    const parsed = JSON.parse(payload);
                    recordRealtimeBusNodeMessage('received', parsed.type ?? 'unknown');
                    void handler(parsed);
                    void channel;
                }
                catch (error) {
                    recordRealtimeBusSubscribeFailure('valkey', 'invalid_payload');
                    logger.warn({ err: error }, 'Invalid Valkey realtime payload ignored');
                }
            }, (error) => {
                recordRealtimeBusSubscribeFailure('valkey', 'subscriber_error');
                logger.warn({ err: error }, 'Valkey realtime subscriber error');
            });
        }
        catch (error) {
            recordRealtimeBusSubscribeFailure('valkey', 'subscribe_failed');
            logger.warn({ err: error }, 'Valkey realtime subscribe failed; polling fallback remains authoritative');
        }
    }
}
export function createRealtimeBus() {
    if (config.REALTIME_BUS_PROVIDER === 'valkey') {
        return new ValkeyRealtimeBus({
            url: config.VALKEY_URL,
            namespace: config.VALKEY_NAMESPACE,
            tlsEnabled: config.VALKEY_TLS_ENABLED,
            caCertPath: config.VALKEY_CA_CERT_PATH,
            publishTimeoutMs: config.REALTIME_VALKEY_PUBLISH_TIMEOUT_MS,
            reconnectMinMs: config.REALTIME_VALKEY_RECONNECT_MIN_MS,
            reconnectMaxMs: config.REALTIME_VALKEY_RECONNECT_MAX_MS,
            pubsubEnabled: config.VALKEY_PUBSUB_ENABLED,
        });
    }
    return new InMemoryRealtimeBus();
}
