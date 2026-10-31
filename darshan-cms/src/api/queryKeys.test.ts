import { describe, expect, it } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { queryKeys } from "./queryKeys";

describe("account-scoped directory cache keys", () => {
  it("keeps users, operators and invitations separate after an account switch", () => {
    const cache = new QueryClient();
    const queries = [
      [queryKeys.usersList("actor-a", 1, 9), queryKeys.usersList("actor-b", 1, 9)],
      [queryKeys.operatorDirectory("actor-a", 1, 9), queryKeys.operatorDirectory("actor-b", 1, 9)],
      [queryKeys.invitationsList("actor-a", 1, 9), queryKeys.invitationsList("actor-b", 1, 9)],
    ] as const;

    for (const [actorAKey, actorBKey] of queries) {
      cache.setQueryData(actorAKey, { items: [{ id: "private-to-a" }] });
      expect(cache.getQueryData(actorBKey)).toBeUndefined();
    }
    expect(queryKeys.usersList("actor-a", 2, 9)).not.toEqual(queryKeys.usersList("actor-a", 1, 9));
    cache.clear();
  });
});

describe("backup cache keys", () => {
  it("separates pages, records, and deletion operations", () => {
    expect(queryKeys.settingsBackupHistory({ limit: 20, cursor: "next" }))
      .not.toEqual(queryKeys.settingsBackupHistory({ limit: 20 }));
    expect(queryKeys.settingsBackupDetail("run-a")).not.toEqual(queryKeys.settingsBackupDetail("run-b"));
    expect(queryKeys.settingsBackupOperation("op-a")).not.toEqual(queryKeys.settingsBackupOperation("op-b"));
  });
});
