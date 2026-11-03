#!/usr/bin/env node
/**
 * Supporting actual-service verification; never CMS/Electron/human acceptance.
 * Run only after the final isolated API/worker build has been restarted:
 *   node scripts/qa/live-publication-evidence.mjs --verify-isolated-live-publication
 *
 * Fixed API18120 / PostgreSQL55455 darshan_live_20261103_test / MinIO59100.
 * SQL writes INSERT exactly two new, unpaired OFFLINE fixture Screens. All
 * source/group/schedule/request/publish/takedown actions use authenticated REST.
 * Repeated runs create uniquely named fixtures and preserve every history row.
 * Failures attempt to take down/cancel only this invocation's own publications
 * and requests; there is no deletion, reset, migration or forced cleanup.
 */
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { chmod, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const runtime = resolve(root, '.local/live-broadcast');
const output = resolve(runtime, 'live-publication-runtime-evidence.json');
const api = new URL('http://127.0.0.1:18120');
const protectedScreen = '7be1093c-cd8d-488c-9f48-bd6971e9565f';
const owner = 'Owned by scripts/qa/live-publication-evidence.mjs; isolated synthetic publication only.';
const preparationOwner = 'Owned by live-fallback-preparation-evidence.mjs; isolated synthetic fallback only.';
const runId = randomUUID(), prefix = `Live Publication Probe ${runId}`;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const canonical = value => value === null || typeof value !== 'object' ? JSON.stringify(value)
  : Array.isArray(value) ? `[${value.map(canonical).join(',')}]`
    : `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
const digest = value => sha256(canonical(value));
const evidence = { version: 1, fixture_owner: owner, run_id: runId, started_at: new Date().toISOString(), status: 'IN_PROGRESS',
  scope: 'Actual isolated REST + PostgreSQL + immutable MinIO downloads. Supporting developer evidence; no CMS, admission, live run, player display or human acceptance claim.',
  protected_player_excluded: true, ids: { screens: [], schedules: [], publications: [], requests: [] }, checks: [], downloads: [] };
let phase = 'explicit isolated-runtime guard', pool, cookie, csrf, loggedIn = false, verifiedRuntime = false;
let actorId, preparation, source, group;
const publications = new Map(), requests = new Set(), schedules = new Set();

function requireThat(condition, code) {
  if (!condition) { const error = new Error('Isolated publication verification failed'); error.safeCode = code; throw error; }
}
function id(value, label) { requireThat(typeof value === 'string' && uuid.test(value), `INVALID_${label}_ID`); return value; }
function ownScreen(value) { requireThat(evidence.ids.screens.includes(value) && value !== protectedScreen, 'REFUSED_NONOWNED_SCREEN'); return value; }
function ownSchedule(value) { requireThat(schedules.has(value), 'REFUSED_NONOWNED_SCHEDULE'); return value; }
function mark(name, started = performance.now(), details = {}) {
  evidence.checks.push({ name, result: 'PASS', elapsed_ms: Math.round(performance.now() - started), ...details });
}
async function persist() {
  const temporary = resolve(runtime, `.live-publication-evidence-${runId}.tmp`);
  await writeFile(temporary, JSON.stringify(evidence, null, 2) + '\n', { mode: 0o600 });
  await chmod(temporary, 0o600); await rename(temporary, output); await chmod(output, 0o600);
}
const unwrap = body => body?.success === true && body.data !== undefined ? body.data : body;
async function request(label, path, { method = 'GET', body, expected = 200 } = {}) {
  requireThat(verifiedRuntime && loggedIn, 'RUNTIME_OR_SESSION_NOT_VERIFIED');
  requireThat(path.startsWith('/') && !path.includes('://') && !path.includes('#'), 'REFUSED_NONLOCAL_API_PATH');
  const started = performance.now();
  const response = await fetch(new URL(`/api/v1${path}`, api), { method, redirect: 'error',
    headers: { cookie, 'x-requested-with': 'XMLHttpRequest', ...(method === 'GET' ? {} : { 'x-csrf-token': csrf }),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(20_000) });
  let parsed; try { parsed = await response.json(); } catch { requireThat(false, 'NON_JSON_API_RESPONSE'); }
  const code = typeof parsed?.error?.code === 'string' && /^[A-Z0-9_]+$/.test(parsed.error.code) ? parsed.error.code : 'UNKNOWN';
  requireThat(response.status === expected, `HTTP_${response.status}_${code}`);
  mark(label, started, { method, status_code: response.status, ...(expected >= 400 ? { error_code: code } : {}) });
  return expected >= 400 ? parsed : unwrap(parsed);
}
async function ownedSnapshot(publication) {
  ownSchedule(publication.schedule_id);
  const row = (await pool.query(`SELECT p.id,p.schedule_id,p.snapshot_id,p.status,s.payload
    FROM publishes p JOIN schedule_snapshots s ON s.id=p.snapshot_id WHERE p.id=$1`, [publication.publish_id])).rows[0];
  requireThat(row && row.schedule_id === publication.schedule_id && row.snapshot_id === publication.snapshot_id, 'PUBLICATION_IDENTITY_MISMATCH');
  requireThat(!/https?:\/\/|wss?:\/\/|[?&]x-amz-|"(?:ticket|token|password|cookie|authorization)"/i.test(JSON.stringify(row.payload)), 'TRANSIENT_AUTHORITY_IN_IMMUTABLE_SNAPSHOT');
  requireThat(row.payload.publish_id === row.id && row.payload.schedule.id === row.schedule_id, 'SNAPSHOT_PARENT_MISMATCH');
  return row;
}
async function createSchedule(label, { screenId, groupId }) {
  requireThat(Boolean(screenId) !== Boolean(groupId), 'ONE_OWNED_TARGET_KIND_REQUIRED');
  if (screenId) ownScreen(screenId); if (groupId) requireThat(groupId === group.id, 'REFUSED_NONOWNED_GROUP');
  const now = Date.now();
  const schedule = await request(`create ${label} schedule`, '/schedules', { method: 'POST', expected: 201, body: {
    name: `${prefix} ${label}`, description: owner, timezone: 'Asia/Kolkata',
    start_at: new Date(now + 300_000).toISOString(), end_at: new Date(now + 7_200_000).toISOString(),
  } });
  id(schedule.id, 'SCHEDULE'); schedules.add(schedule.id); evidence.ids.schedules.push(schedule.id); await persist();
  const item = await request(`create ${label} LIVE item`, `/schedules/${schedule.id}/items`, { method: 'POST', expected: 201, body: {
    source_kind: 'LIVE', live_session_id: source.id, presentation_id: preparation.presentation_id,
    start_at: new Date(now + 900_000).toISOString(), end_at: new Date(now + 3_600_000).toISOString(), priority: 0,
    screen_ids: screenId ? [screenId] : [], screen_group_ids: groupId ? [groupId] : [],
  } });
  id(item.id, 'ITEM'); return { id: schedule.id, item_id: item.id };
}
async function publishDirect(schedule, targetId) {
  ownSchedule(schedule.id); ownScreen(targetId);
  const prepIds = { [preparation.presentation_id]: preparation.preparation_id };
  // Deliberately omit explicit groups: authored LIVE group provenance must
  // create its own frozen PublishTarget, independently of current membership.
  const preflight = await request('review direct live policy', '/schedules/live-preflight', { method: 'POST', body: {
    schedule_id: schedule.id, fallback_preparation_ids: prepIds,
  } });
  requireThat(preflight.schedule_id === schedule.id && preflight.items.length === 1 &&
    digest(preflight.items[0].screen_ids) === digest([targetId]), 'PREFLIGHT_AUDIENCE_MISMATCH');
  const result = await request('publish reviewed live schedule', `/schedules/${schedule.id}/publish`, { method: 'POST', body: {
    fallback_preparation_ids: prepIds, expected_live_fingerprint: preflight.approval_fingerprint,
  } });
  const publication = { schedule_id: schedule.id, publish_id: id(result.publish_id, 'PUBLISH'), snapshot_id: id(result.snapshot_id, 'SNAPSHOT') };
  publications.set(publication.publish_id, publication); evidence.ids.publications.push(publication); await persist();
  const stored = await ownedSnapshot(publication), item = stored.payload.schedule.items[0];
  requireThat(stored.status === 'ACTIVE' && item.source_kind === 'LIVE' && item.presentation === null &&
    digest(item.live_policy) === digest(preflight.items[0]) && item.live_policy.fallback.preparation_id === preparation.preparation_id,
    'FROZEN_POLICY_MISMATCH');
  mark('immutable snapshot equals reviewed policy', performance.now(), { snapshot_sha256: digest(stored.payload), approval_fingerprint: preflight.approval_fingerprint });
  return { ...publication, policy: item.live_policy, snapshot_sha256: digest(stored.payload) };
}
async function verifyDownloads(label, response, publication, targetId) {
  requireThat(response.publish?.publish_id === publication.publish_id && response.snapshot?.schedule?.items?.length === 1, 'WRONG_SNAPSHOT_PUBLICATION');
  const item = response.snapshot.schedule.items[0], expected = publication.policy;
  requireThat(item.source_kind === 'LIVE' && item.presentation === null && digest(item.live_policy) === digest(expected) &&
    digest(item.resolved_screen_ids) === digest([targetId]), 'HYDRATED_POLICY_OR_AUDIENCE_CHANGED');
  const assets = expected.fallback.manifest.assets, downloads = item.live_fallback_downloads;
  requireThat(Array.isArray(downloads) && downloads.length === assets.length && new Set(downloads.map(value => value.asset_id)).size === assets.length,
    'INCOMPLETE_FROZEN_DOWNLOAD_GRAPH');
  for (const asset of assets) {
    requireThat(/^live-fallbacks\/v1\/sha256\/[a-f0-9]{64}\.[a-z0-9]+$/.test(asset.object_key) &&
      asset.object_key.includes(asset.sha256), 'NON_CAS_FROZEN_ASSET');
    const download = downloads.find(value => value.asset_id === asset.id);
    requireThat(download?.sha256 === asset.sha256 && download.size === asset.size && download.cache_key === asset.cache_key &&
      download.content_type === asset.content_type, 'FROZEN_DOWNLOAD_DESCRIPTOR_CHANGED');
    const url = new URL(download.url);
    requireThat(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) && url.port === '59100' &&
      !url.username && !url.password && !url.hash && decodeURIComponent(url.pathname) === `/${asset.bucket}/${asset.object_key}`,
      'REFUSED_DOWNLOAD_OUTSIDE_ISOLATED_MINIO');
    const started = performance.now(), response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(30_000) });
    requireThat(response.ok && response.body && response.headers.get('content-type')?.split(';')[0] === asset.content_type, 'MINIO_DOWNLOAD_FAILED');
    const hash = createHash('sha256'); let size = 0;
    for await (const chunk of response.body) { size += chunk.byteLength; hash.update(chunk); }
    requireThat(size === asset.size && hash.digest('hex') === asset.sha256, 'DOWNLOADED_FROZEN_BYTES_MISMATCH');
    evidence.downloads.push({ journey: label, asset_id: asset.id, render_type: asset.render_type, size, sha256: asset.sha256,
      elapsed_ms: Math.round(performance.now() - started), verified: true });
  }
  mark(`${label} immutable downloads verified`); await persist();
}
async function stateHash() {
  const state = {};
  state.source = (await pool.query('SELECT to_jsonb(s) AS row FROM live_sessions s WHERE id=$1', [source.id])).rows;
  state.screens = (await pool.query('SELECT to_jsonb(s) AS row FROM screens s WHERE id=ANY($1::uuid[]) ORDER BY id', [evidence.ids.screens])).rows;
  state.group = (await pool.query('SELECT to_jsonb(g) AS row FROM screen_groups g WHERE id=$1', [group.id])).rows;
  state.members = (await pool.query('SELECT * FROM screen_group_members WHERE group_id=$1 ORDER BY screen_id', [group.id])).rows;
  for (const table of ['schedules', 'schedule_items', 'schedule_reservations', 'live_schedule_occurrences', 'publishes', 'schedule_snapshots']) {
    // Table names are this fixed source allowlist, never input/configuration.
    const column = table === 'schedules' ? 'id' : 'schedule_id';
    state[table] = (await pool.query(`SELECT to_jsonb(t) AS row FROM ${table} t WHERE ${column}=ANY($1::uuid[]) ORDER BY id`, [[...schedules]])).rows;
  }
  state.targets = (await pool.query(`SELECT to_jsonb(t) AS row FROM publish_targets t
    WHERE publish_id IN (SELECT id FROM publishes WHERE schedule_id=ANY($1::uuid[])) ORDER BY id`, [[...schedules]])).rows;
  state.assets = (await pool.query(`SELECT to_jsonb(a) AS row FROM live_occurrence_assets a
    WHERE occurrence_id IN (SELECT id FROM live_schedule_occurrences WHERE schedule_id=ANY($1::uuid[]))
    ORDER BY occurrence_id,asset_id`, [[...schedules]])).rows;
  return digest(state);
}
async function blockedDelete(label, path, body, code) {
  const before = await stateHash(), result = await request(label, path, { method: 'DELETE', body, expected: 409 });
  requireThat(result.error?.code === code && await stateHash() === before, 'BLOCKED_DELETE_CHANGED_OWNED_STATE');
  mark(`${label} left owned records unchanged`);
}
async function verifyReleased(publication) {
  const [publish] = (await pool.query('SELECT status FROM publishes WHERE id=$1', [publication.publish_id])).rows;
  const screenRows = (await pool.query('SELECT state FROM schedule_reservations WHERE publish_id=$1', [publication.publish_id])).rows;
  const liveRows = (await pool.query('SELECT state FROM live_schedule_occurrences WHERE publish_id=$1', [publication.publish_id])).rows;
  requireThat(publish?.status === 'TAKEN_DOWN' && screenRows.length === 1 && liveRows.length === 1 &&
    [...screenRows, ...liveRows].every(row => row.state === 'RELEASED'), 'TAKEDOWN_RESERVATIONS_NOT_RELEASED');
  mark('takedown released screen and logical live reservations');
}
async function verifyRequestReservations(requestId, scheduleId, expectedState, expectedStatus) {
  requireThat(requests.has(requestId), 'REFUSED_NONOWNED_REQUEST'); ownSchedule(scheduleId);
  const [row] = (await pool.query('SELECT status,reservation_token,requested_by FROM schedule_requests WHERE id=$1 AND schedule_id=$2', [requestId, scheduleId])).rows;
  const screenRows = (await pool.query('SELECT state,reservation_token FROM schedule_reservations WHERE schedule_request_id=$1', [requestId])).rows;
  const liveRows = (await pool.query('SELECT state,reservation_token FROM live_schedule_occurrences WHERE schedule_request_id=$1', [requestId])).rows;
  requireThat(row?.status === expectedStatus && row.requested_by === actorId && row.reservation_token && screenRows.length === 1 && liveRows.length === 1 &&
    [...screenRows, ...liveRows].every(value => value.state === expectedState && value.reservation_token === row.reservation_token), 'REQUEST_RESERVATION_PHASE_MISMATCH');
  mark('request screen and live reservation phases match', performance.now(), { request_status: expectedStatus, reservation_state: expectedState });
}
async function takeDownDirect(publication) {
  requireThat(publications.has(publication.publish_id), 'REFUSED_NONOWNED_PUBLICATION'); ownSchedule(publication.schedule_id);
  await request('take down own direct publication', `/publishes/${publication.publish_id}/take-down`, { method: 'POST', body: { reason: owner } });
  await verifyReleased(publication);
}

try {
  requireThat(process.argv.length === 3 && process.argv[2] === '--verify-isolated-live-publication', 'EXPLICIT_ISOLATED_GUARD_REQUIRED');
  const require = createRequire(resolve(root, 'darshan-server/package.json'));
  const { parse } = require('dotenv'), { Pool } = require('pg');
  for (const file of ['backend.env', 'credentials.json', 'baseline-fixtures.json', 'live-fallback-preparation-runtime-evidence.json'])
    requireThat(((await stat(resolve(runtime, file))).mode & 0o077) === 0, 'PRIVATE_INPUT_MODE_REQUIRED');
  const env = parse(await readFile(resolve(runtime, 'backend.env'))), database = new URL(env.DATABASE_URL);
  requireThat(database.protocol === 'postgresql:' || database.protocol === 'postgres:', 'REFUSED_DATABASE_PROTOCOL');
  requireThat(database.hostname === '127.0.0.1' && database.port === '55455' && database.pathname === '/darshan_live_20261103_test' &&
    !database.search && !database.hash && env.NODE_ENV === 'test', 'REFUSED_NONISOLATED_DATABASE');
  const endpoint = new URL(env.MINIO_ENDPOINT.includes('://') ? env.MINIO_ENDPOINT : `http://${env.MINIO_ENDPOINT}`);
  if (!endpoint.port && env.MINIO_PORT) endpoint.port = env.MINIO_PORT;
  requireThat(endpoint.protocol === 'http:' && endpoint.hostname === '127.0.0.1' && endpoint.port === '59100' &&
    endpoint.pathname === '/' && !endpoint.username && !endpoint.password && !endpoint.search && !endpoint.hash, 'REFUSED_NONISOLATED_MINIO');
  const inspected = spawnSync('docker', ['--context', 'default', 'inspect', 'darshan-live-api-20261103', '--format', '{{json .Config.Env}}'],
    { encoding: 'utf8', timeout: 10_000 });
  requireThat(inspected.status === 0, 'ISOLATED_API_CONTAINER_UNAVAILABLE');
  // Never assert.equal/log secret-bearing environment values, URLs or objects.
  const actual = Object.fromEntries(JSON.parse(inspected.stdout).map(value => { const separator = value.indexOf('='); return [value.slice(0, separator), value.slice(separator + 1)]; }));
  for (const key of ['DATABASE_URL', 'MINIO_ENDPOINT', 'MINIO_PORT', 'MINIO_ACCESS_KEY', 'MINIO_SECRET_KEY', 'NODE_ENV'])
    requireThat(Boolean(env[key]) && actual[key] === env[key], 'RUNNING_API_PRIVATE_STORAGE_MISMATCH');
  requireThat(actual.PORT === '18120', 'ISOLATED_API_PORT_MISMATCH');
  verifiedRuntime = true;
  pool = new Pool({ connectionString: env.DATABASE_URL, max: 2, application_name: `live_publication_probe_${runId}`,
    options: '-c timezone=UTC -c statement_timeout=5000 -c lock_timeout=5000' });
  requireThat((await pool.query('SELECT current_database() AS name')).rows[0].name === 'darshan_live_20261103_test', 'CONNECTED_DATABASE_MISMATCH');
  const ready = await fetch(new URL('/api/v1/health/ready', api), { redirect: 'error', signal: AbortSignal.timeout(5000) });
  requireThat(ready.status === 200, 'ISOLATED_API_NOT_READY'); await ready.arrayBuffer();
  mark('fixed isolated runtime verified');

  phase = 'private cookie and CSRF login';
  const credentials = JSON.parse(await readFile(resolve(runtime, 'credentials.json'), 'utf8'));
  requireThat(typeof credentials.email === 'string' && typeof credentials.password === 'string', 'PRIVATE_CREDENTIAL_SHAPE_INVALID');
  const login = await fetch(new URL('/api/v1/auth/login', api), { method: 'POST', redirect: 'error',
    headers: { 'content-type': 'application/json', 'x-requested-with': 'XMLHttpRequest' }, body: JSON.stringify(credentials), signal: AbortSignal.timeout(15_000) });
  requireThat(login.status === 200, 'PRIVATE_LOGIN_FAILED');
  const cookies = login.headers.getSetCookie().map(value => value.split(';')[0]);
  cookie = cookies.join('; '); const csrfCookie = cookies.find(value => value.startsWith('csrf_token='));
  requireThat(Boolean(csrfCookie) && cookies.some(value => value.startsWith('access_token=')), 'LOGIN_COOKIE_MISSING');
  csrf = decodeURIComponent(csrfCookie.slice('csrf_token='.length)); await login.arrayBuffer(); loggedIn = true;
  actorId = id((await request('resolve current isolated actor', '/auth/me')).id, 'ACTOR');

  phase = 'verify existing owned READY fallback';
  const prior = JSON.parse(await readFile(resolve(runtime, 'live-fallback-preparation-runtime-evidence.json'), 'utf8'));
  preparation = prior.preparations?.find(value => value.state === 'READY');
  requireThat(Boolean(preparation), 'READY_PREPARATION_EVIDENCE_REQUIRED');
  id(preparation.preparation_id, 'PREPARATION'); id(preparation.presentation_id, 'PRESENTATION');
  const [owned] = (await pool.query(`SELECT p.name,p.description,p.created_by,f.state,f.source_fingerprint,f.presentation_id
    FROM live_fallback_preparations f JOIN presentations p ON p.id=f.presentation_id WHERE f.id=$1`, [preparation.preparation_id])).rows;
  requireThat(owned?.name.startsWith('Live Immutable Fallback Probe ') && owned.description === preparationOwner && owned.created_by === actorId &&
    owned.state === 'READY' && owned.presentation_id === preparation.presentation_id && owned.source_fingerprint === preparation.source_fingerprint,
    'REFUSED_NONOWNED_OR_CHANGED_FALLBACK');
  const baseline = JSON.parse(await readFile(resolve(runtime, 'baseline-fixtures.json'), 'utf8'));
  requireThat(baseline.api_base === api.origin, 'BASELINE_FIXTURE_ORIGIN_MISMATCH');
  const expectedMedia = ['normal', 'document', 'video'].map(kind => id(baseline[`${kind}_media_id`], 'BASELINE_MEDIA')).sort();
  const prepared = await request('read existing owned READY preparation', `/live-fallback-preparations/${preparation.preparation_id}`);
  requireThat(prepared.state === 'READY' && prepared.manifest.presentation.id === preparation.presentation_id &&
    digest(prepared.manifest.assets.map(asset => asset.media_id).sort()) === digest(expectedMedia), 'PREPARED_FIXTURE_GRAPH_CHANGED');
  evidence.preparation = { preparation_id: preparation.preparation_id, presentation_id: preparation.presentation_id,
    source_fingerprint: preparation.source_fingerprint, manifest_sha256: digest(prepared.manifest) }; await persist();

  phase = 'insert only two new unpaired OFFLINE fixture screens';
  const screenX = randomUUID(), screenY = randomUUID(); requireThat(![screenX, screenY].includes(protectedScreen), 'PROTECTED_SCREEN_COLLISION');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const [screen, suffix] of [[screenX, 'X'], [screenY, 'Y']]) await client.query(`INSERT INTO screens(id,name,status,aspect_ratio,width,height,device_info,screenshot_enabled)
      VALUES($1,$2,'OFFLINE','16:9',1920,1080,$3,false)`, [screen, `${prefix} ${suffix}`, { fixture_owner: owner, fixture_run: runId,
      player_capabilities: { features: ['live_broadcast_v1', 'pdf_page_selection_v1'] }, codecs: ['h264'] }]);
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  evidence.ids.screens.push(screenX, screenY); await persist(); mark('created two own offline screens without pairing');

  phase = 'create own source and group through REST';
  source = await request('create own reusable live source', '/live-sessions', { method: 'POST', expected: 201, body: {
    name: `${prefix} Source`, description: owner, presenter_user_id: actorId, microphone: false, screen_share_audio: false, is_active: true,
  } }); id(source.id, 'SOURCE'); evidence.ids.source = source.id; await persist();
  group = await request('create own GroupA with X', '/screen-groups', { method: 'POST', expected: 201,
    body: { name: `${prefix} GroupA`, description: owner, screen_ids: [ownScreen(screenX)] } });
  id(group.id, 'GROUP'); evidence.ids.group = group.id; await persist();

  phase = 'publish frozen authored group audience';
  const grouped = await createSchedule('Grouped A', { groupId: group.id }), publicationA = await publishDirect(grouped, screenX);
  const groupBefore = await request('read authored-group publication', `/screen-groups/${group.id}/snapshot?include_urls=true`);
  await verifyDownloads('group before membership replacement', groupBefore, publicationA, screenX);
  requireThat(digest(publicationA.policy.screen_group_ids) === digest([group.id]), 'AUTHORED_GROUP_PROVENANCE_MISSING');
  const groupTarget = (await pool.query('SELECT resolved_screen_ids FROM publish_targets WHERE publish_id=$1 AND screen_group_id=$2',
    [publicationA.publish_id, group.id])).rows;
  requireThat(groupTarget.length === 1 && digest(groupTarget[0].resolved_screen_ids) === digest([screenX]), 'AUTHORED_GROUP_PUBLISH_TARGET_MISSING');

  phase = 'replace group membership and separately publish direct Y';
  const replacement = await request('replace own group member X with Y', `/screen-groups/${group.id}`, { method: 'PATCH', body: { screen_ids: [ownScreen(screenY)] } });
  requireThat(digest(replacement.screen_ids) === digest([screenY]), 'GROUP_MEMBERSHIP_REPLACEMENT_FAILED');
  const directY = await createSchedule('Direct Y', { screenId: screenY }), publicationB = await publishDirect(directY, screenY);
  const groupAfter = await request('read historical group after replacement', `/screen-groups/${group.id}/snapshot?include_urls=true`);
  await verifyDownloads('group after membership replacement', groupAfter, publicationA, screenX);
  requireThat(digest(groupAfter.screen_ids) === digest([screenY]), 'GROUP_CURRENT_MEMBERSHIP_NOT_DYNAMIC');
  for (const [screen, publication, label] of [[screenX, publicationA, 'removed X retains frozen A'], [screenY, publicationB, 'Y receives only direct B']]) {
    const response = await request(label, `/screens/${ownScreen(screen)}/snapshot?include_urls=true`);
    await verifyDownloads(label, response, publication, screen);
  }
  mark('group history and concrete screen delivery remain independently frozen');

  phase = 'reject referenced deletion without mutating owned records';
  await blockedDelete('reject referenced source deletion', `/live-sessions/${source.id}`, { expected_revision: source.revision }, 'LIVE_SESSION_IN_USE');
  await blockedDelete('reject immutable-audience X deletion', `/screens/${ownScreen(screenX)}`, undefined, 'SCREEN_IN_USE');
  await blockedDelete('reject referenced group deletion', `/screen-groups/${group.id}`, undefined, 'SCREEN_GROUP_IN_USE');

  phase = 'take down both own direct publications';
  await takeDownDirect(publicationA); await takeDownDirect(publicationB); await persist();

  phase = 'request create approve publish and idempotent retries';
  const queued = await createSchedule('Request X', { screenId: screenX });
  const scheduleRequest = await request('create own live approval request', '/schedule-requests', { method: 'POST', expected: 201, body: {
    schedule_id: queued.id, notes: owner, fallback_preparation_ids: { [preparation.presentation_id]: preparation.preparation_id },
  } });
  id(scheduleRequest.id, 'REQUEST'); requests.add(scheduleRequest.id); evidence.ids.requests.push(scheduleRequest.id); await persist();
  requireThat(scheduleRequest.status === 'PENDING' && scheduleRequest.live_approval?.items?.length === 1, 'REQUEST_DID_NOT_FREEZE_REVIEW');
  await verifyRequestReservations(scheduleRequest.id, queued.id, 'HELD', 'PENDING');
  const approved = await request('approve own live request', `/schedule-requests/${scheduleRequest.id}/approve`, { method: 'POST', body: { comment: owner } });
  requireThat(approved.status === 'APPROVED' && digest(approved.live_approval) === digest(scheduleRequest.live_approval), 'APPROVAL_CHANGED_FROZEN_REVIEW');
  await verifyRequestReservations(scheduleRequest.id, queued.id, 'RESERVED', 'APPROVED');
  const published = await request('publish own approved request', `/schedule-requests/${scheduleRequest.id}/publish`, { method: 'POST', body: {} });
  const publicationC = { schedule_id: queued.id, publish_id: id(published.publish_id, 'PUBLISH'), snapshot_id: id(published.snapshot_id, 'SNAPSHOT') };
  publications.set(publicationC.publish_id, publicationC); evidence.ids.publications.push(publicationC); await persist();
  await verifyRequestReservations(scheduleRequest.id, queued.id, 'PUBLISHED', 'PUBLISHED');
  const frozenRequestSnapshot = await ownedSnapshot(publicationC), frozenHash = digest(frozenRequestSnapshot.payload);
  requireThat(digest(frozenRequestSnapshot.payload.schedule.items[0].live_policy) === digest(scheduleRequest.live_approval.items[0]), 'REQUEST_SNAPSHOT_CHANGED_REVIEW');

  phase = 'edit future source policy without changing existing publication';
  source = await request('edit own future source policy', `/live-sessions/${source.id}`, { method: 'PATCH', body: { expected_revision: source.revision, microphone: true } });
  requireThat(source.microphone === true && source.policy_revision > scheduleRequest.live_approval.items[0].policy_revision, 'SOURCE_POLICY_REVISION_NOT_CHANGED');
  for (const [path, body] of [[`/schedule-requests/${scheduleRequest.id}/publish`, {}], [`/schedules/${queued.id}/publish`, { schedule_request_id: scheduleRequest.id }]]) {
    const retry = await request('retry existing publication after source policy edit', path, { method: 'POST', body });
    requireThat(retry.publish_id === publicationC.publish_id && retry.snapshot_id === publicationC.snapshot_id, 'IDEMPOTENT_RETRY_CREATED_DIFFERENT_PUBLICATION');
  }
  requireThat(digest((await ownedSnapshot(publicationC)).payload) === frozenHash, 'FROZEN_PUBLICATION_CHANGED_AFTER_SOURCE_EDIT');
  const requestDelivery = await request('read request snapshot after future source edit', `/screens/${ownScreen(screenX)}/snapshot?include_urls=true`);
  await verifyDownloads('request delivery after source policy edit', requestDelivery,
    { ...publicationC, policy: scheduleRequest.live_approval.items[0] }, screenX);
  const rows = (await pool.query('SELECT id FROM publishes WHERE schedule_id=$1', [queued.id])).rows;
  requireThat(rows.length === 1 && rows[0].id === publicationC.publish_id, 'DUPLICATE_REQUEST_PUBLICATION');
  mark('both retry endpoints preserve exact publication and approved policy', performance.now(), { snapshot_sha256: frozenHash });

  phase = 'take down own request and preserve history';
  const taken = await request('take down own published request', `/schedule-requests/${scheduleRequest.id}/take-down`, { method: 'POST', body: { reason: owner } });
  requireThat(taken.status === 'TAKEN_DOWN', 'REQUEST_TAKEDOWN_FAILED'); await verifyReleased(publicationC);
  evidence.status = 'PASS'; evidence.finished_at = new Date().toISOString(); await persist();
} catch (error) {
  evidence.status = 'FAIL'; evidence.failed_phase = phase;
  evidence.failure_code = /^[A-Z0-9_]+$/.test(error?.safeCode ?? error?.code ?? '') ? error.safeCode ?? error.code : 'UNCLASSIFIED_FAILURE';
  process.exitCode = 1;
} finally {
  if (verifiedRuntime && loggedIn && pool) {
    // No hard cleanup: terminate only this invocation's own future authority.
    // Recover a committed publish whose HTTP response was interrupted via its
    // exact own schedule/actor identity, never by a global or broad date query.
    try {
      for (const scheduleId of schedules) {
        const rows = (await pool.query('SELECT id,snapshot_id FROM publishes WHERE schedule_id=$1 AND published_by=$2 AND status=$3', [scheduleId, actorId, 'ACTIVE'])).rows;
        for (const row of rows) publications.set(row.id, { schedule_id: scheduleId, publish_id: row.id, snapshot_id: row.snapshot_id });
      }
      for (const requestId of requests) {
        const current = await request('read own final request status', `/schedule-requests/${requestId}`);
        requireThat(schedules.has(current.schedule_id) && current.requested_by === actorId, 'REFUSED_NONOWNED_REQUEST_CLEANUP');
        if (current.status === 'PUBLISHED') await request('terminate own request after interrupted probe', `/schedule-requests/${requestId}/take-down`, { method: 'POST', body: { reason: owner } });
        else if (['PENDING', 'APPROVED'].includes(current.status)) await request('cancel own incomplete probe request', `/schedule-requests/${requestId}/cancel`, { method: 'POST', body: {} });
      }
      for (const publication of publications.values()) {
        const [current] = (await pool.query('SELECT status FROM publishes WHERE id=$1', [publication.publish_id])).rows;
        if (current?.status === 'ACTIVE') await takeDownDirect(publication);
      }
      evidence.own_authority_cleanup = 'COMPLETE_HISTORY_PRESERVED';
    } catch { evidence.own_authority_cleanup = 'INCOMPLETE_REVIEW_OWN_IDS'; process.exitCode = 1; evidence.status = 'FAIL'; }
    try {
      await request('logout only this probe session', '/auth/logout', { method: 'POST', body: {} });
      await request('confirm own session revoked', '/auth/me', { expected: 401 });
      evidence.own_session_logout = 'REVOKED';
    } catch { evidence.own_session_logout = 'UNCONFIRMED'; process.exitCode = 1; evidence.status = 'FAIL'; }
  }
  await pool?.end();
  evidence.finished_at = new Date().toISOString();
  // Without the explicit storage guard, do not write or mutate any runtime.
  if (verifiedRuntime) await persist();
  console.log(JSON.stringify({ status: evidence.status, run_id: runId, checks: evidence.checks.length, verified_downloads: evidence.downloads.length,
    ...(evidence.failed_phase ? { failed_phase: evidence.failed_phase, failure_code: evidence.failure_code } : {}),
    ...(verifiedRuntime ? { evidence_file: '.local/live-broadcast/live-publication-runtime-evidence.json' } : {}) }));
}
