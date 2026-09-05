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

  it('generates source-free lifecycle scripts with the canonical db command names', () => {
    const assembler = readFileSync(path.resolve(process.cwd(), '../scripts/bundle/assemble-runtime-bundle.sh'), 'utf8');
    const lifecycle = assembler.slice(
      assembler.indexOf('write_backend_lifecycle_scripts()'),
      assembler.indexOf('write_stop_script()')
    );

    expect(lifecycle).toContain('npm run --silent db:status');
    expect(lifecycle).toContain('npm run --silent db:migrate');
    expect(lifecycle).toContain('npm run --silent db:adopt');
    expect(lifecycle).not.toContain('npm run --silent migration:plan');
    expect(lifecycle).not.toContain('npm run --silent migration:apply');
    expect(lifecycle).not.toContain('npm run --silent migration:adopt');
    expect(lifecycle).toContain('A regular restore-verified backup manifest is required');
    expect(lifecycle).toContain('! -L "\\$DARSHAN_BACKUP_MANIFEST"');
  });

  it('generates acceptance checks that reject empty or multiline password files', () => {
    const assembler = readFileSync(path.resolve(process.cwd(), '../scripts/bundle/assemble-runtime-bundle.sh'), 'utf8');
    const serverPackage = readFileSync(path.resolve(process.cwd(), '../scripts/export/package-server.sh'), 'utf8');
    const lifecycle = assembler.slice(
      assembler.indexOf('write_backend_lifecycle_scripts()'),
      assembler.indexOf('write_stop_script()')
    );

    expect(lifecycle).toContain('Password file must contain one non-empty line.');
    expect(lifecycle).toContain('A protected regular password file is required.');
    expect(lifecycle).toContain('Fresh installation requires a regular bootstrap-secrets/admin-password file.');
    expect(lifecycle).toContain('/run/darshan-bootstrap/admin-password');
    expect(lifecycle).not.toContain('/run/secrets/initial-admin-password');
    expect(lifecycle).toContain('--resolve "\\${CMS_PUBLIC_HOST}:\\${CMS_HTTPS_PORT}:\\${CMS_BIND_ADDRESS}"');
    expect(lifecycle).toContain('A protected regular recovery password file is required.');
    expect(lifecycle).toContain('text.replace(/\\\\r?\\\\n$/, "")');
    expect(lifecycle).toContain('/[\\\\r\\\\n\\\\0]/.test(password)');
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
    expect(serverPackage).toContain('npm run --silent db:migrate');
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
