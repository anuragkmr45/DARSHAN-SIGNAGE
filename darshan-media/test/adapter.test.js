import test from 'node:test';
import assert from 'node:assert/strict';
import { LiveKitAdapter } from '../src/livekit-adapter.js';

const adapter = () => new LiveKitAdapter({ url: 'http://127.0.0.1:18781', apiKey: 'test-key', apiSecret: 'test-secret-at-least-32-characters' });
const entry = { participantId: 'opaque-player', room: 'opaque-room', role: 'receiver', audio: { microphone: true, screen_share_audio: true } };
const decode = (token) => JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());

test('receiver JWT is subscribe-only with no data publishing or room administration', async () => {
  const claims = decode(await adapter().createToken(entry));
  assert.equal(claims.sub, 'opaque-player');
  assert.equal(claims.video.room, 'opaque-room');
  assert.equal(claims.video.canPublish, false);
  assert.equal(claims.video.canSubscribe, true);
  assert.equal(claims.video.canPublishData, false);
  assert.equal(claims.video.roomAdmin, undefined);
  assert.equal(claims.video.roomCreate, undefined);
  assert.equal(claims.exp - claims.nbf, 10);
});

test('presenter JWT permits only approved source types and no receiving', async () => {
  const minimal = decode(await adapter().createToken({ ...entry, role: 'presenter', audio: { microphone: false, screen_share_audio: false } }));
  assert.equal(minimal.video.canSubscribe, false);
  assert.equal(minimal.video.canPublish, true);
  assert.deepEqual(minimal.video.canPublishSources, ['screen_share']);
  const full = decode(await adapter().createToken({ ...entry, role: 'presenter' }));
  assert.deepEqual(full.video.canPublishSources, ['screen_share', 'microphone', 'screen_share_audio']);
  assert.equal(full.video.canPublishData, false);
});

test('removal of an absent participant is idempotent; other errors fail', async () => {
  const sdk = adapter();
  sdk.rooms = { removeParticipant: async () => { throw Object.assign(new Error(), { code: 'not_found' }); } };
  await sdk.removeParticipant('room', 'id');
  sdk.rooms = { removeParticipant: async () => { throw Object.assign(new Error(), { code: 'unavailable' }); } };
  await assert.rejects(sdk.removeParticipant('room', 'id'));
});

test('hung management request is bounded rather than silently retaining media', async () => {
  const sdk = new LiveKitAdapter({ url: 'http://127.0.0.1:18781', apiKey: 'key', apiSecret: 'secret', timeoutMs: 25 });
  sdk.rooms = { removeParticipant: async () => new Promise(() => {}) };
  await assert.rejects(sdk.removeParticipant('room', 'id'), /SFU_TIMEOUT/);
});

test('participant confirmation tolerates a transient cold-node timeout without widening cleanup authority', async () => {
  const sdk = adapter();
  let probes = 0;
  sdk.probes = { getParticipant: async () => {
    probes += 1;
    if (probes === 1) throw Object.assign(new Error('temporary timeout'), { code: 'deadline_exceeded' });
    return {};
  } };
  await sdk.confirmParticipant(entry);
  assert.equal(probes, 2);
});

test('unconfirmed participant registration remains bounded and permission denial is immediate', async () => {
  const sdk = new LiveKitAdapter({ url: 'http://127.0.0.1:18781', apiKey: 'key', apiSecret: 'secret', confirmationTimeoutMs: 30 });
  sdk.probes = { getParticipant: async () => new Promise(() => {}) };
  await assert.rejects(sdk.confirmParticipant(entry), /PARTICIPANT_REGISTRATION_UNCONFIRMED/);
  sdk.probes = { getParticipant: async () => { throw Object.assign(new Error('denied'), { code: 'permission_denied' }); } };
  await assert.rejects(sdk.confirmParticipant(entry), /denied/);
});
