#!/usr/bin/env node
/** Supporting real-service evidence only; no CMS/player journey claim. */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

assert(process.argv.includes('--verify-isolated-live-fallbacks'), 'Supply --verify-isolated-live-fallbacks');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const runtime = resolve(root, '.local/live-broadcast'), require = createRequire(resolve(root, 'darshan-server/package.json'));
const { parse } = require('dotenv'), { Pool } = require('pg'), { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
for (const file of ['backend.env', 'credentials.json']) assert.equal((await stat(resolve(runtime, file))).mode & 0o077, 0, 'Private runtime inputs must be mode0600');
const env = parse(await readFile(resolve(runtime, 'backend.env'))), database = new URL(env.DATABASE_URL);
assert.equal(database.hostname, '127.0.0.1'); assert.equal(database.port, '55455'); assert.equal(database.pathname, '/darshan_live_20261103_test');
assert.equal(env.NODE_ENV, 'test');
const endpoint = new URL(`http://${env.MINIO_ENDPOINT}:${env.MINIO_PORT}`);
assert.equal(endpoint.hostname, '127.0.0.1'); assert.equal(endpoint.port, '59100');
assert(!endpoint.username && !endpoint.password, 'Storage endpoint must not contain credentials');
// Inspect secret-bearing environment only in memory; never print it.
const running = JSON.parse(execFileSync('docker', ['--context', 'default', 'inspect', 'darshan-live-api-20261103',
  '--format', '{{json .Config.Env}}'], { encoding: 'utf8', timeout: 10_000 }));
const actual = Object.fromEntries(running.map(value => { const split = value.indexOf('='); return [value.slice(0, split), value.slice(split + 1)]; }));
for (const key of ['DATABASE_URL', 'MINIO_ENDPOINT', 'MINIO_PORT', 'NODE_ENV']) assert(actual[key] === env[key], 'Dedicated API storage/runtime configuration changed');
const base = 'http://127.0.0.1:18120', owner = 'Owned by live-fallback-preparation-evidence.mjs; isolated synthetic fallback only.';
const freshSuffix = process.argv.includes('--fresh') ? ` ${randomUUID()}` : '';
const fixtures = JSON.parse(await readFile(resolve(runtime, 'baseline-fixtures.json'), 'utf8'));
assert.equal(fixtures.api_base, base);
const mediaIds = ['normal', 'document', 'video'].map(kind => { const id = fixtures[`${kind}_media_id`]; assert.match(id, /^[a-f0-9-]{36}$/); return id; });
const readyDeadline = Date.now() + 30_000;
let ready = false;
while (!ready && Date.now() < readyDeadline) {
  try { ready = (await fetch(base + '/api/v1/health/ready', { signal: AbortSignal.timeout(2000) })).status === 200; } catch {}
  if (!ready) await new Promise(resolve => setTimeout(resolve, 250));
}
assert(ready, 'Feature API must be ready');
const login = await fetch(base + '/api/v1/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-requested-with': 'XMLHttpRequest' }, body: await readFile(resolve(runtime, 'credentials.json'), 'utf8') });
assert.equal(login.status, 200);
const cookies = login.headers.getSetCookie().map(value => value.split(';')[0]), cookie = cookies.join('; ');
const csrf = decodeURIComponent(cookies.find(value => value.startsWith('csrf_token=')).slice(11));
await login.arrayBuffer();
const evidence = { captured_at: new Date().toISOString(), scope: 'Actual isolated HTTP+CSRF+pg-boss worker+PostgreSQL+MinIO. Supporting developer evidence, not CMS/Electron acceptance.', checks: [], preparations: [] };
async function request(path, method = 'GET', body) {
  const response = await fetch(base + '/api/v1' + path, { method,
    headers: { cookie, 'x-requested-with': 'XMLHttpRequest', ...(method === 'GET' ? {} : { 'x-csrf-token': csrf }), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15_000) });
  const parsed = await response.json();
  assert(response.ok, `${method} ${path}: status ${response.status}, code ${parsed?.error?.code ?? 'unknown'}`);
  evidence.checks.push({ method, path, status: response.status });
  return parsed?.success === true && parsed.data !== undefined ? parsed.data : parsed;
}
const pool = new Pool({ connectionString: env.DATABASE_URL, max: 1, options: '-c timezone=UTC -c statement_timeout=5000' });
const storage = new S3Client({ endpoint: endpoint.origin, region: 'us-east-1', forcePathStyle: true,
  credentials: { accessKeyId: env.MINIO_ACCESS_KEY, secretAccessKey: env.MINIO_SECRET_KEY } });
try {
  // Fixed existing synthetic media only. There is no file/URL/target override.
  const sourceRows = (await pool.query(`SELECT m.id,m.name,m.type,m.status,m.ready_object_id,m.source_object_id,
    so.sha256,so.size,so.content_type,so.id AS delivered_id FROM media m
    JOIN storage_objects so ON so.id=coalesce(m.ready_object_id,m.source_object_id) WHERE m.id=ANY($1::uuid[])`, [mediaIds])).rows;
  assert.equal(sourceRows.length, 3); assert(sourceRows.every(row => row.status === 'READY' && row.name.startsWith('Live Loop Baseline ')));
  const inventory = (await request('/presentations?limit=100')).items;
  for (const suffix of ['Primary', 'CAS reuse']) {
    const name = `Live Immutable Fallback Probe ${suffix}${freshSuffix}`;
    let presentation = inventory.find(row => row.name === name);
    if (presentation) assert.equal(presentation.description, owner, 'Refuse another presentation using the probe name');
    else {
      presentation = await request('/presentations', 'POST', { name, description: owner, layout_id: fixtures.layout_id });
      await request(`/presentations/${presentation.id}/slots`, 'PUT', { items: mediaIds.map((media_id, order) => ({
        slot_id: 'fullscreen', media_id, order, duration_seconds: 10, fit_mode: 'contain', audio_enabled: false, loop_enabled: false,
        ...(order === 1 ? { page_number: 2 } : {}),
      })) });
    }
    const slots = (await request(`/presentations/${presentation.id}/slots`)).items;
    assert.deepEqual(slots.map(row => row.media_id), mediaIds, 'Do not overwrite changed probe content');
    const started = performance.now();
    const [first, duplicate] = await Promise.all([1, 2].map(() => request('/live-fallback-preparations', 'POST', { presentation_id: presentation.id })));
    assert.equal(first.id, duplicate.id, 'Repeated preparation requests must coalesce');
    let current = first;
    while (current.state !== 'READY' && performance.now() - started < 90_000) {
      assert.notEqual(current.state, 'FAILED', `Preparation failed: ${current.failure_code}`);
      await new Promise(resolve => setTimeout(resolve, 250));
      current = await request(`/live-fallback-preparations/${first.id}`);
    }
    assert.equal(current.state, 'READY');
    assert.equal((await request('/live-fallback-preparations', 'POST', { presentation_id: presentation.id })).id, first.id);
    const manifest = current.manifest;
    assert.equal(manifest.assets.length, 3); assert.equal(manifest.presentation.items[1].page_number, 2);
    const assets = [];
    for (const asset of manifest.assets) {
      const source = sourceRows.find(row => row.id === asset.media_id); assert(source);
      assert.equal(asset.sha256, source.sha256, 'Approved bytes must match the final playback object, not original upload');
      assert.notEqual(asset.storage_object_id, source.delivered_id, 'Mutable delivery object IDs cannot be approved as immutable copies');
      assert.match(asset.object_key, new RegExp(`^live-fallbacks/v1/sha256/${asset.sha256}\\.[a-z0-9]+$`));
      assert.equal(asset.cache_key, `live_${asset.sha256}_${asset.render_type}`);
      const object = await storage.send(new GetObjectCommand({ Bucket: asset.bucket, Key: asset.object_key }));
      // These three allowlisted fixtures are small; production copy code streams.
      const bytes = await object.Body.transformToByteArray();
      assert.equal(bytes.length, asset.size); assert.equal(createHash('sha256').update(bytes).digest('hex'), asset.sha256);
      assert.equal(object.ContentType, asset.content_type);
      assets.push({ media_type: source.type, render_type: asset.render_type, representation: asset.representation,
        sha256: asset.sha256, size: asset.size, copied_storage_object: true, bytes_verified: true });
    }
    const rows = (await pool.query('SELECT * FROM live_fallback_preparation_assets WHERE preparation_id=$1', [first.id])).rows;
    assert.equal(rows.length, 3);
    const state = (await pool.query('SELECT state,claim_token,lease_expires_at FROM live_fallback_preparations WHERE id=$1', [first.id])).rows[0];
    assert.deepEqual(state, { state: 'READY', claim_token: null, lease_expires_at: null });
    evidence.preparations.push({ presentation_id: presentation.id, preparation_id: first.id, state: 'READY', elapsed_ms: Math.round(performance.now() - started), duplicate_coalesced: true,
      normalized_asset_count: rows.length, lease_released: true, source_fingerprint: current.source_fingerprint, assets });
  }
  await writeFile(resolve(runtime, 'live-fallback-preparation-runtime-evidence.json'), JSON.stringify(evidence, null, 2) + '\n', { mode: 0o600 });
  console.log(JSON.stringify({ scope: evidence.scope, preparations: evidence.preparations }, null, 2));
} finally { await pool.end(); storage.destroy(); }
