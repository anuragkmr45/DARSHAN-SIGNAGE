import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const deferred = () => { let resolve, reject; const promise = new Promise((done, fail) => { resolve = done; reject = fail; }); return { promise, resolve, reject }; };
async function presenterFixture(options = {}) {
  const source = (await readFile(new URL('../presenter.js', import.meta.url), 'utf8')).replace(/^import .*?;\s*/m, '');
  const elements = new Map();
  const el = id => {
    if (!elements.has(id)) elements.set(id, { value: 'private-fixture-presenter-token', checked: id === 'renew', disabled: false, textContent: '', srcObject: null });
    return elements.get(id);
  };
  const tracks = [];
  const stream = () => {
    const track = { listeners: {}, stop() { this.stopped = true; }, getSettings() { return { width: 1280 + tracks.indexOf(this), height: 720 }; }, addEventListener(event, callback) { this.listeners[event] = callback; } };
    tracks.push(track);
    return { getTracks: () => [track], getVideoTracks: () => [track], getAudioTracks: () => [] };
  };
  const requests = [];
  const rooms = [];
  const documentEvents = {};
  class FakeRoom {
    constructor() { this.handlers = {}; this.localParticipant = { publishTrack: async track => { this.published = track; } }; rooms.push(this); }
    on(event, callback) { this.handlers[event] = callback; }
    async connect() { this.connected = true; }
    async disconnect() { this.connected = false; }
  }
  let uuid = 0;
  const sandbox = {
    Room: FakeRoom, RoomEvent: { Disconnected: 'disconnected' }, Track: { Source: { ScreenShare: 'screen_share', ScreenShareAudio: 'screen_share_audio', Microphone: 'microphone' } },
    document: { getElementById: el, addEventListener(event, callback) { documentEvents[event] = callback; } }, window: { addEventListener() {} },
    crypto: { randomUUID: () => `00000000-0000-4000-8000-${String(++uuid).padStart(12, '0')}` }, performance: { now: () => 0 },
    navigator: { mediaDevices: { getDisplayMedia: options.capture ?? (async () => stream()), getUserMedia: options.microphone ?? (async () => { throw new Error('microphone denied'); }) } },
    setTimeout: () => 1, clearTimeout() {}, setInterval: () => 1, clearInterval() {}, AbortSignal: { timeout: () => undefined },
    fetch: async (route, request) => {
      const body = JSON.parse(request.body); requests.push({ route, body });
      const result = await options.fetch?.(route, body);
      return { ok: true, status: 200, json: async () => result ?? { run_id: 'run-1', generation: 1, signal_url: 'ws://127.0.0.1:19001', ticket: 'fixture-ticket', lease_ms: 10000, window_remaining_ms: 60000 } };
    },
  };
  vm.runInNewContext(source, sandbox, { filename: 'prototype-presenter.js' });
  return { el, requests, rooms, tracks, documentEvents };
}

test('capture cancellation never creates a run or enables broadcast start', async () => {
  const f = await presenterFixture({ capture: async () => { throw new Error('picker cancelled'); } });
  f.el('start').disabled = true;
  await f.el('choose').onclick();
  assert.equal(f.requests.length, 0);
  assert.equal(f.el('start').disabled, true);
  assert.match(f.el('status').textContent, /cancelled or denied/);
});

test('local preview creates no run; successful explicit start publishes only after authority', async () => {
  const f = await presenterFixture();
  await f.el('choose').onclick();
  assert.equal(f.requests.length, 0); assert.ok(f.el('preview').srcObject);
  await f.el('start').onclick();
  assert.equal(f.requests[0].route, '/prototype/start');
  assert.equal(f.requests[1].route, '/prototype/authority/presenter');
  assert.equal(f.rooms.length, 1); assert.equal(f.rooms[0].published, f.tracks[0]);
});

test('a late first start cannot stop or publish into a newer presenter attempt', async () => {
  const firstStart = deferred(); let starts = 0; let activeRun;
  const f = await presenterFixture({ fetch: async (route, body) => {
    if (route === '/prototype/start') {
      starts += 1; activeRun = `run-${starts}`;
      if (starts === 1) { await firstStart.promise; return { run_id: 'run-1', generation: 1 }; }
      return { run_id: activeRun, generation: 1 };
    }
    if (route === '/prototype/stop') {
      if (!body.run_id || body.run_id === activeRun) activeRun = undefined;
      return { stopped: true };
    }
    return { run_id: activeRun, generation: 1, signal_url: 'ws://127.0.0.1:19001', ticket: 'fixture-ticket', lease_ms: 10000, window_remaining_ms: 60000 };
  } });
  await f.el('choose').onclick();
  const staleStart = f.el('start').onclick();
  await Promise.resolve();
  await f.el('stop').onclick();
  await f.el('choose').onclick();
  await f.el('start').onclick();
  assert.equal(activeRun, 'run-2');
  firstStart.resolve(); await staleStart;
  assert.equal(activeRun, 'run-2');
  assert.equal(f.rooms.length, 1);
  assert.equal(f.rooms[0].published, f.tracks[1]);
});

test('optional microphone denial retains video and accurately excludes the absent track from policy', async () => {
  const f = await presenterFixture(); f.el('microphone').checked = true;
  await f.el('choose').onclick();
  assert.ok(f.el('preview').srcObject); assert.equal(f.el('start').disabled, false);
  assert.match(f.el('status').textContent, /Microphone unavailable/);
  await f.el('start').onclick();
  assert.equal(f.requests[0].body.microphone, false);
  assert.equal(f.requests[0].body.screen_share_audio, false);
  assert.equal(f.rooms[0].published, f.tracks[0]);
});

test('an ended event from a replaced source cannot stop the current presenter', async () => {
  const f = await presenterFixture();
  await f.el('choose').onclick();
  const staleEnded = f.tracks[0].listeners.ended;
  await f.el('choose').onclick();
  await f.el('start').onclick();
  staleEnded();
  await Promise.resolve();
  assert.notEqual(f.tracks[1].stopped, true);
  assert.equal(f.rooms[0].connected, true);
  assert.equal(f.requests.filter(request => request.route === '/prototype/stop').length, 0);
  f.tracks[1].listeners.ended();
  await Promise.resolve();
  assert.equal(f.tracks[1].stopped, true);
  assert.equal(f.rooms[0].connected, false);
  assert.equal(f.requests.filter(request => request.route === '/prototype/stop').length, 1);
});

test('a replaced source microphone rejection cannot overwrite current preview status', async () => {
  const microphone = deferred();
  const requested = deferred();
  const f = await presenterFixture({ microphone: () => { requested.resolve(); return microphone.promise; } });
  f.el('microphone').checked = true;
  const first = f.el('choose').onclick();
  await requested.promise;
  f.el('microphone').checked = false;
  await f.el('choose').onclick();
  const currentPreview = f.el('preview').srcObject;
  const currentDetails = f.el('details').textContent;
  microphone.reject(new Error('permission denied'));
  await first;
  assert.equal(f.el('preview').srcObject, currentPreview);
  assert.equal(f.el('details').textContent, currentDetails);
  assert.equal(f.el('status').textContent, 'Local preview ready. Nothing is broadcasting yet.');
});

test('a late renewal failure cannot replace the terminal stopped reason', async () => {
  const renewal = deferred(); const requested = deferred(); let authorities = 0;
  const f = await presenterFixture({ fetch: async route => {
    if (route === '/prototype/authority/presenter' && ++authorities === 2) {
      requested.resolve(); await renewal.promise;
    }
  } });
  await f.el('choose').onclick(); await f.el('start').onclick(); await requested.promise;
  f.el('stop').onclick();
  renewal.reject(new Error('controller stopped'));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.el('status').textContent, 'Presenter stopped the attempt');
  assert.equal(f.el('start').disabled, true);
  assert.equal(f.el('stop').disabled, true);
});

test('an old renewal completion cannot release a newer run renewal single-flight guard', async () => {
  const oldRenewal = deferred(); const newRenewal = deferred();
  const oldRequested = deferred(); const newRequested = deferred(); let authorities = 0;
  const f = await presenterFixture({ fetch: async route => {
    if (route !== '/prototype/authority/presenter') return;
    ++authorities;
    if (authorities === 2) { oldRequested.resolve(); await oldRenewal.promise; }
    if (authorities === 4) { newRequested.resolve(); await newRenewal.promise; }
  } });
  await f.el('choose').onclick(); await f.el('start').onclick(); await oldRequested.promise;
  f.el('stop').onclick();
  await f.el('choose').onclick(); await f.el('start').onclick(); await newRequested.promise;
  oldRenewal.reject(new Error('old request failed'));
  await new Promise(resolve => setImmediate(resolve));
  f.documentEvents.visibilitychange();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(authorities, 4);
  assert.equal(f.el('status').textContent, 'Presenter transmitting. Check the real Electron receiver for rendering.');
  newRenewal.resolve();
  await new Promise(resolve => setImmediate(resolve));
  f.el('stop').onclick();
});

test('double click during a pending start creates exactly one request and one media room', async () => {
  const gate = deferred(); const began = deferred();
  const f = await presenterFixture({ fetch: async route => {
    if (route === '/prototype/start') { began.resolve(); await gate.promise; }
  } });
  await f.el('choose').onclick();
  const first = f.el('start').onclick(); await began.promise;
  await f.el('start').onclick();
  gate.resolve(); await first;
  assert.equal(f.requests.filter(request => request.route === '/prototype/start').length, 1);
  assert.equal(f.rooms.length, 1);
});

test('late capture picker result is stopped and cannot replace the newer selected source', async () => {
  const old = deferred(); let count = 0;
  const stream = () => {
    const track = { stop() { this.stopped = true; }, getSettings: () => ({}), addEventListener() {} };
    return { track, getTracks: () => [track], getVideoTracks: () => [track], getAudioTracks: () => [] };
  };
  const stale = stream(); const current = stream();
  const f = await presenterFixture({ capture: async () => ++count === 1 ? old.promise : current });
  const first = f.el('choose').onclick();
  await f.el('choose').onclick(); old.resolve(stale); await first;
  assert.equal(stale.track.stopped, true);
  assert.equal(f.el('preview').srcObject, current);
  assert.equal(f.requests.length, 0);
});
