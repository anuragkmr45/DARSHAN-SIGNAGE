import assert from 'node:assert/strict';

const baseUrl = process.env.PREQA_API_BASE_URL ?? 'http://127.0.0.1:13000';
const adminEmail = process.env.PREQA_ADMIN_EMAIL;
const adminPassword = process.env.PREQA_ADMIN_PASSWORD;
const userPassword = process.env.PREQA_USER_PASSWORD;
const requestedScreenId = process.env.PREQA_SCREEN_ID;

if (!adminEmail || !adminPassword || !userPassword) {
  throw new Error('PREQA_ADMIN_EMAIL, PREQA_ADMIN_PASSWORD and PREQA_USER_PASSWORD are required');
}

const stateChanging = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

async function login(email, password) {
  const response = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-requested-with': 'XMLHttpRequest',
    },
    body: JSON.stringify({ email, password }),
  });
  const body = await response.json();
  assert.equal(response.status, 200, `Login failed for ${email}: ${JSON.stringify(body)}`);
  const cookies = response.headers.getSetCookie().map((value) => value.split(';')[0]);
  const cookie = cookies.join('; ');
  const csrfToken = cookies.find((value) => value.startsWith('csrf_token='))?.slice('csrf_token='.length);
  assert.ok(csrfToken, 'Login did not return a CSRF token');
  return { cookie, csrfToken, user: body.user };
}

async function api(session, path, options = {}) {
  const method = options.method ?? 'GET';
  const headers = {
    cookie: session.cookie,
    'x-requested-with': 'XMLHttpRequest',
    ...(stateChanging.has(method) ? { 'x-csrf-token': session.csrfToken } : {}),
    ...(options.body !== undefined ? { 'content-type': 'application/json' } : {}),
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

const runSuffix = Date.now().toString(36);
const admin = await login(adminEmail, adminPassword);
const roles = expectStatus(await api(admin, '/api/v1/roles?limit=100'), 200, 'list roles').items;
const departments = expectStatus(await api(admin, '/api/v1/departments?limit=100'), 200, 'list departments').items;
const roleId = (name) => roles.find((role) => role.name === name)?.id;
const departmentId = (name) => departments.find((department) => department.name === name)?.id;
const operatorRoleId = roleId('OPERATOR');
const leadRoleId = roleId('DEPARTMENT');
const operationsId = departmentId('Operations');
const salesId = departmentId('Sales');
assert.ok(operatorRoleId && leadRoleId && operationsId && salesId, 'Required roles/departments are missing');

async function createUser(label, role, department, email) {
  return expectStatus(
    await api(admin, '/api/v1/users', {
      method: 'POST',
      body: {
        email,
        password: userPassword,
        first_name: 'PreQA',
        last_name: label,
        role_id: role,
        department_id: department,
      },
    }),
    201,
    `create ${label}`
  );
}

const creatorEmail = `preqa.creator.${runSuffix}@example.test`;
const creatorUser = await createUser('Creator', operatorRoleId, operationsId, creatorEmail);
const peerUser = await createUser('Peer', operatorRoleId, operationsId, `preqa.peer.${runSuffix}@example.test`);
const leadUser = await createUser('Lead', leadRoleId, operationsId, `preqa.lead.${runSuffix}@example.test`);
const otherUser = await createUser('Other', operatorRoleId, salesId, `preqa.other.${runSuffix}@example.test`);

const creator = await login(creatorEmail, userPassword);
const peer = await login(peerUser.email, userPassword);
const lead = await login(leadUser.email, userPassword);
const other = await login(otherUser.email, userPassword);
const screens = expectStatus(await api(admin, '/api/v1/screens?limit=100'), 200, 'list screens').items;
const screenId = requestedScreenId ?? screens.find((screen) => screen.name.startsWith('PreQA Runtime Screen'))?.id;
assert.ok(screenId && screens.some((screen) => screen.id === screenId), 'Requested PreQA screen fixture is missing');

const layoutSpec = {
  slots: [{ id: 'main', x: 0, y: 0, w: 1, h: 1, z: 0, fit: 'contain', audio_enabled: true }],
};
const media = expectStatus(
  await api(creator, '/api/v1/media', { method: 'POST', body: { name: `ownership-${runSuffix}.mp4`, type: 'VIDEO' } }),
  201,
  'create department media'
);
const layout = expectStatus(
  await api(creator, '/api/v1/layouts', {
    method: 'POST',
    body: { name: `Ownership Layout ${runSuffix}`, aspect_ratio: '16:9', spec: layoutSpec },
  }),
  201,
  'create department layout'
);
const presentation = expectStatus(
  await api(creator, '/api/v1/presentations', {
    method: 'POST',
    body: { name: `Ownership Presentation ${runSuffix}`, layout_id: layout.id },
  }),
  201,
  'create department presentation'
);
const start = new Date(Date.now() + 5 * 60_000);
const end = new Date(Date.now() + 65 * 60_000);
const itemStart = new Date(start.getTime() + 5 * 60_000);
const itemEnd = new Date(start.getTime() + 15 * 60_000);
const schedule = expectStatus(
  await api(creator, '/api/v1/schedules', {
    method: 'POST',
    body: {
      name: `Ownership Schedule ${runSuffix}`,
      timezone: 'Asia/Kolkata',
      start_at: start.toISOString(),
      end_at: end.toISOString(),
    },
  }),
  201,
  'create department schedule'
);
expectStatus(
  await api(creator, `/api/v1/schedules/${schedule.id}/items`, {
    method: 'POST',
    body: {
      presentation_id: presentation.id,
      start_at: itemStart.toISOString(),
      end_at: itemEnd.toISOString(),
      screen_ids: [screenId],
      screen_group_ids: [],
    },
  }),
  201,
  'add compatible department presentation to department schedule'
);
const scheduleRequest = expectStatus(
  await api(creator, '/api/v1/schedule-requests', {
    method: 'POST',
    body: { schedule_id: schedule.id, notes: 'Pre-QA tombstone continuity' },
  }),
  201,
  'create schedule request'
);
const cancelledRequest = expectStatus(
  await api(creator, `/api/v1/schedule-requests/${scheduleRequest.id}/cancel`, { method: 'POST' }),
  200,
  'cancel schedule request to release the mutable schedule'
);
assert.equal(cancelledRequest.status, 'CANCELLED');

for (const [name, resource] of Object.entries({ media, layout, presentation, schedule })) {
  assert.equal(resource.ownership.scope, 'DEPARTMENT', `${name} scope`);
  assert.equal(resource.ownership.department_id, operationsId, `${name} owner department`);
  assert.equal(resource.ownership.creator.id, creatorUser.id, `${name} creator`);
}

const resourcePaths = {
  media: `/api/v1/media/${media.id}`,
  layout: `/api/v1/layouts/${layout.id}`,
  presentation: `/api/v1/presentations/${presentation.id}`,
  schedule: `/api/v1/schedules/${schedule.id}`,
};

for (const [name, path] of Object.entries(resourcePaths)) {
  const peerView = expectStatus(await api(peer, path), 200, `peer reads ${name}`);
  assert.equal(peerView.permissions.can_update, false, `peer cannot update ${name}`);
  assert.equal(peerView.permissions.can_delete, false, `peer cannot delete ${name}`);
  const leadView = expectStatus(await api(lead, path), 200, `lead reads ${name}`);
  if (name !== 'media') assert.equal(leadView.permissions.can_update, true, `lead can update ${name}`);
  if (name !== 'schedule') assert.equal(leadView.permissions.can_delete, true, `lead can delete ${name}`);
  expectStatus(await api(other, path), 403, `other department cannot read ${name}`);
}

expectStatus(
  await api(peer, `/api/v1/layouts/${layout.id}`, { method: 'PATCH', body: { description: 'peer should fail' } }),
  403,
  'peer layout update denied'
);
expectStatus(
  await api(lead, `/api/v1/layouts/${layout.id}`, { method: 'PATCH', body: { description: 'lead managed' } }),
  200,
  'department lead layout update'
);
expectStatus(
  await api(lead, `/api/v1/presentations/${presentation.id}`, { method: 'PATCH', body: { description: 'lead managed' } }),
  200,
  'department lead presentation update'
);
expectStatus(
  await api(lead, `/api/v1/schedules/${schedule.id}`, { method: 'PATCH', body: { description: 'lead managed' } }),
  200,
  'department lead schedule update'
);

const orgLayout = expectStatus(
  await api(admin, '/api/v1/layouts', {
    method: 'POST',
    body: { name: `Organization Layout ${runSuffix}`, aspect_ratio: '16:9', spec: layoutSpec },
  }),
  201,
  'create organization layout'
);
assert.equal(orgLayout.ownership.scope, 'ORGANIZATION');
const creatorOrgView = expectStatus(await api(creator, `/api/v1/layouts/${orgLayout.id}`), 200, 'creator reads organization layout');
assert.equal(creatorOrgView.permissions.can_update, false);
expectStatus(
  await api(admin, '/api/v1/presentations', {
    method: 'POST',
    body: { name: `Invalid Organization Presentation ${runSuffix}`, layout_id: layout.id },
  }),
  400,
  'organization presentation rejects department layout'
);
const deptPresentationWithOrgLayout = expectStatus(
  await api(creator, '/api/v1/presentations', {
    method: 'POST',
    body: { name: `Department Uses Organization ${runSuffix}`, layout_id: orgLayout.id },
  }),
  201,
  'department presentation accepts organization layout'
);
assert.equal(deptPresentationWithOrgLayout.ownership.scope, 'DEPARTMENT');

const orgSchedule = expectStatus(
  await api(admin, '/api/v1/schedules', {
    method: 'POST',
    body: {
      name: `Organization Schedule ${runSuffix}`,
      start_at: start.toISOString(),
      end_at: end.toISOString(),
    },
  }),
  201,
  'create organization schedule'
);
expectStatus(
  await api(admin, `/api/v1/schedules/${orgSchedule.id}/items`, {
    method: 'POST',
    body: {
      presentation_id: presentation.id,
      start_at: itemStart.toISOString(),
      end_at: itemEnd.toISOString(),
      screen_ids: [screenId],
      screen_group_ids: [],
    },
  }),
  400,
  'organization schedule rejects department presentation'
);

expectStatus(
  await api(admin, `/api/v1/users/${creatorUser.id}`, { method: 'PATCH', body: { department_id: salesId } }),
  200,
  'transfer creator'
);
expectStatus(await api(creator, `/api/v1/layouts/${layout.id}`), 401, 'old creator session revoked after transfer');
for (const [name, path] of Object.entries(resourcePaths)) {
  const retained = expectStatus(await api(admin, path), 200, `admin reads transferred creator ${name}`);
  assert.equal(retained.ownership.department_id, operationsId, `${name} ownership stays in Operations after transfer`);
  assert.equal(retained.ownership.creator.id, creatorUser.id, `${name} creator attribution stays unchanged after transfer`);
}

const firstDelete = expectStatus(await api(admin, `/api/v1/users/${creatorUser.id}`, { method: 'DELETE' }), 200, 'delete creator');
assert.equal(firstDelete.already_deleted, false);
const secondDelete = expectStatus(await api(admin, `/api/v1/users/${creatorUser.id}`, { method: 'DELETE' }), 200, 'repeat creator delete');
assert.equal(secondDelete.already_deleted, true);

const deletedLogin = await fetch(`${baseUrl}/api/v1/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-requested-with': 'XMLHttpRequest' },
  body: JSON.stringify({ email: creatorEmail, password: userPassword }),
});
assert.equal(deletedLogin.status, 401, 'deleted user login must be rejected');

const usersAfterDelete = expectStatus(await api(admin, '/api/v1/users?limit=100'), 200, 'list active users after deletion');
assert.equal(usersAfterDelete.items.some((user) => user.id === creatorUser.id), false, 'tombstone must be absent from active users');
expectStatus(await api(admin, `/api/v1/users/${creatorUser.id}`), 404, 'deleted user detail hidden');

for (const [name, path] of Object.entries(resourcePaths)) {
  const retained = expectStatus(await api(admin, path), 200, `admin reads tombstoned creator ${name}`);
  assert.equal(retained.ownership.department_id, operationsId, `${name} ownership remains Operations after deletion`);
  assert.equal(retained.ownership.creator.id, creatorUser.id, `${name} creator ID retained`);
  assert.equal(retained.ownership.creator.status, 'DELETED', `${name} creator marked deleted`);
  assert.equal(JSON.stringify(retained).includes(creatorEmail), false, `${name} response must not expose deleted email`);
}

const requestAfterDelete = expectStatus(
  await api(admin, `/api/v1/schedule-requests/${scheduleRequest.id}?include=users,schedule`),
  200,
  'schedule request survives creator deletion'
);
assert.equal(requestAfterDelete.requested_by_user?.status, 'DELETED');
assert.equal(JSON.stringify(requestAfterDelete).includes(creatorEmail), false, 'schedule request must not expose deleted email');

const replacement = await createUser('Replacement', operatorRoleId, salesId, creatorEmail);
assert.notEqual(replacement.id, creatorUser.id, 'email reuse must create a different identity');

const departmentDelete = await api(admin, `/api/v1/departments/${operationsId}`, { method: 'DELETE' });
expectStatus(departmentDelete, 409, 'owning department deletion blocked');
const usage = departmentDelete.body?.error?.details;
assert.ok(usage, 'department conflict must include usage counts');
assert.ok(usage.media >= 1, 'department conflict media count');
assert.ok(usage.layouts >= 1, 'department conflict layout count');
assert.ok(usage.presentations >= 2, 'department conflict presentation count');
assert.ok(usage.schedules >= 1, 'department conflict schedule count');

const summary = {
  runSuffix,
  users: {
    creator: creatorUser.id,
    peer: peerUser.id,
    departmentLead: leadUser.id,
    otherDepartment: otherUser.id,
    replacement: replacement.id,
  },
  resources: {
    media: media.id,
    layout: layout.id,
    presentation: presentation.id,
    schedule: schedule.id,
    scheduleRequest: scheduleRequest.id,
    organizationLayout: orgLayout.id,
    organizationSchedule: orgSchedule.id,
    screen: screenId,
  },
  assertions: {
    roleAndScopeMatrix: 'passed',
    nestedOwnershipClosure: 'passed',
    transferRevocationAndStableOwnership: 'passed',
    tombstoneAndIdempotency: 'passed',
    emailReuseAndHistoryPrivacy: 'passed',
    departmentDeleteCounts: usage,
  },
};

process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
