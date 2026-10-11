import 'dotenv/config';
import { program } from 'commander';
import { Pool } from 'pg';
import { config as appConfig } from '../src/config/index.js';
import { createDatabasePoolConfig } from '../src/db/index.js';
import { beginDeploymentRun, DeploymentRunError, inspectDeploymentRun, markDeploymentStep, } from '../src/deployment/deployment-run-state.js';
function output(value) {
    process.stdout.write(`${JSON.stringify(value)}\n`);
}
async function withClient(action) {
    const pool = new Pool(createDatabasePoolConfig({
        connectionString: appConfig.DATABASE_URL,
        tlsEnabled: appConfig.DATABASE_TLS_ENABLED,
        caCertPath: appConfig.DATABASE_CA_CERT_PATH,
    }));
    const client = await pool.connect();
    try {
        output(await action(client));
    }
    catch (error) {
        const code = error instanceof DeploymentRunError ? error.code : 'DEPLOYMENT_STATE_FAILED';
        process.stderr.write(`${JSON.stringify({ status: 'error', code, message: error instanceof Error ? error.message : String(error) })}\n`);
        process.exitCode = 1;
    }
    finally {
        client.release();
        await pool.end();
    }
}
function identity(command) {
    return command
        .requiredOption('--release-id <id>')
        .requiredOption('--site-name <site>')
        .requiredOption('--manifest-sha256 <sha256>');
}
identity(program.command('begin'))
    .requiredOption('--mode <mode>', 'INSTALL, UPGRADE, or ADOPT')
    .option('--ticket <ticket>')
    .action((options) => withClient((client) => beginDeploymentRun(client, {
    releaseId: options.releaseId,
    siteName: options.siteName,
    manifestSha256: options.manifestSha256,
    mode: String(options.mode).toUpperCase(),
    ticket: options.ticket,
})));
identity(program.command('mark'))
    .requiredOption('--step <step>')
    .option('--complete')
    .action((options) => withClient((client) => markDeploymentStep(client, {
    releaseId: options.releaseId,
    siteName: options.siteName,
    manifestSha256: options.manifestSha256,
    step: String(options.step).toUpperCase(),
    complete: options.complete,
})));
program.command('status')
    .requiredOption('--release-id <id>')
    .action((options) => withClient(async (client) => ({ run: await inspectDeploymentRun(client, options.releaseId) })));
await program.parseAsync(process.argv);
