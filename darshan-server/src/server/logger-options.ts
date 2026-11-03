export function buildFastifyLoggerOptions(
  nodeEnv: 'development' | 'production' | 'test',
  level: string
) {
  const redact = ['req.headers.authorization', 'req.headers.cookie',
    'req.headers["x-darshan-live-authority-secret"]', 'req.headers["x-darshan-media-secret"]',
    'req.headers["x-darshan-live-witness-secret"]'];
  if (nodeEnv !== 'development') {
    return { level, redact };
  }

  return {
    level,
    redact,
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
      },
    },
  };
}
