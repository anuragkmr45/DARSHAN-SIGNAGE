import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  admissionOpen: false,
  rowExists: false,
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
}));

import { getScreenDisplayState } from './screen-display-state-service';

const screenId = '00000000-0000-4000-8000-000000000002';

function storedRow() {
  const now = new Date('2026-10-28T10:00:00.000Z');
  return {
    screen_id: screenId,
    desired_selection: { mode: 'PRIMARY', preferred_key: null },
    selection_version: 1,
    active_display_key: null,
    placement: 'UNVERIFIED',
    display_profile: null,
    profile_hash: null,
    profile_revision: 0,
    runtime_session_id: null,
    observation_seq: 0,
    observed_at: null,
    created_at: now,
    updated_at: now,
  };
}

function selectBuilder() {
  const builder: any = {
    from() { return builder; },
    where() { return builder; },
    limit: async () => (mocks.rowExists ? [storedRow()] : []),
    for: async () => (mocks.rowExists ? [storedRow()] : []),
  };
  return builder;
}

beforeEach(() => {
  mocks.admissionOpen = false;
  mocks.rowExists = false;
  mocks.inserts = 0;
  mocks.db = {
    select: () => selectBuilder(),
    insert: () => ({
      values: () => ({
        onConflictDoNothing: async () => {
          mocks.inserts += 1;
          mocks.rowExists = true;
        },
      }),
    }),
  };
});

describe('screen display state hidden-read creation', () => {
  it('returns the default state without insert while closed, then creates it after reopen', async () => {
    const deferred = await getScreenDisplayState(screenId);
    expect(deferred).toMatchObject({
      screen_id: screenId,
      selection_version: 1,
      placement: 'UNVERIFIED',
    });
    expect(mocks.inserts).toBe(0);
    expect(mocks.rowExists).toBe(false);

    mocks.admissionOpen = true;
    await expect(getScreenDisplayState(screenId)).resolves.toMatchObject({ screen_id: screenId });
    expect(mocks.inserts).toBe(1);
    expect(mocks.rowExists).toBe(true);
  });
});
