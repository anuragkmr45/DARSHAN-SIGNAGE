import { describe, expect, it } from "vitest";
import { resolveMediaSourceFormat } from "./media";

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
