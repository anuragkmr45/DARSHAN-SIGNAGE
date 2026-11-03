import test from 'node:test';
import assert from 'node:assert/strict';
import https from 'node:https';
import { writeFile, rename } from 'node:fs/promises';
import { randomBytes, randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import path from 'node:path';
import { createBackendAuthority } from '../src/backend-authority.js';
import { AdmissionController } from '../src/controller.js';
import { tlsFiles } from './fixtures/tls-files.mjs';

const code = expected => error => error.code === expected;
async function fixture(t, handler, { san, timeoutMs = 1500 } = {}) {
  const tls = await tlsFiles(t, san), node = randomUUID(), epoch = randomUUID(), secret = randomBytes(32).toString('base64url');
  const authorityFile = path.join(tls.directory, 'authority.json');
  await writeFile(authorityFile, JSON.stringify({ version: 1, epoch_id: epoch, authority_secret: secret }), { mode: 0o600 });
  const received = [];
  const server = https.createServer({ cert: tls.cert, key: tls.key, minVersion: 'TLSv1.2' }, async (request, response) => {
    let body = ''; for await (const chunk of request) body += chunk;
    const value = JSON.parse(body); received.push({ body: value, correctSecret: request.headers['x-darshan-live-authority-secret'] === secret });
    response.on('error', () => {});
    const canonical = { ...value, allowed: true, participant_id: value.id, role: 'receiver', audio: { microphone: false, screen_share_audio: false }, lease_ms: 10_000, window_remaining_ms: 60_000 };
    if (handler) await handler({ request, response, value, canonical });
    else { response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify(canonical)); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const url = `https://127.0.0.1:${server.address().port}/api/v1/internal/live-authority`;
  const invalidations = [];
  const options = { url, authorityFile, caFile: tls.certFile, nodeInstanceId: node, timeoutMs, onInvalid: () => invalidations.push(true) };
  const input = { action: 'CREATE', nonce: randomBytes(32).toString('base64url'), id: randomUUID(), run_id: randomUUID(), generation: 1,
    node_instance_id: node, authority_epoch: epoch, operation_revision: 1, signal: new AbortController().signal };
  return { ...tls, options, input, received, invalidations, secret, authorityFile, node, epoch };
}

test('fresh authority uses verified HTTPS, bounded JSON and a separate secret header without serializing signal', async t => {
  const f = await fixture(t), authority = createBackendAuthority(f.options);
  const grant = await authority.verifyAuthority(f.input);
  assert.equal(grant.allowed, true); assert.equal(grant.nonce, f.input.nonce);
  assert.equal(f.received.length, 1); assert.equal(f.received[0].correctSecret, true);
  assert.equal(f.received[0].body.signal, undefined); assert.equal(f.received[0].body.authority_secret, undefined);
  assert.equal(JSON.stringify(authority).includes(f.secret), false);
});

test('untrusted CA and mismatched certificate hostname never reach HTTP authority', async t => {
  const untrusted = await fixture(t), other = await tlsFiles(t);
  await assert.rejects(createBackendAuthority({ ...untrusted.options, caFile: other.certFile }).verifyAuthority(untrusted.input), code('BACKEND_AUTHORITY_UNAVAILABLE'));
  assert.equal(untrusted.received.length, 0);
  const wrongName = await fixture(t, undefined, { san: 'DNS:wrong-host.test' });
  await assert.rejects(createBackendAuthority(wrongName.options).verifyAuthority(wrongName.input), code('BACKEND_AUTHORITY_UNAVAILABLE'));
  assert.equal(wrongName.received.length, 0);
});

test('wrong nonce, node, epoch, operation and nonboolean decisions cannot become a fresh grant', async t => {
  let changes;
  const f = await fixture(t, ({ response, canonical }) => { response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify({ ...canonical, ...changes })); });
  const authority = createBackendAuthority(f.options);
  for (changes of [{ nonce: 'old' }, { node_instance_id: randomUUID() }, { authority_epoch: randomUUID() },
    { operation_revision: 2 }, { allowed: undefined }, { allowed: 'true' }]) {
    await assert.rejects(authority.verifyAuthority(f.input), code('BACKEND_AUTHORITY_RESPONSE_INVALID'));
  }
});

test('matching explicit denial revokes through the strict controller rather than extending authority', async t => {
  const f = await fixture(t, ({ response, canonical }) => { response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify({ ...canonical, allowed: false })); });
  const authority = createBackendAuthority(f.options);
  const controller = new AdmissionController({ adapter: {}, isolate: async () => {}, signalUrl: 'wss://localhost',
    strictAuthority: { nodeInstanceId: f.node, authorityEpoch: f.epoch, verifyAuthority: authority.verifyAuthority } });
  await assert.rejects(controller.createAuthorized({ ...f.input }), code('AUTHORITY_DENIED'));
  assert.equal(controller.admissionView(f.input.id).teardown_confirmed, true);
  assert.equal(controller.admissionView(f.input.id).run_id, f.input.run_id);
  assert.equal(controller.admissionView(f.input.id).generation, f.input.generation);
  assert.equal(controller.tickets.size, 0);
});

test('timeout includes TLS/header wait and a hung JSON body', async t => {
  for (const mode of ['headers', 'body']) {
    const f = await fixture(t, ({ response }) => {
      if (mode === 'body') { response.writeHead(200, { 'content-type': 'application/json' }); response.write('{'); }
    }, { timeoutMs: 60 });
    const before = performance.now();
    await assert.rejects(createBackendAuthority(f.options).verifyAuthority(f.input), code('BACKEND_AUTHORITY_TIMEOUT'));
    assert.ok(performance.now() - before < 1000);
  }
});

test('aborted, oversized and redirected responses are rejected without exposing private payloads', async t => {
  const hanging = await fixture(t, () => {});
  const abort = new AbortController(); const aborted = createBackendAuthority(hanging.options).verifyAuthority({ ...hanging.input, signal: abort.signal });
  abort.abort(); await assert.rejects(aborted, code('BACKEND_AUTHORITY_ABORTED'));
  for (const status of [200, 302]) {
    const f = await fixture(t, ({ response }) => { response.writeHead(status, { 'content-type': 'application/json', location: 'https://never-follow.test/' }); response.end('x'.repeat(8193)); });
    await assert.rejects(createBackendAuthority(f.options).verifyAuthority(f.input), error => error.code === 'BACKEND_AUTHORITY_RESPONSE_INVALID' && !String(error).includes(f.secret));
  }
});

test('a changed authority file during a pending check invalidates the pinned service and cannot hot-rotate', async t => {
  let release, started;
  const waiting = new Promise(resolve => { release = resolve; }), seen = new Promise(resolve => { started = resolve; });
  const f = await fixture(t, async ({ response, canonical }) => { started(); await waiting; response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify(canonical)); });
  const authority = createBackendAuthority(f.options), pending = authority.verifyAuthority(f.input);
  await seen;
  await writeFile(`${f.authorityFile}.new`, JSON.stringify({ version: 1, epoch_id: f.epoch, authority_secret: randomBytes(32).toString('base64url') }), { mode: 0o600 });
  await rename(`${f.authorityFile}.new`, f.authorityFile); release();
  await assert.rejects(pending, code('BACKEND_AUTHORITY_CONFIGURATION_CHANGED'));
  assert.equal(f.invalidations.length, 1);
  await assert.rejects(authority.verifyAuthority(f.input), code('BACKEND_AUTHORITY_CONFIGURATION_CHANGED'));
  assert.equal(f.received.length, 1);
});

test('unsafe URL configuration fails before any request without echoing it', async t => {
  const f = await fixture(t);
  for (const url of ['http://localhost/api/v1/internal/live-authority', 'https://secret@localhost/api/v1/internal/live-authority',
    `${f.options.url}?secret=value`, `${f.options.url}#fragment`, 'https://localhost/other']) {
    assert.throws(() => createBackendAuthority({ ...f.options, url }), error => error.code?.startsWith('BACKEND_AUTHORITY_') && !String(error).includes(url));
  }
  assert.equal(f.received.length, 0);
});
