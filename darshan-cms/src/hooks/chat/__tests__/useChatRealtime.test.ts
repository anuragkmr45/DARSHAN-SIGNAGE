import { beforeEach, describe, expect, test, vi } from "vitest";
import { clearChatTypingTimeouts } from "@/hooks/chat/useChatRealtime";

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
