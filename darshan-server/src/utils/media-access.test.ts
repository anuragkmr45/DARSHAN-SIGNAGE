import { describe, expect, it } from 'vitest';
import { resolveMediaDeliveryFilename } from './media-access';

describe('resolveMediaDeliveryFilename', () => {
  it('names converted and native document delivery as PDF', () => {
    expect(resolveMediaDeliveryFilename({ name: 'Quarterly report', type: 'DOCUMENT' }, 'application/pdf')).toBe('Quarterly report.pdf');
    expect(resolveMediaDeliveryFilename({ name: 'Quarterly report', type: 'DOCUMENT' }, 'application/pdf', 'slides.pptx')).toBe('slides.pdf');
    expect(resolveMediaDeliveryFilename({ name: 'Report.pdf', type: 'DOCUMENT' }, 'application/pdf')).toBe('Report.pdf');
  });

  it('preserves source names for non-PDF delivery', () => {
    expect(resolveMediaDeliveryFilename({ name: 'Clip', type: 'VIDEO' }, 'video/mp4', 'clip.mp4')).toBe('clip.mp4');
  });
});
