import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'

const BOOLEAN_FIELDS = new Set([
  'EXPORT_SERVER', 'EXPORT_CMS', 'EXPORT_ELECTRON', 'INSTALL_PLAYWRIGHT_CHROMIUM',
  'VITE_ENABLE_PRODUCTION_LOCKDOWN', 'VITE_REALTIME_DELIVERY_STATUS_UI', 'VITE_MEDIA_CACHE_STATUS_UI',
])

const PORT_FIELDS = new Set([
  'CMS_HTTPS_PORT', 'CMS_HTTP_PORT', 'API_HOST_PORT', 'POSTGRES_HOST_PORT', 'MINIO_HOST_PORT',
  'MINIO_CONSOLE_PORT', 'VALKEY_HOST_PORT', 'PROMETHEUS_HOST_PORT', 'ALERTMANAGER_HOST_PORT', 'GRAFANA_HOST_PORT',
])

const HOST_FIELDS = new Set([
  'CMS_PUBLIC_HOST', 'BACKEND_PRIVATE_HOST', 'BACKEND_DEVICE_HOST', 'DATA_PRIVATE_HOST',
  'VALKEY_PRIVATE_HOST', 'OBSERVABILITY_PRIVATE_HOST',
])

const PATH_FIELDS = new Set([
  'PACKAGE_OUTPUT_BASE', 'BUNDLE_OUTPUT_BASE', 'SERVER_PACKAGE_DIR', 'CMS_PACKAGE_DIR', 'PLAYER_ARTIFACTS_DIR',
  'PKI_ROOT_DIR', 'SITE_PKI_DIR',
  'TRANSPORT_CA_CERT_FILE', 'TRANSPORT_CA_KEY_FILE', 'CMS_TLS_CERT_FILE', 'CMS_TLS_KEY_FILE',
  'BACKEND_TLS_CERT_FILE', 'BACKEND_TLS_KEY_FILE', 'MINIO_TLS_CERT_FILE', 'MINIO_TLS_KEY_FILE',
  'DEVICE_CA_CERT_FILE', 'DEVICE_CA_KEY_FILE',
])

const SECRET_FIELDS = new Set([
  'POSTGRES_PASSWORD', 'MINIO_ACCESS_KEY', 'MINIO_SECRET_KEY', 'JWT_SECRET', 'ADMIN_PASSWORD',
  'TRANSPORT_CA_KEY_FILE', 'CMS_TLS_KEY_FILE', 'BACKEND_TLS_KEY_FILE', 'MINIO_TLS_KEY_FILE', 'DEVICE_CA_KEY_FILE',
])

const OUTPUTS = {
  RELEASE_ID: ['BUNDLE_OVERVIEW.md', 'CONFIGURATION_MANIFEST.json'],
  SITE_NAME: ['BUNDLE_OVERVIEW.md', 'CONFIGURATION_MANIFEST.json'],
  CMS_PUBLIC_HOST: ['production/cms/.env.production', 'production/cms/nginx/default.conf', 'production/cms/www/config/app-config.json'],
  BACKEND_PRIVATE_HOST: ['production/backend/.env.production', 'production/cms/nginx/default.conf', 'production/observability/prometheus/prometheus.yml'],
  BACKEND_DEVICE_HOST: ['production/electron/config.json'],
  DATA_PRIVATE_HOST: ['production/backend/.env.production', 'production/observability/prometheus/prometheus.yml'],
  VALKEY_PRIVATE_HOST: ['production/backend/.env.production'],
  OBSERVABILITY_PRIVATE_HOST: ['production/cms/.env.production', 'production/observability/.env.production'],
  TRANSPORT_TLS_MODE: ['production/data/tls', 'production/backend/certs', 'production/cms/tls', 'production/electron/transport-ca.crt'],
  TRANSPORT_CA_CERT_FILE: ['production/data/tls/CAs/transport-ca.crt', 'production/backend/certs/transport-ca.crt', 'production/cms/tls/transport-ca.crt', 'production/electron/transport-ca.crt'],
  DEVICE_CA_CERT_FILE: ['production/backend/certs/device-ca.crt'],
  DEVICE_CA_KEY_FILE: ['production/backend/certs/device-ca.key'],
  POSTGRES_PASSWORD: ['production/data/.env.production', 'production/backend/.env.production'],
  MINIO_ACCESS_KEY: ['production/data/.env.production', 'production/backend/.env.production'],
  MINIO_SECRET_KEY: ['production/data/.env.production', 'production/backend/.env.production'],
  JWT_SECRET: ['production/backend/.env.production'],
  ADMIN_PASSWORD: ['production/backend/.env.production'],
  VITE_ENABLE_PRODUCTION_LOCKDOWN: ['CMS build artifact'],
  VITE_REALTIME_DELIVERY_STATUS_UI: ['CMS build artifact'],
  VITE_MEDIA_CACHE_STATUS_UI: ['CMS build artifact'],
}

const ALLOWED_FIELDS = new Set([
  'RELEASE_ID', 'SITE_NAME', 'EXPORT_SERVER', 'EXPORT_CMS', 'EXPORT_ELECTRON', 'ELECTRON_PLATFORM',
  'INSTALL_PLAYWRIGHT_CHROMIUM', 'PACKAGE_OUTPUT_BASE', 'BUNDLE_OUTPUT_BASE', 'SERVER_PACKAGE_DIR', 'PKI_ROOT_DIR', 'SITE_PKI_DIR',
  'CMS_PACKAGE_DIR', 'PLAYER_ARTIFACTS_DIR', 'CMS_PUBLIC_HOST', 'BACKEND_PRIVATE_HOST', 'BACKEND_DEVICE_HOST',
  'DATA_PRIVATE_HOST', 'VALKEY_PRIVATE_HOST', 'OBSERVABILITY_PRIVATE_HOST', 'CMS_HTTPS_PORT', 'CMS_HTTP_PORT',
  'API_HOST_PORT', 'POSTGRES_HOST_PORT', 'MINIO_HOST_PORT', 'MINIO_CONSOLE_PORT', 'VALKEY_HOST_PORT',
  'PROMETHEUS_HOST_PORT', 'ALERTMANAGER_HOST_PORT', 'GRAFANA_HOST_PORT', 'TRANSPORT_TLS_MODE',
  'TRANSPORT_CA_CERT_FILE', 'TRANSPORT_CA_KEY_FILE', 'CMS_TLS_CERT_FILE', 'CMS_TLS_KEY_FILE',
  'BACKEND_TLS_CERT_FILE', 'BACKEND_TLS_KEY_FILE', 'MINIO_TLS_CERT_FILE', 'MINIO_TLS_KEY_FILE',
  'DEVICE_CA_CERT_FILE', 'DEVICE_CA_KEY_FILE', 'POSTGRES_USER', 'POSTGRES_PASSWORD', 'POSTGRES_DB',
  'MINIO_ACCESS_KEY', 'MINIO_SECRET_KEY', 'MINIO_REGION', 'JWT_SECRET', 'JWT_EXPIRY', 'ADMIN_EMAIL',
  'ADMIN_PASSWORD', 'LOG_LEVEL', 'POSTGRES_IMAGE', 'MINIO_IMAGE', 'VALKEY_IMAGE', 'NGINX_IMAGE',
  'PROMETHEUS_IMAGE', 'ALERTMANAGER_IMAGE', 'GRAFANA_IMAGE', 'PROMETHEUS_SCRAPE_INTERVAL',
  'PROMETHEUS_EVALUATION_INTERVAL', 'PROMETHEUS_RETENTION_TIME', 'VITE_ENABLE_PRODUCTION_LOCKDOWN',
  'VITE_REALTIME_DELIVERY_STATUS_UI', 'VITE_MEDIA_CACHE_STATUS_UI',
])

const REQUIRED_FIELDS = [
  'RELEASE_ID', 'SITE_NAME', 'CMS_PUBLIC_HOST', 'BACKEND_PRIVATE_HOST', 'DATA_PRIVATE_HOST',
  'OBSERVABILITY_PRIVATE_HOST',
  'TRANSPORT_TLS_MODE', 'TRANSPORT_CA_CERT_FILE', 'DEVICE_CA_CERT_FILE', 'DEVICE_CA_KEY_FILE',
  'POSTGRES_PASSWORD', 'MINIO_ACCESS_KEY', 'MINIO_SECRET_KEY', 'JWT_SECRET', 'ADMIN_EMAIL', 'ADMIN_PASSWORD',
]

const DEFAULTS = {
  EXPORT_SERVER: 'true', EXPORT_CMS: 'true', EXPORT_ELECTRON: 'false', ELECTRON_PLATFORM: 'linux',
  INSTALL_PLAYWRIGHT_CHROMIUM: 'true', PACKAGE_OUTPUT_BASE: 'out', BUNDLE_OUTPUT_BASE: 'dist/onprem',
  CMS_HTTPS_PORT: '443', CMS_HTTP_PORT: '80', API_HOST_PORT: '3000', POSTGRES_HOST_PORT: '5432',
  MINIO_HOST_PORT: '9000', MINIO_CONSOLE_PORT: '9001', VALKEY_HOST_PORT: '6379',
  PROMETHEUS_HOST_PORT: '9090', ALERTMANAGER_HOST_PORT: '9093', GRAFANA_HOST_PORT: '3001',
  POSTGRES_USER: 'postgres', POSTGRES_DB: 'darshan', MINIO_REGION: 'us-east-1', JWT_EXPIRY: '900', LOG_LEVEL: 'info',
  POSTGRES_IMAGE: 'postgres:15-alpine', MINIO_IMAGE: 'minio/minio:latest', VALKEY_IMAGE: 'valkey/valkey:7-alpine',
  NGINX_IMAGE: 'nginx:1.27-alpine', PROMETHEUS_IMAGE: 'prom/prometheus:v3.3.1',
  ALERTMANAGER_IMAGE: 'prom/alertmanager:v0.28.1', GRAFANA_IMAGE: 'grafana/grafana:12.0.2',
  PROMETHEUS_SCRAPE_INTERVAL: '30s', PROMETHEUS_EVALUATION_INTERVAL: '30s', PROMETHEUS_RETENTION_TIME: '30d',
  VITE_ENABLE_PRODUCTION_LOCKDOWN: 'true', VITE_REALTIME_DELIVERY_STATUS_UI: 'true',
  VITE_MEDIA_CACHE_STATUS_UI: 'true',
}

function fail(message) {
  throw new Error(`Invalid production bundle config: ${message}`)
}

function unquote(value, lineNumber) {
  if (!value.startsWith('"') && !value.startsWith("'")) return value
  const quote = value[0]
  if (value.length < 2 || value.at(-1) !== quote) fail(`line ${lineNumber} has an unterminated quoted value`)
  const body = value.slice(1, -1)
  if (body.includes(quote)) fail(`line ${lineNumber} contains an unsupported embedded quote`)
  return body
}

export function parseBundleEnvText(text) {
  const values = {}
  const explicit = new Set()
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/)
  lines.forEach((rawLine, index) => {
    const lineNumber = index + 1
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) return
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line)
    if (!match) fail(`line ${lineNumber} must use KEY=value syntax`)
    const [, key, rawValue] = match
    if (!ALLOWED_FIELDS.has(key)) fail(`line ${lineNumber} uses unknown key ${key}`)
    if (explicit.has(key)) fail(`line ${lineNumber} duplicates key ${key}`)
    const value = unquote(rawValue.trim(), lineNumber)
    if (/\$\{|\$\(|`/.test(value)) fail(`line ${lineNumber} contains shell interpolation; values must be literal`)
    if (/[<>]/.test(value) || /^(change[-_ ]?me|replace[-_ ]?me)(?:\b|[-_])/i.test(value)) {
      fail(`line ${lineNumber} contains an unresolved placeholder for ${key}`)
    }
    values[key] = value
    explicit.add(key)
  })
  return { values, explicit }
}

function isValidHostname(value) {
  if (!value || value.length > 253 || value.endsWith('.')) return false
  return value.split('.').every((label) => label.length > 0 && label.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label))
}

function validateHost(name, value) {
  if (!value) return
  if (value.includes('://') || value.includes('/') || value.includes(':')) {
    fail(`${name} must be a hostname or IPv4 address without a scheme, path, or port`)
  }
  if (net.isIP(value) !== 4 && !isValidHostname(value)) fail(`${name} must be a valid hostname or IPv4 address`)
}

function resolvePath(repoRoot, value) {
  return path.isAbsolute(value) ? path.normalize(value) : path.resolve(repoRoot, value)
}

function requireReadableFile(name, value) {
  let stats
  try { stats = fs.statSync(value) } catch { fail(`${name} file does not exist: ${value}`) }
  if (!stats.isFile()) fail(`${name} must point to a file: ${value}`)
  fs.accessSync(value, fs.constants.R_OK)
}

function requirePrivateKeyPermissions(name, value) {
  if (process.platform === 'win32') return
  const mode = fs.statSync(value).mode & 0o777
  if ((mode & 0o077) !== 0) fail(`${name} must not be accessible by group/other (current mode ${mode.toString(8)})`)
}

function validateSecret(name, value, minimumLength) {
  if (value.length < minimumLength) fail(`${name} must be at least ${minimumLength} characters`)
  if (/^(postgres|minioadmin|admin|password|secret|localdev@123)$/i.test(value)) fail(`${name} uses a development default`)
  if (!/^[A-Za-z0-9._~-]+$/.test(value)) {
    fail(`${name} may contain only letters, numbers, dot, underscore, tilde, and hyphen`)
  }
}

export function loadProductionBundleConfig(envFile, repoRoot = process.cwd()) {
  const absoluteEnvFile = path.resolve(envFile)
  let text
  try { text = fs.readFileSync(absoluteEnvFile, 'utf8') } catch { fail(`file not found: ${absoluteEnvFile}`) }
  const parsed = parseBundleEnvText(text)
  const config = { ...DEFAULTS, ...parsed.values }
  if (config.PKI_ROOT_DIR && !config.SITE_PKI_DIR && config.SITE_NAME) {
    config.SITE_PKI_DIR = path.join(config.PKI_ROOT_DIR, config.SITE_NAME)
  }
  if (config.SITE_PKI_DIR) {
    config.TRANSPORT_CA_CERT_FILE ||= path.join(config.SITE_PKI_DIR, 'transport-ca.crt')
    config.TRANSPORT_CA_KEY_FILE ||= path.join(config.SITE_PKI_DIR, 'transport-ca.key')
    config.DEVICE_CA_CERT_FILE ||= path.join(config.SITE_PKI_DIR, 'device-ca.crt')
    config.DEVICE_CA_KEY_FILE ||= path.join(config.SITE_PKI_DIR, 'device-ca.key')
    if (config.TRANSPORT_TLS_MODE === 'provided') {
      config.CMS_TLS_CERT_FILE ||= path.join(config.SITE_PKI_DIR, 'cms.crt')
      config.CMS_TLS_KEY_FILE ||= path.join(config.SITE_PKI_DIR, 'cms.key')
      config.BACKEND_TLS_CERT_FILE ||= path.join(config.SITE_PKI_DIR, 'backend.crt')
      config.BACKEND_TLS_KEY_FILE ||= path.join(config.SITE_PKI_DIR, 'backend.key')
      config.MINIO_TLS_CERT_FILE ||= path.join(config.SITE_PKI_DIR, 'minio.crt')
      config.MINIO_TLS_KEY_FILE ||= path.join(config.SITE_PKI_DIR, 'minio.key')
    }
  }
  if (config.RELEASE_ID && config.PACKAGE_OUTPUT_BASE) {
    config.SERVER_PACKAGE_DIR ||= path.join(config.PACKAGE_OUTPUT_BASE, config.RELEASE_ID, 'server')
    config.CMS_PACKAGE_DIR ||= path.join(config.PACKAGE_OUTPUT_BASE, config.RELEASE_ID, 'cms')
    config.PLAYER_ARTIFACTS_DIR ||= path.join(config.PACKAGE_OUTPUT_BASE, config.RELEASE_ID, 'electron')
  }
  config.BACKEND_DEVICE_HOST ||= config.BACKEND_PRIVATE_HOST
  config.VALKEY_PRIVATE_HOST ||= config.BACKEND_PRIVATE_HOST
  for (const name of REQUIRED_FIELDS) if (!config[name]) fail(`${name} is required`)
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(config.RELEASE_ID)) fail('RELEASE_ID has invalid characters')
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(config.SITE_NAME)) fail('SITE_NAME must be a lowercase DNS-style label')
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(config.POSTGRES_USER)) fail('POSTGRES_USER must be a PostgreSQL identifier')
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(config.POSTGRES_DB)) fail('POSTGRES_DB must be a PostgreSQL identifier')
  for (const name of BOOLEAN_FIELDS) if (!['true', 'false'].includes(config[name])) fail(`${name} must be true or false`)
  for (const name of PORT_FIELDS) {
    const port = Number(config[name])
    if (!Number.isInteger(port) || port < 1 || port > 65535) fail(`${name} must be an integer from 1 to 65535`)
  }
  for (const name of HOST_FIELDS) validateHost(name, config[name])
  if (!['internal-ca', 'provided'].includes(config.TRANSPORT_TLS_MODE)) fail('TRANSPORT_TLS_MODE must be internal-ca or provided')
  if (!['windows', 'macos', 'linux', 'all-supported'].includes(config.ELECTRON_PLATFORM)) fail('ELECTRON_PLATFORM is invalid')
  if (!['trace', 'debug', 'info', 'warn', 'error', 'fatal'].includes(config.LOG_LEVEL)) fail('LOG_LEVEL is invalid')
  if (!/^\d+$/.test(config.JWT_EXPIRY) || Number(config.JWT_EXPIRY) < 60) fail('JWT_EXPIRY must be at least 60 seconds')
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(config.ADMIN_EMAIL)) fail('ADMIN_EMAIL must be valid')
  validateSecret('POSTGRES_PASSWORD', config.POSTGRES_PASSWORD, 12)
  validateSecret('MINIO_ACCESS_KEY', config.MINIO_ACCESS_KEY, 8)
  validateSecret('MINIO_SECRET_KEY', config.MINIO_SECRET_KEY, 16)
  validateSecret('JWT_SECRET', config.JWT_SECRET, 32)
  validateSecret('ADMIN_PASSWORD', config.ADMIN_PASSWORD, 12)
  for (const name of PATH_FIELDS) if (config[name]) config[name] = resolvePath(repoRoot, config[name])
  const requiredFiles = ['TRANSPORT_CA_CERT_FILE', 'DEVICE_CA_CERT_FILE', 'DEVICE_CA_KEY_FILE']
  const privateKeys = ['DEVICE_CA_KEY_FILE']
  if (config.TRANSPORT_TLS_MODE === 'internal-ca') {
    requiredFiles.push('TRANSPORT_CA_KEY_FILE')
    privateKeys.push('TRANSPORT_CA_KEY_FILE')
  } else {
    requiredFiles.push('CMS_TLS_CERT_FILE', 'CMS_TLS_KEY_FILE', 'BACKEND_TLS_CERT_FILE', 'BACKEND_TLS_KEY_FILE', 'MINIO_TLS_CERT_FILE', 'MINIO_TLS_KEY_FILE')
    privateKeys.push('CMS_TLS_KEY_FILE', 'BACKEND_TLS_KEY_FILE', 'MINIO_TLS_KEY_FILE')
  }
  for (const name of requiredFiles) {
    if (!config[name]) fail(`${name} is required for TRANSPORT_TLS_MODE=${config.TRANSPORT_TLS_MODE}`)
    requireReadableFile(name, config[name])
  }
  for (const name of privateKeys) requirePrivateKeyPermissions(name, config[name])
  return { config, explicit: parsed.explicit, envFile: absoluteEnvFile, sourceText: text, secretFields: SECRET_FIELDS, outputs: OUTPUTS }
}

export function toAssemblerEnvironment(config) {
  return {
    ...config,
    CMS_PUBLIC_SCHEME: 'https', MINIO_USE_SSL: 'true',
    ONPREM_CERT_MODE: config.TRANSPORT_TLS_MODE === 'internal-ca' ? 'generate' : 'provided',
    OUTPUT_BASE: config.BUNDLE_OUTPUT_BASE,
    CA_CERT_PATH: '/app/certs/device-ca.crt', CA_KEY_PATH: '/app/certs/device-ca.key',
    TLS_CERT_PATH: '/app/certs/server.crt', TLS_KEY_PATH: '/app/certs/server.key', SERVER_TLS_ENABLED: 'true',
    AUTH_COOKIE_SECURE: 'true', SIGNHEX_DEPLOYMENT_ID: config.SITE_NAME,
    SIGNHEX_ENVIRONMENT_NAME: 'production', SIGNHEX_SERVER_ID: `backend-${config.SITE_NAME}`,
  }
}
