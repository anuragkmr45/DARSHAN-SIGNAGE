import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const permission = vi.hoisted(() => ({ grants: new Set<string>(), loading: false }));
vi.mock('@/store/store', () => ({ store: { getState: vi.fn(), subscribe: vi.fn() } }));
vi.mock('@/hooks/useAuthorization', () => ({ useAuthorization: () => ({ isLoading: permission.loading, can: (action: string, subject: string) => permission.grants.has(`${action}:${subject}`) }) }));
vi.mock('@/components/ui/dialog', () => ({ Dialog: ({ children }: { children: ReactNode }) => createElement('section', {}, children),
  DialogContent: ({ children }: { children: ReactNode }) => createElement('div', {}, children), DialogHeader: ({ children }: { children: ReactNode }) => createElement('header', {}, children),
  DialogTitle: ({ children }: { children: ReactNode }) => createElement('h2', {}, children), DialogDescription: ({ children }: { children: ReactNode }) => createElement('p', {}, children) }));
import { LivePresenterPanel } from './LivePresenterPanel';
const render = () => renderToStaticMarkup(createElement(LivePresenterPanel, { actorId: 'actor', occurrenceId: 'occurrence', onClose: vi.fn() }));
describe('presenter controls initial operator contract', () => {
  beforeEach(() => { permission.grants.clear(); permission.loading = false; });
  it('requires effective publish permission rather than approval, management or a role name', () => {
    permission.grants.add('manage:LiveBroadcast'); permission.grants.add('approve:ScheduleRequest');
    expect(render()).toContain('does not allow presenting'); permission.grants.add('publish:LiveBroadcast'); expect(render()).toContain('Loading current presenter eligibility');
  });
  it('separates local preview, explicit Start and actual player display without issuing capture or API calls during render', () => {
    permission.grants.add('publish:LiveBroadcast'); const markup = render();
    expect(markup).toContain('Choose screen for local preview'); expect(markup).toContain('Start broadcast explicitly'); expect(markup).toContain('Stop sharing now');
    expect(markup).toContain('Muted local capture preview'); expect(markup).toContain('Local preview first frame'); expect(markup).toContain('SDK video publication');
    expect(markup).toContain('do not confirm player display'); expect(markup).toContain('Audio is optional and starts off');
    expect(markup).not.toContain('synthetic-private-ticket');
    const start = Array.from(markup.match(/<button\b[^>]*>[\s\S]*?<\/button>/g) ?? []).find(button => button.includes('Start broadcast explicitly'));
    expect(start).toMatch(/\sdisabled(?:=|[\s>])/);
  });
});
