import { describe, expect, it } from 'vitest';
import { isScheduleReservationActiveAt } from './schedule-reservation';

describe('schedule reservation logical expiry', () => {
  const now = new Date('2026-10-28T10:00:00.000Z');

  it('excludes elapsed holds and windows even before expiry persistence runs', () => {
    expect(isScheduleReservationActiveAt({
      state: 'HELD',
      end_at: new Date('2026-10-28T11:00:00.000Z'),
      hold_expires_at: new Date('2026-10-28T09:59:59.000Z'),
    }, now)).toBe(false);

    expect(isScheduleReservationActiveAt({
      state: 'PUBLISHED',
      end_at: new Date('2026-10-28T09:59:59.000Z'),
    }, now)).toBe(false);
  });

  it('keeps unexpired reservations visible while durable cleanup is deferred', () => {
    expect(isScheduleReservationActiveAt({
      state: 'HELD',
      end_at: new Date('2026-10-28T11:00:00.000Z'),
      hold_expires_at: new Date('2026-10-28T10:30:00.000Z'),
    }, now)).toBe(true);
    expect(isScheduleReservationActiveAt({
      state: 'RESERVED',
      end_at: new Date('2026-10-28T11:00:00.000Z'),
    }, now)).toBe(true);
  });
});
