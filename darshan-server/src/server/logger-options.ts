export function buildFastifyLoggerOptions(
  nodeEnv: 'development' | 'production' | 'test',
  level: string
) {
  if (nodeEnv !== 'development') {
    return { level };
  }

  return {
    level,
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
      },
    },
  };
}
