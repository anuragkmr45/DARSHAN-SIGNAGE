import assert from 'node:assert/strict';

const baseUrl = process.env.RUNTIME_API_BASE_URL ?? 'http://127.0.0.1:13000';
const superAdminEmail = process.env.RUNTIME_SUPER_ADMIN_EMAIL;
const superAdminPassword = process.env.RUNTIME_SUPER_ADMIN_PASSWORD;
const userPassword = process.env.RUNTIME_USER_PASSWORD;

if (!superAdminEmail || !superAdminPassword || !userPassword) {
  throw new Error('RUNTIME_SUPER_ADMIN_EMAIL, RUNTIME_SUPER_ADMIN_PASSWORD and RUNTIME_USER_PASSWORD are required');
}

const SCREEN_ALLOWED = '11111111-1111-4111-8111-111111111101';
const SCREEN_DENIED = '11111111-1111-4111-8111-111111111102';
const MEDIA_A = '22222222-2222-4222-8222-222222222201';
const MEDIA_B = '22222222-2222-4222-8222-222222222202';
const stateChanging = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const results = [];

async function login(email, password) {
  const response = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-requested-with': 'XMLHttpRequest' },
    body: JSON.stringify({ email, password }),
  });
  const body = await response.json();
  assert.equal(response.status, 200, `Login failed for ${email}: ${JSON.stringify(body)}`);
  const cookies = response.headers.getSetCookie().map((value) => value.split(';')[0]);
  const csrfToken = cookies.find((value) => value.startsWith('csrf_token='))?.slice('csrf_token='.length);
  assert.ok(csrfToken, `Login for ${email} did not return a CSRF token`);
  return { cookie: cookies.join('; '), csrfToken, user: body.user };
}

async function api(session, path, options = {}) {
  const method = options.method ?? 'GET';
  const headers = {
    ...(session ? { cookie: session.cookie } : {}),
    'x-requested-with': 'XMLHttpRequest',
    ...(session && stateChanging.has(method) ? { 'x-csrf-token': session.csrfToken } : {}),
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
  return { status: response.status, body, headers: Object.fromEntries(response.headers.entries()) };
}

function expectStatus(result, status, label) {
  assert.equal(result.status, status, `${label}: expected ${status}, got ${result.status}: ${JSON.stringify(result.body)}`);
  return result.body;
}

function expectDenied(result, label) {
  assert.ok([403, 404].includes(result.status), `${label}: expected 403/404, got ${result.status}: ${JSON.stringify(result.body)}`);
  return result.status;
}

async function check(id, name, fn) {
  const startedAt = Date.now();
  try {
    const evidence = await fn();
    results.push({ id, name, status: 'PASS', duration_ms: Date.now() - startedAt, evidence });
  } catch (error) {
    results.push({
      id,
      name,
      status: 'FAIL',
      duration_ms: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function record(id, name, status, evidence) {
  results.push({ id, name, status, duration_ms: 0, evidence });
}

const runSuffix = Date.now().toString(36);
const root = await login(superAdminEmail, superAdminPassword);
const roleList = expectStatus(await api(root, '/api/v1/roles?limit=100'), 200, 'list roles').items;
const departmentList = expectStatus(await api(root, '/api/v1/departments?limit=100'), 200, 'list departments').items;
const roleId = (name) => roleList.find((role) => role.name === name)?.id;
const departmentId = (name) => departmentList.find((department) => department.name === name)?.id;
const ids = {
  superAdminRole: roleId('SUPER_ADMIN'),
  adminRole: roleId('ADMIN'),
  operatorRole: roleId('OPERATOR'),
  operations: departmentId('Operations'),
  sales: departmentId('Sales'),
};
for (const [key, value] of Object.entries(ids)) assert.ok(value, `Missing setup identifier: ${key}`);

async function createUser(label, role, department = undefined) {
  const email = `runtime.${label.toLowerCase().replace(/[^a-z0-9]+/g, '.')}.${runSuffix}@example.test`;
  const user = expectStatus(await api(root, '/api/v1/users', {
    method: 'POST',
    body: {
      email,
      password: userPassword,
      first_name: 'Runtime',
      last_name: label,
      role_id: role,
      ...(department ? { department_id: department } : {}),
    },
  }), 201, `create ${label}`);
  return { ...user, password: userPassword };
}

async function createRole(name, grants) {
  return expectStatus(await api(root, '/api/v1/roles', {
    method: 'POST',
    body: { name: `${name} ${runSuffix}`, description: 'Runtime-only role', permissions: { grants } },
  }), 201, `create role ${name}`);
}

const creatorUser = await createUser('Creator', ids.operatorRole, ids.operations);
const peerUser = await createUser('Peer', ids.operatorRole, ids.operations);
const otherUser = await createUser('Other Department', ids.operatorRole, ids.sales);
const adminUser = await createUser('Administrator', ids.adminRole);
const creator = await login(creatorUser.email, userPassword);
const peer = await login(peerUser.email, userPassword);
const other = await login(otherUser.email, userPassword);
const admin = await login(adminUser.email, userPassword);

const layoutSpec = {
  slots: [{ id: 'main', x: 0, y: 0, w: 1, h: 1, z: 0, fit: 'contain', audio_enabled: true }],
};
const futureWindow = () => {
  const start = new Date(Date.now() + 15 * 60_000);
  const end = new Date(start.getTime() + 60 * 60_000);
  return { start_at: start.toISOString(), end_at: end.toISOString(), timezone: 'Asia/Kolkata' };
};

const departmentMedia = expectStatus(await api(creator, '/api/v1/media', {
  method: 'POST', body: { name: `department-${runSuffix}.mp4`, type: 'VIDEO' },
}), 201, 'create department media');
const creatorDeleteMedia = expectStatus(await api(creator, '/api/v1/media', {
  method: 'POST', body: { name: `creator-delete-${runSuffix}.png`, type: 'IMAGE' },
}), 201, 'create creator-delete media');
const departmentLayout = expectStatus(await api(creator, '/api/v1/layouts', {
  method: 'POST', body: { name: `Department Layout ${runSuffix}`, aspect_ratio: '16:9', spec: layoutSpec },
}), 201, 'create department layout');
const departmentPresentation = expectStatus(await api(creator, '/api/v1/presentations', {
  method: 'POST', body: { name: `Department Presentation ${runSuffix}`, layout_id: departmentLayout.id },
}), 201, 'create department presentation');
const departmentSchedule = expectStatus(await api(creator, '/api/v1/schedules', {
  method: 'POST', body: { name: `Department Schedule ${runSuffix}`, ...futureWindow() },
}), 201, 'create department schedule');

await check(1, 'Last active SUPER_ADMIN protection', async () => {
  const deleteCandidate = await createUser('SA Delete Candidate', ids.superAdminRole);
  const disableCandidate = await createUser('SA Disable Candidate', ids.superAdminRole);
  const demoteCandidate = await createUser('SA Demote Candidate', ids.superAdminRole);
  expectStatus(await api(root, `/api/v1/users/${deleteCandidate.id}`, { method: 'DELETE' }), 200, 'delete non-last SUPER_ADMIN');
  expectStatus(await api(root, `/api/v1/users/${disableCandidate.id}`, { method: 'PATCH', body: { is_active: false } }), 200, 'disable non-last SUPER_ADMIN');
  expectStatus(await api(root, `/api/v1/users/${demoteCandidate.id}`, { method: 'PATCH', body: { role_id: ids.adminRole } }), 200, 'demote non-last SUPER_ADMIN');

  const attempts = [
    await api(root, `/api/v1/users/${root.user.id}`, { method: 'DELETE' }),
    await api(root, `/api/v1/users/${root.user.id}`, { method: 'PATCH', body: { is_active: false } }),
    await api(root, `/api/v1/users/${root.user.id}`, { method: 'PATCH', body: { role_id: ids.adminRole } }),
  ];
  for (const attempt of attempts) {
    assert.equal(attempt.status, 409);
    assert.equal(attempt.body?.error?.code, 'LAST_ACTIVE_SUPER_ADMIN');
  }
  expectStatus(await api(root, '/api/v1/auth/me'), 200, 'last SUPER_ADMIN session remains active');
  return { non_last_removals: [200, 200, 200], last_admin_attempts: attempts.map((attempt) => attempt.status) };
});

await check(2, 'Operator directory is department-scoped', async () => {
  const listing = expectStatus(await api(peer, '/api/v1/users?limit=100'), 200, 'operator directory');
  assert.ok(listing.items.some((user) => user.id === creatorUser.id));
  assert.ok(listing.items.some((user) => user.id === peerUser.id));
  assert.ok(listing.items.every((user) => user.department_id === ids.operations));
  expectStatus(await api(peer, `/api/v1/users/${otherUser.id}`), 404, 'cross-department user detail hidden');
  return { visible_user_ids: listing.items.map((user) => user.id), total: listing.pagination.total, cross_department_detail: 404 };
});

await check(3, 'Media ownership', async () => {
  const peerView = expectStatus(await api(peer, `/api/v1/media/${departmentMedia.id}`), 200, 'peer reads department media');
  assert.equal(peerView.permissions.can_update, false);
  assert.equal(peerView.permissions.can_delete, false);
  expectStatus(await api(peer, `/api/v1/media/${departmentMedia.id}`, { method: 'DELETE' }), 403, 'peer media delete denied');
  expectDenied(await api(other, `/api/v1/media/${departmentMedia.id}`), 'cross-department media read denied');
  const creatorView = expectStatus(await api(creator, `/api/v1/media/${creatorDeleteMedia.id}`), 200, 'creator reads own media');
  assert.equal(creatorView.permissions.can_delete, true);
  expectStatus(await api(creator, `/api/v1/media/${creatorDeleteMedia.id}`, { method: 'DELETE' }), 200, 'creator deletes own media');
  return { peer_read: 200, peer_delete: 403, creator_delete: 200, scope: peerView.ownership.scope };
});

await check(4, 'Layout ownership', async () => {
  const peerView = expectStatus(await api(peer, `/api/v1/layouts/${departmentLayout.id}`), 200, 'peer reads department layout');
  assert.equal(peerView.permissions.can_update, false);
  assert.equal(peerView.permissions.can_delete, false);
  expectStatus(await api(peer, `/api/v1/layouts/${departmentLayout.id}`, { method: 'PATCH', body: { description: 'peer must fail' } }), 403, 'peer layout update denied');
  expectStatus(await api(creator, `/api/v1/layouts/${departmentLayout.id}`, { method: 'PATCH', body: { description: 'creator update' } }), 200, 'creator layout update');
  expectDenied(await api(other, `/api/v1/layouts/${departmentLayout.id}`), 'cross-department layout read denied');
  return { peer_read: 200, peer_update: 403, creator_update: 200, scope: peerView.ownership.scope };
});

await check(5, 'Presentation ownership', async () => {
  const peerView = expectStatus(await api(peer, `/api/v1/presentations/${departmentPresentation.id}`), 200, 'peer reads department presentation');
  assert.equal(peerView.permissions.can_update, false);
  expectStatus(await api(peer, `/api/v1/presentations/${departmentPresentation.id}`, { method: 'PATCH', body: { description: 'peer must fail' } }), 403, 'peer presentation update denied');
  expectStatus(await api(admin, `/api/v1/presentations/${departmentPresentation.id}`), 200, 'administrator reads department presentation');
  expectDenied(await api(other, `/api/v1/presentations/${departmentPresentation.id}`), 'cross-department presentation read denied');
  return { same_department_read: 200, same_department_update: 403, administrator_read: 200 };
});

await check(6, 'Schedule ownership', async () => {
  const peerView = expectStatus(await api(peer, `/api/v1/schedules/${departmentSchedule.id}`), 200, 'peer reads department schedule');
  assert.equal(peerView.permissions.can_update, true);
  expectStatus(await api(peer, `/api/v1/schedules/${departmentSchedule.id}`, { method: 'PATCH', body: { description: 'same-department update' } }), 200, 'same-department schedule update');
  expectStatus(await api(admin, `/api/v1/schedules/${departmentSchedule.id}`), 200, 'administrator reads department schedule');
  expectDenied(await api(other, `/api/v1/schedules/${departmentSchedule.id}`), 'cross-department schedule read denied');
  return { same_department_read: 200, same_department_update: 200, administrator_read: 200 };
});

async function createContentPack(session, label) {
  const media = expectStatus(await api(session, '/api/v1/media', {
    method: 'POST', body: { name: `${label}-${runSuffix}.png`, type: 'IMAGE' },
  }), 201, `create ${label} media`);
  const layout = expectStatus(await api(session, '/api/v1/layouts', {
    method: 'POST', body: { name: `${label} Layout ${runSuffix}`, aspect_ratio: '16:9', spec: layoutSpec },
  }), 201, `create ${label} layout`);
  const presentation = expectStatus(await api(session, '/api/v1/presentations', {
    method: 'POST', body: { name: `${label} Presentation ${runSuffix}`, layout_id: layout.id },
  }), 201, `create ${label} presentation`);
  const schedule = expectStatus(await api(session, '/api/v1/schedules', {
    method: 'POST', body: { name: `${label} Schedule ${runSuffix}`, ...futureWindow() },
  }), 201, `create ${label} schedule`);
  return { media, layout, presentation, schedule };
}

await check(7, 'ADMIN content is shared and SUPER_ADMIN content is private', async () => {
  const adminPack = await createContentPack(admin, 'Admin Shared');
  const rootPack = await createContentPack(root, 'Super Admin Restricted');
  const paths = {
    media: '/api/v1/media',
    layout: '/api/v1/layouts',
    presentation: '/api/v1/presentations',
    schedule: '/api/v1/schedules',
  };
  for (const key of Object.keys(paths)) {
    assert.equal(adminPack[key].ownership.scope, 'ORGANIZATION', `${key} ADMIN scope`);
    assert.equal(rootPack[key].ownership.scope, 'RESTRICTED', `${key} SUPER_ADMIN scope`);
    expectStatus(await api(peer, `${paths[key]}/${adminPack[key].id}`), 200, `operator reads ADMIN ${key}`);
    expectDenied(await api(peer, `${paths[key]}/${rootPack[key].id}`), `operator denied SUPER_ADMIN ${key}`);
  }
  return { subjects: Object.keys(paths), admin_scope: 'ORGANIZATION', super_admin_scope: 'RESTRICTED' };
});

await check(8, 'Custom-role permissions are name-independent', async () => {
  const customRole = await createRole('Arbitrary Content Steward', [
    ...['Media', 'Layout', 'Presentation', 'Schedule'].flatMap((subject) => [
      { action: 'read', subject }, { action: 'create', subject }, { action: 'update', subject }, { action: 'delete', subject },
    ]),
  ]);
  const customUser = await createUser('Custom Permission User', customRole.id, ids.operations);
  const custom = await login(customUser.email, userPassword);
  const pack = await createContentPack(custom, 'Custom Role');
  for (const resource of Object.values(pack)) assert.equal(resource.ownership.scope, 'DEPARTMENT');
  expectStatus(await api(custom, `/api/v1/layouts/${pack.layout.id}`, { method: 'PATCH', body: { description: 'custom role update' } }), 200, 'custom role applies Layout update grant');
  expectStatus(await api(custom, `/api/v1/schedules/${pack.schedule.id}`, { method: 'PATCH', body: { description: 'custom role schedule update' } }), 200, 'custom role applies Schedule update grant');
  expectStatus(await api(custom, '/api/v1/users?limit=10'), 403, 'missing User permission denied');
  return { role_name: customRole.name, created_subjects: Object.keys(pack), denied_without_grant: 'User.read' };
});

const lowGroup = expectStatus(await api(root, '/api/v1/screen-groups', {
  method: 'POST', body: { name: `Runtime Low Group ${runSuffix}`, screen_ids: [SCREEN_ALLOWED] },
}), 201, 'create low-priority group');
const highGroup = expectStatus(await api(root, '/api/v1/screen-groups', {
  method: 'POST', body: { name: `Runtime High Group ${runSuffix}`, screen_ids: [SCREEN_ALLOWED] },
}), 201, 'create high-priority group');

let delegatedAllowedEmergency = null;
let delegatedDeniedEmergency = null;
await check(9, 'Delegated and global emergency target permissions', async () => {
  const delegateRole = await createRole('Selected Screen Emergency Delegate', [
    { action: 'read', subject: 'Screen' },
    { action: 'update', subject: 'Screen', conditions: { id: SCREEN_ALLOWED } },
  ]);
  const delegateUser = await createUser('Emergency Delegate', delegateRole.id, ids.operations);
  const delegate = await login(delegateUser.email, userPassword);
  delegatedAllowedEmergency = expectStatus(await api(delegate, '/api/v1/emergency/trigger', {
    method: 'POST', headers: { 'idempotency-key': `delegate-ok-${runSuffix}` },
    body: { message: 'Allowed direct-screen emergency', severity: 'HIGH', screen_ids: [SCREEN_ALLOWED] },
  }), 201, 'delegate triggers allowed screen');
  expectStatus(await api(delegate, '/api/v1/emergency/trigger', {
    method: 'POST', headers: { 'idempotency-key': `delegate-denied-${runSuffix}` },
    body: { message: 'Denied direct-screen emergency', severity: 'HIGH', screen_ids: [SCREEN_DENIED] },
  }), 403, 'delegate denied unassigned screen');
  expectStatus(await api(delegate, '/api/v1/emergency/trigger', {
    method: 'POST', headers: { 'idempotency-key': `delegate-group-${runSuffix}` },
    body: { message: 'Denied group emergency', screen_group_ids: [lowGroup.id] },
  }), 403, 'delegate denied group scope');
  expectStatus(await api(delegate, '/api/v1/emergency/trigger', {
    method: 'POST', headers: { 'idempotency-key': `delegate-global-${runSuffix}` },
    body: { message: 'Denied global emergency', target_all: true },
  }), 403, 'delegate denied global scope');
  const adminGroupEmergency = expectStatus(await api(admin, '/api/v1/emergency/trigger', {
    method: 'POST', headers: { 'idempotency-key': `admin-group-${runSuffix}` },
    body: { message: 'Administrator group emergency', screen_group_ids: [lowGroup.id] },
  }), 201, 'ADMIN triggers group emergency');
  const rootGlobalEmergency = expectStatus(await api(root, '/api/v1/emergency/trigger', {
    method: 'POST', headers: { 'idempotency-key': `root-global-${runSuffix}` },
    body: { message: 'SUPER_ADMIN global emergency', target_all: true },
  }), 201, 'SUPER_ADMIN triggers global emergency');
  delegatedDeniedEmergency = expectStatus(await api(admin, '/api/v1/emergency/trigger', {
    method: 'POST', headers: { 'idempotency-key': `admin-denied-screen-${runSuffix}` },
    body: { message: 'Admin emergency on delegate-denied screen', screen_ids: [SCREEN_DENIED] },
  }), 201, 'ADMIN triggers emergency on delegate-denied screen');
  return {
    delegate_direct_allowed: 201,
    delegate_other_screen: 403,
    delegate_group: 403,
    delegate_global: 403,
    admin_group: adminGroupEmergency.scope,
    super_admin_global: rootGlobalEmergency.scope,
  };
});

await check(10, 'Delegate emergency clear is limited to allowed screens', async () => {
  assert.ok(delegatedAllowedEmergency && delegatedDeniedEmergency, 'Emergency fixtures from requirement 9 are missing');
  const delegateRoleName = `Selected Screen Emergency Delegate ${runSuffix}`;
  const delegateRole = expectStatus(await api(root, `/api/v1/roles?limit=100&search=${encodeURIComponent(delegateRoleName)}`), 200, 'find delegate role').items.find((role) => role.name === delegateRoleName);
  assert.ok(delegateRole);
  const delegates = expectStatus(await api(root, `/api/v1/users?limit=100&role_id=${delegateRole.id}`), 200, 'find delegate user').items;
  assert.equal(delegates.length, 1);
  const delegate = await login(delegates[0].email, userPassword);
  expectStatus(await api(delegate, `/api/v1/emergency/${delegatedAllowedEmergency.id}/clear`, {
    method: 'POST', body: { clear_reason: 'Allowed incident resolved' },
  }), 200, 'delegate clears allowed emergency');
  expectStatus(await api(delegate, `/api/v1/emergency/${delegatedDeniedEmergency.id}/clear`, {
    method: 'POST', body: { clear_reason: 'Must not clear unassigned screen' },
  }), 403, 'delegate cannot clear unassigned emergency');
  const stillActive = expectStatus(await api(admin, '/api/v1/emergency/status'), 200, 'administrator reads emergency status');
  assert.ok(stillActive.active_emergencies.some((item) => item.id === delegatedDeniedEmergency.id));
  return { allowed_clear: 200, unassigned_clear: 403, unassigned_still_active: true };
});

await check(11, 'Out-of-scope Requests APIs are disabled', async () => {
  const requestsChecks = [
    await api(root, '/api/v1/requests'),
    await api(root, '/api/v1/requests/status-summary'),
    await api(root, '/api/v1/requests', { method: 'POST', body: {} }),
  ];
  for (const response of requestsChecks) assert.equal(response.status, 404);
  expectStatus(await api(root, '/api/v1/schedule-requests?limit=10'), 200, 'in-scope schedule requests remain available');
  return { requests_api_statuses: requestsChecks.map((response) => response.status), schedule_requests: 200 };
});

await check(12, 'Sessions stop immediately after sensitive account changes', async () => {
  const disabledUser = await createUser('Session Disabled', ids.operatorRole, ids.operations);
  const disabledSession = await login(disabledUser.email, userPassword);
  expectStatus(await api(root, `/api/v1/users/${disabledUser.id}`, { method: 'PATCH', body: { is_active: false } }), 200, 'disable user');
  expectStatus(await api(disabledSession, '/api/v1/auth/me'), 401, 'disabled old session revoked');

  const passwordUser = await createUser('Session Password', ids.operatorRole, ids.operations);
  const passwordSession = await login(passwordUser.email, userPassword);
  const changedPassword = 'RuntimeChanged-2026!Strong';
  expectStatus(await api(root, `/api/v1/users/${passwordUser.id}/reset-password`, {
    method: 'POST', body: { new_password: changedPassword },
  }), 200, 'change password');
  expectStatus(await api(passwordSession, '/api/v1/auth/me'), 401, 'password-change old session revoked');
  const oldLogin = await api(null, '/api/v1/auth/login', { method: 'POST', body: { email: passwordUser.email, password: userPassword } });
  assert.equal(oldLogin.status, 401);
  await login(passwordUser.email, changedPassword);

  const mutableRole = await createRole('Revocable Permission Role', [{ action: 'read', subject: 'Layout' }]);
  const permissionUser = await createUser('Session Permission', mutableRole.id, ids.operations);
  const permissionSession = await login(permissionUser.email, userPassword);
  expectStatus(await api(permissionSession, `/api/v1/layouts/${departmentLayout.id}`), 200, 'permission user reads layout before revocation');
  expectStatus(await api(root, `/api/v1/roles/${mutableRole.id}`, {
    method: 'PUT', body: { permissions: { grants: [] } },
  }), 200, 'remove role permission');
  expectStatus(await api(permissionSession, '/api/v1/auth/me'), 401, 'permission-change old session revoked');
  return { disabled_session: 401, password_changed_session: 401, permission_changed_session: 401, new_password_login: 200 };
});

await check(17, 'Explicit group priority is stable across edits', async () => {
  const initial = expectStatus(await api(root, '/api/v1/settings/default-media/targets'), 200, 'read target defaults');
  const saved = expectStatus(await api(root, '/api/v1/settings/default-media/targets', {
    method: 'PUT',
    body: {
      expected_revision: initial.revision,
      assignments: [
        { target_type: 'GROUP', target_id: lowGroup.id, media_id: MEDIA_A, aspect_ratio: '16:9', priority: 10 },
        { target_type: 'GROUP', target_id: highGroup.id, media_id: MEDIA_B, aspect_ratio: '16:9', priority: 90 },
      ],
    },
  }), 200, 'save explicit group priorities');
  const firstResolution = expectStatus(await api(root, `/api/v1/screens/${SCREEN_ALLOWED}/default-media`), 200, 'resolve higher-priority group default');
  assert.equal(firstResolution.media_id, MEDIA_B);
  assert.equal(firstResolution.source, 'GROUP');

  expectStatus(await api(root, `/api/v1/screen-groups/${highGroup.id}`, {
    method: 'PATCH', body: { name: `Runtime High Group Renamed ${runSuffix}` },
  }), 200, 'edit group metadata');
  const afterGroupEdit = expectStatus(await api(root, '/api/v1/settings/default-media/targets'), 200, 'read priority after group edit');
  assert.equal(afterGroupEdit.assignments.find((item) => item.target_id === highGroup.id)?.priority, 90);

  const updated = expectStatus(await api(root, '/api/v1/settings/default-media/targets', {
    method: 'PUT',
    body: {
      expected_revision: afterGroupEdit.revision,
      assignments: [
        { target_type: 'GROUP', target_id: lowGroup.id, media_id: MEDIA_B, aspect_ratio: '16:9' },
        { target_type: 'GROUP', target_id: highGroup.id, media_id: MEDIA_A, aspect_ratio: '16:9' },
      ],
    },
  }), 200, 'edit assignments without replacing priority');
  assert.equal(updated.assignments.find((item) => item.target_id === lowGroup.id)?.priority, 10);
  assert.equal(updated.assignments.find((item) => item.target_id === highGroup.id)?.priority, 90);
  const secondResolution = expectStatus(await api(root, `/api/v1/screens/${SCREEN_ALLOWED}/default-media`), 200, 'resolve priority after edit');
  assert.equal(secondResolution.media_id, MEDIA_A);
  return {
    priorities: { [lowGroup.id]: 10, [highGroup.id]: 90 },
    first_winner: MEDIA_B,
    winner_after_edit: MEDIA_A,
    priority_after_group_edit: 90,
    priority_after_omitted_update: 90,
  };
});

await check(18, 'Standard company fallback when no schedule/default exists', async () => {
  const current = expectStatus(await api(root, '/api/v1/settings/default-media/targets'), 200, 'read defaults before clearing');
  expectStatus(await api(root, '/api/v1/settings/default-media/targets', {
    method: 'PUT', body: { expected_revision: current.revision, assignments: [] },
  }), 200, 'clear target defaults');
  expectStatus(await api(root, '/api/v1/settings/default-media/variants', {
    method: 'PUT', body: { variants: {} },
  }), 200, 'clear aspect-ratio defaults');
  expectStatus(await api(root, '/api/v1/settings/default-media', {
    method: 'PUT', body: { media_id: null },
  }), 200, 'clear global default');
  const resolution = expectStatus(await api(root, `/api/v1/screens/${SCREEN_DENIED}/default-media`), 200, 'resolve no-content fallback');
  assert.ok(resolution.media, `Expected a standard company fallback image, but API returned ${JSON.stringify(resolution)}`);
  assert.notEqual(resolution.source, 'NONE');
  return { source: resolution.source, media_id: resolution.media_id };
});

for (const requiredId of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 17, 18]) {
  if (!results.some((result) => result.id === requiredId)) {
    record(requiredId, `Requirement ${requiredId}`, 'BLOCKED', { reason: 'Runtime check was not reached' });
  }
}

const output = {
  run: {
    timestamp: new Date().toISOString(),
    base_url: baseUrl,
    mode: 'live-built-api',
    database: 'darshan_runtime_test',
    run_suffix: runSuffix,
  },
  summary: {
    pass: results.filter((result) => result.status === 'PASS').length,
    fail: results.filter((result) => result.status === 'FAIL').length,
    blocked: results.filter((result) => result.status === 'BLOCKED').length,
  },
  results: results.sort((left, right) => left.id - right.id),
};

process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
