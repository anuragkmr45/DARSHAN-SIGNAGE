import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, chmod } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID, randomBytes } from 'node:crypto';
import { loadMediaRuntimeConfig } from '../src/runtime-config.js';
import { tlsFiles } from './fixtures/tls-files.mjs';

async function backend(t) {
  const files = await tlsFiles(t), secret = randomBytes(32).toString('base64url');
  const authority = path.join(files.directory, 'authority.json');
  await writeFile(authority, JSON.stringify({ version: 1, epoch_id: randomUUID(), authority_secret: secret }), { mode: 0o600 });
  return { files, secret, env: { DARSHAN_MEDIA_AUTHORITY_MODE: 'backend', DARSHAN_MEDIA_NODE_INSTANCE_ID: randomUUID(),
    DARSHAN_MEDIA_AUTHORITY_INSTANCE_ID: randomUUID(), DARSHAN_MEDIA_SUPERVISOR_STATE_FILE: path.join(files.directory, 'supervisor.json'),
    DARSHAN_MEDIA_HOST_LEASE_FILE: '/run/darshan-media-host-lease/lease.json',
    DARSHAN_MEDIA_CONTROL_SECRET: 'separate-control-secret-for-test-only-at-least32', DARSHAN_MEDIA_AUTHORITY_FILE: authority,
    DARSHAN_MEDIA_BACKEND_AUTHORITY_URL: 'https://127.0.0.1:19446/api/v1/internal/live-authority', DARSHAN_MEDIA_BACKEND_CA_FILE: files.certFile,
    DARSHAN_MEDIA_TLS_CERT_FILE: files.certFile, DARSHAN_MEDIA_TLS_KEY_FILE: files.keyFile, DARSHAN_MEDIA_SIGNAL_URL: 'wss://localhost:19447',
    DARSHAN_MEDIA_ALLOWED_ORIGINS: 'https://cms.test,null,file://', DARSHAN_MEDIA_CONTROL_HOST: '0.0.0.0', DARSHAN_MEDIA_SIGNAL_HOST: '0.0.0.0' } };
}
const code = expected => error => error.code === expected;

test('prototype retains HTTP loopback defaults and rejects explicit nonloopback HTTP bindings', () => {
  const env = { DARSHAN_MEDIA_CONTROL_SECRET: 'fixture-prototype-control-secret-at-least32' };
  const config = loadMediaRuntimeConfig(env);
  assert.equal(config.mode, 'prototype'); assert.equal(config.controlHost, '127.0.0.1'); assert.equal(config.signalHost, '127.0.0.1');
  assert.equal(config.tlsOptions, undefined);
  for (const key of ['DARSHAN_MEDIA_CONTROL_HOST', 'DARSHAN_MEDIA_SIGNAL_HOST']) {
    assert.throws(() => loadMediaRuntimeConfig({ ...env, [key]: '0.0.0.0' }), code('MEDIA_BIND_CONFIGURATION_INVALID'));
  }
});

test('explicit backend mode requires supervisor identities, verified TLS and distinct authority/control secrets', async t => {
  const { env, secret } = await backend(t);
  assert.throws(() => loadMediaRuntimeConfig(env), code('BACKEND_SUPERVISION_REQUIRED'));
  const config = loadMediaRuntimeConfig(env, { supervised: true });
  assert.equal(config.mode, 'backend'); assert.equal(config.nodeInstanceId, env.DARSHAN_MEDIA_AUTHORITY_INSTANCE_ID);
  assert.equal(config.managedInstanceId, env.DARSHAN_MEDIA_NODE_INSTANCE_ID);
  assert.ok(config.tlsOptions.cert); assert.ok(config.backendAuthority);
  assert.equal(JSON.stringify(config).includes(secret), false);
  assert.equal(JSON.stringify(config).includes(env.DARSHAN_MEDIA_CONTROL_SECRET), false);
  assert.throws(() => loadMediaRuntimeConfig({ ...env, DARSHAN_MEDIA_CONTROL_SECRET: secret }, { supervised: true }), code('MEDIA_SECRETS_MUST_BE_DISTINCT'));
});

test('backend never substitutes weak/missing TLS, wildcard origins or reused managed identity', async t => {
  const { env, files } = await backend(t);
  for (const key of ['DARSHAN_MEDIA_TLS_CERT_FILE', 'DARSHAN_MEDIA_TLS_KEY_FILE', 'DARSHAN_MEDIA_AUTHORITY_FILE', 'DARSHAN_MEDIA_BACKEND_AUTHORITY_URL', 'DARSHAN_MEDIA_HOST_LEASE_FILE']) {
    assert.throws(() => loadMediaRuntimeConfig({ ...env, [key]: undefined }, { supervised: true }));
  }
  for (const signalUrl of ['ws://localhost:19447', 'wss://wrong-host.test:19447', 'wss://localhost:19447/?token=value']) {
    assert.throws(() => loadMediaRuntimeConfig({ ...env, DARSHAN_MEDIA_SIGNAL_URL: signalUrl }, { supervised: true }), code('TLS_SERVER_CONFIGURATION_INVALID'));
  }
  assert.throws(() => loadMediaRuntimeConfig({ ...env, DARSHAN_MEDIA_ALLOWED_ORIGINS: '*' }, { supervised: true }), code('MEDIA_ORIGIN_CONFIGURATION_INVALID'));
  assert.throws(() => loadMediaRuntimeConfig({ ...env, DARSHAN_MEDIA_AUTHORITY_INSTANCE_ID: env.DARSHAN_MEDIA_NODE_INSTANCE_ID }, { supervised: true }), code('BACKEND_SUPERVISION_REQUIRED'));
  await chmod(files.keyFile, 0o644);
  assert.throws(() => loadMediaRuntimeConfig(env, { supervised: true }), code('TLS_SERVER_CONFIGURATION_INVALID'));
});
