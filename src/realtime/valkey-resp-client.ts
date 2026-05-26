import net from 'net';
import tls from 'tls';
import { URL } from 'url';

type RespValue = string | number | null | RespValue[];

type PendingCommand = {
  resolve: (value: RespValue) => void;
  reject: (error: Error) => void;
};

type ValkeyClientOptions = {
  url?: string;
  tlsEnabled?: boolean;
  commandTimeoutMs: number;
};

type ParsedEndpoint = {
  host: string;
  port: number;
  password?: string;
  database?: string;
  tlsEnabled: boolean;
};

function encodeBulk(value: string) {
  return `$${Buffer.byteLength(value, 'utf8')}\r\n${value}\r\n`;
}

function encodeCommand(parts: Array<string | number>) {
  return `*${parts.length}\r\n${parts.map((part) => encodeBulk(String(part))).join('')}`;
}

function parseEndpoint(url: string, tlsEnabled?: boolean): ParsedEndpoint {
  const parsed = new URL(url);
  const protocol = parsed.protocol.replace(':', '');
  const isTlsProtocol = protocol === 'rediss' || protocol === 'valkeys';

  return {
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : 6379,
    password: parsed.password ? decodeURIComponent(parsed.password) : undefined,
    database: parsed.pathname && parsed.pathname !== '/' ? parsed.pathname.slice(1) : undefined,
    tlsEnabled: tlsEnabled ?? isTlsProtocol,
  };
}

class RespParser {
  private buffer = Buffer.alloc(0);

  push(chunk: Buffer) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    const values: RespValue[] = [];

    while (this.buffer.length > 0) {
      const parsed = this.parseValue(0);
      if (!parsed) break;
      values.push(parsed.value);
      this.buffer = this.buffer.subarray(parsed.offset);
    }

    return values;
  }

  private findLineEnd(offset: number) {
    for (let i = offset; i < this.buffer.length - 1; i += 1) {
      if (this.buffer[i] === 13 && this.buffer[i + 1] === 10) return i;
    }
    return -1;
  }

  private parseValue(offset: number): { value: RespValue; offset: number } | null {
    if (offset >= this.buffer.length) return null;

    const type = String.fromCharCode(this.buffer[offset]);
    const lineEnd = this.findLineEnd(offset + 1);
    if (lineEnd === -1) return null;
    const line = this.buffer.toString('utf8', offset + 1, lineEnd);
    const nextOffset = lineEnd + 2;

    if (type === '+') return { value: line, offset: nextOffset };
    if (type === ':') return { value: Number(line), offset: nextOffset };
    if (type === '-') throw new Error(line);

    if (type === '$') {
      const length = Number(line);
      if (length === -1) return { value: null, offset: nextOffset };
      const end = nextOffset + length;
      if (this.buffer.length < end + 2) return null;
      return {
        value: this.buffer.toString('utf8', nextOffset, end),
        offset: end + 2,
      };
    }

    if (type === '*') {
      const count = Number(line);
      if (count === -1) return { value: null, offset: nextOffset };
      const values: RespValue[] = [];
      let cursor = nextOffset;
      for (let i = 0; i < count; i += 1) {
        const parsed = this.parseValue(cursor);
        if (!parsed) return null;
        values.push(parsed.value);
        cursor = parsed.offset;
      }
      return { value: values, offset: cursor };
    }

    throw new Error(`Unsupported Valkey RESP type: ${type}`);
  }
}

export class ValkeyCommandClient {
  private socket: net.Socket | tls.TLSSocket | null = null;
  private connecting: Promise<void> | null = null;
  private readonly parser = new RespParser();
  private readonly pending: PendingCommand[] = [];
  private readonly endpoint: ParsedEndpoint | null;

  constructor(private readonly options: ValkeyClientOptions) {
    this.endpoint = options.url ? parseEndpoint(options.url, options.tlsEnabled) : null;
  }

  get configured() {
    return Boolean(this.endpoint);
  }

  async command(parts: Array<string | number>) {
    if (!this.endpoint) {
      throw new Error('VALKEY_URL is not configured');
    }

    await this.connect();
    if (!this.socket) throw new Error('Valkey command socket is not connected');

    return await new Promise<RespValue>((resolve, reject) => {
      let pending: PendingCommand | null = null;
      const removePending = () => {
        if (!pending) return;
        const index = this.pending.indexOf(pending);
        if (index >= 0) this.pending.splice(index, 1);
        pending = null;
      };

      const timer = setTimeout(() => {
        removePending();
        reject(new Error(`Valkey command timed out: ${parts[0]}`));
      }, this.options.commandTimeoutMs);

      pending = {
        resolve: (value) => {
          clearTimeout(timer);
          pending = null;
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          pending = null;
          reject(error);
        },
      };
      this.pending.push(pending);

      this.socket!.write(encodeCommand(parts), (error) => {
        if (error) {
          removePending();
          clearTimeout(timer);
          reject(error);
        }
      });
    });
  }

  async close() {
    const socket = this.socket;
    this.socket = null;
    this.connecting = null;
    socket?.destroy();
    this.rejectPending(new Error('Valkey command client closed'));
  }

  private async connect() {
    if (this.socket && !this.socket.destroyed) return;
    if (this.connecting) return await this.connecting;

    this.connecting = new Promise<void>((resolve, reject) => {
      if (!this.endpoint) {
        reject(new Error('VALKEY_URL is not configured'));
        return;
      }

      const endpoint = this.endpoint;
      const socket = endpoint.tlsEnabled
        ? tls.connect({ host: endpoint.host, port: endpoint.port, servername: endpoint.host })
        : net.createConnection({ host: endpoint.host, port: endpoint.port });

      const fail = (error: Error) => {
        socket.destroy();
        reject(error);
      };

      socket.once('error', fail);
      socket.once('connect', async () => {
        socket.off('error', fail);
        this.socket = socket;
        socket.on('data', (chunk) => this.handleData(chunk));
        socket.on('error', (error) => {
          this.rejectPending(error);
          this.socket = null;
        });
        socket.on('close', () => {
          this.rejectPending(new Error('Valkey command socket closed'));
          if (this.socket === socket) this.socket = null;
        });

        try {
          if (endpoint.password) {
            await this.command(['AUTH', endpoint.password]);
          }
          if (endpoint.database) {
            await this.command(['SELECT', endpoint.database]);
          }
          resolve();
        } catch (error) {
          reject(error instanceof Error ? error : new Error('Valkey handshake failed'));
        }
      });
    }).finally(() => {
      this.connecting = null;
    });

    return await this.connecting;
  }

  private handleData(chunk: Buffer) {
    try {
      const values = this.parser.push(chunk);
      for (const value of values) {
        const pending = this.pending.shift();
        pending?.resolve(value);
      }
    } catch (error) {
      this.rejectPending(error instanceof Error ? error : new Error('Valkey response parse failed'));
    }
  }

  private rejectPending(error: Error) {
    while (this.pending.length > 0) {
      this.pending.shift()?.reject(error);
    }
  }
}

export class ValkeySubscriberClient {
  private socket: net.Socket | tls.TLSSocket | null = null;
  private readonly parser = new RespParser();
  private readonly endpoint: ParsedEndpoint | null;
  private closed = false;

  constructor(private readonly options: ValkeyClientOptions & { reconnectMinMs: number; reconnectMaxMs: number }) {
    this.endpoint = options.url ? parseEndpoint(options.url, options.tlsEnabled) : null;
  }

  get configured() {
    return Boolean(this.endpoint);
  }

  async subscribe(channels: string[], handler: (channel: string, payload: string) => void, onError?: (error: Error) => void) {
    if (!this.endpoint) {
      throw new Error('VALKEY_URL is not configured');
    }

    this.closed = false;
    await this.connectAndSubscribe(channels, handler, onError, this.options.reconnectMinMs);
  }

  async close() {
    this.closed = true;
    this.socket?.destroy();
    this.socket = null;
  }

  private async connectAndSubscribe(
    channels: string[],
    handler: (channel: string, payload: string) => void,
    onError: ((error: Error) => void) | undefined,
    reconnectDelayMs: number
  ) {
    if (!this.endpoint || this.closed) return;

    const socket = this.endpoint.tlsEnabled
      ? tls.connect({ host: this.endpoint.host, port: this.endpoint.port, servername: this.endpoint.host })
      : net.createConnection({ host: this.endpoint.host, port: this.endpoint.port });

    socket.on('data', (chunk) => {
      try {
        const values = this.parser.push(chunk);
        for (const value of values) {
          if (Array.isArray(value) && value[0] === 'message' && typeof value[1] === 'string' && typeof value[2] === 'string') {
            handler(value[1], value[2]);
          }
        }
      } catch (error) {
        onError?.(error instanceof Error ? error : new Error('Valkey subscriber parse failed'));
      }
    });

    socket.once('error', (error) => {
      onError?.(error);
    });

    socket.once('close', () => {
      if (this.closed) return;
      const nextDelay = Math.min(reconnectDelayMs * 2, this.options.reconnectMaxMs);
      setTimeout(() => {
        void this.connectAndSubscribe(channels, handler, onError, nextDelay);
      }, reconnectDelayMs).unref?.();
    });

    await new Promise<void>((resolve, reject) => {
      socket.once('connect', () => resolve());
      socket.once('error', reject);
    });

    this.socket = socket;
    if (this.endpoint.password) {
      socket.write(encodeCommand(['AUTH', this.endpoint.password]));
    }
    if (this.endpoint.database) {
      socket.write(encodeCommand(['SELECT', this.endpoint.database]));
    }
    socket.write(encodeCommand(['SUBSCRIBE', ...channels]));
  }
}
