import { describe, expect, it } from "vitest";
import { emptyLiveDraftForm, instantFromLocalInput, liveDraftReviewPayload, liveDraftStorageKey, localDateTime, newLiveDraftJournal, restoreLiveDraftJournal, serializeLiveDraftJournal } from "./liveScheduleDraft";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const complete = () => ({ ...emptyLiveDraftForm(), name: "  Town hall  ", live_session_id: id(1), presentation_id: id(2), preparation_id: id(3),
  start_at: "2050-01-01T10:00:00.000Z", end_at: "2050-01-01T11:00:00.000Z", screen_ids: [id(5), id(4), id(5)] });
describe("live authoring retry journal", () => {
  it("uses account-specific storage and stable restored draft/operation identities", () => {
    const journal = newLiveDraftJournal(), input = liveDraftReviewPayload(complete(), 0);
    journal.form = complete(); journal.pending_review = input;
    const restored = restoreLiveDraftJournal(JSON.stringify(journal));
    expect(restored.draft_id).toBe(journal.draft_id); expect(restored.pending_review).toEqual(input);
    expect(liveDraftStorageKey("a")).not.toBe(liveDraftStorageKey("b"));
    expect(newLiveDraftJournal().draft_id).not.toBe(journal.draft_id);
  });
  it("strips URLs, runtime tickets and unknown nested fields from restored drafts", () => {
    const journal = newLiveDraftJournal(); journal.form = complete();
    const raw = { ...journal, preview: { url: "https://example.test/?secret=must-not-persist" }, ticket: "must-not-persist",
      form: { ...journal.form, live_authority: { secret: "must-not-persist" } },
      pending_review: { ...liveDraftReviewPayload(journal.form, 0), downloads: [{ url: "must-not-persist" }] } };
    const restored = restoreLiveDraftJournal(JSON.stringify(raw));
    expect(JSON.stringify(restored)).not.toContain("must-not-persist");
    expect(restored.draft_id).toBe(journal.draft_id);
  });
  it("recovers corrupt journals without crashing or accepting negative revisions", () => {
    expect(restoreLiveDraftJournal("{").draft_revision).toBe(0);
    expect(restoreLiveDraftJournal(JSON.stringify({ ...newLiveDraftJournal(), draft_revision: -1 })).draft_revision).toBe(0);
    expect(() => serializeLiveDraftJournal({ ...newLiveDraftJournal(), draft_revision: -1 })).toThrow();
  });
  it("canonicalizes concrete targets and timestamps but generates a new explicit review command", () => {
    const left = liveDraftReviewPayload(complete(), 2), right = liveDraftReviewPayload(complete(), 2);
    expect(left).toMatchObject({ expected_revision: 2, name: "Town hall", screen_ids: [id(4), id(5)], start_at: "2050-01-01T10:00:00.000Z" });
    expect(left.request_id).not.toBe(right.request_id);
  });
  it("rejects missing selections and invalid or reversed windows before sending a mutation", () => {
    for (const form of [emptyLiveDraftForm(), { ...complete(), preparation_id: "" }, { ...complete(), screen_ids: [] },
      { ...complete(), start_at: "invalid" }, { ...complete(), end_at: complete().start_at }]) expect(() => liveDraftReviewPayload(form, 0)).toThrow();
  });
  it("converts server instants to input-local values without changing their instant", () => {
    const iso = "2050-01-01T10:00:00.000Z";
    expect(new Date(localDateTime(iso)).toISOString()).toBe(iso);
    expect(localDateTime("invalid")).toBe("");
  });
  it("preserves saved UTC instants when the operator computer timezone changes", () => {
    const prior = process.env.TZ;
    try {
      const form = complete(); process.env.TZ = "Asia/Kolkata";
      expect(localDateTime(form.start_at)).toBe("2050-01-01T15:30:00");
      process.env.TZ = "UTC"; expect(localDateTime(form.start_at)).toBe("2050-01-01T10:00:00");
      expect(liveDraftReviewPayload(form, 0).start_at).toBe("2050-01-01T10:00:00.000Z");
    } finally { if (prior === undefined) delete process.env.TZ; else process.env.TZ = prior; }
  });
  it("does not silently normalize nonexistent or ambiguous local times during clock changes", () => {
    const prior = process.env.TZ;
    try {
      process.env.TZ = "America/New_York";
      expect(() => instantFromLocalInput("2026-03-08T02:30")).toThrow("does not exist");
      expect(() => instantFromLocalInput("2026-11-01T01:30")).toThrow("occurs twice");
      expect(instantFromLocalInput("2026-11-01T03:30")).toBe("2026-11-01T08:30:00.000Z");
      expect(instantFromLocalInput("")).toBe("");
    } finally { if (prior === undefined) delete process.env.TZ; else process.env.TZ = prior; }
  });
});
