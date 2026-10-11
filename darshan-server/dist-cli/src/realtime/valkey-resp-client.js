import net from 'net';
import tls from 'tls';
import { readFileSync } from 'node:fs';
import { URL } from 'url';
function encodeBulk(value) {
    return `$${Buffer.byteLength(value, 'utf8')}\r\n${value}\r\n`;
}
function encodeCommand(parts) {
    return `*${parts.length}\r\n${parts.map((part) => encodeBulk(String(part))).join('')}`;
}
function parseEndpoint(url, tlsEnabled) {
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
function loadTrustedCa(caCertPath) {
    if (!caCertPath)
        return undefined;
    try {
        return readFileSync(caCertPath);
    }
    catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        throw new Error(`Unable to read VALKEY_CA_CERT_PATH ${caCertPath}: ${detail}`);
    }
}
class RespParser {
    buffer = Buffer.alloc(0);
    push(chunk) {
        this.buffer = Buffer.concat([this.buffer, chunk]);
        const values = [];
        while (this.buffer.length > 0) {
            const parsed = this.parseValue(0);
            if (!parsed)
                break;
            values.push(parsed.value);
            this.buffer = this.buffer.subarray(parsed.offset);
        }
        return values;
    }
    findLineEnd(offset) {
        for (let i = offset; i < this.buffer.length - 1; i += 1) {
            if (this.buffer[i] === 13 && this.buffer[i + 1] === 10)
                return i;
        }
        return -1;
    }
    parseValue(offset) {
        if (offset >= this.buffer.length)
            return null;
        const type = String.fromCharCode(this.buffer[offset]);
        const lineEnd = this.findLineEnd(offset + 1);
        if (lineEnd === -1)
            return null;
        const line = this.buffer.toString('utf8', offset + 1, lineEnd);
        const nextOffset = lineEnd + 2;
        if (type === '+')
            return { value: line, offset: nextOffset };
        if (type === ':')
            return { value: Number(line), offset: nextOffset };
        if (type === '-')
            throw new Error(line);
        if (type === '$') {
            const length = Number(line);
            if (length === -1)
                return { value: null, offset: nextOffset };
            const end = nextOffset + length;
            if (this.buffer.length < end + 2)
                return null;
            return {
                value: this.buffer.toString('utf8', nextOffset, end),
                offset: end + 2,
            };
        }
        if (type === '*') {
            const count = Number(line);
            if (count === -1)
                return { value: null, offset: nextOffset };
            const values = [];
            let cursor = nextOffset;
            for (let i = 0; i < count; i += 1) {
                const parsed = this.parseValue(cursor);
                if (!parsed)
                    return null;
                values.push(parsed.value);
                cursor = parsed.offset;
            }
            return { value: values, offset: cursor };
        }
        throw new Error(`Unsupported Valkey RESP type: ${type}`);
    }
}
export class ValkeyCommandClient {
    options;
    socket = null;
    connecting = null;
    parser = new RespParser();
    pending = [];
    endpoint;
    trustedCa;
    generation = 0;
    constructor(options) {
        this.options = options;
        this.endpoint = options.url ? parseEndpoint(options.url, options.tlsEnabled) : null;
        this.trustedCa = this.endpoint?.tlsEnabled ? loadTrustedCa(options.caCertPath) : undefined;
    }
    get configured() {
        return Boolean(this.endpoint);
    }
    async command(parts) {
        if (!this.endpoint) {
            throw new Error('VALKEY_URL is not configured');
        }
        await this.connect();
        return await this.writeCommand(parts);
    }
    async close() {
        this.generation += 1;
        const socket = this.socket;
        this.socket = null;
        this.connecting = null;
        socket?.destroy();
        this.rejectPending(new Error('Valkey command client closed'));
    }
    async connect() {
        if (this.socket && !this.socket.destroyed)
            return;
        if (this.connecting)
            return await this.connecting;
        const generation = this.generation;
        const connection = new Promise((resolve, reject) => {
            if (!this.endpoint) {
                reject(new Error('VALKEY_URL is not configured'));
                return;
            }
            const endpoint = this.endpoint;
            const socket = endpoint.tlsEnabled
                ? tls.connect({
                    host: endpoint.host,
                    port: endpoint.port,
                    servername: this.options.tlsServerName || endpoint.host,
                    ca: this.trustedCa,
                    rejectUnauthorized: true,
                    minVersion: 'TLSv1.2',
                })
                : net.createConnection({ host: endpoint.host, port: endpoint.port });
            const fail = (error) => {
                socket.destroy();
                reject(error);
            };
            socket.once('error', fail);
            socket.once(endpoint.tlsEnabled ? 'secureConnect' : 'connect', async () => {
                if (generation !== this.generation) {
                    socket.destroy();
                    reject(new Error('Valkey command client closed while connecting'));
                    return;
                }
                socket.off('error', fail);
                this.socket = socket;
                this.parser = new RespParser();
                socket.on('data', (chunk) => {
                    if (generation !== this.generation || this.socket !== socket)
                        return;
                    this.handleData(socket, chunk);
                });
                socket.on('error', (error) => {
                    if (generation !== this.generation || this.socket !== socket)
                        return;
                    this.rejectPending(error);
                    this.socket = null;
                });
                socket.on('close', () => {
                    if (generation !== this.generation || this.socket !== socket)
                        return;
                    this.rejectPending(new Error('Valkey command socket closed'));
                    this.socket = null;
                });
                try {
                    if (endpoint.password) {
                        await this.writeCommand(['AUTH', endpoint.password]);
                    }
                    if (endpoint.database) {
                        await this.writeCommand(['SELECT', endpoint.database]);
                    }
                    resolve();
                }
                catch (error) {
                    if (this.socket === socket)
                        this.socket = null;
                    socket.destroy();
                    reject(error instanceof Error ? error : new Error('Valkey handshake failed'));
                }
            });
        });
        this.connecting = connection;
        void connection.then(() => {
            if (this.connecting === connection)
                this.connecting = null;
        }, () => {
            if (this.connecting === connection)
                this.connecting = null;
        });
        return await connection;
    }
    async writeCommand(parts) {
        if (!this.socket || this.socket.destroyed) {
            throw new Error('Valkey command socket is not connected');
        }
        return await new Promise((resolve, reject) => {
            let pending = null;
            const removePending = () => {
                if (!pending)
                    return;
                const index = this.pending.indexOf(pending);
                if (index >= 0)
                    this.pending.splice(index, 1);
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
            this.socket.write(encodeCommand(parts), (error) => {
                if (error) {
                    removePending();
                    clearTimeout(timer);
                    reject(error);
                }
            });
        });
    }
    handleData(socket, chunk) {
        try {
            const values = this.parser.push(chunk);
            for (const value of values) {
                const pending = this.pending.shift();
                pending?.resolve(value);
            }
        }
        catch (error) {
            this.rejectPending(error instanceof Error ? error : new Error('Valkey response parse failed'));
            socket.destroy();
        }
    }
    rejectPending(error) {
        while (this.pending.length > 0) {
            this.pending.shift()?.reject(error);
        }
    }
}
export class ValkeySubscriberClient {
    options;
    socket = null;
    parser = new RespParser();
    endpoint;
    trustedCa;
    setupPending = [];
    closed = false;
    generation = 0;
    constructor(options) {
        this.options = options;
        this.endpoint = options.url ? parseEndpoint(options.url, options.tlsEnabled) : null;
        this.trustedCa = this.endpoint?.tlsEnabled ? loadTrustedCa(options.caCertPath) : undefined;
    }
    get configured() {
        return Boolean(this.endpoint);
    }
    async subscribe(channels, handler, onError) {
        if (!this.endpoint) {
            throw new Error('VALKEY_URL is not configured');
        }
        this.closed = false;
        this.generation += 1;
        const generation = this.generation;
        this.socket?.destroy();
        this.socket = null;
        this.rejectSetup(new Error('Valkey subscriber replaced'));
        await this.connectAndSubscribe(channels, handler, onError, this.options.reconnectMinMs, generation);
    }
    async close() {
        this.closed = true;
        this.generation += 1;
        this.rejectSetup(new Error('Valkey subscriber closed'));
        this.socket?.destroy();
        this.socket = null;
    }
    async connectAndSubscribe(channels, handler, onError, reconnectDelayMs, generation) {
        const endpoint = this.endpoint;
        if (!endpoint || this.closed || generation !== this.generation)
            return;
        const socket = endpoint.tlsEnabled
            ? tls.connect({
                host: endpoint.host,
                port: endpoint.port,
                servername: this.options.tlsServerName || endpoint.host,
                ca: this.trustedCa,
                rejectUnauthorized: true,
                minVersion: 'TLSv1.2',
            })
            : net.createConnection({ host: this.endpoint.host, port: this.endpoint.port });
        socket.on('data', (chunk) => {
            if (generation !== this.generation || this.socket !== socket)
                return;
            try {
                const values = this.parser.push(chunk);
                for (const value of values) {
                    const pending = this.setupPending.shift();
                    if (pending) {
                        pending.resolve(value);
                        continue;
                    }
                    if (Array.isArray(value) && value[0] === 'message' && typeof value[1] === 'string' && typeof value[2] === 'string') {
                        handler(value[1], value[2]);
                    }
                }
            }
            catch (error) {
                const failure = error instanceof Error ? error : new Error('Valkey subscriber parse failed');
                this.rejectSetup(failure);
                onError?.(failure);
                socket.destroy();
            }
        });
        const initialError = (_error) => {
            socket.destroy();
        };
        socket.once('error', initialError);
        socket.on('error', (error) => {
            if (generation !== this.generation || (this.socket && this.socket !== socket))
                return;
            this.rejectSetup(error);
            onError?.(error);
        });
        socket.once('close', () => {
            if (generation !== this.generation || (this.socket && this.socket !== socket))
                return;
            this.rejectSetup(new Error('Valkey subscriber socket closed'));
            if (this.socket === socket)
                this.socket = null;
            if (this.closed || generation !== this.generation)
                return;
            const nextDelay = Math.min(reconnectDelayMs * 2, this.options.reconnectMaxMs);
            setTimeout(() => {
                void this.connectAndSubscribe(channels, handler, onError, nextDelay, generation);
            }, reconnectDelayMs).unref?.();
        });
        await new Promise((resolve, reject) => {
            const onReady = () => {
                socket.off('error', reject);
                resolve();
            };
            socket.once(endpoint.tlsEnabled ? 'secureConnect' : 'connect', onReady);
            socket.once('error', reject);
        });
        socket.off('error', initialError);
        if (this.closed || generation !== this.generation) {
            socket.destroy();
            return;
        }
        this.socket = socket;
        this.parser = new RespParser();
        try {
            if (endpoint.password) {
                await this.writeSetupCommand(socket, ['AUTH', endpoint.password]);
            }
            if (endpoint.database) {
                await this.writeSetupCommand(socket, ['SELECT', endpoint.database]);
            }
            await this.writeSetupCommand(socket, ['SUBSCRIBE', ...channels]);
        }
        catch (error) {
            if (this.socket === socket)
                socket.destroy();
            throw error;
        }
    }
    async writeSetupCommand(socket, parts) {
        return await new Promise((resolve, reject) => {
            let pending = null;
            const removePending = () => {
                if (!pending)
                    return;
                const index = this.setupPending.indexOf(pending);
                if (index >= 0)
                    this.setupPending.splice(index, 1);
                pending = null;
            };
            const timer = setTimeout(() => {
                removePending();
                reject(new Error(`Valkey subscriber setup timed out: ${parts[0]}`));
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
            this.setupPending.push(pending);
            socket.write(encodeCommand(parts), (error) => {
                if (!error)
                    return;
                removePending();
                clearTimeout(timer);
                reject(error);
            });
        });
    }
    rejectSetup(error) {
        while (this.setupPending.length > 0) {
            this.setupPending.shift()?.reject(error);
        }
    }
}
