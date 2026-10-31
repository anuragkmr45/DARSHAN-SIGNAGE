import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  admissionOpen: false,
  counterExists: false,
  unread: 3,
  inserts: 0,
  db: null as any,
}));

vi.mock('@/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/db')>();
  return { ...actual, getDatabase: () => mocks.db };
});

vi.mock('@/maintenance/content-mutation-admission', () => ({
  tryRunWithContentMutationAdmission: async (_kind: string, work: () => Promise<unknown>) =>
    mocks.admissionOpen ? { admitted: true, value: await work() } : { admitted: false },
  runWithContentMutationAdmission: async (_kind: string, work: () => Promise<unknown>) => work(),
}));

import { schema } from '@/db';
import { NotificationCounterRepository } from './notification-counter';

function selectBuilder() {
  let source: unknown;
  const rows = () => source === schema.userNotificationCounters
    ? (mocks.counterExists ? [{ unread_total: mocks.unread }] : [])
    : [{ count: mocks.unread }];
  const builder: any = {
    from(table: unknown) { source = table; return builder; },
    where() { return builder; },
    limit: async () => rows(),
    then(resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) {
      return Promise.resolve(rows()).then(resolve, reject);
    },
  };
  return builder;
}

beforeEach(() => {
  mocks.admissionOpen = false;
  mocks.counterExists = false;
  mocks.unread = 3;
  mocks.inserts = 0;
  const tx: any = {
    select: () => selectBuilder(),
    insert: () => ({
      values: () => ({
        onConflictDoUpdate: () => ({
          returning: async () => {
            mocks.inserts += 1;
            mocks.counterExists = true;
            return [{ unread_total: mocks.unread }];
          },
        }),
      }),
    }),
  };
  mocks.db = {
    select: () => selectBuilder(),
    transaction: async (work: (executor: typeof tx) => Promise<unknown>) => work(tx),
  };
});

describe('notification counter hidden-read reconciliation', () => {
  it('returns the source count without upsert while closed, then persists after reopen', async () => {
    const repo = new NotificationCounterRepository();

    await expect(repo.getUnreadTotal('00000000-0000-4000-8000-000000000001')).resolves.toBe(3);
    expect(mocks.inserts).toBe(0);
    expect(mocks.counterExists).toBe(false);

    mocks.admissionOpen = true;
    await expect(repo.getUnreadTotal('00000000-0000-4000-8000-000000000001')).resolves.toBe(3);
    expect(mocks.inserts).toBe(1);
    expect(mocks.counterExists).toBe(true);
  });
});
