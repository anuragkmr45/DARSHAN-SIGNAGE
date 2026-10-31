import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ admissionOpen: false }));

vi.mock('@/maintenance/content-mutation-admission', () => ({
  tryRunWithContentMutationAdmission: async (_kind: string, work: () => Promise<unknown>) =>
    mocks.admissionOpen ? { admitted: true, value: await work() } : { admitted: false },
  runWithContentMutationAdmission: async (_kind: string, work: () => Promise<unknown>) => work(),
}));

import { ScheduleReservationRepository } from './schedule-reservation';

function createDb() {
  const update = vi.fn(() => {
    const builder: any = {
      set: () => builder,
      where: () => builder,
      returning: async () => [],
      then(resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) {
        return Promise.resolve([]).then(resolve, reject);
      },
    };
    return builder;
  });
  return { update };
}

beforeEach(() => {
  mocks.admissionOpen = false;
});

describe('schedule reservation read-path expiry admission', () => {
  it('does not issue expiry updates while closed and replays them after reopen', async () => {
    const repo = new ScheduleReservationRepository();
    const db = createDb();
    const now = new Date('2026-10-28T10:00:00.000Z');

    await expect(repo.tryExpireStaleHolds(now, db as any)).resolves.toEqual({ admitted: false });
    expect(db.update).not.toHaveBeenCalled();

    mocks.admissionOpen = true;
    await expect(repo.tryExpireStaleHolds(now, db as any)).resolves.toMatchObject({ admitted: true });
    expect(db.update).toHaveBeenCalledTimes(3);
  });
});
