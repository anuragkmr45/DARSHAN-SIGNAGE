#!/usr/bin/env node
/**
 * Prepare only named loop-0 fixtures in the isolated live-broadcast runtime.
 * This intentionally never creates/publishes a schedule or triggers emergency.
 *
 * node scripts/qa/live-baseline-fixtures.mjs --prepare-isolated-live-fixtures
 * Credentials: .local/live-broadcast/credentials.json (mode 0600).
 * Output: .local/live-broadcast/baseline-fixtures.json (non-secret IDs).
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
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
const manifestPath = resolve(runtime, 'baseline-fixtures.json');
const credentialsPath = resolve(runtime, 'credentials.json');
const marker = 'Owned by scripts/qa/live-baseline-fixtures.mjs; isolated loop-0 fixtures only.';
const names = {
  normal: 'Live Loop Baseline Normal PNG',
  emergency: 'Live Loop Baseline Emergency PNG',
  layout: 'Live Loop Baseline 16x9 Fullscreen Layout',
  presentation: 'Live Loop Baseline Normal Presentation',
  screen: 'Live Loop Baseline Player',
};

const credentialStat = await stat(credentialsPath);
assert.equal(credentialStat.mode & 0o077, 0, 'Credentials must have no group/other permissions (use mode 0600)');
const credentials = JSON.parse(await readFile(credentialsPath, 'utf8'));
assert(typeof credentials.email === 'string' && typeof credentials.password === 'string', 'Private credentials require email/password');
let manifest = {};
try { manifest = JSON.parse(await readFile(manifestPath, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
assert(!manifest.api_base || manifest.api_base === api.origin, 'Existing fixture manifest belongs to another API');
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
async function prepareImage(kind, label, background, accent) {
  const bytes = makePng(label, background, accent), sha256 = createHash('sha256').update(bytes).digest('hex');
  const filename = `live-baseline-${kind}.png`, localPath = resolve(runtime, 'fixtures', filename);
  await writeFile(localPath, bytes, { mode: 0o600 });
  let media = manifest[`${kind}_media_id`] ? await request(`/media/${manifest[`${kind}_media_id`]}`, { allow404: true }) : null;
  media ??= mediaInventory.find((item) => item.name === names[kind] || item.display_name === names[kind]);
  if (!media) {
    const upload = await request('/media/uploads', { method: 'POST', headers: { 'idempotency-key': `live-loop0-${kind}-${sha256}` },
      body: { filename, display_name: names[kind], content_type: 'image/png', size: bytes.length, checksum_sha256: sha256 } });
    assert.equal(upload.strategy, 'single', 'Small PNG requires single upload');
    const uploadUrl = new URL(upload.upload_url);
    assert(['127.0.0.1', 'localhost', '[::1]'].includes(uploadUrl.hostname) && uploadUrl.port === '59100', 'Upload URL must target isolated MinIO port 59100');
    const stored = await fetch(uploadUrl, { method: 'PUT', headers: { 'content-type': 'image/png' }, body: bytes });
    assert(stored.ok, `Isolated ${kind} PNG object upload failed (${stored.status})`);
    await stored.arrayBuffer();
    await request(`/media/uploads/${upload.session_id}/complete`, { method: 'POST', body: { width: 1280, height: 720 } });
    media = { id: upload.media_id };
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
  assert.equal(media.type, 'IMAGE', 'Fixture type must be image');
  assert.equal(media.display_name ?? media.name, names[kind], 'Refusing another named media');
  manifest[`${kind}_fixture`] = { filename, size: bytes.length, sha256, width: 1280, height: 720, status: media.status };
  await persist();
}

await prepareImage('normal', 'NORMAL CONTENT', [8, 70, 86], [40, 220, 150]);
await prepareImage('emergency', 'EMERGENCY', [155, 8, 18], [255, 205, 35]);
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
  layout: { name: names.layout, id: manifest.layout_id }, presentation: { name: names.presentation, id: manifest.presentation_id },
  screen: screen ? { name: names.screen, id: screen.id } : null,
  schedule_published: false, emergency_triggered: false }, null, 2));
