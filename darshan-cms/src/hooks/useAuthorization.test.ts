import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SelfAuthorization } from '@/api/domains/selfAuthorization';
import type { User } from '@/api/types';
const fixture = vi.hoisted(() => ({ auth: { user: null as User | null, token: 'synthetic-private-jwt', apiKey: 'synthetic-private-api-key' },
  authorization: null as SelfAuthorization | null, error: false, queries: [] as Array<{ queryKey: readonly unknown[]; enabled?: boolean; queryFn: (context: { signal?: AbortSignal }) => Promise<unknown> }> }));
vi.mock('@/store/hooks', () => ({ useAppSelector: (selector: (state: { auth: typeof fixture.auth }) => unknown) => selector({ auth: fixture.auth }) }));
vi.mock('@tanstack/react-query', () => ({ useQuery: (options: typeof fixture.queries[number]) => {
  fixture.queries.push(options); return { data: options.queryKey[0] === 'self-authorization' ? fixture.authorization : undefined,
    isLoading: false, isFetching: false, isError: options.queryKey[0] === 'self-authorization' && fixture.error, refetch: vi.fn() };
}, useQueryClient: () => ({ setQueryData: vi.fn(), invalidateQueries: vi.fn(), removeQueries: vi.fn() }), useMutation: () => ({ isPending: false, mutateAsync: vi.fn() }) }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
import { apiClient, ApiError } from '@/api/apiClient';
import { rolesApi } from '@/api/domains/roles';
import { getSelfAuthorization, canWithCapabilities } from '@/api/domains/selfAuthorization';
import { useAuthorization } from './useAuthorization';
import { canAccessModule, canManageBrandingSettings } from '@/lib/access';
import LiveBroadcasts from '@/pages/LiveBroadcasts';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const capabilities = [ ...['Schedule', 'ScheduleItem', 'ScheduleRequest', 'LiveBroadcast'].map(subject => ({ action: 'create', subject })),
  ...['LiveBroadcast', 'Schedule', 'Media', 'Presentation', 'Screen'].map(subject => ({ action: 'read', subject })) ];
const own = (): SelfAuthorization => ({ version: 1, user_id: id(1), role: { id: id(2), name: 'CUSTOM_CREATE_ONLY' }, department_id: id(3), department_ids: [id(3)], capabilities });
const actor = (): User => ({ id: id(1), role_id: id(2), role: 'CUSTOM_CREATE_ONLY', email: 'synthetic@example.test', department_id: id(3) });
function VisibleGate() { const auth = useAuthorization(); return createElement('p', {}, `${canAccessModule('live', fixture.auth.user, auth.can)}:${auth.can('create', 'ScheduleItem')}:${auth.can('read', 'Role')}`); }
describe('actual self-authorization hook and LIVE navigation', () => {
  beforeEach(() => { fixture.auth.user = actor(); fixture.authorization = own(); fixture.error = false; fixture.queries = []; });
  afterEach(() => vi.restoreAllMocks());
  it('uses the real hook to expose allowed LIVE source/schedule controls without querying the forbidden role directory', () => {
    const directory = vi.spyOn(rolesApi, 'list').mockRejectedValue(new ApiError({ status: 403, message: 'Role directory denied' }));
    expect(renderToStaticMarkup(createElement(VisibleGate))).toContain('true:true:false');
    const markup = renderToStaticMarkup(createElement(LiveBroadcasts));
    expect(markup).toContain('New live source'); expect(markup).toContain('Schedule live event'); expect(markup).not.toContain('Approve and Publish');
    expect(directory).not.toHaveBeenCalled(); expect(fixture.queries.some(query => query.queryKey[0] === 'roles')).toBe(false);
  });
  it('calls only the self endpoint and binds the response to the current account', async () => {
    renderToStaticMarkup(createElement(VisibleGate)); const query = fixture.queries.find(query => query.queryKey[0] === 'self-authorization')!;
    const request = vi.spyOn(apiClient, 'request').mockResolvedValue(own()); await query.queryFn({ signal: new AbortController().signal });
    expect(request).toHaveBeenCalledWith(expect.objectContaining({ method: 'GET', path: '/auth/authorization', signal: expect.any(AbortSignal) }));
    request.mockResolvedValueOnce({ ...own(), user_id: id(90) }); await expect(getSelfAuthorization(id(1))).rejects.toMatchObject({ code: 'AUTHORIZATION_RESPONSE_INVALID' });
  });
  it('scopes query keys to account and non-secret session generation, including a new login by the same account', () => {
    renderToStaticMarkup(createElement(VisibleGate)); const first = fixture.queries[0].queryKey;
    expect(JSON.stringify(first)).not.toContain(fixture.auth.token); expect(JSON.stringify(first)).not.toContain(fixture.auth.apiKey);
    apiClient.invalidateSession(); fixture.queries = []; renderToStaticMarkup(createElement(VisibleGate)); const second = fixture.queries[0].queryKey;
    expect(second).not.toEqual(first); expect(second[1]).toBe(id(1));
    fixture.auth.user = { ...actor(), id: id(91) }; fixture.queries = [];
    expect(renderToStaticMarkup(createElement(VisibleGate))).toContain('false:false:false'); expect(fixture.queries[0].queryKey[1]).toBe(id(91));
  });
  it('fails closed on logout or a failed current permissions read, even if old data or a privileged role name remains', () => {
    fixture.auth.user = { ...actor(), role: 'SUPER_ADMIN' }; fixture.error = true;
    expect(renderToStaticMarkup(createElement(VisibleGate))).toContain('false:false:false');
    fixture.error = false; fixture.auth.user = null; expect(renderToStaticMarkup(createElement(VisibleGate))).toContain('false:false:false');
    expect(fixture.queries[fixture.queries.length - 1]?.enabled).toBe(false);
  });
  it('uses only exact server-expanded capabilities and server Branding decisions, never a role-name or wildcard shortcut', () => {
    expect(canWithCapabilities([{ action: 'manage', subject: 'all' }], 'read', 'Screen')).toBe(false);
    const denied = () => false; expect(canManageBrandingSettings({ ...actor(), role: 'SUPER_ADMIN' }, { id: id(2), name: 'SUPER_ADMIN' }, denied)).toBe(false);
    expect(canManageBrandingSettings({ ...actor(), role: 'ADMIN' }, { id: id(2), name: 'ADMIN' }, (action, subject) => action === 'update' && subject === 'BrandingSettings')).toBe(true);
  });
});
