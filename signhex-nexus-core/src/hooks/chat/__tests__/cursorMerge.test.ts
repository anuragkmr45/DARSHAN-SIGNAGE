import type { InfiniteData } from "@tanstack/react-query";
import { normalizeCursorParams } from "@/api/domains/chat";
import type { ChatListMessagesResponse, ChatMessage } from "@/api/types";
import {
  appendMessageInInfiniteData,
  clampChatCursorLimit,
  getLastSeenSeq,
  mergeChatMessages,
  normalizeDeletedMessagePatch,
  patchMessageInInfiniteData,
  tombstonePatch,
} from "@/hooks/chat/cursorUtils";

const makeMessage = (seq: number, overrides: Partial<ChatMessage> = {}): ChatMessage => ({
  id: overrides.id ?? `msg-${seq}`,
  conversation_id: overrides.conversation_id ?? "conv-1",
  seq,
  sender_id: overrides.sender_id ?? "user-1",
  body_text: Object.prototype.hasOwnProperty.call(overrides, "body_text") ? (overrides.body_text ?? null) : `message-${seq}`,
  body_rich: Object.prototype.hasOwnProperty.call(overrides, "body_rich") ? (overrides.body_rich ?? null) : null,
  reply_to_message_id: overrides.reply_to_message_id ?? null,
  thread_root_id: overrides.thread_root_id ?? null,
  thread_reply_count: overrides.thread_reply_count ?? 0,
  created_at: overrides.created_at ?? `2026-03-06T10:${String(seq).padStart(2, "0")}:00.000Z`,
  edited_at: overrides.edited_at ?? null,
  deleted_at: overrides.deleted_at ?? null,
  attachments: overrides.attachments ?? [],
  reactions: overrides.reactions ?? [],
  also_to_channel: overrides.also_to_channel,
  alsoToChannel: overrides.alsoToChannel,
});

const makeInfiniteData = (items: ChatMessage[]): InfiniteData<ChatListMessagesResponse, number> => ({
  pages: [{ items }],
  pageParams: [0],
});

const makeThreadInfiniteData = (items: ChatMessage[]): InfiniteData<ChatThreadResponse, number> => ({
  pages: [{ items, threadRootId: "msg-1" }],
  pageParams: [0],
});

describe("chat cursor merge + dedupe", () => {
  test("merges existing [1..10] with incoming [11..15]", () => {
    const existing = Array.from({ length: 10 }, (_, index) => makeMessage(index + 1));
    const incoming = Array.from({ length: 5 }, (_, index) => makeMessage(index + 11));

    const merged = mergeChatMessages(existing, incoming);
    expect(merged).toHaveLength(15);
    expect(merged[0].seq).toBe(1);
    expect(merged[14].seq).toBe(15);
  });

  test("duplicate message id in response is ignored (upsert by id)", () => {
    const existing = [makeMessage(10, { id: "same-id", body_text: "old" })];
    const incoming = [makeMessage(10, { id: "same-id", body_text: "new" })];

    const merged = mergeChatMessages(existing, incoming);
    expect(merged).toHaveLength(1);
    expect(merged[0].body_text).toBe("new");
  });

  test("duplicate id keeps existing attachments when incoming payload omits them", () => {
    const existing = [makeMessage(10, { id: "same-id", attachments: ["media-1"] })];
    const incoming = [makeMessage(10, { id: "same-id", attachments: [] })];

    const merged = mergeChatMessages(existing, incoming);
    expect(merged[0].attachments).toEqual(["media-1"]);
  });

  test("deleted incoming message does not preserve previous attachments", () => {
    const existing = [makeMessage(10, { id: "same-id", attachments: ["media-1"], reactions: [{ message_id: "same-id", user_id: "u1", emoji: "👍" }] })];
    const incoming = [makeMessage(10, { id: "same-id", attachments: [], reactions: [], deleted_at: "2026-03-06T12:00:00.000Z", body_text: null, body_rich: null })];

    const merged = mergeChatMessages(existing, incoming);
    expect(merged[0].attachments).toEqual([]);
    expect(merged[0].reactions).toEqual([]);
    expect(merged[0].body_text).toBeNull();
    expect(merged[0].deleted_at).toBe("2026-03-06T12:00:00.000Z");
  });

  test("out-of-order response still results in sorted cache", () => {
    const merged = mergeChatMessages([makeMessage(1), makeMessage(2)], [makeMessage(12), makeMessage(11)]);
    expect(merged.map((item) => item.seq)).toEqual([1, 2, 11, 12]);
  });

  test("duplicate seq with different ids keeps both and stable ordering by seq, created_at, id", () => {
    const sameSeqA = makeMessage(25, { id: "a", created_at: "2026-03-06T11:00:00.000Z" });
    const sameSeqB = makeMessage(25, { id: "b", created_at: "2026-03-06T11:00:00.000Z" });

    const merged = mergeChatMessages([sameSeqB], [sameSeqA]);
    expect(merged).toHaveLength(2);
    expect(merged.map((item) => item.id)).toEqual(["a", "b"]);
  });
});

describe("cursor defaults + limit clamping", () => {
  test("limit > 100 clamps to 100", () => {
    expect(clampChatCursorLimit(200)).toBe(100);
    expect(normalizeCursorParams({ limit: 200 }).limit).toBe(100);
  });

  test("no limit defaults to 50", () => {
    expect(clampChatCursorLimit(undefined)).toBe(50);
    expect(normalizeCursorParams({}).limit).toBe(50);
  });
});

describe("reconnect catch-up + ws patch helpers", () => {
  test("reconnect catch-up uses lastSeenSeq and appends only new messages", () => {
    const existing = Array.from({ length: 50 }, (_, index) => makeMessage(index + 1));
    const lastSeenSeq = getLastSeenSeq(existing);
    expect(lastSeenSeq).toBe(50);
    expect(normalizeCursorParams({ afterSeq: lastSeenSeq, limit: 50 })).toEqual({ afterSeq: 50, limit: 50 });

    const incoming = [makeMessage(51), makeMessage(52)];
    const merged = mergeChatMessages(existing, incoming);
    expect(merged).toHaveLength(52);
    expect(merged[merged.length - 1].seq).toBe(52);
  });

  test("chat:message:new append + chat:message:deleted tombstone patch behavior", () => {
    const initial = makeInfiniteData([makeMessage(1, { attachments: ["m1"], reactions: [{ message_id: "msg-1", user_id: "u", emoji: "👍" }] })]);
    const afterNew = appendMessageInInfiniteData(initial, makeMessage(2));
    expect(afterNew?.pages[0].items.map((item) => item.seq)).toEqual([1, 2]);

    const afterDelete = patchMessageInInfiniteData(afterNew, "msg-1", tombstonePatch("2026-03-06T12:00:00.000Z"));
    const deleted = afterDelete?.pages[0].items.find((item) => item.id === "msg-1");
    expect(deleted?.deleted_at).toBe("2026-03-06T12:00:00.000Z");
    expect(deleted?.body_text).toBeNull();
    expect(deleted?.attachments).toEqual([]);
    expect(deleted?.reactions).toEqual([]);
  });

  test("delete mutation patch normalizes partial response into a tombstone", () => {
    const partialDeleteResponse = {
      id: "msg-1",
      deleted_at: "2026-03-06T12:10:00.000Z",
      edited_at: "2026-03-06T12:10:00.000Z",
    } as Partial<ChatMessage>;

    const patch = normalizeDeletedMessagePatch(partialDeleteResponse);
    expect(patch.deleted_at).toBe("2026-03-06T12:10:00.000Z");
    expect(patch.body_text).toBeNull();
    expect(patch.body_rich).toBeNull();
    expect(patch.attachments).toEqual([]);
    expect(patch.reactions).toEqual([]);
    expect(patch.edited_at).toBe("2026-03-06T12:10:00.000Z");
  });

  test("thread cache tombstone patch removes attachments and reactions", () => {
    const initial = makeThreadInfiniteData([
      makeMessage(3, {
        id: "thread-msg",
        thread_root_id: "msg-1",
        attachments: ["media-9"],
        reactions: [{ message_id: "thread-msg", user_id: "u2", emoji: "🔥" }],
      }),
    ]);

    const afterDelete = patchMessageInInfiniteData(
      initial,
      "thread-msg",
      normalizeDeletedMessagePatch({ id: "thread-msg", deleted_at: "2026-03-06T12:20:00.000Z" }),
    );
    const deleted = afterDelete?.pages[0].items.find((item) => item.id === "thread-msg");

    expect(deleted?.deleted_at).toBe("2026-03-06T12:20:00.000Z");
    expect(deleted?.attachments).toEqual([]);
    expect(deleted?.reactions).toEqual([]);
    expect(deleted?.body_text).toBeNull();
  });
});
