const DEFAULT_MIN_BYTES = 256 * 1024;
const DEFAULT_MAX_DIMENSION = 1920;
const DEFAULT_QUALITY = 0.82;
const DEFAULT_MIN_REDUCTION_RATIO = 0.95;

type CompressionOptions = {
  minBytes?: number;
  maxDimension?: number;
  quality?: number;
  minReductionRatio?: number;
};

export interface CompressionResult {
  file: File;
  didCompress: boolean;
  originalSize: number;
  finalSize: number;
  width?: number;
  height?: number;
  durationSeconds?: number;
}

type CanvasImageSourceResult = {
  width: number;
  height: number;
  source: CanvasImageSource;
  cleanup: () => void;
};

const MIME_EXTENSION_MAP: Record<string, string> = {
  "image/webp": ".webp",
  "image/jpeg": ".jpg",
  "image/png": ".png",
};

const getFileExtension = (name: string) => {
  const dotIndex = name.lastIndexOf(".");
  return dotIndex >= 0 ? name.slice(dotIndex) : "";
};

const replaceFileExtension = (name: string, contentType: string) => {
  const nextExtension = MIME_EXTENSION_MAP[contentType];
  if (!nextExtension) return name;

  const currentExtension = getFileExtension(name);
  if (!currentExtension) return `${name}${nextExtension}`;
  return `${name.slice(0, -currentExtension.length)}${nextExtension}`;
};

const hasWebpSupport = () => {
  if (typeof document === "undefined") return false;
  const canvas = document.createElement("canvas");
  try {
    return canvas.toDataURL("image/webp").startsWith("data:image/webp");
  } catch {
    return false;
  }
};

const loadCanvasSource = async (file: File): Promise<CanvasImageSourceResult> => {
  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(file);
    return {
      width: bitmap.width,
      height: bitmap.height,
      source: bitmap,
      cleanup: () => bitmap.close(),
    };
  }

  if (typeof Image === "undefined" || typeof URL === "undefined") {
    throw new Error("Image decoding is not available.");
  }

  const url = URL.createObjectURL(file);

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      resolve({
        width: img.naturalWidth,
        height: img.naturalHeight,
        source: img,
        cleanup: () => URL.revokeObjectURL(url),
      });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Unable to decode image."));
    };
    img.src = url;
  });
};

const canvasToBlob = (canvas: HTMLCanvasElement, contentType: string, quality: number) =>
  new Promise<Blob | null>((resolve) => {
    canvas.toBlob((blob) => resolve(blob), contentType, quality);
  });

const canvasHasTransparency = (canvas: HTMLCanvasElement) => {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return false;

  const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
  for (let index = 3; index < data.length; index += 4) {
    if (data[index] < 255) {
      return true;
    }
  }

  return false;
};

const buildFileFromBlob = (originalFile: File, blob: Blob, contentType: string) =>
  new File([blob], replaceFileExtension(originalFile.name, contentType), {
    type: contentType,
    lastModified: originalFile.lastModified,
  });

export const maybeCompressForUpload = async (
  file: File,
  opts: CompressionOptions = {},
): Promise<CompressionResult> => {
  const minBytes = opts.minBytes ?? DEFAULT_MIN_BYTES;
  const maxDimension = opts.maxDimension ?? DEFAULT_MAX_DIMENSION;
  const quality = opts.quality ?? DEFAULT_QUALITY;
  const minReductionRatio = opts.minReductionRatio ?? DEFAULT_MIN_REDUCTION_RATIO;

  const originalResult: CompressionResult = {
    file,
    didCompress: false,
    originalSize: file.size,
    finalSize: file.size,
  };

  if (!file.type.startsWith("image/") || file.size < minBytes || typeof document === "undefined") {
    return originalResult;
  }

  let sourceResult: CanvasImageSourceResult | null = null;

  try {
    sourceResult = await loadCanvasSource(file);
    const { width: originalWidth, height: originalHeight, source } = sourceResult;
    const ratio = Math.min(1, maxDimension / Math.max(originalWidth, originalHeight));
    const finalWidth = Math.max(1, Math.round(originalWidth * ratio));
    const finalHeight = Math.max(1, Math.round(originalHeight * ratio));
    const canvas = document.createElement("canvas");
    canvas.width = finalWidth;
    canvas.height = finalHeight;

    const context = canvas.getContext("2d");
    if (!context) {
      return originalResult;
    }

    context.drawImage(source, 0, 0, finalWidth, finalHeight);

    const supportsWebp = hasWebpSupport();
    const hasTransparency = file.type === "image/png" ? canvasHasTransparency(canvas) : false;

    const candidateTypes: string[] = [];
    if (supportsWebp) {
      candidateTypes.push("image/webp");
    }
    if (!hasTransparency) {
      candidateTypes.push("image/jpeg");
    }
    if (hasTransparency || candidateTypes.length === 0) {
      candidateTypes.push("image/png");
    }

    for (const contentType of candidateTypes) {
      const blob = await canvasToBlob(canvas, contentType, quality);
      if (!blob || blob.size >= file.size * minReductionRatio) {
        continue;
      }

      const compressedFile = buildFileFromBlob(file, blob, contentType);
      return {
        file: compressedFile,
        didCompress: true,
        originalSize: file.size,
        finalSize: compressedFile.size,
        width: finalWidth,
        height: finalHeight,
      };
    }

    return {
      ...originalResult,
      width: originalWidth,
      height: originalHeight,
    };
  } catch {
    return originalResult;
  } finally {
    sourceResult?.cleanup();
  }
};
