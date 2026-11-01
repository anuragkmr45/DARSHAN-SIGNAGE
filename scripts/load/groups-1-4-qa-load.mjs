#!/usr/bin/env node

import { createHash, createPrivateKey, createPublicKey, createSign, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { createWriteStream, lstatSync, realpathSync, statSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { once } from 'node:events';
import { isIP } from 'node:net';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ACK_PREFIX = 'I_ACKNOWLEDGE_DESTRUCTIVE_QA_LOAD_ON_';
const API_PREFIX = '/api/v1';
const MAX_EVIDENCE_BODY_BYTES = 1024 * 1024;
const DEVICE_SIGNATURE_PREFIX = 'DARSHAN_DEVICE_AUTH_V1';
const DEVICE_SOCKET_SIGNATURE_PREFIX = 'DARSHAN_DEVICE_SOCKET_AUTH_V1';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function integer(value, name, min, max) {
  assert(Number.isInteger(value) && value >= min && value <= max, `${name} must be an integer from ${min} to ${max}`);
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function percentile(sorted, fraction) {
  if (sorted.length === 0) return null;
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
}

function privateIpv4(hostname) {
  if (isIP(hostname) !== 4) return false;
  const [a, b] = hostname.split('.').map(Number);
  return a === 10 || a === 127 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31);
}

function productionLooking(url, environment) {
  const host = url.hostname.toLowerCase();
  const qaNamed = /(^|[.-])(qa|test|staging|stage|dev)([.-]|$)/.test(host);
  const safeNamed = host === 'localhost' || host.endsWith('.test') || host.endsWith('.internal');
  return environment !== 'qa' || /(^|[.-])prod(uction)?([.-]|$)/.test(host) || (!privateIpv4(host) && !safeNamed && !qaNamed);
}

function rejectEmbeddedCredentials(value, trail = 'config') {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    assert(!/(token|password|secret|credential|serial|authorization)/i.test(key), `${trail}.${key} may not embed credentials`);
    rejectEmbeddedCredentials(child, `${trail}.${key}`);
  }
}

export function validateConfig(config) {
  assert(config && typeof config === 'object' && !Array.isArray(config), 'config must be a JSON object');
  rejectEmbeddedCredentials(config);
  assert(config.environment === 'qa', 'environment must be "qa"');
  const baseUrl = new URL(config.baseUrl);
  assert(baseUrl.pathname === '/' || baseUrl.pathname === '', 'baseUrl must not include an API path');
  assert(baseUrl.protocol === 'https:' || (baseUrl.protocol === 'http:' && ['localhost', '127.0.0.1', '::1'].includes(baseUrl.hostname)), 'non-loopback QA targets require HTTPS');
  assert(!baseUrl.username && !baseUrl.password, 'baseUrl must not contain credentials');
  assert(['packet4-release-gate-v1', 'site-capacity-v1'].includes(config.profile), 'profile must be packet4-release-gate-v1 or site-capacity-v1');
  integer(config.baseline?.players, 'baseline.players', 1, 1000);
  integer(config.baseline?.durationSeconds, 'baseline.durationSeconds', 1, 86400);
  integer(config.spike?.players, 'spike.players', config.baseline.players, 2000);
  integer(config.spike?.durationSeconds, 'spike.durationSeconds', 1, 3600);
  if (config.profile === 'packet4-release-gate-v1') {
    assert(config.baseline.players === 500, 'packet4 release-gate baseline must use exactly 500 players');
    assert(config.spike.players === 1000 && config.spike.durationSeconds === 300, 'packet4 release-gate spike must use exactly 1000 players for 300 seconds');
  } else {
    integer(config.capacity?.maximumExpectedPlayers, 'capacity.maximumExpectedPlayers', 1, 1000);
    integer(config.capacity?.temporarySpikePlayers, 'capacity.temporarySpikePlayers', config.capacity.maximumExpectedPlayers, 2000);
    assert(config.baseline.players === config.capacity.maximumExpectedPlayers, 'site-capacity baseline.players must equal capacity.maximumExpectedPlayers');
    assert(config.spike.players === config.capacity.temporarySpikePlayers, 'site-capacity spike.players must equal capacity.temporarySpikePlayers');
    assert(config.spike.durationSeconds === 300, 'site-capacity spike must run for exactly 300 seconds');
  }
  for (const [key, min, max] of [
    ['heartbeatSeconds', 5, 300], ['commandPollSeconds', 1, 300],
    ['desiredStateSeconds', 5, 600], ['playbackTransitionSeconds', 1, 3600],
  ]) integer(config.intervals?.[key], `intervals.${key}`, min, max);
  integer(config.requestTimeoutMs, 'requestTimeoutMs', 1000, 120000);
  integer(config.maxInflight, 'maxInflight', 10, 5000);
  assert(config.realtime?.enabled === true, 'release-gate realtime connections must be enabled');
  const realtimeUrl = new URL(config.realtime.url);
  assert(realtimeUrl.protocol === 'https:' || (realtimeUrl.protocol === 'http:' && ['localhost', '127.0.0.1', '::1'].includes(realtimeUrl.hostname)), 'non-loopback realtime targets require HTTPS');
  assert(realtimeUrl.pathname === '/' && !realtimeUrl.username && !realtimeUrl.password, 'realtime.url must be a credential-free origin');
  assert(realtimeUrl.origin === baseUrl.origin, 'realtime.url must use the acknowledged QA API origin');
  assert(config.realtime.namespace === '/device', 'realtime.namespace must be /device');
  integer(config.realtime.connectTimeoutMs, 'realtime.connectTimeoutMs', 1000, 120000);
  integer(config.cms?.users, 'cms.users', 1, 100);
  assert(config.cms.users === 40, 'release-gate CMS load must use exactly 40 users');
  integer(config.cms.intervalSeconds, 'cms.intervalSeconds', 1, 300);
  assert(Array.isArray(config.cms.flows) && config.cms.flows.length > 0, 'cms.flows must not be empty');
  for (const [index, flow] of config.cms.flows.entries()) {
    assert(flow.method === 'GET', `cms.flows[${index}] must be a read-only GET`);
    assert(typeof flow.path === 'string' && flow.path.startsWith(`${API_PREFIX}/`), `cms.flows[${index}].path must stay under ${API_PREFIX}`);
  }
  assert(config.uploads?.concurrency === 5, 'release-gate upload concurrency must be exactly 5');
  assert(config.uploads?.sizeBytes === 500 * 1024 * 1024, 'release-gate uploads must be exactly 500 MiB each');
  assert(config.uploads?.contentType === 'video/mp4', 'uploads.contentType must be video/mp4');
  integer(config.uploads.partConcurrency, 'uploads.partConcurrency', 1, 5);
  assert(typeof config.outputDirectory === 'string' && path.isAbsolute(config.outputDirectory), 'outputDirectory must be an absolute path');
  const backlog = config.backlog;
  integer(backlog?.players, 'backlog.players', 1, config.baseline.players);
  integer(backlog?.offlineStartSeconds, 'backlog.offlineStartSeconds', 0, config.baseline.durationSeconds - 1);
  integer(backlog?.offlineDurationSeconds, 'backlog.offlineDurationSeconds', 1, config.baseline.durationSeconds);
  assert(backlog.offlineStartSeconds + backlog.offlineDurationSeconds < config.baseline.durationSeconds, 'backlog recovery window must finish during baseline');
  if (config.proxyScenario?.enabled) {
    assert(['trusted', 'untrusted'].includes(config.proxyScenario.mode), 'proxyScenario.mode must be trusted or untrusted');
    assert(config.proxyScenario.headerName === 'x-forwarded-for', 'only x-forwarded-for is supported');
  }
  if (config.fanout?.enabled) {
    assert(['baseline', 'spike'].includes(config.fanout.phase), 'fanout.phase must be baseline or spike');
    assert(config.fanout.method === 'POST', 'fanout.method must be POST');
    assert(typeof config.fanout.path === 'string' && config.fanout.path.startsWith(`${API_PREFIX}/`), 'fanout.path must stay under the API prefix');
    integer(config.fanout.cmsUserIndex, 'fanout.cmsUserIndex', 0, config.cms.users - 1);
    integer(config.fanout.expectedRecipients, 'fanout.expectedRecipients', 1, config.spike.players);
    assert(config.fanout.expectedRecipients === config[config.fanout.phase].players, 'fanout.expectedRecipients must equal the selected phase player count');
    assert(!config.fanout.path.includes('/qa/preprovisioned-fanout-trigger'), 'replace the example fanout path before enabling it');
  }
  for (const [index, probe] of (config.resourceProbes ?? []).entries()) {
    assert(typeof probe.name === 'string' && probe.name.length > 0, `resourceProbes[${index}].name is required`);
    const probeUrl = new URL(probe.url, baseUrl);
    assert(probeUrl.origin === baseUrl.origin, `resourceProbes[${index}] must use the QA target origin`);
    assert(!probeUrl.username && !probeUrl.password, `resourceProbes[${index}] may not contain credentials`);
    assert(probe.auth === 'none' || /^cms:\d+$/.test(probe.auth), `resourceProbes[${index}].auth is invalid`);
    integer(probe.intervalSeconds, `resourceProbes[${index}].intervalSeconds`, 5, 3600);
  }
  return { ...config, normalizedBaseUrl: baseUrl.origin, targetLooksProduction: productionLooking(baseUrl, config.environment) };
}

export function validateCredentialManifest(manifest, config) {
  assert(manifest && typeof manifest === 'object', 'credential manifest must be a JSON object');
  assert(Array.isArray(manifest.players) && manifest.players.length >= config.spike.players, `credential manifest requires at least ${config.spike.players} players`);
  assert(Array.isArray(manifest.cmsUsers) && manifest.cmsUsers.length >= config.cms.users, `credential manifest requires at least ${config.cms.users} CMS users`);
  const playerIds = new Set(); const identityValues = new Set(); const forwardedValues = new Set();
  for (const [index, player] of manifest.players.slice(0, config.spike.players).entries()) {
    for (const key of ['deviceId', 'serial', 'privateKeyPath', 'mediaId', 'scheduleId']) assert(typeof player[key] === 'string' && player[key].length > 0, `players[${index}].${key} is required`);
    for (const key of ['deviceId', 'mediaId', 'scheduleId']) assert(UUID_PATTERN.test(player[key]), `players[${index}].${key} must be a UUID`);
    assert(!playerIds.has(player.deviceId), `duplicate player deviceId at players[${index}]`);
    playerIds.add(player.deviceId);
    assert(!identityValues.has(player.serial), `duplicate player serial at players[${index}]`);
    identityValues.add(player.serial);
    if (config.proxyScenario?.enabled) {
      assert(typeof player.forwardedFor === 'string' && isIP(player.forwardedFor) !== 0, `players[${index}].forwardedFor is required`);
      assert(!forwardedValues.has(player.forwardedFor), `duplicate forwardedFor at players[${index}]`);
      forwardedValues.add(player.forwardedFor);
    }
  }
  const accessTokens = new Set();
  for (const [index, user] of manifest.cmsUsers.slice(0, config.cms.users).entries()) {
    assert(typeof user.accessToken === 'string' && user.accessToken.length >= 20, `cmsUsers[${index}].accessToken is required`);
    assert(!accessTokens.has(user.accessToken), `duplicate CMS access token at cmsUsers[${index}]`);
    accessTokens.add(user.accessToken);
    if (config.proxyScenario?.enabled) {
      assert(typeof user.forwardedFor === 'string' && isIP(user.forwardedFor) !== 0, `cmsUsers[${index}].forwardedFor is required`);
      assert(!forwardedValues.has(user.forwardedFor), `duplicate forwardedFor at cmsUsers[${index}]`);
      forwardedValues.add(user.forwardedFor);
    }
  }
  return manifest;
}

export function buildDryRunPlan(config, manifest) {
  const baselineTransitions = Math.floor(config.baseline.durationSeconds / config.intervals.playbackTransitionSeconds) * config.baseline.players;
  const spikeTransitions = Math.floor(config.spike.durationSeconds / config.intervals.playbackTransitionSeconds) * config.spike.players;
  return {
    status: 'DRY_RUN_ONLY',
    target: config.normalizedBaseUrl,
    production_looking: config.targetLooksProduction,
    credential_counts: { players: manifest.players.length, cms_users: manifest.cmsUsers.length },
    device_key_set_sha256: sha256(manifest.players.map((player) => player.keyFingerprint).sort().join('\n')),
    phases: [config.baseline, config.spike],
    required_release_shape: {
      profile: config.profile,
      baseline_players: config.baseline.players,
      spike_players: config.spike.players,
      spike_seconds: config.spike.durationSeconds,
      cms_users: config.cms.users,
      uploads: config.uploads.concurrency,
      upload_bytes_each: config.uploads.sizeBytes,
    },
    realtime: { enabled: true, namespace: config.realtime.namespace, target: config.realtime.url },
    projected_pop_events_minimum: baselineTransitions + spikeTransitions,
    proxy_scenario: config.proxyScenario,
    fanout_enabled: Boolean(config.fanout?.enabled),
    remote_resource_probes: (config.resourceProbes ?? []).map(({ name, url, intervalSeconds }) => ({ name, url, intervalSeconds })),
    note: 'No requests were sent and no release gate was evaluated.',
  };
}

class Semaphore {
  constructor(limit) { this.limit = limit; this.active = 0; this.waiters = []; }
  async use(fn) {
    if (this.active >= this.limit) await new Promise((resolve) => this.waiters.push(resolve));
    this.active += 1;
    try { return await fn(); }
    finally { this.active -= 1; this.waiters.shift()?.(); }
  }
}

class Evidence {
  constructor(stream) { this.stream = stream; this.operations = new Map(); this.phases = new Map(); this.commandDevices = new Set(); this.realtimeCommandDevices = new Set(); this.commandIds = new Set(); this.ackedCommandIds = new Set(); this.popAttempted = 0; this.popSucceeded = 0; this.rateLimited = 0; this.backlogRecovered = new Map(); }
  record(event) {
    this.stream.write(`${JSON.stringify(event)}\n`);
    const bucket = this.operations.get(event.operation) ?? { durations: [], total: 0, errors: 0, statuses: {} };
    bucket.total += 1;
    bucket.durations.push(event.duration_ms);
    if (!event.ok) bucket.errors += 1;
    bucket.statuses[event.status] = (bucket.statuses[event.status] ?? 0) + 1;
    if (event.status === 429) this.rateLimited += 1;
    this.operations.set(event.operation, bucket);
    const phaseBucket = this.phases.get(event.phase ?? 'unphased') ?? { durations: [], total: 0, errors: 0, statuses: {} };
    phaseBucket.total += 1; phaseBucket.durations.push(event.duration_ms);
    if (!event.ok) phaseBucket.errors += 1;
    phaseBucket.statuses[event.status] = (phaseBucket.statuses[event.status] ?? 0) + 1;
    this.phases.set(event.phase ?? 'unphased', phaseBucket);
  }
  summary() {
    const summarize = (bucket) => {
      const sorted = [...bucket.durations].sort((a, b) => a - b);
      return { total: bucket.total, errors: bucket.errors, error_rate: bucket.total ? bucket.errors / bucket.total : 0, p50_ms: percentile(sorted, .5), p95_ms: percentile(sorted, .95), p99_ms: percentile(sorted, .99), statuses: bucket.statuses };
    };
    const byOperation = {}; const byPhase = {};
    const overall = { durations: [], total: 0, errors: 0, statuses: {} };
    const overallApi = { durations: [], total: 0, errors: 0, statuses: {} };
    for (const [name, bucket] of this.operations) {
      byOperation[name] = summarize(bucket); overall.durations.push(...bucket.durations); overall.total += bucket.total; overall.errors += bucket.errors;
      for (const [status, count] of Object.entries(bucket.statuses)) overall.statuses[status] = (overall.statuses[status] ?? 0) + count;
      if (!name.startsWith('realtime_') && !name.startsWith('resource:') && name !== 'upload_part') {
        overallApi.durations.push(...bucket.durations); overallApi.total += bucket.total; overallApi.errors += bucket.errors;
        for (const [status, count] of Object.entries(bucket.statuses)) overallApi.statuses[status] = (overallApi.statuses[status] ?? 0) + count;
      }
    }
    for (const [name, bucket] of this.phases) byPhase[name] = summarize(bucket);
    return { overall_all_requests: summarize(overall), overall_api: summarize(overallApi), by_operation: byOperation, by_phase: byPhase };
  }
}

export function buildDeviceSignaturePayload(method, rawPathAndQuery, deviceId, timestamp) {
  return [DEVICE_SIGNATURE_PREFIX, method.trim().toUpperCase(), rawPathAndQuery.trim(), deviceId.trim(), timestamp.trim()].join('\n');
}

export function signDeviceRequest(privateKeyPem, method, rawPathAndQuery, deviceId, timestamp) {
  const signer = createSign('RSA-SHA256');
  signer.update(buildDeviceSignaturePayload(method, rawPathAndQuery, deviceId, timestamp));
  signer.end();
  return signer.sign(privateKeyPem, 'base64');
}

export function buildDeviceSocketAuth(player, timestamp = Date.now().toString(), nonce = randomUUID().replaceAll('-', '')) {
  const payload = [DEVICE_SOCKET_SIGNATURE_PREFIX, 'CONNECT', '/device', player.deviceId, player.serial, timestamp, nonce].join('\n');
  const signer = createSign('RSA-SHA256'); signer.update(payload); signer.end();
  return { device_id: player.deviceId, device_serial: player.serial, auth_version: 'v1', auth_timestamp: timestamp, auth_nonce: nonce, auth_signature: signer.sign(player.privateKeyPem, 'base64') };
}

export function buildCommandAcknowledgement(command, processedAt = new Date().toISOString()) {
  assert(typeof command?.delivery_token === 'string' && command.delivery_token.length > 0, 'claimed command is missing delivery_token');
  return { delivery_token: command.delivery_token, success: true, processed_at: processedAt };
}

export function buildSignedDeviceHeaders(subject, config, method, pathOrUrl) {
  const target = new URL(pathOrUrl, config.normalizedBaseUrl);
  assert(target.origin === config.normalizedBaseUrl, 'device requests must stay on the QA API origin');
  const rawPathAndQuery = `${target.pathname}${target.search}`;
  const timestamp = Date.now().toString();
  const headers = {
    'x-device-serial': subject.serial,
    'x-device-auth-version': 'v1',
    'x-device-timestamp': timestamp,
    'x-device-signature': signDeviceRequest(subject.privateKeyPem, method, rawPathAndQuery, subject.deviceId, timestamp),
  };
  if (config.proxyScenario?.enabled) headers[config.proxyScenario.headerName] = subject.forwardedFor;
  return headers;
}

function cmsHeaders(subject, config) {
  const headers = { authorization: `Bearer ${subject.accessToken}` };
  if (config.proxyScenario?.enabled) headers[config.proxyScenario.headerName] = subject.forwardedFor;
  return headers;
}

async function zeroSha256(size) {
  const hash = createHash('sha256');
  const chunk = Buffer.alloc(1024 * 1024);
  for (let remaining = size; remaining > 0; remaining -= chunk.length) hash.update(chunk.subarray(0, Math.min(chunk.length, remaining)));
  return hash.digest('hex');
}

class Runner {
  constructor(config, manifest, evidence, resourceStream, socketIo) {
    this.config = config; this.manifest = manifest; this.evidence = evidence; this.resourceStream = resourceStream;
    this.semaphore = new Semaphore(config.maxInflight); this.pending = new Set(); this.abort = new AbortController();
    this.startedAt = Date.now(); this.generatorSamples = []; this.uploadChecksum = null; this.socketIo = socketIo; this.sockets = new Map(); this.closingSockets = false; this.plannedOffline = new Set();
  }
  track(promise) { this.pending.add(promise); promise.then(() => this.pending.delete(promise), () => this.pending.delete(promise)); return promise; }
  async request(operation, pathOrUrl, options = {}, meta = {}) {
    return this.semaphore.use(async () => {
      const started = performance.now();
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.config.requestTimeoutMs);
      let status = 0; let body = ''; let response;
      try {
        response = await fetch(new URL(pathOrUrl, this.config.normalizedBaseUrl), { ...options, signal: controller.signal });
        status = response.status; body = await response.text();
        this.evidence.record({ timestamp: new Date().toISOString(), operation, status, ok: response.ok, duration_ms: Math.round((performance.now() - started) * 100) / 100, ...meta });
        return { response, status, body, json: () => body ? JSON.parse(body) : {} };
      } catch (error) {
        this.evidence.record({ timestamp: new Date().toISOString(), operation, status, ok: false, duration_ms: Math.round((performance.now() - started) * 100) / 100, error: error?.name ?? 'Error', ...meta });
        return { response: null, status, body, error };
      } finally { clearTimeout(timeout); }
    });
  }
  processCommands(player, result, phase, source) {
    if (!result.response?.ok) return;
    let commands = [];
    try { commands = result.json().commands ?? []; } catch { return; }
    for (const command of commands) {
      if (!command?.id || this.evidence.commandIds.has(`${player.deviceId}:${command.id}`)) continue;
      this.evidence.commandIds.add(`${player.deviceId}:${command.id}`); this.evidence.commandDevices.add(player.deviceId);
      const ackPath = `${API_PREFIX}/device/${player.deviceId}/commands/${command.id}/ack`;
      const headers = { ...buildSignedDeviceHeaders(player, this.config, 'POST', ackPath), 'content-type': 'application/json' };
      let acknowledgement;
      try { acknowledgement = buildCommandAcknowledgement(command); }
      catch (error) {
        this.evidence.record({ timestamp: new Date().toISOString(), operation: 'command_ack', status: 0, ok: false, duration_ms: 0, error: error.message, phase, device_id: player.deviceId, command_id: command.id, source });
        continue;
      }
      const body = JSON.stringify(acknowledgement);
      const key = `${player.deviceId}:${command.id}`;
      this.track(this.request('command_ack', ackPath, { method: 'POST', headers, body }, { phase, device_id: player.deviceId, command_id: command.id, source }).then((ack) => { if (ack.response?.ok) this.evidence.ackedCommandIds.add(key); }));
    }
  }
  heartbeat(player, phase) {
    const requestPath = `${API_PREFIX}/device/heartbeat`;
    const result = this.request('heartbeat', requestPath, { method: 'POST', headers: { ...buildSignedDeviceHeaders(player, this.config, 'POST', requestPath), 'content-type': 'application/json' }, body: JSON.stringify({ device_id: player.deviceId, status: 'ONLINE', uptime: Math.floor(process.uptime()), memory_usage: 30, cpu_usage: 20, current_schedule_id: player.scheduleId, current_media_id: player.mediaId, app_version: 'qa-load-generator' }) }, { phase, device_id: player.deviceId });
    return result.then((value) => { this.processCommands(player, value, phase, 'heartbeat'); return Boolean(value.response?.ok); });
  }
  commands(player, phase) {
    const requestPath = `${API_PREFIX}/device/${player.deviceId}/commands`;
    const result = this.request('commands', requestPath, { headers: buildSignedDeviceHeaders(player, this.config, 'GET', requestPath) }, { phase, device_id: player.deviceId });
    return result.then((value) => { this.processCommands(player, value, phase, 'poll'); return Boolean(value.response?.ok); });
  }
  desiredState(player, phase) {
    const requestPath = `${API_PREFIX}/device/${player.deviceId}/desired-state`;
    return this.request('desired_state', requestPath, { headers: buildSignedDeviceHeaders(player, this.config, 'GET', requestPath) }, { phase, device_id: player.deviceId });
  }
  pop(player, phase) {
    const end = new Date(); const duration = this.config.intervals.playbackTransitionSeconds; const start = new Date(end.getTime() - duration * 1000);
    this.evidence.popAttempted += 1;
    const requestPath = `${API_PREFIX}/device/proof-of-play`;
    return this.request('proof_of_play', requestPath, { method: 'POST', headers: { ...buildSignedDeviceHeaders(player, this.config, 'POST', requestPath), 'content-type': 'application/json' }, body: JSON.stringify({ device_id: player.deviceId, media_id: player.mediaId, schedule_id: player.scheduleId, playback_instance_id: randomUUID(), start_time: start.toISOString(), end_time: end.toISOString(), duration, completed: true }) }, { phase, device_id: player.deviceId }).then((result) => { if (result.response?.ok) this.evidence.popSucceeded += 1; });
  }
  cms(user, flow, phase, index) { return this.request(`cms:${flow.name}`, flow.path, { headers: cmsHeaders(user, this.config) }, { phase, cms_user: index }); }
  async triggerFanout(phase) {
    if (!this.config.fanout?.enabled || this.config.fanout.phase !== phase) return;
    const user = this.manifest.cmsUsers[this.config.fanout.cmsUserIndex];
    const result = await this.request('fanout_trigger', this.config.fanout.path, { method: 'POST', headers: { ...cmsHeaders(user, this.config), 'content-type': 'application/json' }, body: JSON.stringify(this.config.fanout.body ?? {}) }, { phase });
    if (!result.response?.ok) throw new Error(`fanout trigger failed with HTTP ${result.status}`);
  }
  async connectRealtimePlayer(player, phase) {
    const started = performance.now();
    const extraHeaders = this.config.proxyScenario?.enabled ? { [this.config.proxyScenario.headerName]: player.forwardedFor } : {};
    const socket = this.socketIo(`${this.config.realtime.url}${this.config.realtime.namespace}`, {
      transports: ['websocket'], timeout: this.config.realtime.connectTimeoutMs, reconnection: true,
      reconnectionAttempts: 10, auth: (callback) => callback(buildDeviceSocketAuth(player)), extraHeaders,
    });
    this.sockets.set(player.deviceId, socket);
    socket.on('HELLO_ACK', () => this.evidence.record({ timestamp: new Date().toISOString(), operation: 'realtime_hello_ack', status: 200, ok: true, duration_ms: 0, phase, device_id: player.deviceId }));
    socket.on('COMMAND_AVAILABLE', () => {
      this.evidence.realtimeCommandDevices.add(player.deviceId);
      this.evidence.record({ timestamp: new Date().toISOString(), operation: 'realtime_command_notification', status: 200, ok: true, duration_ms: 0, phase, device_id: player.deviceId });
      this.track(this.commands(player, phase));
    });
    socket.on('RESYNC_REQUIRED', () => {
      this.evidence.record({ timestamp: new Date().toISOString(), operation: 'realtime_resync_notification', status: 200, ok: true, duration_ms: 0, phase, device_id: player.deviceId });
      this.track(this.desiredState(player, phase));
    });
    socket.on('disconnect', (reason) => {
      if (!this.closingSockets && !this.plannedOffline.has(player.deviceId)) this.evidence.record({ timestamp: new Date().toISOString(), operation: 'realtime_disconnect', status: 0, ok: false, duration_ms: 0, phase, device_id: player.deviceId, reason });
    });
    socket.on('connect', () => socket.emit('HELLO', { type: 'HELLO', protocol_version: '1.0', device_id: player.deviceId, session_id: `qa-load-${randomUUID()}`, app: { version: 'qa-load-generator' }, platform: { family: 'qa-load' }, capabilities: { commands: ['REFRESH', 'RESYNC'], offline_startup: true, background_push: true } }));
    await new Promise((resolve) => {
      let settled = false; let lastError = 'connect_timeout';
      const finish = (ok, error) => {
        if (settled) return; settled = true; clearTimeout(timer);
        this.evidence.record({ timestamp: new Date().toISOString(), operation: 'realtime_connect', status: ok ? 200 : 0, ok, duration_ms: Math.round((performance.now() - started) * 100) / 100, phase, device_id: player.deviceId, ...(error ? { error } : {}) });
        resolve();
      };
      const timer = setTimeout(() => finish(false, lastError), this.config.realtime.connectTimeoutMs);
      socket.once('connect', () => finish(true));
      socket.on('connect_error', (error) => { lastError = error?.name ?? 'connect_error'; });
    });
  }
  async ensureRealtimeConnections(count, phase) {
    const missing = this.manifest.players.slice(0, count).filter((player) => !this.sockets.has(player.deviceId));
    for (let offset = 0; offset < missing.length; offset += 100) await Promise.all(missing.slice(offset, offset + 100).map((player) => this.connectRealtimePlayer(player, phase)));
  }
  disconnectRealtime() {
    this.closingSockets = true;
    for (const socket of this.sockets.values()) socket.disconnect();
    this.sockets.clear();
  }
  async sampleResources(phase, elapsed) {
    const memory = process.memoryUsage(); const usage = process.resourceUsage();
    const sample = { timestamp: new Date().toISOString(), phase, elapsed_seconds: Math.floor(elapsed), generator: { rss_bytes: memory.rss, heap_used_bytes: memory.heapUsed, user_cpu_micros: usage.userCPUTime, system_cpu_micros: usage.systemCPUTime } };
    this.generatorSamples.push(sample); this.resourceStream.write(`${JSON.stringify(sample)}\n`);
    for (const probe of this.config.resourceProbes ?? []) {
      if (Math.floor(elapsed) % probe.intervalSeconds !== 0) continue;
      const headers = probe.auth === 'none' ? {} : cmsHeaders(this.manifest.cmsUsers[Number(probe.auth.split(':')[1])], this.config);
      const result = await this.request(`resource:${probe.name}`, probe.url, { headers }, { phase });
      this.resourceStream.write(`${JSON.stringify({ timestamp: new Date().toISOString(), phase, probe: probe.name, status: result.status, body: result.body.slice(0, MAX_EVIDENCE_BODY_BYTES), truncated: result.body.length > MAX_EVIDENCE_BODY_BYTES })}\n`);
    }
  }
  async runPhase(name, phase, withUploads = false) {
    const players = this.manifest.players.slice(0, phase.players); const users = this.manifest.cmsUsers.slice(0, this.config.cms.users);
    await this.ensureRealtimeConnections(phase.players, name);
    if (withUploads) {
      this.uploadChecksum ??= zeroSha256(this.config.uploads.sizeBytes);
      await this.uploadChecksum;
    }
    const now = Date.now();
    const state = players.map((_, index) => ({ heartbeat: now + (index % this.config.intervals.heartbeatSeconds) * 1000, commands: now + (index % this.config.intervals.commandPollSeconds) * 1000, desired: now + (index % this.config.intervals.desiredStateSeconds) * 1000, pop: now + (index % this.config.intervals.playbackTransitionSeconds) * 1000 }));
    const cmsNext = users.map((_, index) => now + (index % this.config.cms.intervalSeconds) * 1000);
    const phaseStart = Date.now(); const phaseEnd = phaseStart + phase.durationSeconds * 1000;
    const recoveryStart = phaseStart + (this.config.backlog.offlineStartSeconds + this.config.backlog.offlineDurationSeconds) * 1000;
    await this.triggerFanout(name);
    const uploadPromise = withUploads ? Promise.all(Array.from({ length: this.config.uploads.concurrency }, (_, index) => this.upload(index))) : Promise.resolve();
    let nextResource = phaseStart;
    let backlogDisconnected = false; let backlogReconnected = false;
    while (Date.now() < phaseEnd) {
      const current = Date.now(); const elapsed = (current - phaseStart) / 1000;
      if (name === 'baseline' && !backlogDisconnected && elapsed >= this.config.backlog.offlineStartSeconds) {
        backlogDisconnected = true;
        for (const player of players.slice(0, this.config.backlog.players)) {
          this.plannedOffline.add(player.deviceId); this.sockets.get(player.deviceId)?.disconnect(); this.sockets.delete(player.deviceId);
        }
      }
      if (name === 'baseline' && backlogDisconnected && !backlogReconnected && current >= recoveryStart) {
        backlogReconnected = true;
        for (const player of players.slice(0, this.config.backlog.players)) this.plannedOffline.delete(player.deviceId);
        await this.ensureRealtimeConnections(this.config.backlog.players, name);
      }
      for (let index = 0; index < players.length; index += 1) {
        const player = players[index]; const timer = state[index];
        const offline = name === 'baseline' && index < this.config.backlog.players && elapsed >= this.config.backlog.offlineStartSeconds && elapsed < this.config.backlog.offlineStartSeconds + this.config.backlog.offlineDurationSeconds;
        if (offline) continue;
        const recovering = name === 'baseline' && index < this.config.backlog.players && current >= recoveryStart && !this.evidence.backlogRecovered.has(player.deviceId);
        if (current >= timer.heartbeat) {
          timer.heartbeat += this.config.intervals.heartbeatSeconds * 1000;
          this.track(this.heartbeat(player, name).then((ok) => { if (ok && recovering && !this.evidence.backlogRecovered.has(player.deviceId)) this.evidence.backlogRecovered.set(player.deviceId, Date.now() - recoveryStart); }));
        }
        if (current >= timer.commands) {
          timer.commands += this.config.intervals.commandPollSeconds * 1000;
          this.track(this.commands(player, name).then((ok) => { if (ok && recovering && !this.evidence.backlogRecovered.has(player.deviceId)) this.evidence.backlogRecovered.set(player.deviceId, Date.now() - recoveryStart); }));
        }
        if (current >= timer.desired) { timer.desired += this.config.intervals.desiredStateSeconds * 1000; this.track(this.desiredState(player, name)); }
        if (current >= timer.pop) { timer.pop += this.config.intervals.playbackTransitionSeconds * 1000; this.track(this.pop(player, name)); }
      }
      for (let index = 0; index < users.length; index += 1) if (current >= cmsNext[index]) {
        cmsNext[index] += this.config.cms.intervalSeconds * 1000;
        const flow = this.config.cms.flows[index % this.config.cms.flows.length]; this.track(this.cms(users[index], flow, name, index));
      }
      if (current >= nextResource) { nextResource += 1000; this.track(this.sampleResources(name, elapsed)); }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    await uploadPromise;
    while (this.pending.size > 0) await Promise.allSettled([...this.pending]);
  }
  async upload(index) {
    const user = this.manifest.cmsUsers[index]; const headers = cmsHeaders(user, this.config); const size = this.config.uploads.sizeBytes;
    this.uploadChecksum ??= zeroSha256(size);
    const checksum = await this.uploadChecksum;
    const create = await this.request('upload_create', `${API_PREFIX}/media/uploads`, { method: 'POST', headers: { ...headers, 'content-type': 'application/json', 'idempotency-key': `packet4-${randomUUID()}` }, body: JSON.stringify({ filename: `packet4-load-${index}.mp4`, display_name: `Packet 4 QA load ${index}`, content_type: this.config.uploads.contentType, size, checksum_sha256: checksum }) }, { upload: index });
    if (!create.response?.ok) return;
    const session = create.json(); assert(session.strategy === 'multipart', '500 MiB upload did not receive multipart strategy');
    const partNumbers = Array.from({ length: session.part_count }, (_, partIndex) => partIndex + 1); const signed = [];
    for (let offset = 0; offset < partNumbers.length; offset += 20) {
      const presign = await this.request('upload_presign', `${API_PREFIX}/media/uploads/${session.session_id}/parts/presign`, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ part_numbers: partNumbers.slice(offset, offset + 20) }) }, { upload: index });
      if (!presign.response?.ok) return; signed.push(...presign.json().parts);
    }
    const chunk = Buffer.alloc(session.part_size); const parts = [];
    for (let offset = 0; offset < signed.length; offset += this.config.uploads.partConcurrency) {
      const batch = signed.slice(offset, offset + this.config.uploads.partConcurrency);
      const uploaded = await Promise.all(batch.map(async (part) => {
        const remaining = size - (part.part_number - 1) * session.part_size; const body = chunk.subarray(0, Math.min(chunk.length, remaining));
        const result = await this.request('upload_part', part.upload_url, { method: 'PUT', body }, { upload: index, part: part.part_number });
        if (!result.response?.ok) throw new Error(`upload ${index} part ${part.part_number} failed`);
        const etag = result.response.headers.get('etag'); assert(etag, `upload ${index} part ${part.part_number} did not expose an ETag`);
        return { part_number: part.part_number, etag };
      })); parts.push(...uploaded);
    }
    await this.request('upload_complete', `${API_PREFIX}/media/uploads/${session.session_id}/complete`, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ parts }) }, { upload: index });
  }
}

function parseArgs(argv) {
  const args = { execute: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--execute') { args.execute = true; continue; }
    const [name, inline] = arg.split('=', 2); const value = inline ?? argv[++index];
    if (!value) throw new Error(`Missing value for ${name}`);
    if (name === '--config') args.configPath = path.resolve(value);
    else if (name === '--credentials') args.credentialsPath = path.resolve(value);
    else if (name === '--acknowledge-qa-target') args.acknowledgement = value;
    else throw new Error(`Unknown option ${name}`);
  }
  assert(args.configPath, '--config is required'); assert(args.credentialsPath, '--credentials is required');
  return args;
}

function secureExternalFile(filename, repositoryRoot, label) {
  assert(path.isAbsolute(filename), `${label} must be an absolute path`);
  assert(!lstatSync(filename).isSymbolicLink(), `${label} may not be a symbolic link`);
  const resolved = realpathSync(filename);
  const relative = path.relative(repositoryRoot, resolved);
  assert(relative.startsWith('..') || path.isAbsolute(relative), `${label} must be outside the repository`);
  const stats = statSync(resolved);
  assert(stats.isFile(), `${label} must be a regular file`);
  assert((stats.mode & 0o077) === 0, `${label} permissions must deny group/other access (use chmod 600)`);
  return resolved;
}

async function loadExternalManifest(filename, repositoryRoot) {
  const resolved = secureExternalFile(filename, repositoryRoot, 'credential manifest');
  const raw = await readFile(resolved, 'utf8');
  return { raw, manifest: JSON.parse(raw) };
}

async function preloadPlayerKeys(manifest, config, repositoryRoot) {
  const players = []; const uniquePaths = new Set();
  for (const [index, player] of manifest.players.slice(0, config.spike.players).entries()) {
    const resolved = secureExternalFile(player.privateKeyPath, repositoryRoot, `players[${index}].privateKeyPath`);
    assert(!uniquePaths.has(resolved), `duplicate private key path at players[${index}]`);
    uniquePaths.add(resolved);
    const privateKeyPem = await readFile(resolved, 'utf8');
    const key = createPrivateKey(privateKeyPem);
    assert(key.asymmetricKeyType === 'rsa' || key.asymmetricKeyType === 'rsa-pss', `players[${index}] private key must be RSA`);
    const publicDer = createPublicKey(key).export({ type: 'spki', format: 'der' });
    const { privateKeyPath: _privateKeyPath, ...safePlayer } = player;
    players.push({ ...safePlayer, privateKeyPem, keyFingerprint: sha256(publicDer) });
  }
  return { players, cmsUsers: manifest.cmsUsers.slice(0, config.cms.users) };
}

async function main() {
  const args = parseArgs(process.argv.slice(2)); const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const configRaw = await readFile(args.configPath, 'utf8'); const config = validateConfig(JSON.parse(configRaw));
  const loaded = await loadExternalManifest(args.credentialsPath, repositoryRoot);
  const validatedManifest = validateCredentialManifest(loaded.manifest, config);
  const manifest = await preloadPlayerKeys(validatedManifest, config, repositoryRoot);
  const plan = buildDryRunPlan(config, manifest);
  if (!args.execute) { console.log(JSON.stringify(plan, null, 2)); return; }
  const requiredAck = `${ACK_PREFIX}${config.normalizedBaseUrl}`;
  assert(args.acknowledgement === requiredAck, `execution requires --acknowledge-qa-target '${requiredAck}'`);
  if (config.targetLooksProduction) assert(config.allowProductionLookingTarget === true, 'production-looking target also requires allowProductionLookingTarget=true in reviewed QA config');
  const serverRequire = createRequire(path.join(repositoryRoot, 'darshan-server', 'package.json'));
  const { io: socketIo } = serverRequire('socket.io-client');
  const runId = new Date().toISOString().replace(/[:.]/g, '-'); const output = path.resolve(config.outputDirectory, runId);
  await mkdir(output, { recursive: false });
  const events = createWriteStream(path.join(output, 'requests.ndjson'), { flags: 'wx' }); const resources = createWriteStream(path.join(output, 'resources.ndjson'), { flags: 'wx' });
  const evidence = new Evidence(events); const runner = new Runner(config, manifest, evidence, resources, socketIo);
  const startUsage = process.resourceUsage(); const startedAt = new Date().toISOString();
  let fatalError = null;
  try { await runner.runPhase('baseline', config.baseline, true); await runner.runPhase('spike', config.spike, false); }
  catch (error) { fatalError = error instanceof Error ? error.message : String(error); }
  runner.disconnectRealtime();
  const endedAt = new Date().toISOString(); events.end(); resources.end();
  await Promise.all([once(events, 'finish'), once(resources, 'finish')]);
  const summary = {
    status: fatalError ? 'RUN_INCOMPLETE' : 'MEASUREMENT_CAPTURED_NOT_EVALUATED', fatal_error: fatalError,
    started_at: startedAt, ended_at: endedAt, target: config.normalizedBaseUrl,
    config_sha256: sha256(configRaw), credential_manifest_sha256: sha256(loaded.raw), credential_values_recorded: false,
    latency_and_errors: evidence.summary(), proof_of_play: { attempted: evidence.popAttempted, accepted: evidence.popSucceeded },
    fanout: { trigger_enabled: Boolean(config.fanout?.enabled), trigger_phase: config.fanout?.phase ?? null, expected_recipients: config.fanout?.expectedRecipients ?? null, realtime_notification_devices: evidence.realtimeCommandDevices.size, unique_devices_receiving_commands: evidence.commandDevices.size, observed_recipient_gap: config.fanout?.enabled ? Math.max(0, config.fanout.expectedRecipients - evidence.commandDevices.size) : null, realtime_notification_gap: config.fanout?.enabled ? Math.max(0, config.fanout.expectedRecipients - evidence.realtimeCommandDevices.size) : null, unique_device_commands: evidence.commandIds.size, acknowledged_device_commands: evidence.ackedCommandIds.size, acknowledgement_gap: Math.max(0, evidence.commandIds.size - evidence.ackedCommandIds.size) },
    rate_limiting: { responses_429: evidence.rateLimited, proxy_scenario: config.proxyScenario },
    backlog: (() => {
      const durations = [...evidence.backlogRecovered.values()].sort((a, b) => a - b);
      return { configured_players: config.backlog.players, recovered_players: durations.length, offline_start_seconds: config.backlog.offlineStartSeconds, offline_duration_seconds: config.backlog.offlineDurationSeconds, recovery_p95_ms: percentile(durations, .95), recovery_max_ms: durations.at(-1) ?? null };
    })(),
    generator_resource_usage: { start: startUsage, end: process.resourceUsage(), samples: runner.generatorSamples.length },
    release_gate: { status: 'NOT_EVALUATED', reason: 'Independent QA must correlate server/proxy/VM metrics, fanout trigger scope, PoP rows, object hashes and raw evidence.' },
  };
  await writeFile(path.join(output, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`, { flag: 'wx' });
  await writeFile(path.join(output, 'run-plan.json'), `${JSON.stringify(plan, null, 2)}\n`, { flag: 'wx' });
  console.log(JSON.stringify({ output, status: summary.status }, null, 2));
  if (fatalError) process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((error) => { console.error(`groups-1-4-qa-load: ${error.message}`); process.exit(1); });
