import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { maybeCompressForUpload } from "@/lib/mediaCompression";

type MockCanvasOptions = {
  supportsWebp?: boolean;
  alpha?: boolean;
  blobSizes?: Partial<Record<"image/webp" | "image/jpeg" | "image/png", number>>;
};

const originalDocument = globalThis.document;
const originalCreateImageBitmap = globalThis.createImageBitmap;

const makeFile = (name: string, type: string, size: number) =>
  new File([new Uint8Array(size)], name, { type, lastModified: 1 });

const installCanvasMocks = ({
  supportsWebp = true,
  alpha = false,
  blobSizes = {},
}: MockCanvasOptions = {}) => {
  const drawImage = vi.fn();
  const getImageData = vi.fn(() => ({
    data: new Uint8ClampedArray(alpha ? [255, 255, 255, 128] : [255, 255, 255, 255]),
  }));

  const canvas = {
    width: 0,
    height: 0,
    toBlob: vi.fn((callback: (blob: Blob | null) => void, type?: string) => {
      const normalizedType = (type || "image/png") as "image/webp" | "image/jpeg" | "image/png";
      const nextSize = blobSizes[normalizedType];
      callback(nextSize ? new Blob([new Uint8Array(nextSize)], { type: normalizedType }) : null);
    }),
    toDataURL: vi.fn((type?: string) =>
      supportsWebp && type === "image/webp" ? "data:image/webp;base64,mock" : "data:image/png;base64,mock",
    ),
    getContext: vi.fn(() => ({
      drawImage,
      getImageData,
    })),
  };

  globalThis.document = {
    createElement: vi.fn((tag: string) => {
      if (tag === "canvas") return canvas;
      throw new Error(`Unexpected element creation: ${tag}`);
    }),
  } as unknown as Document;

  globalThis.createImageBitmap = vi.fn(async () => ({
    width: 4000,
    height: 3000,
    close: vi.fn(),
  })) as typeof createImageBitmap;

  return { canvas, drawImage };
};

describe("maybeCompressForUpload", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.document = originalDocument;
    globalThis.createImageBitmap = originalCreateImageBitmap;
  });

  test("skips non-image files", async () => {
    const file = makeFile("report.pdf", "application/pdf", 600_000);
    const result = await maybeCompressForUpload(file);

    expect(result.didCompress).toBe(false);
    expect(result.file).toBe(file);
    expect(result.finalSize).toBe(file.size);
  });

  test("skips small images", async () => {
    const file = makeFile("small.png", "image/png", 120_000);
    const result = await maybeCompressForUpload(file);

    expect(result.didCompress).toBe(false);
    expect(result.file).toBe(file);
  });

  test("compresses a large image to webp and resizes to max dimension", async () => {
    installCanvasMocks({
      supportsWebp: true,
      blobSizes: { "image/webp": 220_000 },
    });

    const file = makeFile("hero.png", "image/png", 900_000);
    const result = await maybeCompressForUpload(file);

    expect(result.didCompress).toBe(true);
    expect(result.file.type).toBe("image/webp");
    expect(result.file.name).toBe("hero.webp");
    expect(result.width).toBe(1920);
    expect(result.height).toBe(1440);
    expect(result.finalSize).toBe(220_000);
  });

  test("falls back to jpeg when webp is unavailable and image has no alpha", async () => {
    installCanvasMocks({
      supportsWebp: false,
      alpha: false,
      blobSizes: { "image/jpeg": 200_000 },
    });

    const file = makeFile("photo.png", "image/png", 800_000);
    const result = await maybeCompressForUpload(file);

    expect(result.didCompress).toBe(true);
    expect(result.file.type).toBe("image/jpeg");
    expect(result.file.name).toBe("photo.jpg");
  });

  test("keeps png when webp is unavailable and image has alpha", async () => {
    installCanvasMocks({
      supportsWebp: false,
      alpha: true,
      blobSizes: { "image/png": 200_000 },
    });

    const file = makeFile("logo.png", "image/png", 850_000);
    const result = await maybeCompressForUpload(file);

    expect(result.didCompress).toBe(true);
    expect(result.file.type).toBe("image/png");
    expect(result.file.name).toBe("logo.png");
  });

  test("keeps original when compressed result is not at least 5 percent smaller", async () => {
    installCanvasMocks({
      supportsWebp: true,
      blobSizes: { "image/webp": 580_000 },
    });

    const file = makeFile("banner.png", "image/png", 600_000);
    const result = await maybeCompressForUpload(file);

    expect(result.didCompress).toBe(false);
    expect(result.file).toBe(file);
  });

  test("falls back to original file if compression throws", async () => {
    globalThis.document = {
      createElement: vi.fn(),
    } as unknown as Document;
    globalThis.createImageBitmap = vi.fn(async () => {
      throw new Error("decode failed");
    }) as typeof createImageBitmap;

    const file = makeFile("broken.png", "image/png", 900_000);
    const result = await maybeCompressForUpload(file);

    expect(result.didCompress).toBe(false);
    expect(result.file).toBe(file);
  });
});
