import path from 'node:path';
import { isIP } from 'node:net';
import { configurationError, readProtectedFile, validUuid } from './authority-file.js';
import { createBackendAuthority } from './backend-authority.js';
import { readServerTls } from './tls-config.js';

const loopback = host => host === '127.0.0.1' || host === '::1';
export function loadMediaRuntimeConfig(env, { supervised = false, onAuthorityInvalid } = {}) {
  const mode = env.DARSHAN_MEDIA_AUTHORITY_MODE ?? 'prototype';
  if (!['prototype', 'backend'].includes(mode)) throw configurationError('MEDIA_AUTHORITY_MODE_INVALID');
  const required = name => { if (!env[name]) throw configurationError('MEDIA_CONFIGURATION_MISSING'); return env[name]; };
  const port = (name, fallback) => {
    const value = Number(env[name] ?? fallback);
    if (!Number.isSafeInteger(value) || value < 1 || value > 65535) throw configurationError('MEDIA_PORT_INVALID'); return value;
  };
  const controlHost = env.DARSHAN_MEDIA_CONTROL_HOST ?? '127.0.0.1', signalHost = env.DARSHAN_MEDIA_SIGNAL_HOST ?? '127.0.0.1';
  if (!isIP(controlHost) || !isIP(signalHost) || (mode === 'prototype' && (!loopback(controlHost) || !loopback(signalHost)))) throw configurationError('MEDIA_BIND_CONFIGURATION_INVALID');
  const controlSecret = (env.DARSHAN_MEDIA_CONTROL_SECRET_FILE
    ? readProtectedFile(env.DARSHAN_MEDIA_CONTROL_SECRET_FILE, { privateFile: true, maxBytes: 4096 }).data.toString('utf8')
    : required('DARSHAN_MEDIA_CONTROL_SECRET')).trim();
  if (controlSecret.length < 32 || controlSecret.length > 4096 || /[\r\n]/.test(controlSecret)) throw configurationError('MEDIA_CONTROL_SECRET_INVALID');
  const signalPort = port('DARSHAN_MEDIA_SIGNAL_PORT', 18780), controlPort = port('DARSHAN_MEDIA_CONTROL_PORT', 18784);
  const signalUrl = mode === 'backend' ? required('DARSHAN_MEDIA_SIGNAL_URL') : env.DARSHAN_MEDIA_SIGNAL_URL ?? `ws://127.0.0.1:${signalPort}`;
  let tlsOptions, backendAuthority;
  if (mode === 'backend' || env.DARSHAN_MEDIA_TLS_CERT_FILE || env.DARSHAN_MEDIA_TLS_KEY_FILE) {
    tlsOptions = readServerTls({ certFile: required('DARSHAN_MEDIA_TLS_CERT_FILE'), keyFile: required('DARSHAN_MEDIA_TLS_KEY_FILE'), signalUrl });
  }
  const allowedOrigins = (env.DARSHAN_MEDIA_ALLOWED_ORIGINS ?? '').split(',').map(value => value.trim()).filter(Boolean);
  if (mode === 'backend') {
    if (!supervised || !validUuid(env.DARSHAN_MEDIA_NODE_INSTANCE_ID) || !validUuid(env.DARSHAN_MEDIA_AUTHORITY_INSTANCE_ID)
      || env.DARSHAN_MEDIA_NODE_INSTANCE_ID === env.DARSHAN_MEDIA_AUTHORITY_INSTANCE_ID
      || !path.isAbsolute(required('DARSHAN_MEDIA_SUPERVISOR_STATE_FILE'))) throw configurationError('BACKEND_SUPERVISION_REQUIRED');
    if (!path.isAbsolute(required('DARSHAN_MEDIA_HOST_LEASE_FILE'))) throw configurationError('HOST_LEASE_CONFIGURATION_REQUIRED');
    for (const origin of allowedOrigins) {
      if (origin === 'null' || origin === 'file://') continue;
      try { const url = new URL(origin); if (url.protocol !== 'https:' || url.origin !== origin || url.username || url.password) throw new Error(); }
      catch { throw configurationError('MEDIA_ORIGIN_CONFIGURATION_INVALID'); }
    }
    backendAuthority = createBackendAuthority({ url: required('DARSHAN_MEDIA_BACKEND_AUTHORITY_URL'), authorityFile: required('DARSHAN_MEDIA_AUTHORITY_FILE'),
      caFile: env.DARSHAN_MEDIA_BACKEND_CA_FILE, nodeInstanceId: env.DARSHAN_MEDIA_AUTHORITY_INSTANCE_ID, onInvalid: onAuthorityInvalid });
    if (backendAuthority.usesSecret(controlSecret)) throw configurationError('MEDIA_SECRETS_MUST_BE_DISTINCT');
  }
  const config = { mode, controlHost, signalHost, controlPort, signalPort, signalUrl, allowedOrigins,
    upstreamUrl: env.DARSHAN_MEDIA_SFU_URL ?? 'http://127.0.0.1:18781',
    nodeInstanceId: mode === 'backend' ? env.DARSHAN_MEDIA_AUTHORITY_INSTANCE_ID : undefined,
    managedInstanceId: mode === 'backend' ? env.DARSHAN_MEDIA_NODE_INSTANCE_ID : undefined,
    hostLeaseFile: mode === 'backend' ? env.DARSHAN_MEDIA_HOST_LEASE_FILE : undefined };
  for (const [key, value] of Object.entries({ controlSecret, tlsOptions, backendAuthority })) Object.defineProperty(config, key, { value });
  return Object.freeze(config);
}
