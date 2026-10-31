import { readFile } from 'node:fs/promises';
import { ControlledRecoveryError, digest, sha256 } from '../../src/recovery/controlled-docker/contracts';

export const D3_CHECKED_IN_MP4 = '/home/hexmon/Desktop/DARSHAN-SIGNAGE/qa-artifacts/evidence/runtime-2026-10-16/fixture-loop.mp4';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
function pdf3(): Buffer {
  const contents = ['D3 page one: arrival', 'D3 page two: selected content', 'D3 page three: departure'].map((text) => `BT /F1 16 Tf 20 100 Td (${text}) Tj ET\n`);
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Count 3 /Kids [3 0 R 4 0 R 5 0 R] >>',
    ...contents.map((_text, index) => `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 6 0 R >> >> /Contents ${index + 7} 0 R ${index === 1 ? '/D3SelectedPage true ' : ''}>>`),
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', ...contents.map((text) => `<< /Length ${Buffer.byteLength(text)} >>\nstream\n${text}endstream`)];
  let value = '%PDF-1.4\n'; const offsets = [0]; for (const [index, object] of objects.entries()) { offsets.push(Buffer.byteLength(value)); value += `${index + 1} 0 obj\n${object}\nendobj\n`; }
  const xref = Buffer.byteLength(value); value += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`; return Buffer.from(value, 'ascii');
}
const html = Buffer.from('<!doctype html><meta charset="utf-8"><title>D3 Offline</title><main data-d3="offline">offline fixture</main>');
export interface D3FixtureInventory { totalBytes: string; aggregateSha256: string; selectedPdfPage: 2; files: readonly { kind: 'PNG' | 'PDF' | 'HTML' | 'MP4'; size: string; sha256: string; path?: string }[]; }
export async function buildD3FixtureInventory(): Promise<D3FixtureInventory> { const mp4 = await readFile(D3_CHECKED_IN_MP4); const values = [
  { kind: 'PNG' as const, bytes: png }, { kind: 'PDF' as const, bytes: pdf3() }, { kind: 'HTML' as const, bytes: html }, { kind: 'MP4' as const, bytes: mp4, path: D3_CHECKED_IN_MP4 }];
  const total = values.reduce((sum, value) => sum + value.bytes.byteLength, 0); if (total >= 32 * 1024 * 1024) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_D3_FIXTURE_LIMIT', 'D3 fixtures exceed 32 MiB.');
  const files = values.map(({ kind, bytes, path }) => ({ kind, size: bytes.byteLength.toString(), sha256: sha256(bytes), ...(path ? { path } : {}) }));
  return { totalBytes: total.toString(), aggregateSha256: digest(files), selectedPdfPage: 2, files }; }
export function generatedD3FixtureBodies() { return { png: Buffer.from(png), pdf: pdf3(), html: Buffer.from(html) }; }
