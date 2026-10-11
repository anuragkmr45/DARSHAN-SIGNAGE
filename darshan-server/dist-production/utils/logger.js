import pino from 'pino';
import { config as appConfig } from '../config/index.js';
const loggers = new Map();
const recentLogs = [];
const MAX_RECENT_LOGS = 500;
const PINO_LEVEL_NAMES = {
    10: 'trace',
    20: 'debug',
    30: 'info',
    40: 'warn',
    50: 'error',
    60: 'fatal',
};
let runtimeLogLevel = appConfig.LOG_LEVEL;
const developmentTransport = appConfig.NODE_ENV === 'development'
    ? pino.transport({
        target: 'pino-pretty',
        options: {
            colorize: true,
            singleLine: false,
        },
    })
    : undefined;
function pushRecentLog(entry) {
    recentLogs.push({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        timestamp: new Date().toISOString(),
        ...entry,
    });
    if (recentLogs.length > MAX_RECENT_LOGS) {
        recentLogs.splice(0, recentLogs.length - MAX_RECENT_LOGS);
    }
}
export function createLogger(name) {
    if (loggers.has(name)) {
        return loggers.get(name);
    }
    const logger = pino({
        level: runtimeLogLevel,
        base: { name },
        hooks: {
            logMethod(args, method, level) {
                const context = args[0] && typeof args[0] === 'object' && !Array.isArray(args[0])
                    ? args[0]
                    : undefined;
                const message = typeof args[0] === 'string'
                    ? args[0]
                    : typeof args[1] === 'string'
                        ? args[1]
                        : 'Log event';
                pushRecentLog({
                    logger: name,
                    level: PINO_LEVEL_NAMES[level] ?? String(level),
                    message,
                    context,
                });
                method.apply(this, args);
            },
        },
    }, developmentTransport);
    loggers.set(name, logger);
    return logger;
}
export function getLogger(name) {
    const logger = loggers.get(name);
    if (!logger) {
        throw new Error(`Logger "${name}" not found`);
    }
    return logger;
}
export function getRecentLogs(options) {
    const level = options?.level?.toLowerCase();
    const filtered = level ? recentLogs.filter((entry) => entry.level === level) : recentLogs;
    const limit = options?.limit ? Math.max(1, options.limit) : 100;
    return filtered.slice(-limit).reverse();
}
export function setRuntimeLogLevel(level) {
    runtimeLogLevel = level;
    for (const logger of loggers.values()) {
        logger.level = level;
    }
}
export function getRuntimeLogLevel() {
    return runtimeLogLevel;
}
