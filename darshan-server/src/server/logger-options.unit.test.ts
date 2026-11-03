import { describe, expect, it } from 'vitest';
import { buildFastifyLoggerOptions } from './logger-options';
import pino from 'pino';
import { Writable } from 'node:stream';

describe('buildFastifyLoggerOptions', () => {
  it('uses the development-only pretty transport for local source runs', () => {
    expect(buildFastifyLoggerOptions('development', 'debug')).toMatchObject({
      level: 'debug',
      transport: {
        target: 'pino-pretty',
        options: { colorize: true },
      },
    });
  });

  it.each(['production', 'test'] as const)(
    'uses dependency-free structured logging in %s',
    (nodeEnv) => {
      expect(buildFastifyLoggerOptions(nodeEnv, 'info')).toMatchObject({ level: 'info' });
    }
  );
  it('redacts live authority, control and host witness headers from real structured output', () => {
    let output = '';
    const sink = new Writable({ write(chunk, _encoding, done) { output += chunk.toString(); done(); } });
    const logger = pino(buildFastifyLoggerOptions('test', 'info'), sink);
    const headers = Object.fromEntries(['authorization', 'cookie', 'x-darshan-live-authority-secret', 'x-darshan-media-secret',
      'x-darshan-live-witness-secret'].map(name => [name, `synthetic-private-${name}`]));
    logger.info({ req: { headers: { ...headers, 'x-request-id': 'readable-request-id' } } }, 'Synthetic logging check');
    for (const value of Object.values(headers)) expect(output).not.toContain(value);
    expect(output).toContain('readable-request-id'); expect(output).toContain('[Redacted]');
  });
});
