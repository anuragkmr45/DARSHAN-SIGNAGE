import { describe, expect, it } from "vitest";
import { describeMediaStatusReason, resolveMediaSourceFormat } from "./media";

describe("resolveMediaSourceFormat", () => {
  it.each([
    ["application/pdf", "PDF", "PDF document"],
    ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "DOCX", "Word (.docx)"],
    ["application/vnd.openxmlformats-officedocument.presentationml.presentation", "PPTX", "PowerPoint (.pptx)"],
    ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "XLSX", "Excel (.xlsx)"],
    ["text/csv", "CSV", "CSV spreadsheet"],
  ])("shows the source format for %s even when playback is PDF", (sourceMime, badge, label) => {
    expect(resolveMediaSourceFormat({ source_content_type: sourceMime, content_type: "application/pdf" })).toEqual({ badge, label });
  });
});

describe("describeMediaStatusReason", () => {
  it("explains known processing codes without losing their technical identity", () => {
    expect(describeMediaStatusReason("WEBPAGE_CAPTURE_FAILED")).toEqual({
      message: "This retired webpage item cannot be prepared for playback.",
      isTechnicalCode: true,
    });
    expect(describeMediaStatusReason("VIDEO_TRANSCODE_FAILED").message).toContain("video could not be prepared");
  });

  it("keeps readable legacy text and hides unknown codes behind a safe explanation", () => {
    expect(describeMediaStatusReason("Video conversion failed")).toEqual({
      message: "Video conversion failed",
      isTechnicalCode: false,
    });
    expect(describeMediaStatusReason("NEW_WORKER_ERROR")).toEqual({
      message: "The file could not be prepared. Ask an administrator to check the processing logs.",
      isTechnicalCode: true,
    });
  });
});
