#!/usr/bin/env node
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { loadProductionBundleConfig, toAssemblerEnvironment } from './production-bundle-config.mjs'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(scriptDir, '../..')

function usage() {
  process.stdout.write(`Usage:
  bash scripts/bundle/build-production-bundle.sh [--skip-docker] [--validate-only] <bundle-env-file>

The env file is the only manually edited production deployment configuration.
Relative paths resolve from the DARSHAN-SIGNAGE repository root.
`)
}

function fail(message) {
  process.stderr.write(`${message}\n`)
  process.exit(1)
}

const args = process.argv.slice(2)
let skipDocker = false
let validateOnly = false
let envFile = ''
for (const arg of args) {
  if (arg === '-h' || arg === '--help') {
    usage()
    process.exit(0)
  } else if (arg === '--skip-docker') {
    skipDocker = true
  } else if (arg === '--validate-only') {
    validateOnly = true
  } else if (!envFile) {
    envFile = arg
  } else {
    fail(`Unknown argument: ${arg}`)
  }
}
if (!envFile) {
  usage()
  process.exit(1)
}

let loaded
try {
  loaded = loadProductionBundleConfig(envFile, repoRoot)
} catch (error) {
  fail(error instanceof Error ? error.message : String(error))
}
const { config } = loaded

function assertDirectory(label, directory) {
  if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) {
    fail(`${label} directory not found: ${directory}`)
  }
}

function hasArtifact(directory, extension) {
  const pending = [directory]
  while (pending.length > 0) {
    const current = pending.pop()
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name)
      if (entry.isDirectory()) pending.push(absolute)
      else if (entry.isFile() && entry.name.toLowerCase().endsWith(extension)) return true
    }
  }
  return false
}

function assertPlayerArtifacts(directory) {
  const missing = []
  const targets = config.PLAYER_TARGET_PLATFORMS.split(',')
  if (targets.includes('windows') && !hasArtifact(directory, '.exe')) missing.push('one Windows .exe')
  if (targets.includes('linux') && !hasArtifact(directory, '.deb')) missing.push('one Ubuntu .deb')
  if (missing.length > 0) {
    fail(`PLAYER_ARTIFACTS_DIR is missing required artifacts for PLAYER_TARGET_PLATFORMS=${config.PLAYER_TARGET_PLATFORMS}: ${missing.join(' and ')}`)
  }
}

if (config.EXPORT_SERVER === 'false') assertDirectory('SERVER_PACKAGE_DIR', config.SERVER_PACKAGE_DIR)
if (config.EXPORT_CMS === 'false') assertDirectory('CMS_PACKAGE_DIR', config.CMS_PACKAGE_DIR)
if (config.EXPORT_ELECTRON === 'false') {
  assertDirectory('PLAYER_ARTIFACTS_DIR', config.PLAYER_ARTIFACTS_DIR)
  assertPlayerArtifacts(config.PLAYER_ARTIFACTS_DIR)
}
if (validateOnly) {
  process.stdout.write(`Production bundle configuration is valid: ${loaded.envFile}\n`)
  process.exit(0)
}

const preservedEnvironmentNames = [
  'PATH', 'HOME', 'USER', 'LOGNAME', 'TMPDIR', 'DOCKER_HOST', 'DOCKER_CONFIG', 'XDG_RUNTIME_DIR', 'CI',
  'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'no_proxy',
]
const baseEnv = {}
for (const name of preservedEnvironmentNames) {
  if (process.env[name] !== undefined) baseEnv[name] = process.env[name]
}

function run(command, commandArgs, env, cwd = repoRoot) {
  process.stdout.write(`[darshan-bundle] ${command} ${commandArgs.join(' ')}\n`)
  const result = spawnSync(command, commandArgs, { cwd, env: { ...baseEnv, ...env }, stdio: 'inherit' })
  if (result.error) fail(result.error.message)
  if (result.status !== 0) process.exit(result.status ?? 1)
}

const commonExportEnv = {
  OUTPUT_BASE: config.PACKAGE_OUTPUT_BASE,
  POSTGRES_IMAGE: config.POSTGRES_IMAGE,
  MINIO_IMAGE: config.MINIO_IMAGE,
  VALKEY_IMAGE: config.VALKEY_IMAGE,
  NGINX_IMAGE: config.NGINX_IMAGE,
  INSTALL_PLAYWRIGHT_CHROMIUM: config.INSTALL_PLAYWRIGHT_CHROMIUM,
}

if (config.EXPORT_SERVER === 'true') {
  run('bash', ['scripts/export/package-server.sh', '--release', config.RELEASE_ID, '--deployment-layout', 'production-split'], commonExportEnv)
}
if (config.EXPORT_CMS === 'true') {
  run('bash', ['scripts/export/package-cms.sh', '--release', config.RELEASE_ID], {
    ...commonExportEnv,
    VITE_ENABLE_PRODUCTION_LOCKDOWN: config.VITE_ENABLE_PRODUCTION_LOCKDOWN,
    VITE_REALTIME_DELIVERY_STATUS_UI: config.VITE_REALTIME_DELIVERY_STATUS_UI,
    VITE_MEDIA_CACHE_STATUS_UI: config.VITE_MEDIA_CACHE_STATUS_UI,
  })
}
if (config.EXPORT_ELECTRON === 'true') {
  run('bash', ['scripts/export/package-electron.sh', '--release', config.RELEASE_ID, '--platform', config.ELECTRON_PLATFORM], commonExportEnv)
}

assertDirectory('SERVER_PACKAGE_DIR', config.SERVER_PACKAGE_DIR)
assertDirectory('CMS_PACKAGE_DIR', config.CMS_PACKAGE_DIR)
assertDirectory('PLAYER_ARTIFACTS_DIR', config.PLAYER_ARTIFACTS_DIR)
if (config.EXPORT_ELECTRON === 'true') assertPlayerArtifacts(config.PLAYER_ARTIFACTS_DIR)

run('node', [
  'scripts/bundle/verify-package-provenance.mjs',
  '--release', config.RELEASE_ID,
  '--server', config.SERVER_PACKAGE_DIR,
  '--cms', config.CMS_PACKAGE_DIR,
  '--player', config.PLAYER_ARTIFACTS_DIR,
  '--platforms', config.PLAYER_TARGET_PLATFORMS,
])

const assemblerArgs = ['scripts/bundle/assemble-runtime-bundle.sh']
if (skipDocker) assemblerArgs.push('--skip-docker')
assemblerArgs.push('--profile', 'production', config.SITE_NAME)
run('bash', assemblerArgs, toAssemblerEnvironment(config))

const bundleRoot = path.join(config.BUNDLE_OUTPUT_BASE, config.SITE_NAME)
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex')

function readArtifactManifest(directory) {
  return JSON.parse(fs.readFileSync(path.join(directory, 'ARTIFACT_MANIFEST.json'), 'utf8'))
}

function findArtifactManifestDirectories(directory) {
  const result = []
  const pending = [directory]
  while (pending.length > 0) {
    const current = pending.pop()
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name)
      if (entry.isDirectory()) pending.push(absolute)
      else if (entry.isFile() && entry.name === 'ARTIFACT_MANIFEST.json') result.push(current)
    }
  }
  return result.sort()
}

const componentProvenance = {
  server: readArtifactManifest(config.SERVER_PACKAGE_DIR),
  cms: readArtifactManifest(config.CMS_PACKAGE_DIR),
  players: findArtifactManifestDirectories(config.PLAYER_ARTIFACTS_DIR).map(readArtifactManifest),
}

function walk(directory, prefix = '') {
  const results = []
  for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const relative = path.posix.join(prefix, entry.name)
    const absolute = path.join(directory, entry.name)
    if (entry.isDirectory()) results.push(...walk(absolute, relative))
    else if (entry.isFile() && relative !== 'SHA256SUMS.txt') results.push({ relative, absolute })
  }
  return results
}

function assertBundleContract() {
  const files = walk(bundleRoot)
  const sourceFile = files.find(({ relative }) => /\.(?:ts|tsx|map)$/.test(relative))
  if (sourceFile) fail(`Source or source map leaked into runtime bundle: ${sourceFile.relative}`)
  if (files.some(({ relative }) => relative.endsWith('transport-ca.key'))) {
    fail('Transport CA private key must never be packaged')
  }

  const allowedPrivateKeys = new Set([
    'production/backend/certs/device-ca.key',
    'production/backend/certs/server.key',
    'production/cms/tls/tls.key',
    'production/data/tls/private.key',
    'production/data/tls/postgres.key',
    'production/valkey/tls/server.key',
  ])
  for (const { relative, absolute } of files.filter(({ relative }) => relative.endsWith('.key'))) {
    if (!allowedPrivateKeys.has(relative)) fail(`Unexpected private key in runtime bundle: ${relative}`)
    if (process.platform !== 'win32' && (fs.statSync(absolute).mode & 0o077) !== 0) {
      fail(`Private key is accessible by group/other: ${relative}`)
    }
  }

  const cmsConfig = JSON.parse(fs.readFileSync(path.join(bundleRoot, 'production/cms/www/config/app-config.json'), 'utf8'))
  if (!cmsConfig.cms?.api?.baseUrl?.startsWith('https://') || !cmsConfig.cms?.realtime?.socketBaseUrl?.startsWith('https://')) {
    fail('Generated CMS runtime endpoints must use HTTPS')
  }
  for (const playerFile of ['config.json', 'config.windows.json']) {
    const playerConfig = JSON.parse(fs.readFileSync(path.join(bundleRoot, 'production/electron', playerFile), 'utf8')).player
    if (!playerConfig?.backend?.baseUrl?.startsWith('https://') || !playerConfig?.backend?.socketIoUrl?.startsWith('wss://')) {
      fail(`Generated player endpoints must use HTTPS/WSS: ${playerFile}`)
    }
    if (playerConfig?.transportTls?.enabled !== true || playerConfig?.transportTls?.strictCertificateValidation !== true) {
      fail(`Generated player transport trust must be strict: ${playerFile}`)
    }
  }

  const nginx = fs.readFileSync(path.join(bundleRoot, 'production/cms/nginx/default.conf'), 'utf8')
  if (!nginx.includes('proxy_pass https://') || !nginx.includes('proxy_ssl_verify on;')) {
    fail('Generated CMS Nginx config must verify its HTTPS backend upstream')
  }
  const prometheus = fs.readFileSync(path.join(bundleRoot, 'production/observability/prometheus/prometheus.yml'), 'utf8')
  if (!prometheus.includes('scheme: https') || !prometheus.includes('ca_file: /etc/darshan/tls/transport-ca.crt')) {
    fail('Generated Prometheus config must verify HTTPS scrape targets')
  }

  const forbidden = /curl\s+-k\b|NODE_TLS_REJECT_UNAUTHORIZED|rejectUnauthorized\s*[:=]\s*false/
  for (const { relative, absolute } of files) {
    if (!/\.(?:sh|json|ya?ml|conf|env)$/.test(relative)) continue
    const content = fs.readFileSync(absolute, 'utf8')
    if (forbidden.test(content)) fail(`Insecure TLS bypass found in runtime bundle: ${relative}`)
  }
}

assertBundleContract()

function certificateFingerprint(filePath) {
  const result = spawnSync('openssl', ['x509', '-in', filePath, '-noout', '-fingerprint', '-sha256'], {
    encoding: 'utf8', env: baseEnv,
  })
  if (result.status !== 0) return null
  return result.stdout.trim().replace(/^sha256 Fingerprint=/i, '')
}

const entries = Object.keys(config).sort().map((key) => ({
  key,
  source: loaded.explicit.has(key) ? 'operator' : 'default-or-derived',
  classification: loaded.secretFields.has(key) ? 'sensitive' : 'non-secret',
  value: loaded.secretFields.has(key) ? '[redacted]' : config[key],
  outputs: loaded.outputs[key] ?? [],
}))
const manifest = {
  schemaVersion: 1,
  releaseId: config.RELEASE_ID,
  siteName: config.SITE_NAME,
  profile: 'production',
  sourceConfigSha256: sha256(loaded.sourceText),
  componentProvenance,
  transportTlsMode: config.TRANSPORT_TLS_MODE,
  certificateFingerprints: {
    transportCa: certificateFingerprint(config.TRANSPORT_CA_CERT_FILE),
    deviceCa: certificateFingerprint(config.DEVICE_CA_CERT_FILE),
    cms: certificateFingerprint(path.join(bundleRoot, 'production/cms/tls/tls.crt')),
    backend: certificateFingerprint(path.join(bundleRoot, 'production/backend/certs/server.crt')),
    minio: certificateFingerprint(path.join(bundleRoot, 'production/data/tls/public.crt')),
    postgres: certificateFingerprint(path.join(bundleRoot, 'production/data/tls/postgres.crt')),
    valkey: certificateFingerprint(path.join(bundleRoot, 'production/valkey/tls/server.crt')),
  },
  configuration: entries,
  security: {
    privateKeyValuesIncludedInManifest: false,
    secretValuesIncludedInManifest: false,
    transportCaPrivateKeyPackaged: false,
    packagedRolePrivateKeys: [
      'production/backend/certs/device-ca.key',
      'production/backend/certs/server.key',
      'production/cms/tls/tls.key',
      'production/data/tls/private.key',
      'production/data/tls/postgres.key',
      'production/valkey/tls/server.key',
    ],
    deviceCaPrivateKeyRole: 'production/backend only',
  },
}
fs.writeFileSync(path.join(bundleRoot, 'CONFIGURATION_MANIFEST.json'), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 })
const checksums = walk(bundleRoot)
  .filter(({ relative }) => relative !== 'BUNDLE_MANIFEST.sig')
  .map(({ relative, absolute }) => `${sha256(fs.readFileSync(absolute))}  ./${relative}`).join('\n')
fs.writeFileSync(path.join(bundleRoot, 'SHA256SUMS.txt'), `${checksums}\n`)
const signatureResult = spawnSync('openssl', [
  'dgst', '-sha256', '-sign', config.RELEASE_SIGNING_PRIVATE_KEY,
  '-out', path.join(bundleRoot, 'BUNDLE_MANIFEST.sig'), path.join(bundleRoot, 'SHA256SUMS.txt'),
], { encoding: 'utf8', env: baseEnv })
if (signatureResult.status !== 0) {
  fail(`Unable to sign the production bundle manifest: ${signatureResult.stderr || signatureResult.stdout}`)
}
run('bash', ['verify-bundle.sh'], {}, bundleRoot)
process.stdout.write(`Production source-free bundle created at ${bundleRoot}\n`)
