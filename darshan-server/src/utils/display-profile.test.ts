import { describe, expect, it } from 'vitest';
import { areAspectsCompatible, aspectCompatibility, hashDisplayProfile, normalizeAspectRatio } from './display-profile';

describe('display profile aspect normalization', () => {
  it('reduces aliases without losing arbitrary ratios', () => {
    expect(normalizeAspectRatio(1920, 1080)).toBe('16:9');
    expect(normalizeAspectRatio(2400, 1000)).toBe('12:5');
    expect(normalizeAspectRatio(1024, 2560)).toBe('2:5');
  });

  it('uses symmetric ratio compatibility', () => {
    expect(aspectCompatibility(16 / 9, 16 / 9)).toBe(1);
    expect(areAspectsCompatible(16 / 9, (16 / 9) * 1.004)).toBe(true);
    expect(areAspectsCompatible(16 / 9, (16 / 9) * 1.006)).toBe(false);
  });

  it('does not treat observation ordering fields as a new profile', () => {
    const profile: any = {
      schema_version: 1,
      runtime_session_id: 'b550de2f-7c27-4f02-b024-c5ec0507c401',
      observation_seq: 1,
      observed_at: '2026-01-01T00:00:00.000Z',
      selection: { mode: 'PRIMARY', fallback_used: false },
      placement: 'VERIFIED',
      output: null,
      inventory: [],
      viewport: null,
    };
    const first = hashDisplayProfile(profile);
    expect(hashDisplayProfile({ ...profile, runtime_session_id: 'f685af00-2847-4371-b602-7d65c21de337', observation_seq: 2, observed_at: '2026-01-01T00:01:00.000Z' })).toBe(first);
  });
});
