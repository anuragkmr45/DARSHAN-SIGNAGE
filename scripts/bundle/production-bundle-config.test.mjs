import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { parseBundleEnvText, loadProductionBundleConfig, toAssemblerEnvironment } from './production-bundle-config.mjs'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

function repoPath(...segments) {
  return path.join(repositoryRoot, ...segments)
}

test('parser rejects unknown, duplicate, placeholder, and interpolated values', () => {
  assert.throws(() => parseBundleEnvText('UNKNOWN=value\n'), /unknown key/)
  assert.throws(() => parseBundleEnvText('SITE_NAME=a\nSITE_NAME=b\n'), /duplicates key/)
  assert.throws(() => parseBundleEnvText('SITE_NAME=<site>\n'), /placeholder/)
  assert.throws(() => parseBundleEnvText('JWT_SECRET=change-me-with-a-long-random-value\n'), /placeholder/)
  assert.throws(() => parseBundleEnvText('SITE_NAME=$(hostname)\n'), /shell interpolation/)
})

test('parser reports every malformed line in one pass', () => {
  let error
  try {
    parseBundleEnvText([
      'UNKNOWN=value',
      'SITE_NAME=site-a',
      'SITE_NAME=site-b',
      'CMS_PUBLIC_HOST=$(hostname)',
      'not-a-key-value-line',
    ].join('\n'))
  } catch (caught) {
    error = caught
  }
  assert.ok(error)
  assert.match(error.message, /unknown key/)
  assert.match(error.message, /duplicates key/)
  assert.match(error.message, /shell interpolation/)
  assert.match(error.message, /KEY=value syntax/)
})

test('production config derives HTTPS and separates transport from device CA', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'darshan-bundle-config-'))
  const pkiRoot = path.join(root, 'pki')
  const secure = path.join(pkiRoot, 'site-a')
  const packages = path.join(root, 'packages')
  fs.mkdirSync(secure, { recursive: true })
  for (const role of ['server', 'cms', 'electron']) fs.mkdirSync(path.join(packages, 'r1', role), { recursive: true })
  for (const name of ['transport-ca.crt', 'transport-ca.key', 'device-ca.crt', 'device-ca.key']) {
    const file = path.join(secure, name)
    fs.writeFileSync(file, name)
    fs.chmodSync(file, name.endsWith('.key') ? 0o600 : 0o644)
  }
  const signingKey = path.join(secure, 'release-signing.key')
  fs.writeFileSync(signingKey, 'test signing key')
  fs.chmodSync(signingKey, 0o600)
  const capacityEvidence = path.join(secure, 'capacity-evidence.json')
  fs.writeFileSync(capacityEvidence, `${JSON.stringify({
    evidence_type: 'darshan.production.capacity-certification.v1',
    site_name: 'site-a',
    release_id: 'r1',
    status: 'approved',
    profile_name: 'site-a-500-player-profile',
    max_players: 500,
    valid_until: '2099-01-01T00:00:00.000Z',
    model_only: false,
    resource_policy_reviewed: true,
    approved_by: 'QA capacity board',
    runtime_evidence: [
      {
        kind: 'load-test',
        artifact_sha256: 'a'.repeat(64),
      },
      {
        kind: 'hardware-certification',
        artifact_sha256: 'b'.repeat(64),
      },
    ],
  }, null, 2)}\n`)
  const envFile = path.join(root, 'bundle.env')
  fs.writeFileSync(envFile, `RELEASE_ID=r1
SITE_NAME=site-a
EXPORT_SERVER=false
EXPORT_CMS=false
EXPORT_ELECTRON=false
PLAYER_TARGET_PLATFORMS=linux
PACKAGE_OUTPUT_BASE=${packages}
CMS_PUBLIC_HOST=10.20.0.30
BACKEND_PRIVATE_HOST=10.20.0.20
DATA_PRIVATE_HOST=10.20.0.10
OBSERVABILITY_PRIVATE_HOST=10.20.0.40
TRANSPORT_TLS_MODE=internal-ca
PKI_ROOT_DIR=${pkiRoot}
RELEASE_SIGNING_PRIVATE_KEY=${signingKey}
CAPACITY_EVIDENCE_FILE=${capacityEvidence}
POSTGRES_PASSWORD=strong-postgres-pass
POSTGRES_MONITORING_PASSWORD=strong-monitoring-password-123
VALKEY_PASSWORD=strong-valkey-password-123
OBSERVABILITY_METRICS_BEARER_TOKEN=abcdefghijklmnopqrstuvwxyz0123456789
GRAFANA_ADMIN_USER=darshan-admin
GRAFANA_ADMIN_PASSWORD=strong-grafana-password-123
MINIO_ACCESS_KEY=darshan1
MINIO_SECRET_KEY=strong-minio-secret
JWT_SECRET=01234567890123456789012345678901
INITIAL_ADMIN_EMAIL=admin@example.test
WEBPAGE_NAVIGATION_ALLOWLIST=display-content.example.test
WEBPAGE_RESOURCE_ALLOWLIST=*.assets.example.test
WEBPAGE_ALLOWED_CIDRS=10.20.0.0/24,fd00:20::/64
WEBPAGE_ALLOWED_PORTS=443,8443
BACKUP_INTERVAL_HOURS=24
BACKUP_RETENTION_DAYS=30
BACKUP_OFFHOST_DESTINATION=s3://offhost-backups.example.test/darshan/site-a
BACKUP_OFFHOST_ENDPOINT=https://s3.offhost-backups.example.test
BACKUP_OFFHOST_REGION=us-east-1
BACKUP_OFFHOST_ACCESS_KEY=offhost-access-key
BACKUP_OFFHOST_SECRET_KEY=offhost-secret-key-value
CONTAINER_LOG_MAX_SIZE=20m
CONTAINER_LOG_MAX_FILES=5
DATA_MIN_FREE_DISK_BYTES=21474836480
VALKEY_MIN_FREE_DISK_BYTES=5368709120
BACKEND_MIN_FREE_DISK_BYTES=10737418240
CMS_MIN_FREE_DISK_BYTES=5368709120
OBSERVABILITY_MIN_FREE_DISK_BYTES=10737418240
POSTGRES_CPU_LIMIT=2
POSTGRES_MEMORY_LIMIT=4g
POSTGRES_PIDS_LIMIT=512
MINIO_CPU_LIMIT=1
MINIO_MEMORY_LIMIT=2g
MINIO_PIDS_LIMIT=256
VALKEY_CPU_LIMIT=1
VALKEY_MEMORY_LIMIT=1g
VALKEY_PIDS_LIMIT=128
BACKEND_API_CPU_LIMIT=2
BACKEND_API_MEMORY_LIMIT=2g
BACKEND_API_PIDS_LIMIT=512
BACKEND_WORKER_CPU_LIMIT=2
BACKEND_WORKER_MEMORY_LIMIT=4g
BACKEND_WORKER_PIDS_LIMIT=512
CMS_CPU_LIMIT=1
CMS_MEMORY_LIMIT=1g
CMS_PIDS_LIMIT=256
PROMETHEUS_CPU_LIMIT=2
PROMETHEUS_MEMORY_LIMIT=4g
PROMETHEUS_PIDS_LIMIT=512
ALERTMANAGER_CPU_LIMIT=1
ALERTMANAGER_MEMORY_LIMIT=1g
ALERTMANAGER_PIDS_LIMIT=256
GRAFANA_CPU_LIMIT=1
GRAFANA_MEMORY_LIMIT=1g
GRAFANA_PIDS_LIMIT=256
EXPORTER_CPU_LIMIT=0.5
EXPORTER_MEMORY_LIMIT=256m
EXPORTER_PIDS_LIMIT=128
`)
  const loaded = loadProductionBundleConfig(envFile, root)
  const runtime = toAssemblerEnvironment(loaded.config)
  assert.equal(runtime.CMS_PUBLIC_SCHEME, 'https')
  assert.equal(runtime.MINIO_USE_SSL, 'true')
  assert.equal(runtime.SERVER_TLS_ENABLED, 'true')
  assert.equal(runtime.CA_CERT_PATH, '/app/certs/device-ca.crt')
  assert.equal(runtime.TLS_CERT_PATH, '/app/certs/server.crt')
  assert.equal(loaded.config.BACKEND_DEVICE_HOST, '10.20.0.20')
  assert.equal(loaded.config.VALKEY_PRIVATE_HOST, '10.20.0.20')
  assert.equal(loaded.config.BACKEND_BIND_ADDRESS, '10.20.0.20')
  assert.equal(loaded.config.DATA_BIND_ADDRESS, '10.20.0.10')
  assert.equal(loaded.config.DEVICE_AUTH_MODE, 'signature')
  assert.equal(loaded.config.OBSERVABILITY_METRICS_BEARER_TOKEN, 'abcdefghijklmnopqrstuvwxyz0123456789')
  assert.equal(loaded.config.POSTGRES_MONITORING_USER, 'darshan_monitoring')
  assert.equal(loaded.config.BACKUP_OFFHOST_ENDPOINT, 'https://s3.offhost-backups.example.test')
  assert.equal(loaded.config.CAPACITY_EVIDENCE_PROFILE_NAME, 'site-a-500-player-profile')
  assert.equal(loaded.config.CAPACITY_EVIDENCE_MAX_PLAYERS, '500')
  assert.equal(loaded.config.CAPACITY_EVIDENCE_VALID_UNTIL, '2099-01-01T00:00:00.000Z')
  assert.equal(loaded.config.CAPACITY_EVIDENCE_SHA256, crypto.createHash('sha256').update(fs.readFileSync(capacityEvidence)).digest('hex'))
  assert.equal(loaded.config.PLAYER_TARGET_PLATFORMS, 'linux')
  assert.deepEqual(loaded.outputs.WEBPAGE_ALLOWED_CIDRS, ['production/backend/.env.production', 'production/electron/config.json'])
  assert.deepEqual(loaded.outputs.WEBPAGE_ALLOWED_PORTS, ['production/backend/.env.production', 'production/electron/config.json'])
  assert.deepEqual(loaded.outputs.WEBPAGE_ALLOW_HTTP, ['production/backend/.env.production', 'production/electron/config.json'])
  assert.equal(loaded.config.SITE_PKI_DIR, secure)
	  const validText = fs.readFileSync(envFile, 'utf8')
	  const validCapacityEvidence = fs.readFileSync(capacityEvidence, 'utf8')
	  const maxLengthReleaseId = `r${'a'.repeat(127)}`
	  for (const role of ['server', 'cms', 'electron']) fs.mkdirSync(path.join(packages, maxLengthReleaseId, role), { recursive: true })
	  fs.writeFileSync(capacityEvidence, validCapacityEvidence.replace('"release_id": "r1"', `"release_id": "${maxLengthReleaseId}"`))
	  fs.writeFileSync(envFile, validText.replace('RELEASE_ID=r1', `RELEASE_ID=${maxLengthReleaseId}`))
	  assert.equal(loadProductionBundleConfig(envFile, root).config.RELEASE_ID, maxLengthReleaseId)
	  fs.writeFileSync(capacityEvidence, validCapacityEvidence)
	  fs.writeFileSync(envFile, validText)
	  fs.writeFileSync(envFile, `${validText}\nINSTALL_PLAYWRIGHT_CHROMIUM=false\n`)
	  assert.throws(() => loadProductionBundleConfig(envFile, root), /INSTALL_PLAYWRIGHT_CHROMIUM must be true/)
  fs.writeFileSync(envFile, validText)
  fs.writeFileSync(envFile, validText.replace('PLAYER_TARGET_PLATFORMS=linux', 'PLAYER_TARGET_PLATFORMS=macos'))
  assert.throws(() => loadProductionBundleConfig(envFile, root), /PLAYER_TARGET_PLATFORMS must be/)

  fs.writeFileSync(envFile, validText.replace('WEBPAGE_ALLOWED_PORTS=443,8443', 'WEBPAGE_ALLOWED_PORTS=443,70000'))
  assert.throws(() => loadProductionBundleConfig(envFile, root), /WEBPAGE_ALLOWED_PORTS contains invalid port/)

  fs.writeFileSync(envFile, validText.replace('WEBPAGE_ALLOWED_CIDRS=10.20.0.0\/24,fd00:20::\/64', 'WEBPAGE_ALLOWED_CIDRS=10.20.0.0\/99'))
  assert.throws(() => loadProductionBundleConfig(envFile, root), /WEBPAGE_ALLOWED_CIDRS contains invalid CIDR/)

  fs.writeFileSync(envFile, `${validText}\nWEBPAGE_ALLOW_HTTP=true\n`)
  assert.throws(() => loadProductionBundleConfig(envFile, root), /WEBPAGE_ALLOW_HTTP must be false for production/)
  fs.writeFileSync(envFile, validText
    .replace('strong-postgres-pass', 'has:a:colon-password')
    .replace('strong-monitoring-password-123', 'has:a:strong-monitoring-password-123')
    .replace('darshan1', 'darshan:access')
    .replace('strong-minio-secret', 'has:a:strong-minio-secret')
    .replace('01234567890123456789012345678901', 'has:a:01234567890123456789012345678901')
    .replace('strong-valkey-password-123', 'has:a:strong-valkey-password-123'))
  let error
  try {
    loadProductionBundleConfig(envFile, root)
  } catch (caught) {
    error = caught
  }
  assert.ok(error)
  for (const name of ['POSTGRES_PASSWORD', 'POSTGRES_MONITORING_PASSWORD', 'MINIO_ACCESS_KEY', 'MINIO_SECRET_KEY', 'JWT_SECRET', 'VALKEY_PASSWORD']) {
    assert.match(error.message, new RegExp(`${name} may contain only`))
  }

  fs.writeFileSync(envFile, validText.replace('abcdefghijklmnopqrstuvwxyz0123456789', 'metrics:token'))
  assert.throws(() => loadProductionBundleConfig(envFile, root), /OBSERVABILITY_METRICS_BEARER_TOKEN may contain only/)

  fs.writeFileSync(envFile, validText.replace('strong-grafana-password-123', 'grafana:password'))
  assert.throws(() => loadProductionBundleConfig(envFile, root), /GRAFANA_ADMIN_PASSWORD may contain only/)

  fs.writeFileSync(envFile, validText.replace(/^VALKEY_PASSWORD=.*\n/m, ''))
  assert.throws(() => loadProductionBundleConfig(envFile, root), /VALKEY_PASSWORD is required/)

  fs.writeFileSync(envFile, validText.replace(/^POSTGRES_MONITORING_PASSWORD=.*\n/m, ''))
  assert.throws(() => loadProductionBundleConfig(envFile, root), /POSTGRES_MONITORING_PASSWORD is required/)

  fs.writeFileSync(envFile, validText.replace(/^GRAFANA_ADMIN_PASSWORD=.*\n/m, ''))
  assert.throws(() => loadProductionBundleConfig(envFile, root), /GRAFANA_ADMIN_PASSWORD is required/)

  fs.writeFileSync(envFile, validText.replace('BACKUP_OFFHOST_DESTINATION=s3://offhost-backups.example.test/darshan/site-a', 'BACKUP_OFFHOST_DESTINATION=s3://localhost/darshan'))
  assert.throws(() => loadProductionBundleConfig(envFile, root), /BACKUP_OFFHOST_DESTINATION must not resolve/)

  fs.writeFileSync(envFile, validText.replace('BACKUP_OFFHOST_ENDPOINT=https://s3.offhost-backups.example.test', 'BACKUP_OFFHOST_ENDPOINT=http://s3.offhost-backups.example.test'))
  assert.throws(() => loadProductionBundleConfig(envFile, root), /BACKUP_OFFHOST_ENDPOINT must be an https/)

  fs.writeFileSync(envFile, validText.replace(/^BACKUP_OFFHOST_SECRET_KEY=.*\n/m, ''))
  assert.throws(() => loadProductionBundleConfig(envFile, root), /BACKUP_OFFHOST_SECRET_KEY is required/)

  fs.writeFileSync(envFile, validText.replace('POSTGRES_MEMORY_LIMIT=4g', 'POSTGRES_MEMORY_LIMIT=4096'))
  assert.throws(() => loadProductionBundleConfig(envFile, root), /POSTGRES_MEMORY_LIMIT must be/)

  fs.writeFileSync(envFile, validText.replace(/^DATA_MIN_FREE_DISK_BYTES=.*\n/m, ''))
  assert.throws(() => loadProductionBundleConfig(envFile, root), /DATA_MIN_FREE_DISK_BYTES is required/)

  fs.writeFileSync(capacityEvidence, `${JSON.stringify({
    evidence_type: 'darshan.production.capacity-certification.v1',
    site_name: 'site-a',
    release_id: 'r1',
    status: 'approved',
    profile_name: 'model-only-profile',
    max_players: 500,
    valid_until: '2099-01-01T00:00:00.000Z',
    model_only: true,
    resource_policy_reviewed: true,
    approved_by: 'QA capacity board',
    runtime_evidence: [{ kind: 'load-test', artifact_sha256: 'a'.repeat(64) }],
  })}\n`)
  fs.writeFileSync(envFile, validText)
  assert.throws(() => loadProductionBundleConfig(envFile, root), /not model-only sizing/)

  fs.writeFileSync(capacityEvidence, `${JSON.stringify({
    evidence_type: 'darshan.production.capacity-certification.v1',
    site_name: 'other-site',
    release_id: 'r1',
    status: 'approved',
    profile_name: 'site-a-500-player-profile',
    max_players: 500,
    valid_until: '2099-01-01T00:00:00.000Z',
    model_only: false,
    resource_policy_reviewed: true,
    approved_by: 'QA capacity board',
    runtime_evidence: [{ kind: 'load-test', artifact_sha256: 'a'.repeat(64) }],
  })}\n`)
  assert.throws(() => loadProductionBundleConfig(envFile, root), /site_name must match/)

  fs.writeFileSync(capacityEvidence, `${JSON.stringify({
    evidence_type: 'darshan.production.capacity-certification.v1',
    site_name: 'site-a',
    release_id: 'r1',
    status: 'approved',
    profile_name: 'site-a-500-player-profile',
    max_players: 500,
    valid_until: '2099-01-01T00:00:00.000Z',
    model_only: false,
    resource_policy_reviewed: true,
    approved_by: 'QA capacity board',
    runtime_evidence: [],
  })}\n`)
  assert.throws(() => loadProductionBundleConfig(envFile, root), /runtime_evidence must contain/)

  fs.writeFileSync(capacityEvidence, `${JSON.stringify({
    evidence_type: 'darshan.production.capacity-certification.v1',
    site_name: 'site-a',
    release_id: 'r1',
    status: 'approved',
    profile_name: 'site-a-500-player-profile',
    max_players: 500,
    valid_until: '2099-01-01T00:00:00.000Z',
    model_only: false,
    resource_policy_reviewed: true,
    approved_by: 'QA capacity board',
    runtime_evidence: [{ kind: 'load-test', artifact_sha256: 'a'.repeat(64) }],
  })}\n`)

  fs.writeFileSync(envFile, `${validText}\nDEVICE_AUTH_MODE=dual\n`)
  assert.throws(() => loadProductionBundleConfig(envFile, root), /DEVICE_AUTH_LEGACY_COMPATIBILITY_EXPIRES_AT is required/)
  fs.writeFileSync(envFile, `${validText}\nDEVICE_AUTH_MODE=dual\nDEVICE_AUTH_LEGACY_COMPATIBILITY_EXPIRES_AT=2099-01-01T00:00:00Z\n`)
  assert.equal(loadProductionBundleConfig(envFile, root).config.DEVICE_AUTH_MODE, 'dual')
  fs.writeFileSync(envFile, `${validText}\nBACKEND_BIND_ADDRESS=0.0.0.0\n`)
  assert.throws(() => loadProductionBundleConfig(envFile, root), /BACKEND_BIND_ADDRESS must not publish/)
})

test('production state-service artifacts require verified TLS and authenticated Valkey probes', () => {
  const assembler = fs.readFileSync(repoPath('scripts/bundle/assemble-runtime-bundle.sh'), 'utf8')
  const production = assembler.slice(assembler.indexOf('if profile_enabled production; then'))

  assert.match(production, /hostssl all\s+all\s+0\.0\.0\.0\/0\s+scram-sha-256/)
  assert.match(production, /hostnossl all\s+all\s+0\.0\.0\.0\/0\s+reject/)
  assert.match(production, /-c ssl=on/)
  assert.match(production, /-c ssl_min_protocol_version=TLSv1\.2/)
  assert.match(production, /'port 0'/)
  assert.match(production, /'tls-auth-clients no'/)
  assert.match(production, /printf 'requirepass %s\\n'/)
  assert.match(production, /PGSSLMODE=verify-full PGSSLROOTCERT=\/run\/darshan-tls\/postgres-ca\.crt/)
  assert.match(production, /valkey-cli --tls --sni "\$1" --cacert \/run\/darshan-tls\/ca\.crt/)
  assert.match(production, /REDISCLI_AUTH="\$\(cat \/run\/secrets\/valkey-password\)"/)
  assert.match(production, /DEVICE_AUTH_MODE=\$DEVICE_AUTH_MODE/)
  assert.match(production, /DEVICE_SOCKET_LEGACY_AUTH_ALLOWED=\$PROD_DEVICE_SOCKET_LEGACY_AUTH_ALLOWED/)
  assert.match(production, /DEVICE_SOCKET_AUTH_REPLAY_FAIL_CLOSED=true/)
  assert.match(production, /OBSERVABILITY_METRICS_BEARER_TOKEN_FILE=\/run\/secrets\/observability-metrics-bearer-token/)
  assert.match(assembler, /credentials_file: %s/)
  assert.match(production, /"\$\{DATA_BIND_ADDRESS\}:\$\{POSTGRES_HOST_PORT\}:5432"/)
  assert.match(production, /"\$\{VALKEY_BIND_ADDRESS\}:\$\{VALKEY_HOST_PORT\}:6379"/)
  assert.match(production, /"\$\{BACKEND_BIND_ADDRESS\}:\$\{API_HOST_PORT\}:3000"/)
  assert.match(production, /"\$\{CMS_BIND_ADDRESS\}:\$\{CMS_HTTPS_PORT\}:443"/)
  assert.match(production, /--resolve "\$\{DATA_PRIVATE_HOST:-localhost\}:\$\{MINIO_HOST_PORT\}:\$\{DATA_BIND_ADDRESS\}"/)
  assert.match(production, /--resolve "\$\{BACKEND_PRIVATE_HOST\}:\$\{API_HOST_PORT\}:\$\{BACKEND_BIND_ADDRESS\}"/)
  assert.match(production, /curl -fsSI "http:\/\/\$\{CMS_BIND_ADDRESS\}:\$\{CMS_HTTP_PORT\}\//)
  assert.match(production, /curl -fsS "http:\/\/\$\{OBSERVABILITY_BIND_ADDRESS\}:\$\{PROMETHEUS_HOST_PORT\}\/-\/ready"/)
})

test('generated player configs carry the centrally validated webpage policy', () => {
  const assembler = fs.readFileSync(repoPath('scripts/bundle/assemble-runtime-bundle.sh'), 'utf8')
  const playerWriter = assembler.slice(
    assembler.indexOf('stage_player_bundle()'),
    assembler.indexOf('write_skip_placeholder()'),
  )

  assert.match(playerWriter, /"allowedDomains": \$webpage_navigation_json/)
  assert.match(playerWriter, /"webpageResourceDomains": \$webpage_resource_json/)
  assert.match(playerWriter, /"webpageAllowedCidrs": \$webpage_cidrs_json/)
  assert.match(playerWriter, /"webpageAllowedPorts": \$webpage_ports_json/)
  assert.match(playerWriter, /"webpageAllowHttp": \$WEBPAGE_ALLOW_HTTP/)
})

test('production observability deploys every static exporter target from signed role images', () => {
  const assembler = fs.readFileSync(repoPath('scripts/bundle/assemble-runtime-bundle.sh'), 'utf8')
  const template = fs.readFileSync(repoPath('deploy/shared/observability/prometheus/prometheus.yml.template'), 'utf8')
  const production = assembler.slice(assembler.indexOf('if profile_enabled production; then'))

  for (const image of ['NODE_EXPORTER_IMAGE', 'POSTGRES_EXPORTER_IMAGE', 'NGINX_PROMETHEUS_EXPORTER_IMAGE']) {
    assert.match(assembler, new RegExp(`${image}=`))
  }
  for (const service of ['postgres-exporter:', 'node-exporter:', 'nginx-exporter:']) {
    assert.match(production, new RegExp(service))
  }
  assert.match(assembler, /GRANT pg_monitor TO %I/)
  assert.match(production, /DATA_SOURCE_PASS_FILE: \/run\/postgres-exporter\/postgres-monitoring-password/)
  // The observability compose writer is declared before the production assembly
  // block, so assert against the complete assembler rather than the latter slice.
  assert.match(assembler, /GF_SECURITY_ADMIN_PASSWORD__FILE: \$\{GRAFANA_ADMIN_PASSWORD_FILE\}/)
  assert.match(assembler, /grafana-admin-password/)
  assert.match(assembler, /su -s \/bin\/sh grafana -c 'exec \/run\.sh'/)
  assert.match(production, /\$DATA_PRIVATE_HOST:\$POSTGRES_HOST_PORT\/\$POSTGRES_DB\?sslmode=verify-full&sslrootcert=\/etc\/darshan\/tls\/postgres-ca\.crt/)
  assert.match(production, /extra_hosts:\n      - "\$\{DATA_PRIVATE_HOST\}:\$\{DATA_BIND_ADDRESS\}"/)
  assert.match(production, /- "\$\{VALKEY_PRIVATE_HOST\}:\$\{VALKEY_BIND_ADDRESS\}"/)
  assert.match(production, /- "\$\{BACKEND_PRIVATE_HOST\}:\$\{BACKEND_BIND_ADDRESS\}"/)
  assert.match(production, /- "\$\{OBSERVABILITY_PRIVATE_HOST\}:\$\{OBSERVABILITY_BIND_ADDRESS\}"/)
  assert.match(production, /stub_status;/)
  assert.match(production, /--nginx\.scrape-uri=http:\/\/cms:8080\/nginx_status/)
  assert.match(production, /Prometheus target is not healthy/)
  assert.doesNotMatch(template, /cadvisor/)
  for (const job of ['vm4-alertmanager', 'vm1-node', 'vm1-postgres', 'vm1-minio', 'vm-valkey-node', 'vm2-node', 'vm3-node', 'vm3-nginx', 'vm4-node', 'vm4-grafana']) {
    assert.match(template, new RegExp(`job_name: ${job}`))
  }
  assert.match(template, /__VALKEY_HOST__:__NODE_EXPORTER_HOST_PORT__/)
  assert.match(assembler, /"\$PROD_VALKEY_DIR\/images"/)
  assert.ok([...production.matchAll(/^  node-exporter:/gm)].length >= 4)
})

test('production bundle requires and applies the explicit operations policy', () => {
  const assembler = fs.readFileSync(repoPath('scripts/bundle/assemble-runtime-bundle.sh'), 'utf8')
  const config = fs.readFileSync(repoPath('scripts/bundle/production-bundle-config.mjs'), 'utf8')

  for (const field of [
    'BACKUP_INTERVAL_HOURS', 'BACKUP_RETENTION_DAYS', 'BACKUP_OFFHOST_DESTINATION',
    'BACKUP_OFFHOST_ENDPOINT', 'BACKUP_OFFHOST_REGION',
    'CONTAINER_LOG_MAX_SIZE', 'CONTAINER_LOG_MAX_FILES', 'DATA_MIN_FREE_DISK_BYTES',
  ]) {
    assert.match(config, new RegExp(`['\\\"]${field}['\\\"]`))
  }
  assert.match(config, /RESOURCE_LIMIT_FIELDS/)
  assert.match(config, /'POSTGRES', 'MINIO', 'VALKEY', 'BACKEND_API', 'BACKEND_WORKER', 'CMS'/)
  assert.match(config, /CAPACITY_EVIDENCE_FILE/)
  assert.match(config, /darshan\.production\.capacity-certification\.v1/)
  assert.match(assembler, /OPERATIONS_POLICY\.json/)
  assert.match(assembler, /"capacity": \{/)
  assert.match(assembler, /"evidenceSha256": "\$CAPACITY_EVIDENCE_SHA256"/)
  assert.match(assembler, /"modelOnlyAccepted": false/)
  assert.match(assembler, /for role_dir in "\$PROD_DATA_DIR" "\$PROD_VALKEY_DIR" "\$PROD_BACKEND_DIR" "\$PROD_CMS_DIR"/)
  assert.match(assembler, /driver: local/)
  assert.match(assembler, /max-size: \$\{CONTAINER_LOG_MAX_SIZE\}/)
  assert.match(assembler, /mem_limit: \$\{POSTGRES_MEMORY_LIMIT\}/)
  assert.match(assembler, /pids_limit: \$\{BACKEND_WORKER_PIDS_LIMIT\}/)
  assert.match(assembler, /require_docker_free_bytes "\$DATA_MIN_FREE_DISK_BYTES"/)
  assert.match(assembler, /require_docker_free_bytes "\$OBSERVABILITY_MIN_FREE_DISK_BYTES"/)
  assert.match(assembler, /manifest\.off_host_uri !== expected\.destination/)
  assert.match(assembler, /manifest\.backup_interval_hours/)
  assert.match(assembler, /manifest\.retention_days/)
  assert.match(assembler, /backup-offhost-access-key/)
  assert.match(assembler, /BACKUP_OFFHOST_ACCESS_KEY_FILE: \/run\/worker-secrets\/backup-offhost-access-key/)
  const productionBackendCompose = assembler.slice(assembler.indexOf('cat > "$PROD_BACKEND_DIR/docker-compose.yml"'))
  const apiBlock = productionBackendCompose.slice(productionBackendCompose.indexOf('  api:'), productionBackendCompose.indexOf('  worker:'))
  const workerBlock = productionBackendCompose.slice(productionBackendCompose.indexOf('  worker:'), productionBackendCompose.indexOf('  node-exporter:'))
  assert.doesNotMatch(apiBlock, /worker-secrets/)
  assert.match(workerBlock, /\.\/worker-secrets:\/run\/worker-secrets:ro/)
})

test('source-free validator forbids runtime admin password leakage', () => {
  const validator = fs.readFileSync(repoPath('scripts/verify/validate-source-free-production-bundle.sh'), 'utf8')
  const forbiddenPatternLine = validator
    .split('\n')
    .find((line) => line.includes('forbidden_assignment_regex='))

  assert.ok(forbiddenPatternLine)
  assert.match(forbiddenPatternLine, /\bADMIN_PASSWORD\b/)
  assert.doesNotMatch(forbiddenPatternLine, /INITIAL_ADMIN_EMAIL/)
})

test('production realtime documentation does not recommend always-open legacy socket auth', () => {
  const productionRealtimeExample = fs.readFileSync(repoPath('docs/environments/production/realtime-sync.env.example'), 'utf8')
  const productionReadiness = fs.readFileSync(repoPath('docs/implementation/realtime-sync-production-readiness-checklist.md'), 'utf8')

  assert.match(productionRealtimeExample, /^DEVICE_SOCKET_LEGACY_AUTH_ALLOWED=false$/m)
  assert.doesNotMatch(productionRealtimeExample, /legacy socket auth stays available/)
  assert.doesNotMatch(productionRealtimeExample, /Keep DEVICE_SOCKET_LEGACY_AUTH_ALLOWED=true/)
  assert.doesNotMatch(productionReadiness, /DEVICE_SOCKET_LEGACY_AUTH_ALLOWED=true` remains the compatibility posture/)
})

test('authoritative backend role keeps restart separate from install, upgrade, and adoption', () => {
  const assembler = fs.readFileSync(repoPath('scripts/bundle/assemble-runtime-bundle.sh'), 'utf8')
  const startWriter = assembler.slice(
    assembler.indexOf('write_backend_start_script()'),
    assembler.indexOf('write_backend_lifecycle_scripts()'),
  )
  assert.match(startWriter, /docker compose --env-file \$env_file -f docker-compose\.yml up -d/)
  assert.match(startWriter, /exec \.\/wait-ready\.sh/)
  assert.doesNotMatch(startWriter, /db:migrate|migration:apply|bootstrap:production|db:push/)

  const lifecycle = assembler.slice(
    assembler.indexOf('write_backend_lifecycle_scripts()'),
    assembler.indexOf('write_stop_script()'),
  )
  for (const script of ['verify-role.sh', 'deploy.sh', 'install.sh', 'upgrade.sh', 'adopt-existing.sh', 'recover-admin.sh', 'acceptance-check.sh']) {
    assert.match(lifecycle, new RegExp(script.replace('.', '\\.'), 'g'))
  }
  assert.match(lifecycle, /Unsafe file mode/)
  assert.match(lifecycle, /find \.\/secrets \.\/worker-secrets -type f/)
  assert.match(lifecycle, /find \.\/certs \.\/tls -type f/)
  assert.match(lifecycle, /db:status/)
  assert.match(lifecycle, /MIGRATION_ADOPTION_REQUIRED|adoptionRequired/)
  assert.match(lifecycle, /restore_verified/)
  assert.match(lifecycle, /restored_from_run_id/)
  assert.match(lifecycle, /verified_at/)
  assert.match(lifecycle, /manifest_key/)
  assert.match(lifecycle, /Math\.max\(24, expected\.intervalHours\)/)
  assert.match(lifecycle, /bootstrap-secrets\/admin-password/)
  assert.match(lifecycle, /\/run\/darshan-bootstrap\/admin-password/)
  assert.doesNotMatch(lifecycle, /\/run\/secrets\/initial-admin-password/)

  const deploy = lifecycle.slice(
    lifecycle.indexOf('cat > "$target_dir/deploy.sh"'),
    lifecycle.indexOf('cat > "$target_dir/adopt-existing.sh"'),
  )
  const adoption = lifecycle.slice(lifecycle.indexOf('cat > "$target_dir/adopt-existing.sh"'))
  const recovery = lifecycle.slice(lifecycle.indexOf('cat > "$target_dir/recover-admin.sh"'))
  assert.match(deploy, /\.\/verify-role\.sh\n\.\/load-images\.sh\n\.\/wait-dependencies\.sh/)
  assert.match(adoption, /\.\/verify-role\.sh\n\.\/load-images\.sh\n\.\/wait-dependencies\.sh/)
  assert.match(adoption, /DARSHAN_BACKUP_MANIFEST/)
  assert.match(adoption, /A regular restore-verified backup manifest is required/)
  assert.match(adoption, /! -L "\\\$DARSHAN_BACKUP_MANIFEST"/)
  assert.match(adoption, /db:adopt/)
  assert.match(adoption, /db:migrate/)
  assert.match(adoption, /bootstrap:adopt-existing/)
  assert.match(adoption, /exec \.\/wait-ready\.sh/)
  assert.match(recovery, /admin:recover/)
  assert.match(recovery, /--password-file/)
  assert.match(recovery, /Recovery password file must have mode 0600/)
  assert.match(recovery, /Recovery password file must be inside \.\/secrets/)
  assert.match(recovery, /Do not reuse the initial bootstrap password file/)
  assert.doesNotMatch(recovery, / -p |--password </)
})

test('offline role loader verifies signed archive metadata, image ID, and host architecture', () => {
  const assembler = fs.readFileSync(repoPath('scripts/bundle/assemble-runtime-bundle.sh'), 'utf8')
  const roleVerifier = assembler.slice(
    assembler.indexOf('write_role_verification_script()'),
    assembler.indexOf('write_backend_start_script()'),
  )
  const loader = assembler.slice(
    assembler.indexOf('write_load_images_script()'),
    assembler.indexOf('write_image_metadata_manifest()'),
  )

  assert.match(roleVerifier, /Unsafe file mode/)
  assert.match(roleVerifier, /find \.\/secrets \.\/worker-secrets -type f/)
  assert.match(roleVerifier, /find \.\/certs \.\/tls -type f/)
  assert.match(roleVerifier, /CERTIFICATE_FINGERPRINTS\.sha256/)
  assert.match(roleVerifier, /openssl x509 -in "\\\$cert" -noout -fingerprint -sha256/)
  assert.match(roleVerifier, /Certificate fingerprint mismatch/)
  assert.match(assembler, /printf '%s\\t%s\\n' "\$cert" "\$fingerprint" >> CERTIFICATE_FINGERPRINTS\.sha256/)
  assert.match(loader, /IMAGE_MANIFEST\.tsv/)
  assert.match(loader, /--verify-loaded/)
  assert.match(loader, /docker image inspect --format '\{\{\.Id\}\}'/)
  assert.match(loader, /docker version --format '\{\{\.Server\.Os\}\}\/\{\{\.Server\.Arch\}\}'/)
  assert.match(loader, /Loaded image ID mismatch/)
  assert.match(loader, /Loaded image platform mismatch/)
  assert.match(assembler, /runtime_image_reference\(\)/)
  assert.match(assembler, /minioSourceImage/)

  for (const line of assembler.split('\n').filter((entry) => entry.includes('docker compose --env-file'))) {
    assert.match(line, /-f docker-compose\.yml/, `Unsigned Compose override could be loaded by: ${line}`)
  }
})

test('production transfer runbook keeps role archives private and cleans staging copies', () => {
  const runbook = fs.readFileSync(repoPath('docs/runbooks/source-free-production-bundle-deployment.md'), 'utf8')

  assert.match(runbook, /install -d -m 700 "\$transfer_dir"/)
  assert.match(runbook, /umask 077/)
  assert.match(runbook, /chmod 600 "\$\{transfer_dir\}\/\$\{SITE_NAME\}-\$\{RELEASE_ID\}-\$\{role\}\.tgz"/)
  assert.match(runbook, /chmod 600 "\$\{SITE_NAME\}-\$\{RELEASE_ID\}-transfer\.sha256"/)
  assert.match(runbook, /chmod 600 site-a-2026-08-23-r1-<role>\.tgz site-a-2026-08-23-r1-transfer\.sha256/)
  assert.match(runbook, /rm -f site-a-2026-08-23-r1-<role>\.tgz site-a-2026-08-23-r1-transfer\.sha256/)
  assert.match(runbook, /rmdir "\$transfer_dir"/)
})
