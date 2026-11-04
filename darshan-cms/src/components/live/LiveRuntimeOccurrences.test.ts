import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { LiveRuntimeOccurrenceCard, LiveRuntimeOccurrences } from './LiveRuntimeOccurrences';
import type { LiveRuntimeOccurrence } from '@/api/liveRuntimeTypes';
const auth = vi.hoisted(() => ({ grants: new Set<string>() }));
vi.mock('@/hooks/useAuthorization', () => ({ useAuthorization: () => ({ isLoading: false, can: (action: string, subject: string) => auth.grants.has(`${action}:${subject}`) }) }));
const row = (): LiveRuntimeOccurrence => ({ id: 'occurrence', publish_id: 'publish', schedule_item_id: 'item', live_session_id: 'source', start_at: '2050-01-01T00:00:00.000Z', end_at: '2050-01-01T01:00:00.000Z', control_revision: 3, enabled: true, item_fingerprint: 'a'.repeat(64), presenter_user_id: 'presenter', microphone: false, screen_share_audio: true, screen_ids: ['screen'], run: null, can_start: true, can_stop: false, can_manage: false });
const props = { actorId: 'presenter', mayPublish: false, mayManage: false, onPresent: vi.fn(), onChanged: vi.fn(), onPending: vi.fn() };
const renderCard = (options: Parameters<typeof LiveRuntimeOccurrenceCard>[0]) => renderToStaticMarkup(createElement(QueryClientProvider, { client: new QueryClient() }, createElement(LiveRuntimeOccurrenceCard, options)));
describe('live runtime occurrence controls', () => {
  it('renders truthful backend state and audience without inventing player delivery or joining a room', () => {
    const markup = renderCard({ ...props, occurrence: row() });
    expect(markup).toContain('Not started'); expect(markup).toContain('1 approved screens'); expect(markup).toContain('does not confirm that every player');
    expect(markup).not.toContain('Open presenter controls'); expect(markup).not.toContain('Disable and stop'); expect(markup).not.toContain('Join');
  });
  it('requires current coarse permission and record-bound management or assigned presenter identity', () => {
    const presenter = renderCard({ ...props, occurrence: row(), mayPublish: true });
    expect(presenter).toContain('Open presenter controls'); expect(presenter).not.toContain('Disable and stop');
    const foreign = renderCard({ ...props, occurrence: row(), actorId: 'other', mayPublish: true, mayManage: true });
    expect(foreign).not.toContain('Open presenter controls'); expect(foreign).not.toContain('Disable and stop');
    const admin = renderCard({ ...props, occurrence: { ...row(), can_manage: true }, mayManage: true });
    expect(admin).toContain('Disable and stop');
    const disabled = renderCard({ ...props, occurrence: { ...row(), enabled: false, can_manage: true }, mayManage: true });
    expect(disabled).toContain('Re-enable occurrence'); expect(disabled).not.toContain('Disable and stop');
  });
  it('shows an explicit UTC reporting window only for effective current grants and does not show a pager before results', () => {
    const render = () => renderToStaticMarkup(createElement(QueryClientProvider, { client: new QueryClient() }, createElement(LiveRuntimeOccurrences, { actorId: 'actor', onPresent: vi.fn() })));
    auth.grants.clear(); expect(render()).toBe(''); auth.grants.add('publish:LiveBroadcast');
    const markup = render(); expect(markup).toContain('Window from (UTC)'); expect(markup).toContain('exclusive'); expect(markup).not.toContain('Previous live page'); expect(markup).not.toContain('Next live page'); expect(markup).toContain('never joins or subscribes');
    auth.grants.clear();
  });
});
