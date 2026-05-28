import { ApiError } from "@/api/apiClient";
import { mediaApi } from "@/api/domains/media";
import { getFriendlyUploadError, uploadMediaWithPresign } from "@/lib/mediaUploadFlow";
import { maybeCompressForUpload } from "@/lib/mediaCompression";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@/api/domains/media", () => ({
  mediaApi: {
    presignUpload: vi.fn(),
    complete: vi.fn(),
  },
}));

vi.mock("@/lib/mediaCompression", () => ({
  maybeCompressForUpload: vi.fn(),
}));

const mockedMediaApi = vi.mocked(mediaApi);
const mockedCompress = vi.mocked(maybeCompressForUpload);

const originalXmlHttpRequest = globalThis.XMLHttpRequest;
const originalWindow = globalThis.window;

class MockXMLHttpRequest {
  static instances: MockXMLHttpRequest[] = [];

  status = 200;
  responseText = "";
  upload = { onprogress: null as ((event: ProgressEvent<EventTarget>) => void) | null };
  onerror: (() => void) | null = null;
  onload: (() => void) | null = null;
  open = vi.fn();
  setRequestHeader = vi.fn();
  send = vi.fn((file: File) => {
    this.upload.onprogress?.({
      lengthComputable: true,
      loaded: file.size,
      total: file.size,
    } as ProgressEvent<EventTarget>);
    this.onload?.();
  });

  constructor() {
    MockXMLHttpRequest.instances.push(this);
  }
}

const makeFile = (name: string, type: string, size: number) =>
  new File([new Uint8Array(size)], name, { type, lastModified: 1 });

describe("uploadMediaWithPresign", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    MockXMLHttpRequest.instances = [];
    globalThis.XMLHttpRequest = MockXMLHttpRequest as unknown as typeof XMLHttpRequest;
    globalThis.window = undefined as typeof window;
  });

  afterEach(() => {
    globalThis.XMLHttpRequest = originalXmlHttpRequest;
    globalThis.window = originalWindow;
  });

  test("uses compressed file metadata for presign, upload, and complete", async () => {
    const originalFile = makeFile("poster.png", "image/png", 800_000);
    const compressedFile = makeFile("poster.webp", "image/webp", 220_000);

    mockedCompress.mockResolvedValue({
      file: compressedFile,
      didCompress: true,
      originalSize: originalFile.size,
      finalSize: compressedFile.size,
      width: 1920,
      height: 1440,
    });
    mockedMediaApi.presignUpload.mockResolvedValue({
      upload_url: "http://storage/upload",
      media_id: "media-1",
      bucket: "media-source",
      object_key: "media-1/poster.webp",
      expires_in: 300,
    });
    mockedMediaApi.complete.mockResolvedValue({
      id: "media-1",
      filename: "poster.webp",
      content_type: "image/webp",
      media_url: "http://cdn/poster.webp",
      size: compressedFile.size,
    });

    const onPrepared = vi.fn();
    const onProgress = vi.fn();

    const result = await uploadMediaWithPresign(originalFile, { onPrepared, onProgress });

    expect(mockedMediaApi.presignUpload).toHaveBeenCalledWith({
      filename: "poster.webp",
      display_name: "poster",
      content_type: "image/webp",
      size: 220_000,
    });
    expect(MockXMLHttpRequest.instances[0].send).toHaveBeenCalledWith(compressedFile);
    expect(mockedMediaApi.complete).toHaveBeenCalledWith("media-1", {
      content_type: "image/webp",
      size: 220_000,
      width: 1920,
      height: 1440,
      duration_seconds: undefined,
    });
    expect(onPrepared).toHaveBeenCalledWith({
      file: compressedFile,
      didCompress: true,
      originalSize: 800_000,
      finalSize: 220_000,
      width: 1920,
      height: 1440,
    });
    expect(onProgress).toHaveBeenCalledWith(100);
    expect(result.media.id).toBe("media-1");
    expect(result.finalSize).toBe(220_000);
  });

  test("passes through non-image file metadata unchanged", async () => {
    const file = makeFile("report.pdf", "application/pdf", 450_000);

    mockedCompress.mockResolvedValue({
      file,
      didCompress: false,
      originalSize: file.size,
      finalSize: file.size,
    });
    mockedMediaApi.presignUpload.mockResolvedValue({
      upload_url: "http://storage/upload",
      media_id: "media-2",
      bucket: "media-source",
      object_key: "media-2/report.pdf",
      expires_in: 300,
    });
    mockedMediaApi.complete.mockResolvedValue({
      id: "media-2",
      filename: "report.pdf",
      content_type: "application/pdf",
      size: file.size,
    });

    const result = await uploadMediaWithPresign(file);

    expect(mockedMediaApi.presignUpload).toHaveBeenCalledWith({
      filename: "report.pdf",
      display_name: "report",
      content_type: "application/pdf",
      size: 450_000,
    });
    expect(mockedMediaApi.complete).toHaveBeenCalledWith("media-2", {
      content_type: "application/pdf",
      size: 450_000,
    });
    expect(result.didCompress).toBe(false);
  });
});

describe("getFriendlyUploadError", () => {
  test("keeps 413/415/403 mappings unchanged", () => {
    expect(getFriendlyUploadError(new ApiError({ status: 413, message: "too large" }))).toBe(
      "Upload failed: file is too large.",
    );
    expect(getFriendlyUploadError(new ApiError({ status: 415, message: "bad type" }))).toBe(
      "Upload failed: unsupported file type.",
    );
    expect(getFriendlyUploadError(new ApiError({ status: 403, message: "forbidden" }))).toBe(
      "Upload failed: you do not have permission to upload this file.",
    );
  });
});
