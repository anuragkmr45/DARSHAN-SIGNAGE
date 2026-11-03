import { describe, expect, it } from "vitest";
import { resolveMediaPreviewSource } from "./MediaPreview";

describe("resolveMediaPreviewSource", () => {
  it("never treats webpage playback URLs or storage IDs as image previews", () => {
    expect(resolveMediaPreviewSource({
      id: "web-1",
      filename: "Status page",
      name: "Status page",
      type: "WEBPAGE",
      media_url: "https://live.example.test/dashboard",
      thumbnail_object_id: "14424875-4191-4c34-801b-c284d19235d9",
    })).toBeUndefined();
  });

  it("does not render a legacy webpage fallback preview", () => {
    expect(resolveMediaPreviewSource({
      id: "web-1",
      filename: "Status page",
      name: "Status page",
      type: "WEBPAGE",
      fallback_media_url: "https://cdn.example.test/webpage-fallback.png",
    })).toBeUndefined();
  });
});
