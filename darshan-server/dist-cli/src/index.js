process.env['TZ'] ||= 'UTC';
process.setMaxListeners(20);
const [{ createLogger }, { resolveProcessRole }, runtimeBootstrap] = await Promise.all([
    import('./utils/logger.js'),
    import('./runtime/process-role.js'),
    import('./runtime/bootstrap.js'),
]);
const { startRuntime, stopRuntime } = runtimeBootstrap;
const logger = createLogger('main');
async function main() {
    try {
        const role = resolveProcessRole();
        logger.info({ role }, 'Starting runtime');
        const runtime = await startRuntime(role);
        // Graceful shutdown
        const shutdown = async (signal, runtime) => {
            logger.info({ role: runtime.role, signal }, 'Shutdown signal received');
            await stopRuntime(runtime);
            process.exit(0);
        };
        process.on('SIGTERM', async () => {
            await shutdown('SIGTERM', runtime);
        });
        process.on('SIGINT', async () => {
            await shutdown('SIGINT', runtime);
        });
    }
    catch (error) {
        logger.error(error, 'Fatal error during startup');
        process.exit(1);
    }
}
main();
export {};
