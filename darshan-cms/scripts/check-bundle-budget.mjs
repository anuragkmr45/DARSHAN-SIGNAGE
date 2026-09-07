import { gzipSync } from "node:zlib";
import { readFile } from "node:fs/promises";
import path from "node:path";

const DIST_DIR = path.resolve("dist");
const MANIFEST_PATH = path.join(DIST_DIR, ".vite", "manifest.json");
// These limits are intentionally below the pre-splitting 1.296 MiB entry
// bundle. The entry is measured directly; imported framework chunks are
// separately visible in the manifest and subject to the per-chunk cap.
const INITIAL_JS_LIMIT = 350 * 1024;
const INITIAL_GZIP_LIMIT = 150 * 1024;
const CHUNK_LIMIT = 500 * 1024;

const formatBytes = (size) => `${(size / 1024).toFixed(1)} KiB`;

const manifest = JSON.parse(await readFile(MANIFEST_PATH, "utf8"));
const entry = Object.values(manifest).find((chunk) => chunk.isEntry);
if (!entry) throw new Error("Vite manifest does not contain an application entry");

const entryContents = await readFile(path.join(DIST_DIR, entry.file));
const initialSize = entryContents.byteLength;
const initialGzipSize = gzipSync(entryContents).byteLength;
const oversizedChunks = [];
for (const chunk of Object.values(manifest)) {
  if (!chunk.file?.endsWith(".js")) continue;
  const contents = await readFile(path.join(DIST_DIR, chunk.file));
  const fileSize = contents.byteLength;
  if (fileSize > CHUNK_LIMIT) oversizedChunks.push(`${chunk.file} (${formatBytes(fileSize)})`);
}

const failures = [];
if (initialSize > INITIAL_JS_LIMIT) failures.push(`initial JavaScript ${formatBytes(initialSize)} exceeds ${formatBytes(INITIAL_JS_LIMIT)}`);
if (initialGzipSize > INITIAL_GZIP_LIMIT) failures.push(`initial gzip JavaScript ${formatBytes(initialGzipSize)} exceeds ${formatBytes(INITIAL_GZIP_LIMIT)}`);
if (oversizedChunks.length) failures.push(`individual JavaScript chunks exceed ${formatBytes(CHUNK_LIMIT)}: ${oversizedChunks.join(", ")}`);

console.log(`CMS entry JavaScript: ${formatBytes(initialSize)} (${formatBytes(initialGzipSize)} gzip)`);
if (failures.length) throw new Error(`CMS bundle budget failed:\n- ${failures.join("\n- ")}`);
