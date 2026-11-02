import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

type PackageJson = {
  scripts?: Record<string, string>;
};

function readText(relativePath: string) {
  return readFileSync(path.resolve(process.cwd(), relativePath), 'utf8');
}

describe('production command contracts', () => {
  it('does not require off-host worker secrets when the external sidecar owns backups', () => {
    const entrypoint = readText('docker/runtime-entrypoint.sh');
    expect(entrypoint).toContain('if [ "${BACKUP_MODE:-APPLICATION_OFFHOST}" = EXTERNAL_SIDECAR ]');
    expect(entrypoint).toContain('worker_secrets_required=false');
    expect(entrypoint).toContain('copy_inputs /run/darshan-input-worker-secrets /run/worker-secrets "$worker_secrets_required"');
  });

  it('exposes the canonical database lifecycle commands required by production runbooks', () => {
    const packageJson = JSON.parse(readText('package.json')) as PackageJson;

    expect(packageJson.scripts).toMatchObject({
      'db:status': 'tsx scripts/migrate-production.ts status',
      'db:migrate': 'tsx scripts/migrate-production.ts apply',
      'db:adopt': 'tsx scripts/migrate-production.ts adopt',
      'bootstrap:production': 'tsx scripts/production-bootstrap.ts',
      'bootstrap:adopt-existing': 'tsx scripts/production-bootstrap-adopt.ts',
      'admin:inspect': 'tsx scripts/admin-cli.ts inspect',
      'admin:recover': 'tsx scripts/admin-cli.ts recover',
      'typecheck:scripts': 'tsc --noEmit -p tsconfig.scripts.json',
      'lint:scripts': 'eslint scripts --ext .ts --max-warnings=0',
    });

    const bootstrapCli = readText('scripts/production-bootstrap.ts');
    const bootstrapAdoptCli = readText('scripts/production-bootstrap-adopt.ts');
    expect(bootstrapCli).toContain(".requiredOption('--release-id <release>'");
    expect(bootstrapAdoptCli).toContain(".requiredOption('--release-id <release>'");
  });

  it('prepares and verifies a writable Chromium runtime home for production workers', () => {
    const packageJson = JSON.parse(readText('package.json')) as PackageJson;
    const entrypoint = readText('docker/runtime-entrypoint.sh');
    const chromiumRuntime = readText('src/utils/chromium-runtime.ts');
    const chromiumSmoke = readText('scripts/verify-chromium-runtime.ts');
    const webpageCapture = readText('src/utils/webpage-capture.ts');

    expect(packageJson.scripts).toMatchObject({
      'production:verify-chromium-runtime': 'node dist-cli/scripts/verify-chromium-runtime.js',
    });
    expect(entrypoint).toContain('prepare_worker_runtime_dirs()');
    expect(entrypoint).toContain('HOME=/tmp/darshan-worker-home');
    expect(entrypoint).toContain('XDG_CONFIG_HOME="$HOME/.config"');
    expect(entrypoint).toContain('XDG_CACHE_HOME="$HOME/.cache"');
    expect(entrypoint).toContain('export HOME XDG_CONFIG_HOME XDG_CACHE_HOME TMPDIR');
    expect(entrypoint).toContain('install -d -m 1777 /tmp');
    expect(entrypoint).toContain('chmod 1777 /tmp');
    expect(entrypoint).toContain('install -d -m 0700 -o node -g node "$HOME" "$XDG_CONFIG_HOME" "$XDG_CACHE_HOME"');
    expect(entrypoint).toMatch(/if \[ "\$role" = worker \]; then\n\s+prepare_worker_runtime_dirs/);
    expect(entrypoint).toContain('--reuid=node');
    expect(entrypoint).toContain('--regid=node');
    expect(entrypoint).not.toContain('--reset-env');
    expect(chromiumRuntime).toContain("CHROMIUM_RUNTIME_HOME = '/tmp/darshan-worker-home'");
    expect(chromiumRuntime).toContain("'--disable-crash-reporter'");
    expect(chromiumSmoke).toContain("const SMOKE_URL = 'https://example.com/';");
    expect(chromiumSmoke).toContain("assertRuntimeEnv('HOME')");
    expect(chromiumSmoke).toContain("ensureWritableDirectory('XDG_CONFIG_HOME'");
    expect(chromiumSmoke).toContain('assertWorkerIdentity()');
    expect(chromiumSmoke).toContain('DARSHAN_EXPECTED_WORKER_UID');
    expect(chromiumSmoke).toContain('DARSHAN_EXPECTED_WORKER_GID');
    expect(chromiumSmoke).toContain('chromium.launch');
    expect(chromiumSmoke).toContain('page.goto(SMOKE_URL');
    expect(chromiumSmoke).toContain('page.screenshot');
    expect(chromiumSmoke).toContain('browserClosed: true');
    expect(webpageCapture).toContain('CHROMIUM_RUNTIME_LAUNCH_ARGS');
  });

  it('rejects root Chromium smoke checks as worker-runtime validation', () => {
    const chromiumSmoke = readText('scripts/verify-chromium-runtime.ts');
    const assembler = readFileSync(path.resolve(process.cwd(), '../scripts/bundle/assemble-runtime-bundle.sh'), 'utf8');
    const chromiumRuntimeCheck = assembler.slice(
      assembler.indexOf('cat > "$target_dir/chromium-runtime-check.sh"'),
      assembler.indexOf('cat > "$target_dir/acceptance-check.sh"')
    );

    expect(chromiumSmoke).toContain('if (uid === 0)');
    expect(chromiumSmoke).toContain('must run as the unprivileged worker user, not root');
    expect(chromiumSmoke).toContain('uid !== expectedWorkerUid || gid !== expectedWorkerGid');
    expect(chromiumRuntimeCheck).toContain('docker compose --env-file $env_file -f docker-compose.yml run --rm --no-deps worker');
    expect(chromiumRuntimeCheck).not.toContain('docker exec');
    expect(chromiumRuntimeCheck).not.toContain('docker compose exec');
    expect(assembler).toContain('DARSHAN_PROCESS_ROLE: worker');
  });

  it('keeps compatibility migration commands but makes status a first-class read-only command', () => {
    const packageJson = JSON.parse(readText('package.json')) as PackageJson;
    const migrateCli = readText('scripts/migrate-production.ts');

    expect(packageJson.scripts).toMatchObject({
      'migration:plan': 'tsx scripts/migrate-production.ts plan',
      'migration:apply': 'tsx scripts/migrate-production.ts apply',
      'migration:adopt': 'tsx scripts/migrate-production.ts adopt',
    });
    expect(migrateCli).toContain("addStatusCommand('status'");
    expect(migrateCli).toContain('planDatabaseMigrations(client, await loadMigrationManifest())');
    expect(migrateCli).toContain('createDatabasePoolConfig');
    expect(migrateCli).toContain('tlsEnabled: appConfig.DATABASE_TLS_ENABLED');
    expect(migrateCli).toContain('caCertPath: appConfig.DATABASE_CA_CERT_PATH');
  });

  it('generates source-free lifecycle scripts with compiled production db commands', () => {
    const assembler = readFileSync(path.resolve(process.cwd(), '../scripts/bundle/assemble-runtime-bundle.sh'), 'utf8');
    const lifecycle = assembler.slice(
      assembler.indexOf('write_backend_lifecycle_scripts()'),
      assembler.indexOf('write_stop_script()')
    );

    expect(lifecycle).toContain('npm run --silent production:db:status');
    expect(lifecycle).toContain('npm run --silent production:db:migrate');
    expect(lifecycle).toContain('npm run --silent production:db:adopt');
    expect(lifecycle).not.toContain('npm run --silent db:status');
    expect(lifecycle).not.toContain('npm run --silent db:migrate');
    expect(lifecycle).not.toContain('npm run --silent db:adopt');
    expect(lifecycle).not.toContain('npm run --silent migration:plan');
    expect(lifecycle).not.toContain('npm run --silent migration:apply');
    expect(lifecycle).not.toContain('npm run --silent migration:adopt');
    expect(lifecycle).toContain('A regular restore-verified backup manifest is required');
    expect(lifecycle).toContain('! -L "\\$DARSHAN_BACKUP_MANIFEST"');
  });

  it('blocks source-free backend activation when the SSO release preflight fails', () => {
    const packageJson = JSON.parse(readText('package.json')) as PackageJson;
    const assembler = readFileSync(path.resolve(process.cwd(), '../scripts/bundle/assemble-runtime-bundle.sh'), 'utf8');
    const startScript = assembler.slice(
      assembler.indexOf('write_backend_start_script()'),
      assembler.indexOf('write_backend_lifecycle_scripts()')
    );

    expect(packageJson.scripts).toMatchObject({
      'production:preflight:sso': 'node dist-cli/scripts/check-sso-release-preflight.js',
    });
    expect(startScript).toContain('npm run --silent production:preflight:sso');
    expect(startScript).toContain('Backend activation blocked: legacy SSO configuration or stored client secrets');
    expect(startScript.indexOf('production:preflight:sso')).toBeLessThan(startScript.indexOf('up -d'));

    const lifecycle = assembler.slice(
      assembler.indexOf('write_backend_lifecycle_scripts()'),
      assembler.indexOf('write_stop_script()')
    );
    const upgradeScript = lifecycle.slice(
      lifecycle.indexOf('cat > "$target_dir/upgrade.sh"'),
      lifecycle.indexOf('cat > "$target_dir/deploy.sh"')
    );
    expect(upgradeScript).toContain('npm run --silent production:preflight:sso');
    expect(upgradeScript.indexOf('production:preflight:sso')).toBeLessThan(upgradeScript.indexOf('up -d --force-recreate'));
  });

  it('generates acceptance checks that reject empty or multiline password files', () => {
    const assembler = readFileSync(path.resolve(process.cwd(), '../scripts/bundle/assemble-runtime-bundle.sh'), 'utf8');
    const serverPackage = readFileSync(path.resolve(process.cwd(), '../scripts/export/package-server.sh'), 'utf8');
    const lifecycle = assembler.slice(
      assembler.indexOf('write_backend_lifecycle_scripts()'),
      assembler.indexOf('write_stop_script()')
    );

    expect(lifecycle).toContain('password file must contain one non-empty line');
    expect(lifecycle).toContain('A protected regular password file is required.');
    expect(lifecycle).toContain('Fresh installation requires a regular bootstrap-secrets/admin-password file.');
    expect(lifecycle).toContain('/run/darshan-bootstrap/admin-password');
    expect(lifecycle).not.toContain('/run/secrets/initial-admin-password');
    expect(lifecycle).toContain('--resolve "\\${CMS_PUBLIC_HOST}:\\${CMS_HTTPS_PORT}:\\${CMS_BIND_ADDRESS}"');
    expect(lifecycle).toContain('A protected regular recovery password file is required.');
    expect(lifecycle).toContain('sub("\\\\r?\\\\n\\$"; "")');
    expect(lifecycle).toContain('test("[\\\\r\\\\n\\\\u0000]")');
    expect(lifecycle).not.toContain('fs.readFileSync(process.argv[1], "utf8").trimEnd()');

    const standaloneAcceptance = serverPackage.slice(
      serverPackage.indexOf('cat > "$OUTPUT_DIR/acceptance-check.sh"'),
      serverPackage.indexOf('cat > "$OUTPUT_DIR/health-check.sh"')
    );
    expect(standaloneAcceptance).toContain('Password file must contain one non-empty line.');
    expect(serverPackage).toContain('Fresh installation requires a regular bootstrap-secrets/admin-password file.');
    expect(serverPackage).toContain('/run/darshan-bootstrap/admin-password');
    expect(serverPackage).not.toContain('/run/secrets/initial-admin-password');
    expect(standaloneAcceptance).toContain('A regular mode-0600 password file is required.');
    expect(standaloneAcceptance).toContain('text.replace(/\\r?\\n$/, "")');
    expect(standaloneAcceptance).toContain('/[\\r\\n\\0]/.test(password)');
    expect(standaloneAcceptance).not.toContain('fs.readFileSync(process.argv[1], "utf8").trimEnd()');
  });

  it('keeps production-split as the default export path and labels standalone as non-production', () => {
    const serverPackage = readFileSync(path.resolve(process.cwd(), '../scripts/export/package-server.sh'), 'utf8');
    const allPackage = readFileSync(path.resolve(process.cwd(), '../scripts/export/package-all.sh'), 'utf8');

    expect(serverPackage).toContain('DEPLOYMENT_LAYOUT="production-split"');
    expect(allPackage).toContain('SERVER_DEPLOYMENT_LAYOUT="production-split"');
    expect(serverPackage).toContain('NODE_ENV: ${STANDALONE_NODE_ENV:-development}');
    expect(serverPackage).toContain('Do not use it for production promotion.');
    expect(serverPackage).toContain('npm run --silent production:db:migrate');
    expect(serverPackage).not.toContain('npm run migration:apply');
  });

  it('guards the deprecated checkout-based production Docker workflow behind an explicit acknowledgement', () => {
    const legacyLib = readFileSync(path.resolve(process.cwd(), '../deploy/production/docker/lib.sh'), 'utf8');
    const legacyHealthCheck = readFileSync(path.resolve(process.cwd(), '../deploy/production/docker/health-check.sh'), 'utf8');
    const legacyBackendStart = readFileSync(path.resolve(process.cwd(), '../deploy/production/docker/start-backend.sh'), 'utf8');
    const legacyStartAll = readFileSync(path.resolve(process.cwd(), '../deploy/production/docker/start-all.sh'), 'utf8');
    const legacyBackendCompose = readFileSync(path.resolve(process.cwd(), '../deploy/production/docker/backend/docker-compose.yml'), 'utf8');
    const legacyCmsStart = readFileSync(path.resolve(process.cwd(), '../deploy/production/docker/start-cms.sh'), 'utf8');
    const legacyCmsCompose = readFileSync(path.resolve(process.cwd(), '../deploy/production/docker/cms/docker-compose.yml'), 'utf8');
    const legacyCmsNginx = readFileSync(path.resolve(process.cwd(), '../deploy/production/docker/cms/nginx/default.conf.template'), 'utf8');
    const legacyEnvExample = readFileSync(path.resolve(process.cwd(), '../deploy/production/docker/.env.example'), 'utf8');

    expect(legacyLib).toContain('DEPRECATED_CHECKOUT_ACK="I_UNDERSTAND_SOURCE_FREE_BUNDLE_IS_AUTHORITATIVE"');
    expect(legacyLib).toContain('require_deprecated_checkout_ack()');
    expect(legacyLib).toContain('DARSHAN_ALLOW_DEPRECATED_CHECKOUT_PRODUCTION');
    expect(legacyLib).toMatch(/load_production_env\(\) \{\n\s+require_deprecated_checkout_ack/);
    expect(legacyLib).toContain('SERVER_TLS_ENABLED=true');
    expect(legacyLib).toContain('MINIO_HOST="${MINIO_HOST:-$DATA_HOST}"');
    expect(legacyLib).toContain('check_backend_ready()');
    expect(legacyLib).toContain('--cacert "$DARSHAN_BACKEND_TRANSPORT_CA_FILE"');
    expect(legacyLib).toContain('--resolve "${BACKEND_PRIVATE_HOST}:${API_HOST_PORT}:${BACKEND_BIND_ADDRESS}"');
    expect(legacyHealthCheck).toContain('check_backend_ready "backend API readiness"');
    expect(legacyHealthCheck).not.toContain('http://${BACKEND_HOST}:${API_HOST_PORT}/api/v1/health/ready');
    expect(legacyBackendStart).toContain('wait_for_backend_ready 60');
    expect(legacyStartAll).toContain('Backend readiness: $(backend_readiness_url)');
    expect(legacyBackendCompose).toContain('SERVER_TLS_ENABLED: ${SERVER_TLS_ENABLED:-true}');
    expect(legacyBackendCompose).toContain('DATABASE_TLS_ENABLED: ${DATABASE_TLS_ENABLED:-true}');
    expect(legacyBackendCompose).toContain('VALKEY_TLS_ENABLED: ${VALKEY_TLS_ENABLED:-true}');
    expect(legacyBackendCompose).toContain('DARSHAN_CONTAINER_ROLE: api');
    expect(legacyBackendCompose).toContain('https.request({host:\'127.0.0.1\',port:3000,path:\'/api/v1/health/ready\'');
    expect(legacyCmsStart).toContain('require_file "$DARSHAN_BACKEND_TRANSPORT_CA_FILE"');
    expect(legacyCmsCompose).toContain('BACKEND_PRIVATE_HOST: ${BACKEND_PRIVATE_HOST:-${BACKEND_HOST}}');
    expect(legacyCmsCompose).toContain('MINIO_HOST: ${MINIO_HOST:-${DATA_HOST}}');
    expect(legacyCmsCompose).toContain(':/etc/darshan/transport-ca.crt:ro');
    expect(legacyCmsNginx).toContain('proxy_pass https://${BACKEND_HOST}:${BACKEND_PORT}/api/v1/');
    expect(legacyCmsNginx).toContain('proxy_ssl_name ${BACKEND_PRIVATE_HOST};');
    expect(legacyCmsNginx).toContain('proxy_ssl_trusted_certificate /etc/darshan/transport-ca.crt;');
    expect(legacyEnvExample).not.toContain('RUN_PRODUCTION_DB_PUSH');
    expect(legacyEnvExample).not.toContain('RUN_PRODUCTION_SEED');
    expect(legacyEnvExample).toContain('PLAYER_BACKEND_BASE_URL=https://');
  });
});
