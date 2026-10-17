import assert from 'node:assert/strict';

const baseUrl = process.env.RUNTIME_API_BASE_URL ?? 'http://127.0.0.1:13000';
const fixtureBaseUrl = process.env.RUNTIME_WEBPAGE_FIXTURE_URL;
const superAdminEmail = process.env.RUNTIME_SUPER_ADMIN_EMAIL;
const superAdminPassword = process.env.RUNTIME_SUPER_ADMIN_PASSWORD;

if (!fixtureBaseUrl || !superAdminEmail || !superAdminPassword) {
  throw new Error('RUNTIME_WEBPAGE_FIXTURE_URL, RUNTIME_SUPER_ADMIN_EMAIL and RUNTIME_SUPER_ADMIN_PASSWORD are required');
}

const stateChanging = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const results = [];

async function login() {
  const response = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-requested-with': 'XMLHttpRequest' },
    body: JSON.stringify({ email: superAdminEmail, password: superAdminPassword }),
  });
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  const cookies = response.headers.getSetCookie().map((value) => value.split(';')[0]);
  const csrfToken = cookies.find((value) => value.startsWith('csrf_token='))?.slice('csrf_token='.length);
  assert.ok(csrfToken);
  return { cookie: cookies.join('; '), csrfToken };
}

async function api(session, path, options = {}) {
  const method = options.method ?? 'GET';
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      cookie: session.cookie,
      'x-requested-with': 'XMLHttpRequest',
      ...(stateChanging.has(method) ? { 'x-csrf-token': session.csrfToken } : {}),
      ...(options.body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  let body = null;
  if (text) {
    try { body = JSON.parse(text); } catch { body = text; }
  }
  return { status: response.status, body };
}

function expectStatus(result, status, label) {
  assert.equal(result.status, status, `${label}: expected ${status}, got ${result.status}: ${JSON.stringify(result.body)}`);
  return result.body;
}

async function waitForMedia(session, mediaId, predicate, label, timeoutMs = 50_000) {
  const deadline = Date.now() + timeoutMs;
  let latest = null;
  while (Date.now() < deadline) {
    latest = expectStatus(await api(session, `/api/v1/media/${mediaId}`), 200, `poll ${label}`);
    if (predicate(latest)) return latest;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`${label} timed out; latest=${JSON.stringify(latest)}`);
}

async function createWebpage(session, label, sourceUrl) {
  return expectStatus(await api(session, '/api/v1/media', {
    method: 'POST',
    body: { name: label, display_name: label, type: 'WEBPAGE', source_url: sourceUrl },
  }), 201, `create ${label}`);
}

async function fixture(path) {
  const response = await fetch(`${fixtureBaseUrl}${path}`);
  assert.equal(response.status, 200, `fixture request failed: ${path}`);
  return response.json();
}

async function check(id, name, fn) {
  const startedAt = Date.now();
  try {
    const evidence = await fn();
    results.push({ id, name, status: 'PASS', duration_ms: Date.now() - startedAt, evidence });
  } catch (error) {
    results.push({ id, name, status: 'FAIL', duration_ms: Date.now() - startedAt, error: error instanceof Error ? error.message : String(error) });
  }
}

const runSuffix = Date.now().toString(36);
const session = await login();
await fixture('/control?version=1&fail=0');

let refreshMedia = null;
await check(13, 'Ordinary HTTP webpages are supported', async () => {
  const created = await createWebpage(session, `Runtime HTTP ${runSuffix}`, `${fixtureBaseUrl}/page`);
  assert.equal(created.status, 'PROCESSING');
  refreshMedia = await waitForMedia(session, created.id, (media) => media.status === 'READY', 'HTTP webpage READY');
  assert.equal(refreshMedia.source_url, `${fixtureBaseUrl}/page`);
  assert.ok(refreshMedia.fallback_media_revision);
  assert.ok(refreshMedia.fallback_media_sha256);
  return {
    create_status: 201,
    source_url: refreshMedia.source_url,
    final_status: refreshMedia.status,
    fallback_revision: refreshMedia.fallback_media_revision,
    fallback_sha256: refreshMedia.fallback_media_sha256,
  };
});

await check(14, 'Login-required webpages are not supported', async () => {
  const credentialsUrl = new URL(`${fixtureBaseUrl}/auth`);
  credentialsUrl.username = 'runtime-user';
  credentialsUrl.password = 'runtime-password';
  const credentialsAttempt = await api(session, '/api/v1/media', {
    method: 'POST',
    body: { name: `Credential URL ${runSuffix}`, type: 'WEBPAGE', source_url: credentialsUrl.toString() },
  });
  assert.equal(credentialsAttempt.status, 400);
  assert.equal(credentialsAttempt.body?.error?.code, 'WEBPAGE_CREDENTIALS_BLOCKED');

  const created = await createWebpage(session, `Login Required ${runSuffix}`, `${fixtureBaseUrl}/auth`);
  const failed = await waitForMedia(session, created.id, (media) => media.status === 'FAILED', 'login-required webpage FAILED');
  assert.ok(
    ['WEBPAGE_HTTP_401', 'WEBPAGE_UNREACHABLE'].includes(failed.status_reason),
    `Unexpected protected-page failure: ${failed.status_reason}`
  );
  const fixtureStatus = await fixture('/status');
  assert.equal(fixtureStatus.authorizationHeaderCount, 0);
  return {
    credential_url_create: 400,
    credential_url_error: credentialsAttempt.body.error.code,
    protected_page_status: failed.status,
    protected_page_reason: failed.status_reason,
    authorization_headers_sent: fixtureStatus.authorizationHeaderCount,
  };
});

await check(15, 'Redirects must remain on approved hosts', async () => {
  const allowedCreated = await createWebpage(session, `Allowed Redirect ${runSuffix}`, `${fixtureBaseUrl}/redirect-ok`);
  const allowed = await waitForMedia(session, allowedCreated.id, (media) => media.status === 'READY', 'same-host redirect READY');
  assert.equal(allowed.source_url, `${fixtureBaseUrl}/page`);

  const fixtureBeforeBlockedRedirect = await fixture('/status');
  const blockedCreated = await createWebpage(session, `Blocked Redirect ${runSuffix}`, `${fixtureBaseUrl}/redirect-block`);
  const blocked = await waitForMedia(session, blockedCreated.id, (media) => media.status === 'FAILED', 'blocked redirect FAILED');
  const fixtureAfterBlockedRedirect = await fixture('/status');
  assert.equal(
    fixtureAfterBlockedRedirect.secretRequestCount,
    fixtureBeforeBlockedRedirect.secretRequestCount,
    'The browser reached the disallowed redirect destination'
  );
  return {
    same_host_redirect: { status: allowed.status, final_url: allowed.source_url },
    prohibited_host_redirect: {
      status: blocked.status,
      reason: blocked.status_reason,
      destination_requests: fixtureAfterBlockedRedirect.secretRequestCount - fixtureBeforeBlockedRedirect.secretRequestCount,
    },
  };
});

await check(16, 'Failed refresh retains the latest successful preview', async () => {
  assert.ok(refreshMedia, 'HTTP preview fixture from requirement 13 is missing');
  const firstRevision = refreshMedia.fallback_media_revision;
  const firstSha256 = refreshMedia.fallback_media_sha256;

  await fixture('/control?version=2&fail=0');
  expectStatus(await api(session, `/api/v1/media/${refreshMedia.id}/webpage-preview/refresh`, { method: 'POST' }), 202, 'request successful refresh');
  const refreshed = await waitForMedia(
    session,
    refreshMedia.id,
    (media) => media.status === 'READY' && media.webpage_preview_refresh_status === 'READY' && media.fallback_media_revision !== firstRevision,
    'version 2 preview READY'
  );
  assert.notEqual(refreshed.fallback_media_sha256, firstSha256);

  await fixture('/control?version=2&fail=1');
  expectStatus(await api(session, `/api/v1/media/${refreshMedia.id}/webpage-preview/refresh`, { method: 'POST' }), 202, 'request failing refresh');
  const retained = await waitForMedia(
    session,
    refreshMedia.id,
    (media) => media.status === 'READY' && media.webpage_preview_refresh_status === 'FAILED',
    'failed refresh retains READY media'
  );
  assert.equal(retained.webpage_preview_last_error, 'WEBPAGE_HTTP_503');
  assert.equal(retained.fallback_media_revision, refreshed.fallback_media_revision);
  assert.equal(retained.fallback_media_sha256, refreshed.fallback_media_sha256);
  return {
    initial_revision: firstRevision,
    refreshed_revision: refreshed.fallback_media_revision,
    latest_preview_changed: true,
    failed_refresh_reason: retained.webpage_preview_last_error,
    media_status_after_failure: retained.status,
    retained_revision: retained.fallback_media_revision,
    retained_sha256: retained.fallback_media_sha256,
  };
});

process.stdout.write(`${JSON.stringify({
  run: {
    timestamp: new Date().toISOString(),
    base_url: baseUrl,
    fixture_url: fixtureBaseUrl,
    mode: 'live-built-api-worker-chromium',
    database: 'darshan_runtime_test',
    run_suffix: runSuffix,
  },
  summary: {
    pass: results.filter((result) => result.status === 'PASS').length,
    fail: results.filter((result) => result.status === 'FAIL').length,
  },
  results,
}, null, 2)}\n`);
