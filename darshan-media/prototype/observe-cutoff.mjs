import { readFile, mkdir, open } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { randomUUID } from 'node:crypto';
import { RoomServiceClient, TrackSource, TrackType } from 'livekit-server-sdk';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const localRoot = path.join(repo, '.local');
const opaqueId = (value) => typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,128}$/.test(value);
const fail = (code) => { throw Object.assign(new Error(code), { safeCode: code }); };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function parseArguments(argv) {
  const accepted = new Set(['admission-id', 'presenter-identity', 'presenter-admission-id', 'env-file', 'receiver-config', 'output']);
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--self-test') { args.selfTest = true; continue; }
    const key = argv[index].replace(/^--/, '');
    if (!argv[index].startsWith('--') || !accepted.has(key) || !argv[index + 1] || argv[index + 1].startsWith('--') || key in args) fail('INVALID_ARGUMENTS');
    args[key] = argv[++index];
  }
  for (const key of ['admission-id', 'presenter-identity', 'presenter-admission-id']) if (args[key] && !opaqueId(args[key])) fail('INVALID_ID');
  return args;
}

export function parsePrivateEnv(text) {
  const env = {};
  for (let line of text.split(/\r?\n/)) {
    line = line.trim();
    if (!line || line.startsWith('#')) continue;
    const match = /^(?:export\s+)?([A-Z_][A-Z_0-9]*)=(.*)$/.exec(line);
    if (!match) fail('INVALID_PRIVATE_CONFIG');
    let value = match[2];
    if (value.startsWith('"')) { try { value = JSON.parse(value); } catch { fail('INVALID_PRIVATE_CONFIG'); } }
    else if (value.startsWith("'")) {
      if (!value.endsWith("'") || value.length < 2) fail('INVALID_PRIVATE_CONFIG');
      value = value.slice(1, -1);
    }
    if (typeof value !== 'string') fail('INVALID_PRIVATE_CONFIG');
    env[match[1]] = value;
  }
  return env;
}

function localUrl(value) {
  let url;
  try { url = new URL(value); } catch { fail('INVALID_LOOPBACK_ENDPOINT'); }
  if (!['http:', 'https:'].includes(url.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.username || url.password || url.search || url.hash) fail('INVALID_LOOPBACK_ENDPOINT');
  return url;
}

export function parseAuthority(value) {
  if (!value || !opaqueId(value.admission_id) || !opaqueId(value.run_id) || !Number.isSafeInteger(value.generation) || value.generation < 1 ||
    !['IDLE', 'ISSUED', 'CONNECTING', 'CONNECTED', 'REMOVING', 'REVOKED'].includes(value.state) ||
    !Number.isSafeInteger(value.lease_ms) || value.lease_ms < 0 || value.lease_ms > 10_000 ||
    !Number.isSafeInteger(value.requested_lease_ms) || value.requested_lease_ms < 1 || value.requested_lease_ms > 10_000) fail('INVALID_AUTHORITY_RESPONSE');
  // Deliberately copy a strict field allowlist; never persist arbitrary API response data.
  return { admission_id: value.admission_id, run_id: value.run_id, generation: value.generation,
    state: value.state, lease_ms: value.lease_ms, requested_lease_ms: value.requested_lease_ms };
}

export function updateDeadline(previous, authority, before, after) {
  if (after < before || !Number.isFinite(before) || !Number.isFinite(after)) fail('INVALID_SAMPLE_CLOCK');
  // lease_ms is floored by the controller. The server sampled it during this request.
  if (authority.lease_ms === 0) return previous; // Clamped zero cannot reveal a historical deadline.
  const lower = before + authority.lease_ms;
  const upper = after + authority.lease_ms + 1;
  if (!previous || lower > previous.upper) return { lower, upper, requested: authority.requested_lease_ms, renewals: (previous?.renewals ?? -1) + 1 };
  if (upper < previous.lower) return { lower, upper, requested: authority.requested_lease_ms, renewals: previous.renewals }; // Window shortened.
  return { lower: Math.max(previous.lower, lower), upper: Math.min(previous.upper, upper), requested: authority.requested_lease_ms, renewals: previous.renewals };
}

export function cutoffResult(deadline, absentAt) {
  if (!deadline || !Number.isFinite(absentAt)) return { proven: false, reason: 'MISSING_AUTHORITY_OR_ABSENCE_EVIDENCE' };
  const fromAuthorityUpper = absentAt - (deadline.lower - deadline.requested);
  return {
    proven: absentAt <= deadline.lower && fromAuthorityUpper <= 10_000,
    absence_after_last_authority_upper_ms: Math.ceil(fromAuthorityUpper),
    absence_vs_full_deadline_upper_ms: Math.ceil(absentAt - deadline.lower),
    authority_deadline_uncertainty_ms: Math.ceil(deadline.upper - deadline.lower),
    observed_renewals: deadline.renewals,
  };
}

async function jsonGet(url, headers) {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(700), redirect: 'error', cache: 'no-store' });
  if (!response.ok) fail(`CONTROL_HTTP_${response.status}`);
  return response.json();
}

export async function observe(args, notify = (value) => process.stdout.write(`${JSON.stringify(value)}\n`)) {
  const envPath = path.resolve(args['env-file'] ?? path.join(localRoot, 'live-broadcast/media/node.env'));
  const receiverPath = path.resolve(args['receiver-config'] ?? path.join(localRoot, 'live-broadcast/receiver.json'));
  const env = parsePrivateEnv(await readFile(envPath, 'utf8'));
  const receiver = JSON.parse(await readFile(receiverPath, 'utf8'));
  const secret = env.DARSHAN_MEDIA_CONTROL_SECRET_FILE
    ? (await readFile(env.DARSHAN_MEDIA_CONTROL_SECRET_FILE, 'utf8')).trim()
    : env.DARSHAN_MEDIA_CONTROL_SECRET;
  if (typeof secret !== 'string' || secret.length < 32 || !env.LIVEKIT_API_KEY || !env.LIVEKIT_API_SECRET || typeof receiver.renewal_token !== 'string') fail('MISSING_PRIVATE_CONFIGURATION');
  const controlHost = env.DARSHAN_MEDIA_CONTROL_HOST === '::1' ? '[::1]' : (env.DARSHAN_MEDIA_CONTROL_HOST ?? '127.0.0.1');
  const control = localUrl(`http://${controlHost}:${env.DARSHAN_MEDIA_CONTROL_PORT ?? '18784'}`);
  const sfuUrl = localUrl(env.DARSHAN_MEDIA_SFU_URL ?? 'http://127.0.0.1:18781');
  const authorityUrl = localUrl(receiver.authority_url);
  const status = await jsonGet(new URL('/prototype/status', authorityUrl), { authorization: `Bearer ${receiver.renewal_token}` });
  if (status.stopped || !opaqueId(status.run_id)) fail('NO_RUNNING_PROTOTYPE');
  const presenterIdentity = args['presenter-identity'] ?? status.presenter_identity;
  const presenterId = args['presenter-admission-id'] ?? status.presenter_admission_id;
  const receiverId = args['admission-id'] ?? status.receiver_admission_id;
  if (![presenterIdentity, presenterId, receiverId].every(opaqueId)) fail('PRESENTER_AND_RECEIVER_ADMISSION_IDS_REQUIRED');
  if ((status.presenter_identity && status.presenter_identity !== presenterIdentity) ||
    (status.presenter_admission_id && status.presenter_admission_id !== presenterId) ||
    (status.receiver_admission_id && status.receiver_admission_id !== receiverId)) fail('STALE_OBSERVER_IDENTITIES');
  const rooms = new RoomServiceClient(sfuUrl.toString(), env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET, { requestTimeout: 0.7, failover: false });
  let chosen;
  for (const room of (await rooms.listRooms()).filter((item) => item.name.startsWith('darshan-'))) {
    const participants = await rooms.listParticipants(room.name);
    if (participants.some((participant) => participant.identity === presenterIdentity)) {
      if (chosen) fail('AMBIGUOUS_PRESENTER_ROOM');
      chosen = { room, participants };
    }
  }
  if (!chosen) fail('PRESENTER_NOT_PRESENT_AT_SFU');
  const publisher = chosen.participants.find((participant) => participant.identity === presenterIdentity);
  if (!publisher.tracks.some((track) => track.source === TrackSource.SCREEN_SHARE && track.type === TrackType.VIDEO && !track.muted)) fail('NO_LIVE_SCREEN_SHARE_TRACK');
  const receivers = chosen.participants.filter((participant) => participant.identity !== presenterIdentity && participant.permission?.canSubscribe && !participant.permission?.canPublish);
  if (receivers.length !== 1) fail('AMBIGUOUS_RECEIVER_IDENTITY');
  const targets = {
    presenter: { admissionId: presenterId, identity: presenterIdentity },
    receiver: { admissionId: receiverId, identity: receivers[0].identity },
  };
  const output = path.resolve(args.output ?? path.join(localRoot, 'live-broadcast', `cutoff-observer-${Date.now()}-${randomUUID()}.jsonl`));
  if (!output.startsWith(`${localRoot}${path.sep}`)) fail('OUTPUT_MUST_BE_UNDER_LOCAL');
  await mkdir(path.dirname(output), { recursive: true, mode: 0o700 });
  const file = await open(output, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  const started = performance.now();
  let samples = 0;
  let final;
  const record = async (value) => file.write(`${JSON.stringify({ elapsed_ms: Math.floor(performance.now() - started), ...value })}\n`);
  const sampleAuthority = async (target) => {
    const before = performance.now();
    const raw = await jsonGet(new URL(`/internal/admissions/${encodeURIComponent(target.admissionId)}`, control), { 'x-darshan-media-secret': secret });
    const after = performance.now();
    const value = parseAuthority(raw);
    if (value.admission_id !== target.admissionId || value.run_id !== status.run_id) fail('AUTHORITY_IDENTITY_CHANGED');
    const prior = target.deadline;
    target.deadline = updateDeadline(prior, value, before, after);
    const changed = !prior || prior.renewals !== target.deadline?.renewals || target.state !== value.state;
    target.state = value.state;
    if (changed) await record({ event: 'authority', role: target.role, state: value.state, lease_remaining_ms: value.lease_ms,
      deadline_from_start_lower_ms: target.deadline ? Math.floor(target.deadline.lower - started) : null,
      deadline_from_start_upper_ms: target.deadline ? Math.ceil(target.deadline.upper - started) : null });
  };
  for (const [role, target] of Object.entries(targets)) target.role = role;
  try {
    await Promise.all(Object.values(targets).map(sampleAuthority));
    if (Object.values(targets).some((target) => target.state !== 'CONNECTED' || !target.deadline)) fail('ADMISSIONS_NOT_CONNECTED');
    const ready = { event: 'ready', started_at: new Date().toISOString(), run_id: status.run_id, room: chosen.room.name,
      presenter_admission_id: presenterId, receiver_admission_id: receiverId,
      evidence_file: path.relative(repo, output), timeout_ms: 30_000, polling_interval_ms: 100 };
    await record(ready);
    notify(ready);
    while (performance.now() - started < 30_000) {
      const tick = performance.now();
      for (const target of Object.values(targets).filter((item) => item.absentAt === undefined)) {
        try { await sampleAuthority(target); }
        catch (error) { target.controlError = error.safeCode ?? 'CONTROL_UNAVAILABLE'; }
      }
      let participants;
      try { participants = await rooms.listParticipants(chosen.room.name); }
      catch (error) {
        if (error?.code === 'not_found') participants = [];
        else { await record({ event: 'sfu_query_unavailable' }); await sleep(100); continue; }
      }
      const checkedAt = performance.now();
      samples += 1;
      for (const target of Object.values(targets)) {
        if (target.absentAt === undefined && !participants.some((participant) => participant.identity === target.identity)) {
          target.absentAt = checkedAt;
          await record({ event: 'sfu_participant_absent', role: target.role, ...cutoffResult(target.deadline, checkedAt) });
        }
      }
      if (Object.values(targets).every((target) => target.absentAt !== undefined)) break;
      await sleep(Math.max(0, 100 - (performance.now() - tick)));
    }
    const results = Object.fromEntries(Object.entries(targets).map(([role, target]) => [role, {
      ...cutoffResult(target.deadline, target.absentAt),
      last_control_state: target.state, last_control_error: target.controlError ?? null,
      absence_observed_after_ready_ms: target.absentAt === undefined ? null : Math.ceil(target.absentAt - started),
    }]));
    let sameRun = false;
    try {
      const finalStatus = await jsonGet(new URL('/prototype/status', authorityUrl), { authorization: `Bearer ${receiver.renewal_token}` });
      sameRun = finalStatus.run_id === status.run_id;
    } catch { /* Cannot prove a stable test target without the final status. */ }
    final = { event: 'result', status: sameRun && Object.values(results).every((item) => item.proven) ? 'PASS_SFU_CUTOFF' : 'FAIL_OR_UNPROVEN',
      same_run_confirmed: sameRun,
      samples, results, evidence_file: path.relative(repo, output),
      evidence_scope: 'SFU participant absence against observed full authority deadlines; player display/audio require separate runtime evidence' };
    await record(final);
    notify(final);
  } finally { await file.close(); }
  return final;
}

async function selfTest() {
  const assert = (await import('node:assert/strict')).default;
  assert.deepEqual(parseArguments(['--admission-id', 'opaque-receiver', '--presenter-identity', 'opaque-presenter']), { 'admission-id': 'opaque-receiver', 'presenter-identity': 'opaque-presenter' });
  assert.throws(() => parseArguments(['--admission-id', 'https://secret?token=x']), /INVALID_ID/);
  assert.throws(() => parseArguments(['--output']), /INVALID_ARGUMENTS/);
  assert.deepEqual(parsePrivateEnv('# ignored\nA="space value"\nexport B=literal$()\nC=\'single value\'\n'), { A: 'space value', B: 'literal$()', C: 'single value' });
  const state = parseAuthority({ admission_id: 'a', run_id: 'r', generation: 1, state: 'CONNECTED', lease_ms: 9000, requested_lease_ms: 10_000, ticket: 'must-never-copy' });
  assert.equal('ticket' in state, false);
  assert.throws(() => parseAuthority({ ...state, lease_ms: -1 }), /INVALID_AUTHORITY_RESPONSE/);
  const initial = updateDeadline(undefined, state, 100, 102);
  assert.deepEqual(initial, { lower: 9100, upper: 9103, requested: 10_000, renewals: 0 });
  const same = updateDeadline(initial, { ...state, lease_ms: 8900 }, 200, 201);
  assert.equal(same.lower, 9100);
  assert.equal(same.upper, 9102);
  assert.equal(updateDeadline(same, { ...state, lease_ms: 0 }, 20_000, 20_001), same);
  const renewed = updateDeadline(same, { ...state, lease_ms: 10_000 }, 3000, 3001);
  assert.equal(renewed.renewals, 1);
  assert.equal(cutoffResult(same, 9099).proven, true);
  assert.equal(cutoffResult(same, 9101).proven, false);
  assert.equal(cutoffResult(undefined, 0).proven, false);
  assert.equal(cutoffResult(same, undefined).proven, false);
  assert.throws(() => localUrl('http://192.0.2.1:18784'), /INVALID_LOOPBACK_ENDPOINT/);
  process.stdout.write('Cutoff observer parser/deadline self-tests passed\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = parseArguments(process.argv.slice(2));
    if (args.selfTest) await selfTest();
    else {
      const result = await observe(args);
      if (result.status !== 'PASS_SFU_CUTOFF') process.exitCode = 1;
    }
  } catch (error) {
    // SDK/network exceptions may contain credentials or query URLs. Never print them.
    process.stderr.write(`${JSON.stringify({ event: 'observer_failed', code: error.safeCode ?? 'OBSERVER_OPERATION_FAILED' })}\n`);
    process.exitCode = 1;
  }
}
