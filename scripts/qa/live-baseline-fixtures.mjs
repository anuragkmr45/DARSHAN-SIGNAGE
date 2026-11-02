#!/usr/bin/env node
/**
 * Prepare only named loop-0 fixtures in the isolated live-broadcast runtime.
 * This intentionally never creates/publishes a schedule or triggers emergency.
 *
 * node scripts/qa/live-baseline-fixtures.mjs --prepare-isolated-live-fixtures
 * Add --include-media-fallbacks for the fixed synthetic QA PDF/video sources.
 * Private inputs: .local/live-broadcast/{credentials.json,backend.env} (0600).
 * Output: .local/live-broadcast/baseline-fixtures.json (non-secret IDs).
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const runtime = resolve(repo, '.local/live-broadcast');
const api = new URL(process.env.LIVE_BASELINE_API_URL ?? 'http://127.0.0.1:18120');
assert(process.argv.includes('--prepare-isolated-live-fixtures'), 'Supply --prepare-isolated-live-fixtures to prepare this isolated runtime');
assert(['127.0.0.1', 'localhost', '[::1]'].includes(api.hostname), 'Only a loopback API is accepted');
assert.equal(api.port, '18120', 'This fixture helper is restricted to isolated live API port 18120');
assert.equal(api.protocol, 'http:', 'The current isolated loop-0 API uses HTTP; production URLs are refused');
assert(!api.username && !api.password, 'API URL must not contain credentials');
assert(api.pathname === '/' && !api.search && !api.hash, 'Only the isolated API origin is accepted');
const includeMediaFallbacks = process.argv.includes('--include-media-fallbacks');
const manifestPath = resolve(runtime, 'baseline-fixtures.json');
const credentialsPath = resolve(runtime, 'credentials.json');
const marker = 'Owned by scripts/qa/live-baseline-fixtures.mjs; isolated loop-0 fixtures only.';
const names = {
  normal: 'Live Loop Baseline Normal PNG',
  emergency: 'Live Loop Baseline Emergency PNG',
  document: 'Live Loop Baseline Fallback PDF',
  video: 'Live Loop Baseline Fallback Video',
  layout: 'Live Loop Baseline 16x9 Fullscreen Layout',
  presentation: 'Live Loop Baseline Normal Presentation',
  screen: 'Live Loop Baseline Player',
};

const credentialStat = await stat(credentialsPath);
assert.equal(credentialStat.mode & 0o077, 0, 'Credentials must have no group/other permissions (use mode 0600)');
const requireServer = createRequire(resolve(repo, 'darshan-server/package.json'));
const { parse } = requireServer('dotenv');
const { S3Client, GetObjectCommand } = requireServer('@aws-sdk/client-s3');
const backendPath = resolve(runtime, 'backend.env');
assert.equal((await stat(backendPath)).mode & 0o077, 0, 'Backend fixture configuration must be private');
const backend = parse(await readFile(backendPath));
const database = new URL(backend.DATABASE_URL);
assert.equal(database.pathname, '/darshan_live_20261103_test', 'Only the isolated live test database is accepted');
assert(['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname), 'The isolated database must be loopback');
const endpoint = new URL(backend.MINIO_ENDPOINT.includes('://') ? backend.MINIO_ENDPOINT : `http://${backend.MINIO_ENDPOINT}`);
if (!endpoint.port && backend.MINIO_PORT) endpoint.port = backend.MINIO_PORT;
assert(endpoint.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname) && endpoint.port === '59100', 'Only isolated loopback MinIO port 59100 is accepted');
assert(!endpoint.username && !endpoint.password, 'MinIO URL must not contain credentials');
assert(backend.MINIO_ACCESS_KEY && backend.MINIO_SECRET_KEY, 'Private MinIO credentials are required');
// Secret-bearing inspect output stays in memory and is never logged.
const inspection = spawnSync('docker', ['--context', 'default', 'inspect', 'darshan-live-api-20261103', '--format', '{{json .Config.Env}}'], { encoding: 'utf8' });
assert.equal(inspection.status, 0, 'The dedicated isolated API container must be inspectable');
const runningEnv = Object.fromEntries(JSON.parse(inspection.stdout).map(value => {
  const separator = value.indexOf('='); return [value.slice(0, separator), value.slice(separator + 1)];
}));
for (const key of ['DATABASE_URL', 'MINIO_ENDPOINT', 'MINIO_PORT'])
  assert(runningEnv[key] === backend[key], 'Running API storage configuration differs from the private isolated configuration');
const storage = new S3Client({ endpoint: endpoint.origin, region: 'us-east-1', forcePathStyle: true,
  credentials: { accessKeyId: backend.MINIO_ACCESS_KEY, secretAccessKey: backend.MINIO_SECRET_KEY } });
const credentials = JSON.parse(await readFile(credentialsPath, 'utf8'));
assert(typeof credentials.email === 'string' && typeof credentials.password === 'string', 'Private credentials require email/password');
let manifest = {};
try { manifest = JSON.parse(await readFile(manifestPath, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
assert(!manifest.api_base || manifest.api_base === api.origin, 'Existing fixture manifest belongs to another API');
assert(!manifest.fixture_owner || manifest.fixture_owner === marker, 'Existing fixture manifest belongs to another owner');
await mkdir(resolve(runtime, 'fixtures'), { recursive: true, mode: 0o700 });

function unwrap(body) { return body?.success === true && body.data !== undefined ? body.data : body; }
const loginResponse = await fetch(new URL('/api/v1/auth/login', api), {
  method: 'POST', headers: { 'content-type': 'application/json', 'x-requested-with': 'XMLHttpRequest' },
  body: JSON.stringify(credentials),
});
assert.equal(loginResponse.status, 200, `Isolated administrator login failed (${loginResponse.status})`);
const cookies = loginResponse.headers.getSetCookie().map((x) => x.split(';')[0]);
const cookie = cookies.join('; ');
const csrf = cookies.find((x) => x.startsWith('csrf_token='))?.slice('csrf_token='.length);
assert(csrf, 'Login did not return CSRF cookie');
await loginResponse.arrayBuffer(); // Discard the private login payload; never log it.

async function request(path, { method = 'GET', body, headers = {}, allow404 = false } = {}) {
  const response = await fetch(new URL(`/api/v1${path}`, api), {
    method, headers: { cookie, 'x-requested-with': 'XMLHttpRequest',
      ...(method === 'GET' ? {} : { 'x-csrf-token': decodeURIComponent(csrf) }),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const raw = await response.text();
  let parsed;
  try { parsed = raw ? JSON.parse(raw) : null; } catch { throw new Error(`${method} ${path}: non-JSON response (${response.status})`); }
  if (allow404 && response.status === 404) return null;
  // Never print raw error bodies: they can include signed object URLs.
  if (!response.ok) throw new Error(`${method} ${path}: HTTP ${response.status}, code ${parsed?.error?.code ?? 'unknown'}`);
  return unwrap(parsed);
}

async function listAll(path) {
  const result = [];
  for (let page = 1; page <= 30; page += 1) {
    const response = await request(`${path}?limit=100&page=${page}`);
    const items = Array.isArray(response) ? response : response.items;
    assert(Array.isArray(items), `${path} did not return items`);
    result.push(...items);
    if (items.length < 100) return result;
  }
  throw new Error(`${path} unexpectedly exceeds isolated fixture inventory limit`);
}

async function persist() {
  manifest = { ...manifest, fixture_owner: marker, api_base: api.origin, names, updated_at: new Date().toISOString() };
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
}

// Dependency-free PNG encoding and legible block lettering keep these fixtures
// deterministic and portable without host package installation.
const font = {
  A:['01110','10001','10001','11111','10001','10001','10001'], C:['01111','10000','10000','10000','10000','10000','01111'],
  E:['11111','10000','10000','11110','10000','10000','11111'], G:['01111','10000','10000','10111','10001','10001','01111'],
  L:['10000','10000','10000','10000','10000','10000','11111'], M:['10001','11011','10101','10101','10001','10001','10001'],
  N:['10001','11001','10101','10011','10001','10001','10001'], O:['01110','10001','10001','10001','10001','10001','01110'],
  R:['11110','10001','10001','11110','10100','10010','10001'], T:['11111','00100','00100','00100','00100','00100','00100'],
  Y:['10001','10001','01010','00100','00100','00100','00100'], ' ':['00000','00000','00000','00000','00000','00000','00000'],
};
function crc32(bytes) {
  let c = 0xffffffff;
  for (const byte of bytes) { c ^= byte; for (let b = 0; b < 8; b += 1) c = (c >>> 1) ^ ((c & 1) ? 0xedb88320 : 0); }
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, bytes) {
  const label = Buffer.from(type), length = Buffer.alloc(4), checksum = Buffer.alloc(4);
  length.writeUInt32BE(bytes.length); checksum.writeUInt32BE(crc32(Buffer.concat([label, bytes])));
  return Buffer.concat([length, label, bytes, checksum]);
}
function makePng(label, background, accent) {
  const width = 1280, height = 720, pixels = Buffer.alloc(width * height * 3);
  function rectangle(x, y, w, h, color) {
    for (let row = Math.max(0, y); row < Math.min(height, y + h); row += 1)
      for (let column = Math.max(0, x); column < Math.min(width, x + w); column += 1) {
        const i = (row * width + column) * 3; pixels[i] = color[0]; pixels[i + 1] = color[1]; pixels[i + 2] = color[2];
      }
  }
  rectangle(0, 0, width, height, background); rectangle(30, 30, 1220, 20, accent); rectangle(30, 670, 1220, 20, accent);
  const scale = label.length > 10 ? 12 : 16, x0 = Math.floor((width - (label.length * 6 - 1) * scale) / 2), y0 = 285;
  [...label].forEach((letter, index) => font[letter].forEach((row, y) => [...row].forEach((bit, x) => {
    if (bit === '1') rectangle(x0 + (index * 6 + x) * scale, y0 + y * scale, scale, scale, [255, 255, 255]);
  })));
  const scan = Buffer.alloc((width * 3 + 1) * height);
  for (let row = 0; row < height; row += 1) pixels.copy(scan, row * (width * 3 + 1) + 1, row * width * 3, (row + 1) * width * 3);
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(scan)), chunk('IEND', Buffer.alloc(0))]);
}

const mediaInventory = await listAll('/media');
async function prepareMedia(kind, { bytes, filename, contentType, type, completion = {}, expected = {}, provenance }) {
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const localPath = resolve(runtime, 'fixtures', filename);
  await writeFile(localPath, bytes, { mode: 0o600 });
  let media = manifest[`${kind}_media_id`] ? await request(`/media/${manifest[`${kind}_media_id`]}`, { allow404: true }) : null;
  media ??= mediaInventory.find((item) => item.name === names[kind] || item.display_name === names[kind]);
  let upload;
  if (!media) {
    upload = await request('/media/uploads', { method: 'POST', headers: { 'idempotency-key': `live-loop0-${kind}-${sha256}` },
      body: { filename, display_name: names[kind], content_type: contentType, size: bytes.length, checksum_sha256: sha256 } });
    media = { id: upload.media_id };
    manifest[`${kind}_media_id`] = media.id;
    manifest[`${kind}_upload_session_id`] = upload.session_id;
    await persist();
  } else if (media.status !== 'READY' && manifest[`${kind}_upload_session_id`]) {
    upload = await request(`/media/uploads/${manifest[`${kind}_upload_session_id`]}`);
    assert.equal(upload.media_id, media.id, 'Saved upload session belongs to another media');
  }
  if (upload && upload.state !== 'COMPLETED') {
    assert.equal(upload.state, 'ACTIVE', 'Only active fixture upload sessions can resume');
    assert.equal(upload.strategy, 'single', 'These small fixtures require single upload');
    const uploadUrl = new URL(upload.upload_url);
    assert(uploadUrl.origin === endpoint.origin, 'Upload URL must target the exact isolated MinIO origin');
    const stored = await fetch(uploadUrl, { method: 'PUT', headers: { 'content-type': contentType }, body: bytes });
    assert(stored.ok, `Isolated ${kind} fixture upload failed (${stored.status})`);
    await stored.arrayBuffer();
    const completed = await request(`/media/uploads/${upload.session_id}/complete`, { method: 'POST', body: completion });
    assert.equal(completed.state, 'COMPLETED', 'Fixture upload did not complete checksum verification');
  }
  manifest[`${kind}_media_id`] = media.id; await persist();
  const deadline = Date.now() + 90_000;
  do {
    media = await request(`/media/${media.id}`);
    if (media.status === 'READY') break;
    assert.notEqual(media.status, 'FAILED', `${kind} fixture processing failed`);
    await new Promise((done) => setTimeout(done, 500));
  } while (Date.now() < deadline);
  assert.equal(media.status, 'READY', `${kind} fixture did not become READY`);
  assert.equal(media.type, type, 'Unexpected fixture media type');
  assert.equal(media.display_name ?? media.name, names[kind], 'Refusing another named media');
  assert.equal(media.source_content_type, contentType, 'Unexpected source MIME type');
  assert.equal(media.source_size, bytes.length, 'Unexpected source size');
  for (const [key, value] of Object.entries(expected)) assert.equal(media[key], value, `Unexpected ${kind} ${key}`);
  assert(media.source_bucket && media.source_object_key, 'READY fixture is missing its source object');
  // Verify exact source bytes, including on idempotent reuse of named media.
  // Signed URLs and object-store credentials are neither persisted nor printed.
  const object = await storage.send(new GetObjectCommand({ Bucket: media.source_bucket, Key: media.source_object_key }));
  assert.equal(object.ContentType, contentType, 'Unexpected stored source MIME type');
  const storedBytes = await object.Body.transformToByteArray();
  assert.equal(storedBytes.length, bytes.length, 'Unexpected stored source size');
  assert.equal(createHash('sha256').update(storedBytes).digest('hex'), sha256, 'Stored fixture source checksum mismatch');
  manifest[`${kind}_fixture`] = { fixture_owner: marker, filename, content_type: contentType, type, size: bytes.length, sha256,
    status: media.status, width: media.width ?? null, height: media.height ?? null,
    duration_seconds: media.duration_seconds ?? null, page_count: media.page_count ?? null,
    source_checksum_verified: true, ...(provenance ? { source_fixture: provenance } : {}) };
  await persist();
}

async function prepareImage(kind, label, background, accent) {
  return prepareMedia(kind, { bytes: makePng(label, background, accent), filename: `live-baseline-${kind}.png`,
    contentType: 'image/png', type: 'IMAGE', completion: { width: 1280, height: 720 }, expected: { width: 1280, height: 720 } });
}
await prepareImage('normal', 'NORMAL CONTENT', [8, 70, 86], [40, 220, 150]);
await prepareImage('emergency', 'EMERGENCY', [155, 8, 18], [255, 205, 35]);
if (includeMediaFallbacks) {
  // Fixed synthetic sources only: no path/URL override or arbitrary local file.
  const sources = [
    { kind: 'document', source: 'qa-artifacts/evidence/runtime-2026-10-16/fixture-pages.pdf',
      sha256: '8362c191e2e483d4582d6c6b41b0ef463a9100ae915096962202bb991ccf4477',
      filename: 'live-baseline-fallback.pdf', contentType: 'application/pdf', type: 'DOCUMENT', expected: { page_count: 5 } },
    { kind: 'video', source: 'qa-artifacts/evidence/runtime-2026-10-16/fixture-loop.mp4',
      sha256: 'd097080d06c34f999cf3efae77b1ab485f264e3646feb30ea9b044346951a45e',
      filename: 'live-baseline-fallback.mp4', contentType: 'video/mp4', type: 'VIDEO',
      completion: { duration_seconds: 2, width: 640, height: 360 }, expected: { duration_seconds: 2, width: 640, height: 360 } },
  ];
  for (const source of sources) {
    const bytes = await readFile(resolve(repo, source.source));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), source.sha256, 'Allowlisted synthetic source bytes changed');
    await prepareMedia(source.kind, { ...source, bytes, provenance: source.source });
  }
}
storage.destroy();
const layouts = await listAll('/layouts');
let layout = layouts.find((item) => item.id === manifest.layout_id || item.name === names.layout);
if (!layout) {
  layout = await request('/layouts', { method: 'POST', body: { name: names.layout, description: marker, aspect_ratio: '16:9',
    spec: { slots: [{ id: 'fullscreen', x: 0, y: 0, w: 1, h: 1, z: 0, fit: 'contain', audio_enabled: false }] } } });
}
assert.equal(layout.name, names.layout, 'Refusing another layout');
assert.equal(layout.description, marker, 'Existing named layout is not owned by this helper');
assert.equal(layout.aspect_ratio, '16:9');
manifest.layout_id = layout.id; await persist();
const presentations = await listAll('/presentations');
let presentation = presentations.find((item) => item.id === manifest.presentation_id || item.name === names.presentation);
if (!presentation) presentation = await request('/presentations', { method: 'POST', body: { name: names.presentation, description: marker, layout_id: layout.id } });
assert.equal(presentation.name, names.presentation, 'Refusing another presentation');
assert.equal(presentation.description, marker, 'Existing named presentation is not owned by this helper');
assert.equal(presentation.layout_id, layout.id, 'Existing fixture presentation uses another layout');
manifest.presentation_id = presentation.id; await persist();
await request(`/presentations/${presentation.id}/slots`, { method: 'PUT', body: { items: [{ slot_id: 'fullscreen', media_id: manifest.normal_media_id, order: 0, duration_seconds: 10, fit_mode: 'contain', audio_enabled: false, loop_enabled: false }] } });
const slots = await request(`/presentations/${presentation.id}/slots`);
assert.equal(slots.items?.[0]?.media_id, manifest.normal_media_id, 'Normal fixture not assigned to fullscreen slot');
const screens = await listAll('/screens');
const screen = screens.find((item) => item.name === names.screen);
if (screen) { manifest.screen_id = screen.id; manifest.screen_status = screen.status; }
await persist();
console.log(JSON.stringify({ status: 'fixtures_ready', manifest: '.local/live-broadcast/baseline-fixtures.json',
  normal: { name: names.normal, id: manifest.normal_media_id }, emergency: { name: names.emergency, id: manifest.emergency_media_id },
  ...(includeMediaFallbacks ? { document: { name: names.document, id: manifest.document_media_id, ...manifest.document_fixture },
    video: { name: names.video, id: manifest.video_media_id, ...manifest.video_fixture } } : {}),
  layout: { name: names.layout, id: manifest.layout_id }, presentation: { name: names.presentation, id: manifest.presentation_id },
  screen: screen ? { name: names.screen, id: screen.id } : null,
  schedule_published: false, emergency_triggered: false }, null, 2));
