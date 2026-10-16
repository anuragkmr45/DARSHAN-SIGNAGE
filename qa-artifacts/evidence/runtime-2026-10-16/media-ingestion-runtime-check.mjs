import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { basename, resolve } from 'node:path';

const baseUrl = process.env.PREQA_API_BASE_URL ?? 'http://127.0.0.1:13000';
const adminEmail = process.env.PREQA_ADMIN_EMAIL;
const adminPassword = process.env.PREQA_ADMIN_PASSWORD;
const fixtureRoot = resolve(process.env.PREQA_FIXTURE_ROOT ?? new URL('.', import.meta.url).pathname);

if (!adminEmail || !adminPassword) {
  throw new Error('PREQA_ADMIN_EMAIL and PREQA_ADMIN_PASSWORD are required');
}

const fixtures = [
  { filename: 'fixture-pages.pdf', contentType: 'application/pdf', expected: 'READY', expectedPages: 5 },
  { filename: 'fixture-slides.ppt', contentType: 'application/vnd.ms-powerpoint', expected: 'READY', expectedPages: 5 },
  {
    filename: 'fixture-slides.pptx',
    contentType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    expected: 'READY',
    expectedPages: 5,
  },
  { filename: 'fixture-pages.doc', contentType: 'application/msword', expected: 'READY' },
  {
    filename: 'fixture-pages.docx',
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    expected: 'READY',
  },
  { filename: 'fixture-sheet.xls', contentType: 'application/vnd.ms-excel', expected: 'READY' },
  {
    filename: 'fixture-sheet.xlsx',
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    expected: 'READY',
  },
  { filename: 'fixture-sheet.csv', contentType: 'text/csv', expected: 'READY' },
  {
    filename: 'fixture-loop.mp4',
    contentType: 'video/mp4',
    expected: 'READY',
    completion: { duration_seconds: 2 },
  },
  { filename: 'fixture-corrupt.pdf', contentType: 'application/pdf', expected: 'FAILED' },
  { filename: 'fixture-encrypted.pdf', contentType: 'application/pdf', expected: 'FAILED' },
];

const stateChanging = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

async function login() {
  const response = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-requested-with': 'XMLHttpRequest' },
    body: JSON.stringify({ email: adminEmail, password: adminPassword }),
  });
  const body = await response.json();
  assert.equal(response.status, 200, `Admin login failed: ${JSON.stringify(body)}`);
  const cookies = response.headers.getSetCookie().map((value) => value.split(';')[0]);
  const csrfToken = cookies.find((value) => value.startsWith('csrf_token='))?.slice('csrf_token='.length);
  assert.ok(csrfToken, 'Login did not return a CSRF token');
  return { cookie: cookies.join('; '), csrfToken };
}

async function api(session, path, options = {}) {
  const method = options.method ?? 'GET';
  const headers = {
    cookie: session.cookie,
    'x-requested-with': 'XMLHttpRequest',
    ...(stateChanging.has(method) ? { 'x-csrf-token': session.csrfToken } : {}),
    ...(options.body !== undefined ? { 'content-type': 'application/json' } : {}),
    ...(options.headers ?? {}),
  };
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  return { status: response.status, body };
}

function expectStatus(result, status, label) {
  assert.equal(result.status, status, `${label}: expected ${status}, got ${result.status}: ${JSON.stringify(result.body)}`);
  return result.body;
}

async function beginUpload(session, fixture, runId) {
  const path = resolve(fixtureRoot, fixture.filename);
  const [bytes, metadata] = await Promise.all([readFile(path), stat(path)]);
  const checksum = createHash('sha256').update(bytes).digest('hex');
  const created = expectStatus(
    await api(session, '/api/v1/media/uploads', {
      method: 'POST',
      headers: { 'idempotency-key': `preqa-${runId}-${fixture.filename}-${randomUUID()}` },
      body: {
        filename: basename(path),
        display_name: `PreQA ${runId} ${fixture.filename}`,
        content_type: fixture.contentType,
        size: metadata.size,
        checksum_sha256: checksum,
      },
    }),
    201,
    `create upload session for ${fixture.filename}`
  );
  assert.equal(created.strategy, 'single', `${fixture.filename} should use the small-file upload path`);
  assert.ok(created.upload_url, `${fixture.filename} upload session omitted upload_url`);

  const storageResponse = await fetch(created.upload_url, {
    method: 'PUT',
    headers: { 'content-type': fixture.contentType },
    body: bytes,
  });
  const storageText = await storageResponse.text();
  assert.ok(
    storageResponse.ok,
    `${fixture.filename} object upload failed with ${storageResponse.status}: ${storageText.slice(0, 500)}`
  );

  const completed = expectStatus(
    await api(session, `/api/v1/media/uploads/${created.session_id}/complete`, {
      method: 'POST',
      body: fixture.completion ?? {},
    }),
    200,
    `complete upload session for ${fixture.filename}`
  );
  assert.equal(completed.state, 'COMPLETED', `${fixture.filename} upload session was not completed`);
  return { ...fixture, mediaId: created.media_id, uploadSessionId: created.session_id };
}

async function pollTerminal(session, uploads) {
  const deadline = Date.now() + 5 * 60_000;
  const pending = new Map(uploads.map((upload) => [upload.mediaId, upload]));
  const results = [];
  while (pending.size > 0 && Date.now() < deadline) {
    for (const [mediaId, upload] of [...pending]) {
      const media = expectStatus(await api(session, `/api/v1/media/${mediaId}`), 200, `poll ${upload.filename}`);
      if (media.status === 'READY' || media.status === 'FAILED') {
        results.push({ upload, media });
        pending.delete(mediaId);
      }
    }
    if (pending.size > 0) await new Promise((resolvePromise) => setTimeout(resolvePromise, 1000));
  }
  assert.equal(pending.size, 0, `Media processing timeout: ${[...pending.values()].map((item) => item.filename).join(', ')}`);
  return results;
}

const runId = Date.now().toString(36);
const session = await login();
const uploads = [];
for (const fixture of fixtures) {
  uploads.push(await beginUpload(session, fixture, runId));
}
const terminal = await pollTerminal(session, uploads);

const summary = terminal
  .sort((left, right) => left.upload.filename.localeCompare(right.upload.filename))
  .map(({ upload, media }) => {
    assert.equal(media.status, upload.expected, `${upload.filename} terminal status`);
    assert.equal(media.ownership?.scope, 'ORGANIZATION', `${upload.filename} ownership scope`);
    assert.equal(media.ownership?.creator?.status, 'ACTIVE', `${upload.filename} creator state`);
    if (upload.expected === 'READY' && media.type === 'DOCUMENT') {
      assert.ok(Number.isSafeInteger(media.page_count) && media.page_count > 0, `${upload.filename} needs a positive page count`);
    }
    if (upload.expectedPages !== undefined) {
      assert.equal(media.page_count, upload.expectedPages, `${upload.filename} physical page count`);
    }
    if (upload.filename.endsWith('.mp4')) {
      assert.equal(media.type, 'VIDEO');
      assert.ok(media.duration_seconds > 0, 'Processed video needs a positive duration');
    }
    return {
      filename: upload.filename,
      content_type: upload.contentType,
      media_id: upload.mediaId,
      upload_session_id: upload.uploadSessionId,
      type: media.type,
      status: media.status,
      status_reason: media.status_reason ?? null,
      page_count: media.page_count ?? null,
      duration_seconds: media.duration_seconds ?? null,
      owner_scope: media.ownership.scope,
    };
  });

process.stdout.write(`${JSON.stringify({ run_id: runId, assertions: 'passed', media: summary }, null, 2)}\n`);
