import net from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { ValkeyCommandClient } from './valkey-resp-client';

function parseCommand(buffer: Buffer): { parts: string[]; consumed: number } | null {
  const lineEnd = buffer.indexOf('\r\n');
  if (lineEnd < 0 || buffer[0] !== 42) return null;
  const count = Number(buffer.toString('utf8', 1, lineEnd));
  if (!Number.isInteger(count) || count < 0) return null;

  let cursor = lineEnd + 2;
  const parts: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const lengthEnd = buffer.indexOf('\r\n', cursor);
    if (lengthEnd < 0 || buffer[cursor] !== 36) return null;
    const length = Number(buffer.toString('utf8', cursor + 1, lengthEnd));
    if (!Number.isInteger(length) || length < 0) return null;
    const start = lengthEnd + 2;
    const end = start + length;
    if (buffer.length < end + 2) return null;
    parts.push(buffer.toString('utf8', start, end));
    cursor = end + 2;
  }
  return { parts, consumed: cursor };
}

describe('Valkey RESP client', () => {
  let server: net.Server | undefined;
  let client: ValkeyCommandClient | undefined;

  afterEach(async () => {
    await client?.close();
    await new Promise<void>((resolve) => server?.close(() => resolve()) ?? resolve());
  });

  it('authenticates and selects the requested database before sending the caller command', async () => {
    const received: string[][] = [];
    server = net.createServer((socket) => {
      let pending = Buffer.alloc(0);
      socket.on('data', (chunk) => {
        pending = Buffer.concat([pending, chunk]);
        let command = parseCommand(pending);
        while (command) {
          pending = pending.subarray(command.consumed);
          received.push(command.parts);
          if (command.parts[0] === 'PING') socket.write('+PONG\r\n');
          else socket.write('+OK\r\n');
          command = parseCommand(pending);
        }
      });
    });
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected a TCP test address');

    client = new ValkeyCommandClient({
      url: `redis://:test-password@127.0.0.1:${address.port}/2`,
      tlsEnabled: false,
      commandTimeoutMs: 250,
    });

    await expect(client.command(['PING'])).resolves.toBe('PONG');
    expect(received).toEqual([
      ['AUTH', 'test-password'],
      ['SELECT', '2'],
      ['PING'],
    ]);
  });
});
