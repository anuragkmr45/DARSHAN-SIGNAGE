import { constants } from 'node:fs';
import { access, chmod, copyFile, mkdir, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';

const runtimeEnv = { ...process.env };
runtimeEnv.DARSHAN_PROCESS_ROLE ||= 'all';
runtimeEnv.DARSHAN_RELEASE_ID ||= runtimeEnv.RENDER_GIT_COMMIT || 'cloud-native';

if (!runtimeEnv.APP_PUBLIC_BASE_URL && runtimeEnv.RENDER_EXTERNAL_HOSTNAME) {
  runtimeEnv.APP_PUBLIC_BASE_URL = `https://${runtimeEnv.RENDER_EXTERNAL_HOSTNAME}`;
}
runtimeEnv.MINIO_PUBLIC_ENDPOINT ||= runtimeEnv.S3_ENDPOINT;
runtimeEnv.BACKUP_OFFHOST_ENDPOINT ||= runtimeEnv.S3_ENDPOINT;
runtimeEnv.BACKUP_OFFHOST_REGION ||= runtimeEnv.MINIO_REGION;
runtimeEnv.BACKUP_OFFHOST_ACCESS_KEY_FILE ||= runtimeEnv.MINIO_ACCESS_KEY_FILE;
runtimeEnv.BACKUP_OFFHOST_SECRET_KEY_FILE ||= runtimeEnv.MINIO_SECRET_KEY_FILE;

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: runtimeEnv,
      stdio: 'inherit',
      ...options,
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} failed (${signal || `exit ${code}`})`));
    });
  });
}

async function isReadable(filePath) {
  if (!filePath) return false;
  try {
    await access(filePath, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

async function prepareDatabase() {
  if (runtimeEnv.CLOUD_AUTO_MIGRATE !== 'false') {
    process.stdout.write('Applying checksum-verified database migrations.\n');
    await run('node', [
      '--import',
      'tsx',
      'scripts/migrate-production.ts',
      'apply',
      '--release-id',
      runtimeEnv.DARSHAN_RELEASE_ID,
      '--json',
    ]);
  }

  const bootstrapSource = runtimeEnv.CLOUD_BOOTSTRAP_PASSWORD_FILE;
  const bootstrapEmail = runtimeEnv.CLOUD_BOOTSTRAP_ADMIN_EMAIL?.trim();
  if (!(await isReadable(bootstrapSource))) {
    process.stdout.write('No bootstrap password file is mounted; skipping one-time administrator bootstrap.\n');
    return;
  }
  if (!bootstrapEmail) {
    throw new Error('CLOUD_BOOTSTRAP_ADMIN_EMAIL is required when CLOUD_BOOTSTRAP_PASSWORD_FILE is mounted.');
  }

  await mkdir('/app/tmp', { recursive: true });
  const protectedPassword = '/app/tmp/bootstrap-admin-password';
  await copyFile(bootstrapSource, protectedPassword);
  await chmod(protectedPassword, 0o600);
  try {
    process.stdout.write('Running idempotent production administrator bootstrap.\n');
    await run('node', [
      '--import',
      'tsx',
      'scripts/production-bootstrap.ts',
      '--email',
      bootstrapEmail,
      '--password-file',
      protectedPassword,
      '--release-id',
      runtimeEnv.DARSHAN_RELEASE_ID,
      '--json',
    ]);
  } finally {
    await rm(protectedPassword, { force: true });
  }
}

async function startRuntime() {
  await prepareDatabase();
  await new Promise((resolve, reject) => {
    const child = spawn('node', ['dist/index.js', '--role=all'], {
      env: runtimeEnv,
      stdio: 'inherit',
    });
    const forward = (signal) => {
      if (!child.killed) child.kill(signal);
    };
    process.once('SIGTERM', () => forward('SIGTERM'));
    process.once('SIGINT', () => forward('SIGINT'));
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`DARSHAN runtime failed (${signal || `exit ${code}`})`));
    });
  });
}

startRuntime().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Cloud startup failed: ${message}\n`);
  process.exitCode = 1;
});
