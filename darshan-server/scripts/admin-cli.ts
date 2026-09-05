import 'dotenv/config';
import { program } from 'commander';
import { eq } from 'drizzle-orm';
import { closeDatabase, getDatabase, initializeDatabase, schema } from '../src/db/index.js';
import {
  cleanupExpiredSessions,
  createAdministrator,
  deactivateAdministrator,
  inspectAdministrator,
  recoverAdministrator,
} from '../src/deployment/admin-recovery.js';
import { resolveAdminPasswordInput } from '../src/deployment/admin-secret-input.js';

type CommandResult = Record<string, unknown>;

function writeResult(result: CommandResult, json?: boolean) {
  if (json) {
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }
  process.stdout.write(`${result.status ?? result.code ?? 'ok'}\n`);
}

async function withDatabase(action: () => Promise<void>) {
  try {
    await initializeDatabase();
    await action();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${JSON.stringify({ status: 'error', code: 'ADMIN_CLI_FAILED', message })}\n`);
    process.exitCode = 1;
  } finally {
    await closeDatabase();
  }
}

program.name('darshan-admin').description('DARSHAN production administrator recovery CLI').version('2.0.0');

program
  .command('inspect')
  .description('Inspect an administrator account without changing it')
  .requiredOption('-e, --email <email>', 'Administrator email')
  .option('--json', 'Emit machine-readable output')
  .action(async (options) => withDatabase(async () => {
    const accounts = await inspectAdministrator(getDatabase(), options.email);
    writeResult({ status: accounts.length === 0 ? 'not_found' : 'ok', accounts }, options.json);
    process.exitCode = accounts.length === 0 ? 2 : 0;
  }));

function addRecoveryCommand(name: string, description: string) {
  return program
    .command(name)
    .description(description)
    .requiredOption('-e, --email <email>', 'Administrator email')
    .option('--password-file <path>', 'Mode-0600 file containing the new password')
    .option('--prompt-password', 'Read the new password from an interactive non-echoing TTY')
    .requiredOption('--ticket <ticket>', 'Approved incident or change ticket identifier')
    .option('--reactivate', 'Explicitly reactivate the account')
    .option('--grant-super-admin', 'Explicitly assign SUPER_ADMIN')
    .option('--json', 'Emit machine-readable output')
    .action(async (options) => withDatabase(async () => {
      const result = await recoverAdministrator(getDatabase(), {
        email: options.email,
        password: await resolveAdminPasswordInput({
          passwordFile: options.passwordFile,
          promptPassword: options.promptPassword,
          prompt: 'Recovery password: ',
        }),
        ticket: options.ticket,
        reactivate: Boolean(options.reactivate),
        grantSuperAdmin: Boolean(options.grantSuperAdmin),
      });
      writeResult(result, options.json);
      process.exitCode = result.status === 'recovered' ? 0 : 2;
    }));
}

addRecoveryCommand('recover', 'Recover an administrator password and revoke all active sessions');
addRecoveryCommand('reset-password', 'Deprecated alias for recover; plaintext -p is intentionally unsupported');

program
  .command('create-admin')
  .description('Create an administrator with an existing RBAC role')
  .requiredOption('-e, --email <email>', 'Administrator email')
  .option('--password-file <path>', 'Mode-0600 file containing the initial password')
  .option('--prompt-password', 'Read the initial password from an interactive non-echoing TTY')
  .requiredOption('--ticket <ticket>', 'Approved incident or change ticket identifier')
  .option('-r, --role <role>', 'Existing role name', 'ADMIN')
  .option('-f, --first-name <name>', 'First name')
  .option('-l, --last-name <name>', 'Last name')
  .option('--json', 'Emit machine-readable output')
  .action(async (options) => withDatabase(async () => {
    const result = await createAdministrator(getDatabase(), {
      email: options.email,
      password: await resolveAdminPasswordInput({
        passwordFile: options.passwordFile,
        promptPassword: options.promptPassword,
        prompt: 'Initial administrator password: ',
      }),
      ticket: options.ticket,
      roleName: options.role,
      firstName: options.firstName,
      lastName: options.lastName,
    });
    writeResult(result, options.json);
    process.exitCode = result.status === 'created' ? 0 : 2;
  }));

program
  .command('list-users')
  .description('List users with their resolved role')
  .option('-r, --role <role>', 'Filter by role name')
  .option('--json', 'Emit machine-readable output')
  .action(async (options) => withDatabase(async () => {
    const users = await getDatabase()
      .select({
        id: schema.users.id,
        email: schema.users.email,
        isActive: schema.users.is_active,
        role: schema.roles.name,
        createdAt: schema.users.created_at,
      })
      .from(schema.users)
      .leftJoin(schema.roles, eq(schema.users.role_id, schema.roles.id));
    const filtered = options.role ? users.filter((user) => user.role === options.role) : users;
    if (options.json) writeResult({ status: 'ok', users: filtered }, true);
    else process.stdout.write(`${JSON.stringify(filtered, null, 2)}\n`);
  }));

program
  .command('deactivate-user')
  .description('Deactivate an account, revoke its sessions, and preserve at least one SUPER_ADMIN')
  .requiredOption('-e, --email <email>', 'User email')
  .requiredOption('--ticket <ticket>', 'Approved incident or change ticket identifier')
  .option('--json', 'Emit machine-readable output')
  .action(async (options) => withDatabase(async () => {
    const result = await deactivateAdministrator(getDatabase(), { email: options.email, ticket: options.ticket });
    writeResult(result, options.json);
    process.exitCode = result.status === 'deactivated' || result.status === 'already_deactivated' ? 0 : 2;
  }));

program
  .command('cleanup-sessions')
  .description('Delete expired authentication sessions')
  .option('--json', 'Emit machine-readable output')
  .action(async (options) => withDatabase(async () => {
    const result = await cleanupExpiredSessions(getDatabase());
    writeResult({ status: 'ok', ...result }, options.json);
  }));

program.parseAsync(process.argv);
