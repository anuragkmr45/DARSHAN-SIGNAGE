import { config } from '@/config';
import {
  recordRealtimeBusFallback,
  recordRealtimeBusNodeMessage,
  recordRealtimeBusPublish,
  recordRealtimeBusSubscribeFailure,
} from '@/observability/metrics';
import { ValkeyCommandClient, ValkeySubscriberClient } from '@/realtime/valkey-resp-client';
import { createLogger } from '@/utils/logger';

const logger = createLogger('realtime-bus');

export type RealtimeWakeMessage = {
  type: 'COMMAND_AVAILABLE' | 'RESYNC_REQUIRED' | 'SERVER_TIME';
  device_id?: string;
  sent_at?: string;
  [key: string]: unknown;
};

export type RealtimeBusPublishResult =
  | { status: 'published'; channel: string }
  | { status: 'unavailable'; reason: string }
  | { status: 'payload_too_large'; reason: string };

export type RealtimeBus = {
  provider: 'memory' | 'valkey';
  publishToNode(nodeId: string, message: RealtimeWakeMessage): Promise<RealtimeBusPublishResult>;
  publishBroadcast(message: RealtimeWakeMessage): Promise<RealtimeBusPublishResult>;
  subscribeNode(nodeId: string, handler: (message: RealtimeWakeMessage) => void | Promise<void>): Promise<void>;
  subscribeBroadcast(handler: (message: RealtimeWakeMessage) => void | Promise<void>): Promise<void>;
  close(): Promise<void>;
};

function payloadSizeBytes(message: unknown) {
  return Buffer.byteLength(JSON.stringify(message), 'utf8');
}

function validateBusPayload(message: RealtimeWakeMessage): RealtimeBusPublishResult | null {
  const size = payloadSizeBytes(message);
  if (size > config.WS_NOTIFICATION_MAX_BYTES) {
    return {
      status: 'payload_too_large',
      reason: `Realtime bus payload exceeds ${config.WS_NOTIFICATION_MAX_BYTES} bytes`,
    };
  }
  return null;
}

function channelName(namespace: string, name: string) {
  return `${namespace}:${name}`;
}

export class InMemoryRealtimeBus implements RealtimeBus {
  readonly provider = 'memory' as const;
  private readonly handlers = new Map<string, Set<(message: RealtimeWakeMessage) => void | Promise<void>>>();

  async publishToNode(nodeId: string, message: RealtimeWakeMessage): Promise<RealtimeBusPublishResult> {
    return await this.publish(channelName('memory', `realtime:node:${nodeId}`), message);
  }

  async publishBroadcast(message: RealtimeWakeMessage): Promise<RealtimeBusPublishResult> {
    return await this.publish(channelName('memory', 'realtime:broadcast'), message);
  }

  async subscribeNode(nodeId: string, handler: (message: RealtimeWakeMessage) => void | Promise<void>) {
    this.subscribe(channelName('memory', `realtime:node:${nodeId}`), handler);
  }

  async subscribeBroadcast(handler: (message: RealtimeWakeMessage) => void | Promise<void>) {
    this.subscribe(channelName('memory', 'realtime:broadcast'), handler);
  }

  async close() {
    this.handlers.clear();
  }

  private subscribe(channel: string, handler: (message: RealtimeWakeMessage) => void | Promise<void>) {
    const handlers = this.handlers.get(channel) ?? new Set<(message: RealtimeWakeMessage) => void | Promise<void>>();
    handlers.add(handler);
    this.handlers.set(channel, handlers);
  }

  private async publish(channel: string, message: RealtimeWakeMessage): Promise<RealtimeBusPublishResult> {
    const invalid = validateBusPayload(message);
    if (invalid) return invalid;

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

export class ValkeyRealtimeBus implements RealtimeBus {
  readonly provider = 'valkey' as const;
  private readonly publisher: ValkeyCommandClient;
  private readonly subscriber: ValkeySubscriberClient;

  constructor(
    private readonly options: {
      url?: string;
      namespace: string;
      tlsEnabled: boolean;
      caCertPath?: string;
      publishTimeoutMs: number;
      reconnectMinMs: number;
      reconnectMaxMs: number;
      pubsubEnabled: boolean;
    }
  ) {
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

  async publishToNode(nodeId: string, message: RealtimeWakeMessage): Promise<RealtimeBusPublishResult> {
    return await this.publish(channelName(this.options.namespace, `realtime:node:${nodeId}`), message);
  }

  async publishBroadcast(message: RealtimeWakeMessage): Promise<RealtimeBusPublishResult> {
    return await this.publish(channelName(this.options.namespace, 'realtime:broadcast'), message);
  }

  async subscribeNode(nodeId: string, handler: (message: RealtimeWakeMessage) => void | Promise<void>) {
    await this.subscribe([channelName(this.options.namespace, `realtime:node:${nodeId}`)], handler);
  }

  async subscribeBroadcast(handler: (message: RealtimeWakeMessage) => void | Promise<void>) {
    await this.subscribe([channelName(this.options.namespace, 'realtime:broadcast')], handler);
  }

  async close() {
    await Promise.all([this.publisher.close(), this.subscriber.close()]);
  }

  private async publish(channel: string, message: RealtimeWakeMessage): Promise<RealtimeBusPublishResult> {
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
    } catch (error) {
      recordRealtimeBusPublish('valkey', 'failed', message.type);
      recordRealtimeBusFallback('valkey_unavailable');
      logger.warn({ err: error, channel }, 'Valkey realtime publish failed; polling fallback remains authoritative');
      return {
        status: 'unavailable',
        reason: error instanceof Error ? error.message : 'Valkey publish failed',
      };
    }
  }

  private async subscribe(
    channels: string[],
    handler: (message: RealtimeWakeMessage) => void | Promise<void>
  ) {
    if (!this.options.url || !this.options.pubsubEnabled) {
      recordRealtimeBusSubscribeFailure('valkey', this.options.url ? 'pubsub_disabled' : 'url_missing');
      return;
    }

    try {
      await this.subscriber.subscribe(
        channels,
        (channel, payload) => {
          try {
            const parsed = JSON.parse(payload) as RealtimeWakeMessage;
            recordRealtimeBusNodeMessage('received', parsed.type ?? 'unknown');
            void handler(parsed);
            void channel;
          } catch (error) {
            recordRealtimeBusSubscribeFailure('valkey', 'invalid_payload');
            logger.warn({ err: error }, 'Invalid Valkey realtime payload ignored');
          }
        },
        (error) => {
          recordRealtimeBusSubscribeFailure('valkey', 'subscriber_error');
          logger.warn({ err: error }, 'Valkey realtime subscriber error');
        }
      );
    } catch (error) {
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
