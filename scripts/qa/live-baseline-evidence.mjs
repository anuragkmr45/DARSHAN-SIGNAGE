#!/usr/bin/env node
/**
 * Capture support evidence for the fixed isolated baseline player only.
 * No schedule publication, emergency mutation, cleanup or configuration changes.
 * node scripts/qa/live-baseline-evidence.mjs --capture-ordinary
 * To recover a completed helper-owned capture without issuing another command:
 * add --resume-command-id=<uuid>.
 * Private inputs: .local/live-broadcast/{credentials.json,backend.env}
 * PNG/metadata output stays under ignored .local/live-broadcast/evidence.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const runtime = resolve(repo, '.local/live-broadcast');
const screenId = '7be1093c-cd8d-488c-9f48-bd6971e9565f';
const api = 'http://127.0.0.1:18120';
const bucket = 'device-screenshots';
let stage = 'configuration validation';

async function main() {
  assert(process.argv.includes('--capture-ordinary'), 'Supply --capture-ordinary');
  assert(!process.env.LIVE_BASELINE_API_URL || process.env.LIVE_BASELINE_API_URL === api, 'Only isolated API port18120 is accepted');
  const requireServer = createRequire(resolve(repo, 'darshan-server/package.json'));
  const { parse } = requireServer('dotenv');
  const { S3Client, GetObjectCommand } = requireServer('@aws-sdk/client-s3');
  const backendPath = resolve(runtime, 'backend.env');
  const credentialsPath = resolve(runtime, 'credentials.json');
  for (const path of [backendPath, credentialsPath]) assert.equal((await stat(path)).mode & 0o077, 0, 'Private input permissions must be0600');
  const backend = parse(await readFile(backendPath));
  const db = new URL(backend.DATABASE_URL);
  assert.equal(db.pathname, '/darshan_live_20261103_test', 'Only isolated live test database is accepted');
  assert(['127.0.0.1', 'localhost', '[::1]'].includes(db.hostname), 'Database must be loopback');
  const rawEndpoint = backend.MINIO_ENDPOINT;
  assert(typeof rawEndpoint === 'string' && rawEndpoint.length, 'Isolated MinIO endpoint is required');
  const endpoint = new URL(rawEndpoint.includes('://') ? rawEndpoint : `http://${rawEndpoint}`);
  if (!endpoint.port && backend.MINIO_PORT) endpoint.port = backend.MINIO_PORT;
  assert.equal(endpoint.protocol, 'http:', 'Only the isolated loopback MinIO HTTP endpoint is accepted');
  assert(['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname) && endpoint.port === '59100', 'Only isolated MinIO port59100 is accepted');
  assert(!endpoint.username && !endpoint.password, 'MinIO URL must not contain credentials');
  assert(backend.MINIO_ACCESS_KEY && backend.MINIO_SECRET_KEY, 'Private MinIO credentials are required');
  // Check the fixed running feature container as well as its private env file.
  // The inspect output is secret-bearing, remains in memory and is never logged.
  const inspection = spawnSync('docker', ['--context', 'default', 'inspect', 'darshan-live-api-20261103', '--format', '{{json .Config.Env}}'], { encoding: 'utf8' });
  assert.equal(inspection.status, 0, 'Isolated feature API container must be inspectable');
  const runningEnv = Object.fromEntries(JSON.parse(inspection.stdout).map((value) => {
    const separator = value.indexOf('='); return [value.slice(0, separator), value.slice(separator + 1)];
  }));
  for (const key of ['DATABASE_URL', 'MINIO_ENDPOINT', 'MINIO_PORT'])
    assert(runningEnv[key] === backend[key], 'Running feature API storage configuration differs from private isolated config');
  const fixtures = JSON.parse(await readFile(resolve(runtime, 'baseline-fixtures.json'), 'utf8'));
  assert.equal(fixtures.api_base, api, 'Fixture manifest belongs to another API');
  assert.equal(fixtures.screen_id, screenId, 'Fixture manifest must identify the fixed baseline player');
  assert(fixtures.normal_media_id, 'Normal fixture media is required');
  const credentials = JSON.parse(await readFile(credentialsPath, 'utf8'));

  stage = 'isolated administrator login';
  const response = await fetch(`${api}/api/v1/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-requested-with': 'XMLHttpRequest' }, body: JSON.stringify(credentials),
  });
  assert.equal(response.status, 200, 'Isolated login failed');
  const cookies = response.headers.getSetCookie().map((value) => value.split(';')[0]);
  const cookie = cookies.join('; '), csrf = cookies.find((value) => value.startsWith('csrf_token='))?.slice('csrf_token='.length);
  assert(csrf, 'CSRF cookie missing');
  await response.arrayBuffer(); // Discard credentials/token-bearing login body.
  async function request(path, { method = 'GET', body } = {}) {
    const result = await fetch(`${api}/api/v1${path}`, {
      method, headers: { cookie, 'x-requested-with': 'XMLHttpRequest', ...(method === 'GET' ? {} : { 'x-csrf-token': decodeURIComponent(csrf), 'content-type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    assert(result.ok, `Isolated API request failed HTTP${result.status}`);
    const payload = await result.json();
    return payload?.success === true && payload.data !== undefined ? payload.data : payload;
  }
  const wait = (ms) => new Promise((done) => setTimeout(done, ms));
  stage = 'ordinary playback readiness after CMS clear';
  let state, delivery;
  const readyDeadline = Date.now() + 60_000;
  while (Date.now() < readyDeadline) {
    delivery = await request(`/screens/${screenId}/delivery-status?limit=50`);
    state = await request(`/screens/${screenId}/status?include_media=false&include_preview=false`);
    const reportedMedia = [state.current_media_id, state.playback?.current_media_id, ...(state.active_slots ?? []).map((slot) => slot.media_id)];
    if (!delivery.emergency?.active && reportedMedia.includes(fixtures.normal_media_id)) break;
    await wait(1000);
  }
  assert(!delivery.emergency?.active, 'Emergency still active; use CMS to clear before ordinary evidence');
  assert.equal(state.name, 'Live Loop Baseline Player', 'API screen must be the named isolated baseline player');
  assert([state.current_media_id, state.playback?.current_media_id, ...(state.active_slots ?? []).map((slot) => slot.media_id)].includes(fixtures.normal_media_id), 'Ordinary fixture is not the currently reported media');

  // The ordinary player throttles commands of the same type for60s. Respect
  // its existing policy rather than enqueueing a screenshot burst after the
  // operator's emergency screenshot. A concurrent operator command may still
  // win; that failure is reported rather than mislabeled as captured evidence.
  const resumeId = process.argv.find((value) => value.startsWith('--resume-command-id='))?.split('=')[1];
  assert(!resumeId || /^[0-9a-f-]{36}$/.test(resumeId), 'Resume command ID must be UUID');
  let requestedAt = new Date().toISOString(), trigger;
  if (resumeId) trigger = { screen_id: screenId, command_id: resumeId };
  else {
    stage = 'existing screenshot command cooldown';
    const recentBefore = await request(`/screens/${screenId}/commands/recent?limit=100`);
    const lastScreenshot = recentBefore.commands
      .filter((item) => item.type === 'TAKE_SCREENSHOT' && ['COMPLETED', 'ACKED_SUCCESS'].includes(item.status))
      .map((item) => Date.parse(item.completed_at ?? item.acknowledged_at ?? item.created_at))
      .filter(Number.isFinite).sort((a, b) => b - a)[0];
    const eligibleAt = lastScreenshot === undefined ? Date.now() : lastScreenshot + 61_000;
    assert(eligibleAt - Date.now() <= 65_000, 'Unexpected future screenshot timestamp');
    while (Date.now() < eligibleAt) await wait(Math.min(1000, eligibleAt - Date.now()));
    requestedAt = new Date().toISOString();
    trigger = await request(`/screens/${screenId}/screenshot`, { method: 'POST', body: { reason: 'LIVE_LOOP0_ORDINARY_EVIDENCE_AFTER_CMS_CLEAR' } });
    assert.equal(trigger.screen_id, screenId);
  }
  stage = 'exact screenshot command completion';
  assert(typeof trigger.command_id === 'string', 'Screenshot command ID missing');
  let command;
  const commandDeadline = Date.now() + 120_000;
  while (Date.now() < commandDeadline) {
    const recent = await request(`/screens/${screenId}/commands/recent?limit=100`);
    command = recent.commands.find((item) => item.id === trigger.command_id);
    if (command && ['COMPLETED', 'ACKED_SUCCESS'].includes(command.status)) break;
    if (command && ['FAILED', 'ACKED_FAILURE', 'EXPIRED', 'DEAD_LETTER', 'CANCELLED'].includes(command.status)) {
      throw Object.assign(new Error('Exact screenshot command failed'), {
        code: String(command.last_error).includes('Rate limited') ? 'SCREENSHOT_RATE_LIMITED' : 'SCREENSHOT_COMMAND_FAILED',
      });
    }
    await wait(1000);
  }
  assert(command && ['COMPLETED', 'ACKED_SUCCESS'].includes(command.status), 'Exact screenshot command did not complete');
  assert.equal(command.type, 'TAKE_SCREENSHOT', 'Unexpected command type');
  assert.equal(command.payload?.reason, 'LIVE_LOOP0_ORDINARY_EVIDENCE_AFTER_CMS_CLEAR', 'Resume only this evidence helper own screenshot command');
  if (resumeId) requestedAt = command.created_at;
  const payload = command.result_payload;
  const objectKey = payload?.result_payload?.objectKey ?? payload?.data?.objectKey ?? payload?.result?.data?.objectKey ?? payload?.objectKey;
  assert(typeof objectKey === 'string' && objectKey.startsWith(`device-screenshots/${screenId}/`), 'Screenshot result must reference this player only');

  stage = 'exact private screenshot object download';
  const storage = new S3Client({ endpoint: endpoint.origin, region: 'us-east-1', forcePathStyle: true,
    credentials: { accessKeyId: backend.MINIO_ACCESS_KEY, secretAccessKey: backend.MINIO_SECRET_KEY } });
  let bytes;
  try {
    const downloadDeadline = Date.now() + 45_000;
    while (Date.now() < downloadDeadline) {
      try {
        const object = await storage.send(new GetObjectCommand({ Bucket: bucket, Key: objectKey }));
        bytes = Buffer.from(await object.Body.transformToByteArray());
        break;
      } catch (error) {
        if (!['NoSuchKey', 'NotFound'].includes(error.name)) throw error;
        await wait(1000); // Telemetry may be queued after the command ACK.
      }
    }
  } finally { storage.destroy(); }
  assert(bytes?.length > 0, 'Exact screenshot object not persisted before deadline');
  assert(bytes.length < 20 * 1024 * 1024, 'Unexpected screenshot size');
  stage = 'private PNG evidence publication';
  const outputDir = resolve(runtime, 'evidence'); await mkdir(outputDir, { recursive: true, mode: 0o700 });
  const stem = `baseline-normal-after-clear-${Date.now()}-${trigger.command_id}`;
  const pngPath = resolve(outputDir, `${stem}.png`), metadataPath = resolve(outputDir, `${stem}.json`);
  const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (bytes.subarray(0, 8).equals(pngSignature)) await writeFile(pngPath, bytes, { mode: 0o600, flag: 'wx' });
  else {
    const sourcePath = resolve(outputDir, `${stem}.capture`);
    await writeFile(sourcePath, bytes, { mode: 0o600, flag: 'wx' });
    const conversion = spawnSync('python3', ['-c', 'from PIL import Image; import sys,os; im=Image.open(sys.argv[1]); im.convert("RGB").save(sys.argv[2],format="PNG"); os.chmod(sys.argv[2],0o600)', sourcePath, pngPath], { encoding: 'utf8' });
    assert.equal(conversion.status, 0, 'Screenshot PNG conversion failed');
  }
  const png = await readFile(pngPath);
  assert(png.subarray(0, 8).equals(pngSignature), 'Output is not PNG');
  const metadata = { status: 'captured_not_visually_verified', screen_id: screenId, command_id: trigger.command_id,
    requested_at: requestedAt, completed_at: command.completed_at ?? command.acknowledged_at ?? null,
    collected_at: new Date().toISOString(), command_status: command.status, current_media_id: fixtures.normal_media_id,
    emergency_active_before_capture: false, sha256: createHash('sha256').update(png).digest('hex'), bytes: png.length,
    png_path: pngPath, scope: 'support evidence for real CMS baseline; no schedule or emergency mutation' };
  await writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  console.log(JSON.stringify({ ...metadata, metadata_path: metadataPath }, null, 2));
}

main().catch((error) => {
  // Do not output the backend env, credentials, command payload, signed URL,
  // S3 error request or raw response body, even on a failed collection.
  console.error(JSON.stringify({ status: 'collection_failed', stage, code: error.code ?? error.name ?? 'ERROR',
    ...(error.code === 'ERR_ASSERTION' ? { reason: error.message.split('\n')[0] } : {}) }));
  process.exitCode = 1;
});
