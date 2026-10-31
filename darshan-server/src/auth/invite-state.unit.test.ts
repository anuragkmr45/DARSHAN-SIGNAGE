import { describe, expect, it } from 'vitest';
import { canAuthenticateInviteState, parseInviteExpiry, parseInviteToken } from '@/auth/invite-state';

describe('invitation authentication state', () => {
  it('allows direct accounts and completed invitations', () => {
    expect(canAuthenticateInviteState(null)).toBe(true);
    expect(canAuthenticateInviteState({ preference: 'compact' })).toBe(true);
    expect(canAuthenticateInviteState({ invite_status: 'ACTIVATED', invite_token: null })).toBe(true);
  });

  it('denies pending, expired and inconsistent invitation metadata', () => {
    expect(canAuthenticateInviteState({ invite_status: 'PENDING', invite_token: 'token' })).toBe(false);
    expect(canAuthenticateInviteState({ invite_status: 'EXPIRED', invite_token: 'token' })).toBe(false);
    expect(canAuthenticateInviteState({ invited_at: '2026-10-22T00:00:00.000Z' })).toBe(false);
    expect(canAuthenticateInviteState({ invite_status: 'ACTIVATED', invite_token: 'stale-token' })).toBe(false);
    expect(canAuthenticateInviteState({ invite_status: 'ACTIVATED', invite_token: '' })).toBe(false);
    expect(canAuthenticateInviteState({ invite_status: null, invite_token: null })).toBe(false);
    expect(canAuthenticateInviteState('PENDING')).toBe(false);
    expect(canAuthenticateInviteState([])).toBe(false);
  });

  it('accepts only canonical real UTC invitation expiries', () => {
    expect(parseInviteExpiry('2028-02-29T12:34:56.789Z')?.toISOString())
      .toBe('2028-02-29T12:34:56.789Z');
    expect(parseInviteExpiry('2000-02-29T12:34:56.789Z')?.toISOString())
      .toBe('2000-02-29T12:34:56.789Z');
    expect(parseInviteExpiry('2027-02-29T12:34:56.789Z')).toBeNull();
    expect(parseInviteExpiry('1900-02-29T12:34:56.789Z')).toBeNull();
    expect(parseInviteExpiry('2028-04-31T12:34:56.789Z')).toBeNull();
    expect(parseInviteExpiry('2028-02-29T12:34:56Z')).toBeNull();
    expect(parseInviteExpiry('not-a-date')).toBeNull();
    expect(parseInviteExpiry(null)).toBeNull();
  });

  it('accepts only a canonical 128-bit hexadecimal invitation token', () => {
    expect(parseInviteToken('AABBCCDDEEFF00112233445566778899')).toBe('aabbccddeeff00112233445566778899');
    expect(parseInviteToken('  aabbccddeeff00112233445566778899  ')).toBe('aabbccddeeff00112233445566778899');
    expect(parseInviteToken('')).toBeNull();
    expect(parseInviteToken('   ')).toBeNull();
    expect(parseInviteToken('not-a-token')).toBeNull();
    expect(parseInviteToken(null)).toBeNull();
  });
});
