import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { LiveDraftReviewConsent } from './LiveDraftReviewConsent';

const props = { busy: false, unresolved: false, needsSavedLoad: false, editableSaved: false, notes: 'Reviewed by the creating operator', accepted: false,
  onNotesChange: vi.fn(), onAcceptedChange: vi.fn() };
const render = (changed: Partial<typeof props> = {}) => renderToStaticMarkup(createElement(LiveDraftReviewConsent, { ...props, ...changed }));
const controls = (markup: string): string[] => [markup.match(/<textarea\b[^>]*>/)?.[0] ?? '', ...(Array.from(markup.match(/<button\b[^>]*>/g) ?? []).filter(button => button.includes('role="checkbox"')))];
const disabled = (control: string) => /\sdisabled(?:=|[\s>])/.test(control);
describe('confirmed LIVE review consent for create-only operators', () => {
  it('renders real enabled note and acknowledgement controls even when saved Schedule/Item updates are forbidden', () => {
    const markup = render(); expect(markup).toContain('saved schedule is read-only'); expect(markup).toContain('submit it for approval');
    expect(markup).toContain('Reviewed by the creating operator'); expect(markup).toContain('Acknowledge frozen live review');
    expect(controls(markup)).toHaveLength(2); expect(controls(markup).every(control => !disabled(control))).toBe(true);
    expect(render({ accepted: true })).toContain('aria-checked="true"');
  });
  it.each(['busy', 'unresolved', 'needsSavedLoad'] as const)('blocks consent while %s rather than bypassing a pending authority/retry boundary', boundary => {
    const markup = render({ [boundary]: true }); expect(controls(markup)).toHaveLength(2); expect(controls(markup).every(disabled)).toBe(true);
  });
  it('also allows confirmed consent for editors without inventing an approval or publish permission', () => {
    const markup = render({ editableSaved: true }); expect(markup).not.toContain('saved schedule is read-only');
    expect(controls(markup).every(control => !disabled(control))).toBe(true); expect(markup).not.toContain('Approve and Publish'); expect(markup).not.toContain('Start broadcast');
  });
});
