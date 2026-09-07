import { ApiError } from "@/api/apiClient";
import { mediaApi } from "@/api/domains/media";
import {
  getFriendlyUploadError,
  sha256File,
  uploadMediaWithPresign,
  UploadHttpError,
  UploadPipelineError,
} from "@/lib/mediaUploadFlow";
import { maybeCompressForUpload } from "@/lib/mediaCompression";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@/api/domains/media", () => ({
  mediaApi: {
    getUploadPolicy: vi.fn(),
    createUploadSession: vi.fn(),
    getUploadSession: vi.fn(),
    presignUploadParts: vi.fn(),
    completeUploadSession: vi.fn(),
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
  static etag = '"part-etag"';

  status = 200;
  responseText = "";
  upload = { onprogress: null as ((event: ProgressEvent<EventTarget>) => void) | null };
  onerror: (() => void) | null = null;
  onload: (() => void) | null = null;
  getResponseHeader = vi.fn(() => MockXMLHttpRequest.etag);
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

const activeSingleSession = (mediaId: string, uploadUrl = "https://cms.test/media-staging/upload") => ({
  session_id: `session-${mediaId}`,
  media_id: mediaId,
  state: "ACTIVE" as const,
  strategy: "single" as const,
  expires_at: new Date(Date.now() + 60_000).toISOString(),
  part_size: null,
  part_count: 0,
  uploaded_parts: [],
  upload_url: uploadUrl,
  media: null,
  failure_reason: null,
});

describe("uploadMediaWithPresign", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    MockXMLHttpRequest.instances = [];
    MockXMLHttpRequest.etag = '"part-etag"';
    globalThis.XMLHttpRequest = MockXMLHttpRequest as unknown as typeof XMLHttpRequest;
    globalThis.window = undefined as typeof window;
    mockedMediaApi.getUploadPolicy.mockResolvedValue({
      max_bytes: 500 * 1024 * 1024,
      max_mb: 500,
      multipart_threshold_bytes: 100 * 1024 * 1024,
      part_size_bytes: 16 * 1024 * 1024,
      multipart_concurrency: 3,
      allowed_mime_types: [],
    });
  });

  afterEach(() => {
    globalThis.XMLHttpRequest = originalXmlHttpRequest;
    globalThis.window = originalWindow;
  });

  test("creates a verified single-part session, uploads through its CMS URL, and completes it", async () => {
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
    mockedMediaApi.createUploadSession.mockResolvedValue(activeSingleSession("media-1"));
    mockedMediaApi.completeUploadSession.mockResolvedValue({
      ...activeSingleSession("media-1"),
      state: "COMPLETED",
      media: {
      id: "media-1",
      filename: "poster.webp",
      content_type: "image/webp",
      media_url: "http://cdn/poster.webp",
      size: compressedFile.size,
      },
    });

    const onPrepared = vi.fn();
    const onProgress = vi.fn();

    const result = await uploadMediaWithPresign(originalFile, { onPrepared, onProgress });

    expect(mockedMediaApi.createUploadSession).toHaveBeenCalledWith(
      expect.objectContaining({
        filename: "poster.webp",
        display_name: "poster",
        content_type: "image/webp",
        size: 220_000,
        checksum_sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
      expect.any(String),
    );
    expect(MockXMLHttpRequest.instances[0].send).toHaveBeenCalledWith(compressedFile);
    expect(mockedMediaApi.completeUploadSession).toHaveBeenCalledWith("session-media-1", {
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
    mockedMediaApi.createUploadSession.mockResolvedValue(activeSingleSession("media-2"));
    mockedMediaApi.completeUploadSession.mockResolvedValue({
      ...activeSingleSession("media-2"),
      state: "COMPLETED",
      media: {
      id: "media-2",
      filename: "report.pdf",
      content_type: "application/pdf",
      size: file.size,
      },
    });

    const result = await uploadMediaWithPresign(file);

    expect(mockedMediaApi.createUploadSession).toHaveBeenCalledWith(
      expect.objectContaining({ filename: "report.pdf", display_name: "report", content_type: "application/pdf", size: 450_000 }),
      expect.any(String),
    );
    expect(mockedMediaApi.completeUploadSession).toHaveBeenCalledWith("session-media-2", {});
    expect(result.didCompress).toBe(false);
  });

  test("rejects an oversized prepared file before hashing or session creation", async () => {
    const file = makeFile("too-large.mp4", "video/mp4", 11);
    mockedMediaApi.getUploadPolicy.mockResolvedValue({
      max_bytes: 10,
      max_mb: 0.00001,
      multipart_threshold_bytes: 5,
      part_size_bytes: 5,
      multipart_concurrency: 3,
      allowed_mime_types: [],
    });
    mockedCompress.mockResolvedValue({ file, didCompress: false, originalSize: file.size, finalSize: file.size });

    await expect(uploadMediaWithPresign(file)).rejects.toMatchObject({ status: 413, stage: "policy" });
    expect(mockedMediaApi.createUploadSession).not.toHaveBeenCalled();
  });

  test("resumes server-listed multipart state and uploads remaining parts with bounded part URLs", async () => {
    const file = makeFile("large.mp4", "video/mp4", 9);
    mockedCompress.mockResolvedValue({ file, didCompress: false, originalSize: file.size, finalSize: file.size });
    mockedMediaApi.createUploadSession.mockResolvedValue({
      session_id: "multipart-session",
      media_id: "media-multipart",
      state: "ACTIVE",
      strategy: "multipart",
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      part_size: 5,
      part_count: 2,
      uploaded_parts: [{ part_number: 1, etag: '"already-uploaded"', size: 5 }],
      media: null,
      failure_reason: null,
    });
    mockedMediaApi.presignUploadParts.mockResolvedValue({
      session_id: "multipart-session",
      parts: [{ part_number: 2, upload_url: "https://cms.test/media-staging/part-2", expires_in: 900 }],
    });
    MockXMLHttpRequest.etag = '"newly-uploaded"';
    mockedMediaApi.completeUploadSession.mockResolvedValue({
      session_id: "multipart-session",
      media_id: "media-multipart",
      state: "COMPLETED",
      strategy: "multipart",
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      part_size: 5,
      part_count: 2,
      uploaded_parts: [],
      media: { id: "media-multipart", filename: "large.mp4", content_type: "video/mp4", size: 9 },
      failure_reason: null,
    });

    const result = await uploadMediaWithPresign(file);

    expect(mockedMediaApi.presignUploadParts).toHaveBeenCalledWith("multipart-session", [2]);
    expect(MockXMLHttpRequest.instances).toHaveLength(1);
    expect(MockXMLHttpRequest.instances[0].send.mock.calls[0]?.[0].size).toBe(4);
    expect(mockedMediaApi.completeUploadSession).toHaveBeenCalledWith("multipart-session", {
      parts: [
        { part_number: 1, etag: '"already-uploaded"' },
        { part_number: 2, etag: '"newly-uploaded"' },
      ],
    });
    expect(result.media.id).toBe("media-multipart");
  });
});

describe("getFriendlyUploadError", () => {
  test("reports policy rejection without guessing which transport failed", () => {
    expect(getFriendlyUploadError(new ApiError({ status: 413, message: "too large" }))).toBe(
      "Upload rejected by an upstream HTTP gateway because its configured size limit was exceeded.",
    );
    expect(getFriendlyUploadError(new ApiError({ status: 415, message: "bad type" }))).toBe(
      "Upload failed: unsupported file type.",
    );
    expect(getFriendlyUploadError(new ApiError({ status: 403, message: "forbidden" }))).toBe(
      "Upload failed: you do not have permission to upload this file.",
    );
  });

  test("identifies the rejecting layer and preserves diagnostic metadata", () => {
    const failure = new UploadPipelineError(
      "part-upload",
      new UploadHttpError(413, "payload too large", "part-upload", "request-123", "ENTITY_TOO_LARGE"),
    );

    expect(failure).toMatchObject({
      status: 413,
      code: "ENTITY_TOO_LARGE",
      requestId: "request-123",
      retryable: false,
      remediation: "Start a new upload or contact an administrator with the reference code.",
    });
    expect(getFriendlyUploadError(failure)).toBe(
      "Upload rejected by the object-storage upload gateway because its configured size limit was exceeded. Stage: part-upload. Code: ENTITY_TOO_LARGE. Reference: request-123.",
    );
  });
});

describe("sha256File", () => {
  test("hashes incrementally across chunk boundaries", async () => {
    const file = new File([new TextEncoder().encode("abcdefghi")], "payload.bin");
    expect(await sha256File(file, 3)).toBe(
      "19cc02f26df43cc571bc9ed7b0c4d29224a3ec229529221725ef76d021c8326f",
    );
  });

  test("rejects invalid chunk sizes", async () => {
    await expect(sha256File(makeFile("payload.bin", "application/octet-stream", 1), 0)).rejects.toThrow(
      "Hash chunk size must be a positive safe integer.",
    );
  });
});
