import assert from 'node:assert/strict';
import { createVerify, generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, chmodSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildCommandAcknowledgement, buildDeviceSignaturePayload, buildDeviceSocketAuth, buildDryRunPlan, signDeviceRequest, validateConfig, validateCredentialManifest } from './groups-1-4-qa-load.mjs';

const directory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(directory, '../..');
const examplePath = path.join(directory, 'groups-1-4-qa-load.example.json');
const example = JSON.parse(String(await import('node:fs/promises').then(({ readFile }) => readFile(examplePath))));

const keyPair = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });

function manifest(players = 1000, users = 40, keyRoot = '/secure/player-keys') {
  const uuid = (value) => `00000000-0000-4000-8000-${value.toString(16).padStart(12, '0')}`;
  return {
    players: Array.from({ length: players }, (_, index) => ({
      deviceId: uuid(index + 1),
      serial: `serial-${index}`,
      privateKeyPath: path.join(keyRoot, `player-${index}.pem`),
      mediaId: uuid(index + 10001),
      scheduleId: uuid(index + 20001),
      forwardedFor: `10.${20 + Math.floor(index / 65000)}.${Math.floor(index / 255) % 255}.${index % 255}`,
    })),
    cmsUsers: Array.from({ length: users }, (_, index) => ({
      accessToken: `test-access-token-${index}`.padEnd(32, 'x'),
      forwardedFor: `10.30.0.${index + 1}`,
    })),
  };
}

function externalManifestFixture() {
  const temp = mkdtempSync(path.join(os.tmpdir(), 'darshan-packet4-load-'));
  for (let index = 0; index < 1000; index += 1) {
    const keyPath = path.join(temp, `player-${index}.pem`);
    writeFileSync(keyPath, keyPair.privateKey); chmodSync(keyPath, 0o600);
  }
  const credentialsPath = path.join(temp, 'credentials.json');
  writeFileSync(credentialsPath, JSON.stringify(manifest(1000, 40, temp))); chmodSync(credentialsPath, 0o600);
  return { temp, credentialsPath };
}

test('release-gate example validates and produces the fixed required shape', () => {
  const config = validateConfig(structuredClone(example));
  const credentials = validateCredentialManifest(manifest(), config);
  for (const player of credentials.players) player.keyFingerprint = 'a'.repeat(64);
  const plan = buildDryRunPlan(config, credentials);
  assert.equal(plan.status, 'DRY_RUN_ONLY');
  assert.equal(plan.required_release_shape.baseline_players, 500);
  assert.equal(plan.required_release_shape.spike_players, 1000);
  assert.equal(plan.required_release_shape.upload_bytes_each, 500 * 1024 * 1024);
  const serialized = JSON.stringify(plan);
  assert.doesNotMatch(serialized, /privateKeyPath|accessToken|serial-0|\/secure\//);
});

test('device signature matches the production canonical payload exactly', () => {
  const method = 'POST'; const rawPath = '/api/v1/device/device-1/commands/command-1/ack?source=poll';
  const timestamp = '1793491200000'; const deviceId = 'device-1';
  const signature = signDeviceRequest(keyPair.privateKey, method, rawPath, deviceId, timestamp);
  const verifier = createVerify('RSA-SHA256');
  verifier.update(buildDeviceSignaturePayload(method, rawPath, deviceId, timestamp)); verifier.end();
  assert.equal(verifier.verify(keyPair.publicKey, signature, 'base64'), true);
});

test('device Socket.IO auth uses the production namespace canonical payload', () => {
  const player = { deviceId: '00000000-0000-4000-8000-000000000001', serial: 'SERIAL-1', privateKeyPem: keyPair.privateKey };
  const auth = buildDeviceSocketAuth(player, '1793491200000', 'nonce-1');
  const payload = ['DARSHAN_DEVICE_SOCKET_AUTH_V1', 'CONNECT', '/device', player.deviceId, player.serial, '1793491200000', 'nonce-1'].join('\n');
  const verifier = createVerify('RSA-SHA256'); verifier.update(payload); verifier.end();
  assert.equal(verifier.verify(keyPair.publicKey, auth.auth_signature, 'base64'), true);
  assert.deepEqual({ ...auth, auth_signature: '<redacted>' }, { device_id: player.deviceId, device_serial: player.serial, auth_version: 'v1', auth_timestamp: '1793491200000', auth_nonce: 'nonce-1', auth_signature: '<redacted>' });
});

test('command acknowledgement carries the claimed delivery token and completion fields', () => {
  assert.deepEqual(buildCommandAcknowledgement({ delivery_token: 'f2e9a55c-ceee-4f37-91df-00d68bbf33e4' }, '2026-11-01T00:00:00.000Z'), {
    delivery_token: 'f2e9a55c-ceee-4f37-91df-00d68bbf33e4', success: true, processed_at: '2026-11-01T00:00:00.000Z',
  });
  assert.throws(() => buildCommandAcknowledgement({}), /missing delivery_token/);
});

test('config rejects reduced release load, embedded secrets, and insecure cross-VM HTTP', () => {
  const reduced = structuredClone(example); reduced.baseline.players = 499;
  assert.throws(() => validateConfig(reduced), /exactly 500/);
  const secret = structuredClone(example); secret.accessToken = 'do-not-allow';
  assert.throws(() => validateConfig(secret), /may not embed credentials/);
  const http = structuredClone(example); http.baseUrl = 'http://10.20.0.20:3000';
  assert.throws(() => validateConfig(http), /require HTTPS/);
});

test('credential validation requires unique players, all CMS users, and proxy identities', () => {
  const config = validateConfig(structuredClone(example));
  assert.throws(() => validateCredentialManifest(manifest(999), config), /at least 1000 players/);
  const duplicate = manifest(); duplicate.players[1].deviceId = duplicate.players[0].deviceId;
  assert.throws(() => validateCredentialManifest(duplicate, config), /duplicate player/);
  const noForwarded = manifest(); delete noForwarded.players[0].forwardedFor;
  assert.throws(() => validateCredentialManifest(noForwarded, config), /forwardedFor is required/);
});

test('CLI defaults to a no-network dry run using an external mode-600 manifest', () => {
  const { credentialsPath } = externalManifestFixture();
  const result = spawnSync(process.execPath, [path.join(directory, 'groups-1-4-qa-load.mjs'), '--config', examplePath, '--credentials', credentialsPath], { cwd: repositoryRoot, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.status, 'DRY_RUN_ONLY');
  assert.match(output.note, /No requests were sent/);
  assert.doesNotMatch(result.stdout, /credentials\.json|player-0\.pem|serial-0|test-access-token/);
});

test('CLI execution refuses to start without the exact target acknowledgement', () => {
  const { credentialsPath } = externalManifestFixture();
  const result = spawnSync(process.execPath, [path.join(directory, 'groups-1-4-qa-load.mjs'), '--config', examplePath, '--credentials', credentialsPath, '--execute'], { cwd: repositoryRoot, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /execution requires --acknowledge-qa-target/);
});

test('production-looking target needs reviewed config opt-in even with the exact acknowledgement', () => {
  const { temp, credentialsPath } = externalManifestFixture();
  const configPath = path.join(temp, 'production-looking.json');
  const config = structuredClone(example);
  config.baseUrl = 'https://api.production.example.com';
  config.realtime.url = config.baseUrl;
  config.outputDirectory = path.join(temp, 'evidence');
  writeFileSync(configPath, JSON.stringify(config));
  const acknowledgement = `I_ACKNOWLEDGE_DESTRUCTIVE_QA_LOAD_ON_${config.baseUrl}`;
  const result = spawnSync(process.execPath, [path.join(directory, 'groups-1-4-qa-load.mjs'), '--config', configPath, '--credentials', credentialsPath, '--execute', '--acknowledge-qa-target', acknowledgement], { cwd: repositoryRoot, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /allowProductionLookingTarget=true/);
});
