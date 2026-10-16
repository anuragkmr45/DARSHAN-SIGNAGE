import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const baseUrl = process.env.PREQA_API_BASE_URL ?? 'http://127.0.0.1:13000';
const adminEmail = process.env.PREQA_ADMIN_EMAIL;
const adminPassword = process.env.PREQA_ADMIN_PASSWORD;
const mode = process.env.PREQA_MODE ?? 'prepare';
const screenId = process.env.PREQA_SCREEN_ID ?? '33333333-3333-4333-8333-333333333333';
const mediaResultPath = process.env.PREQA_MEDIA_RESULT;
const preparedResultPath = process.env.PREQA_PREPARED_RESULT;

if (!adminEmail || !adminPassword) {
  throw new Error('PREQA_ADMIN_EMAIL and PREQA_ADMIN_PASSWORD are required');
}

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

const session = await login();

if (mode === 'prepare') {
  assert.ok(mediaResultPath, 'PREQA_MEDIA_RESULT is required in prepare mode');
  const ingestion = JSON.parse(await readFile(mediaResultPath, 'utf8'));
  const mediaByName = new Map(ingestion.media.map((item) => [item.filename, item]));
  const documentId = mediaByName.get('fixture-pages.pdf')?.media_id;
  const videoId = mediaByName.get('fixture-loop.mp4')?.media_id;
  assert.ok(documentId && videoId, 'The READY PDF and video IDs are missing from ingestion evidence');

  const runId = Date.now().toString(36);
  const layout = expectStatus(
    await api(session, '/api/v1/layouts', {
      method: 'POST',
      body: {
        name: `PreQA Pages and Loop Layout ${runId}`,
        aspect_ratio: '16:9',
        spec: {
          slots: [
            { id: 'documents', x: 0, y: 0, w: 0.5, h: 1, z: 0, fit: 'contain', audio_enabled: false },
            { id: 'video', x: 0.5, y: 0, w: 0.5, h: 1, z: 1, fit: 'contain', audio_enabled: true },
          ],
        },
      },
    }),
    201,
    'create two-slot layout'
  );
  const presentation = expectStatus(
    await api(session, '/api/v1/presentations', {
      method: 'POST',
      body: { name: `PreQA Pages and Loop Presentation ${runId}`, layout_id: layout.id },
    }),
    201,
    'create presentation'
  );

  const expectedItems = [
    {
      slot_id: 'documents',
      media_id: documentId,
      order: 0,
      duration_seconds: 4,
      page_number: 2,
      loop_enabled: true,
    },
    {
      slot_id: 'documents',
      media_id: documentId,
      order: 1,
      duration_seconds: 4,
      page_number: 5,
    },
    {
      slot_id: 'video',
      media_id: videoId,
      order: 0,
      duration_seconds: 8,
      audio_enabled: true,
      loop_enabled: true,
    },
  ];
  const replaced = expectStatus(
    await api(session, `/api/v1/presentations/${presentation.id}/slots`, {
      method: 'PUT',
      body: { items: expectedItems },
    }),
    200,
    'store page and loop occurrences'
  );
  assert.deepEqual(
    replaced.items.map((item) => [item.slot_id, item.order, item.page_number, item.loop_enabled]),
    [
      ['documents', 0, 2, false],
      ['documents', 1, 5, false],
      ['video', 0, null, true],
    ],
    'occurrence page and loop normalization'
  );
  const stableIds = replaced.items.map((item) => item.id);

  const invalidPage = await api(session, `/api/v1/presentations/${presentation.id}/slots`, {
    method: 'PUT',
    body: {
      items: [
        { ...expectedItems[0], page_number: 3 },
        { ...expectedItems[1], page_number: 6 },
        { ...expectedItems[2], loop_enabled: false },
      ],
    },
  });
  expectStatus(invalidPage, 422, 'reject out-of-range replacement');
  assert.equal(invalidPage.body?.error?.code, 'DOCUMENT_PAGE_OUT_OF_RANGE');

  const invalidVideoPage = await api(session, `/api/v1/presentations/${presentation.id}/slots`, {
    method: 'PUT',
    body: { items: [{ ...expectedItems[2], page_number: 1 }] },
  });
  expectStatus(invalidVideoPage, 422, 'reject page on video');
  assert.equal(invalidVideoPage.body?.error?.code, 'DOCUMENT_PAGE_NOT_APPLICABLE');

  const afterInvalid = expectStatus(
    await api(session, `/api/v1/presentations/${presentation.id}/slots`),
    200,
    'read slots after invalid replacements'
  );
  assert.deepEqual(afterInvalid.items.map((item) => item.id), stableIds, 'invalid replacement must preserve row identities');
  assert.deepEqual(
    afterInvalid.items.map((item) => [item.slot_id, item.order, item.page_number, item.loop_enabled]),
    [
      ['documents', 0, 2, false],
      ['documents', 1, 5, false],
      ['video', 0, null, true],
    ],
    'invalid replacement must preserve the complete prior assignment'
  );

  const startAt = new Date(Date.now() + 60_000);
  const endAt = new Date(Date.now() + 91 * 60_000);
  const schedule = expectStatus(
    await api(session, '/api/v1/schedules', {
      method: 'POST',
      body: {
        name: `PreQA Pages and Loop Schedule ${runId}`,
        timezone: 'Asia/Kolkata',
        start_at: startAt.toISOString(),
        end_at: endAt.toISOString(),
      },
    }),
    201,
    'create active schedule'
  );
  const scheduleItem = expectStatus(
    await api(session, `/api/v1/schedules/${schedule.id}/items`, {
      method: 'POST',
      body: {
        presentation_id: presentation.id,
        start_at: startAt.toISOString(),
        end_at: endAt.toISOString(),
        priority: 10,
        screen_ids: [screenId],
        screen_group_ids: [],
      },
    }),
    201,
    'add active schedule item'
  );

  const blockedPublish = await api(session, `/api/v1/schedules/${schedule.id}/publish`, {
    method: 'POST',
    body: { screen_ids: [screenId], notes: 'Pre-QA page capability rejection' },
  });
  expectStatus(blockedPublish, 409, 'block publish to page-incapable screen');
  assert.equal(blockedPublish.body?.error?.details?.reason, 'UNSUPPORTED_DOCUMENT_PAGE_SELECTION');

  process.stdout.write(
    `${JSON.stringify(
      {
        run_id: runId,
        phase: 'prepared',
        assertions: {
          occurrencePersistence: 'passed',
          nonVideoLoopNormalization: 'passed',
          invalidReplacementAtomicity: 'passed',
          nonDocumentPageRejection: 'passed',
          incapablePlayerPublishGate: 'passed',
        },
        resources: {
          screen_id: screenId,
          document_media_id: documentId,
          video_media_id: videoId,
          layout_id: layout.id,
          presentation_id: presentation.id,
          schedule_id: schedule.id,
          schedule_item_id: scheduleItem.id,
        },
      },
      null,
      2
    )}\n`
  );
} else if (mode === 'publish') {
  assert.ok(preparedResultPath, 'PREQA_PREPARED_RESULT is required in publish mode');
  const prepared = JSON.parse(await readFile(preparedResultPath, 'utf8'));
  const resources = prepared.resources;
  assert.equal(resources.screen_id, screenId, 'prepared screen does not match PREQA_SCREEN_ID');

  const screen = expectStatus(await api(session, `/api/v1/screens/${screenId}`), 200, 'read capable screen');
  assert.ok(
    screen.device_info?.player_capabilities?.features?.includes('pdf_page_selection_v1'),
    'screen capability was not persisted'
  );
  const published = expectStatus(
    await api(session, `/api/v1/schedules/${resources.schedule_id}/publish`, {
      method: 'POST',
      body: { screen_ids: [screenId], notes: 'Pre-QA page and loop snapshot' },
    }),
    200,
    'publish to page-capable screen'
  );
  const screenSnapshot = expectStatus(
    await api(session, `/api/v1/screens/${screenId}/snapshot?include_urls=false`),
    200,
    'read published screen snapshot'
  );
  assert.equal(screenSnapshot.publish.publish_id, published.publish_id);
  const scheduleItems = screenSnapshot.snapshot?.schedule?.items ?? [];
  assert.equal(scheduleItems.length, 1, 'screen snapshot should contain the targeted active item');
  const slots = scheduleItems[0]?.presentation?.slots ?? [];
  assert.deepEqual(
    slots.map((item) => [item.slot_id, item.order, item.media_id, item.page_number, item.loop_enabled]),
    [
      ['documents', 0, resources.document_media_id, 2, false],
      ['documents', 1, resources.document_media_id, 5, false],
      ['video', 0, resources.video_media_id, null, true],
    ],
    'immutable snapshot must retain page and loop values'
  );

  process.stdout.write(
    `${JSON.stringify(
      {
        run_id: prepared.run_id,
        phase: 'published',
        assertions: {
          capablePlayerPublish: 'passed',
          immutableSnapshotPageSelection: 'passed',
          immutableSnapshotLoopFlag: 'passed',
        },
        resources: {
          ...resources,
          publish_id: published.publish_id,
          snapshot_id: published.snapshot_id,
        },
        snapshot_slots: slots.map((item) => ({
          slot_id: item.slot_id,
          order: item.order,
          media_id: item.media_id,
          page_number: item.page_number,
          loop_enabled: item.loop_enabled,
        })),
      },
      null,
      2
    )}\n`
  );
} else {
  throw new Error(`Unsupported PREQA_MODE: ${mode}`);
}
