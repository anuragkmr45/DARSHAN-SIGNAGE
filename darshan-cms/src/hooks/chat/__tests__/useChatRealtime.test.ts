import { beforeEach, describe, expect, test, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { clearChatTypingTimeouts, getLastSeenSeqFromCache } from "@/hooks/chat/useChatRealtime";
import { chatQueryKeys } from "@/hooks/chat/useChatQueries";
import type { ChatListMessagesResponse } from "@/api/types";

test("reconnect uses the normal timeline cursor even when a focused link has a later message", () => {
  const client = new QueryClient();
  const page = (seq: number): ChatListMessagesResponse => ({ items: [{ id: `message-${seq}`, seq }] as ChatListMessagesResponse["items"] });
  client.setQueryData(chatQueryKeys.messages("room-1"), { pages: [page(120)], pageParams: [{ latest: true }] });
  client.setQueryData(chatQueryKeys.messages("room-1", "message-200"), { pages: [page(200)], pageParams: [{ aroundMessageId: "message-200" }] });
  expect(getLastSeenSeqFromCache(client, "room-1")).toBe(120);
  client.removeQueries({ queryKey: chatQueryKeys.messages("room-1"), exact: true });
  expect(getLastSeenSeqFromCache(client, "room-1")).toBe(200);
});

describe("useChatRealtime typing timer cleanup", () => {
  beforeEach(() => {
    vi.stubGlobal("window", {
      clearTimeout: vi.fn(),
    });
  });

  test("clears all pending typing timers and empties the timer map", () => {
    const timers = {
      "conversation-1:user-1": 101,
      "conversation-2:user-2": 202,
    };

    clearChatTypingTimeouts(timers);

    expect(window.clearTimeout).toHaveBeenCalledWith(101);
    expect(window.clearTimeout).toHaveBeenCalledWith(202);
    expect(timers).toEqual({});
  });

  test("can clear timers from the previous conversation before a new subscription lifecycle", () => {
    const previousConversationTimers = {
      "conversation-previous:user-1": 303,
    };
    const nextConversationTimers = {
      "conversation-next:user-2": 404,
    };

    clearChatTypingTimeouts(previousConversationTimers);

    expect(window.clearTimeout).toHaveBeenCalledWith(303);
    expect(previousConversationTimers).toEqual({});
    expect(nextConversationTimers).toEqual({ "conversation-next:user-2": 404 });
  });
});
