import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LiveSession, User } from "@/api/types";
const fixture = vi.hoisted(() => ({ grants: new Set<string>(), rows: [] as LiveSession[],
  queries: [] as Array<{ queryKey: readonly unknown[]; enabled?: boolean }>, mutations: [] as Array<{ retry?: unknown }>,
  actor: { id: "actor", email: "custom@example.test", role_id: "custom-role", role: "CUSTOM_AUTHOR" } as User }));
vi.mock("@/hooks/useAuthorization", () => ({ useAuthorization: () => ({ can: (action: string, subject: string) => fixture.grants.has(`${action}:${subject}`) }) }));
vi.mock("@/store/hooks", () => ({ useAppSelector: (selector: (state: { auth: { user: User } }) => unknown) => selector({ auth: { user: fixture.actor } }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ setQueryData: vi.fn(), invalidateQueries: vi.fn(), removeQueries: vi.fn() }),
  useMutation: (options: { retry?: unknown }) => { fixture.mutations.push(options); return { isPending: false, mutateAsync: vi.fn() }; },
  useQuery: (options: { queryKey: readonly unknown[]; enabled?: boolean }) => {
    fixture.queries.push(options);
    return { data: options.queryKey[0] === "live-sessions" && options.queryKey[1] === "list" && options.enabled ? { items: fixture.rows, pagination: { total: fixture.rows.length, pages: 1 } } : undefined,
      isLoading: false, isFetching: false, isError: false, isPlaceholderData: false, refetch: vi.fn() };
  },
}));
import LiveBroadcasts from "./LiveBroadcasts";

describe("live broadcast page permissions and query intent (server render)", () => {
  beforeEach(() => { fixture.grants.clear(); fixture.rows = []; fixture.queries = []; fixture.mutations = []; });
  it("lets a custom creator open authoring without issuing an unauthorized library/directory query", () => {
    fixture.grants.add("create:LiveBroadcast");
    const markup = renderToStaticMarkup(createElement(LiveBroadcasts));
    expect(markup).toContain("New live source"); expect(markup).toContain("does not allow listing existing sources");
    expect(fixture.queries.find(query => query.queryKey[1] === "list")?.enabled).toBe(false);
    expect(fixture.queries.find(query => query.queryKey[1] === "live-presenters")?.enabled).toBe(false);
    expect(fixture.mutations.map(mutation => mutation.retry)).toEqual([false, false]);
  });
  it("does not expose source creation merely because scheduling approval is permitted", () => {
    fixture.grants.add("read:LiveBroadcast"); fixture.grants.add("approve:ScheduleRequest");
    const markup = renderToStaticMarkup(createElement(LiveBroadcasts));
    expect(markup).not.toContain("New live source"); expect(markup).toContain("No live sources found");
  });
});
