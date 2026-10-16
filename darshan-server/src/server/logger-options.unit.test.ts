import { describe, expect, it } from 'vitest';
import { buildFastifyLoggerOptions } from './logger-options';

describe('buildFastifyLoggerOptions', () => {
  it('uses the development-only pretty transport for local source runs', () => {
    expect(buildFastifyLoggerOptions('development', 'debug')).toEqual({
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
      expect(buildFastifyLoggerOptions(nodeEnv, 'info')).toEqual({ level: 'info' });
    }
  );
});
