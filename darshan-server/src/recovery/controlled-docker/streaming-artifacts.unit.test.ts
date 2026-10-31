import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { extractDeterministicTarStream } from './streaming-artifacts';
import { extractControlledDecryptProcess } from './file-artifacts';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
async function output() { const root = await mkdtemp(join(tmpdir(), 'streaming-tar-')); roots.push(root); return join(root, 'out'); }

function header(name: string, type: string, size: number): Buffer {
  const block = Buffer.alloc(512); block.write(name, 0, 100, 'utf8'); block.write('0000600\0', 100, 8, 'ascii');
  block.write('0000000\0', 108, 8, 'ascii'); block.write('0000000\0', 116, 8, 'ascii');
  block.write(`${size.toString(8).padStart(11, '0')}\0`, 124, 12, 'ascii'); block.write('00000000000\0', 136, 12, 'ascii');
  block.fill(0x20, 148, 156); block[156] = type.charCodeAt(0); block.write('ustar\0', 257, 6, 'ascii'); block.write('00', 263, 2, 'ascii');
  let checksum = 0; for (const byte of block) checksum += byte;
  block.write(checksum.toString(8).padStart(6, '0'), 148, 6, 'ascii'); block[154] = 0; block[155] = 0x20; return block;
}

function entry(name: string, type: string, bytes: Uint8Array = Buffer.alloc(0)): Buffer {
  const body = Buffer.from(bytes); const padding = Buffer.alloc((512 - (body.length % 512)) % 512);
  return Buffer.concat([header(name, type, body.length), body, padding]);
}

function paxRecord(key: string, value: string): Buffer {
  const body = `${key}=${value}\n`; let length = Buffer.byteLength(body) + 2; let previous = 0;
  while (length !== previous) { previous = length; length = Buffer.byteLength(body) + String(length).length + 1; }
  return Buffer.from(`${length} ${body}`);
}

async function* chunks(bytes: Buffer, size = 137): AsyncIterable<Uint8Array> {
  for (let offset = 0; offset < bytes.length; offset += size) yield bytes.subarray(offset, Math.min(offset + size, bytes.length));
}

function archive(entries: Buffer[]): Buffer { return Buffer.concat([...entries, Buffer.alloc(1024)]); }

describe('Activation Packet A streaming archive foundation', () => {
  it('streams producer root/trailing directories and a PAX path without retaining file bodies', async () => {
    const content = Buffer.from('streamed-body'); const pax = paxRecord('path', './folder/item.txt');
    const bytes = archive([entry('./', '5'), entry('./folder/', '5'), entry('PaxHeaders/item', 'x', pax), entry('placeholder', '0', content)]);
    const root = await output();
    const files = await extractDeterministicTarStream({ source: chunks(bytes), outputRoot: root, maximumBytes: '1024', maximumEntries: 8, maximumPathBytes: 128 });
    expect(files).toEqual([expect.objectContaining({ archivePath: 'folder/item.txt', size: String(content.length) })]);
    expect(await readFile(join(root, 'folder/item.txt'))).toEqual(content);
    expect('bytes' in files[0]).toBe(false);
  });

  it('rejects truncated, oversized, traversal, link, duplicate and malformed-checksum archives', async () => {
    const cases: Array<{ bytes: Buffer; maximum: string; code: string }> = [
      { bytes: entry('file', '0', Buffer.from('x')), maximum: '10', code: 'CONTROLLED_RECOVERY_ARCHIVE_TRUNCATED' },
      { bytes: archive([entry('file', '0', Buffer.from('four'))]), maximum: '3', code: 'CONTROLLED_RECOVERY_ARCHIVE_LIMIT' },
      { bytes: archive([entry('../escape', '0', Buffer.from('x'))]), maximum: '10', code: 'CONTROLLED_RECOVERY_ARCHIVE_UNSAFE_PATH' },
      { bytes: archive([entry('link', '2')]), maximum: '10', code: 'CONTROLLED_RECOVERY_ARCHIVE_UNSAFE_TYPE' },
      { bytes: archive([entry('same', '0', Buffer.from('a')), entry('./same', '0', Buffer.from('b'))]), maximum: '10', code: 'CONTROLLED_RECOVERY_ARCHIVE_DUPLICATE' },
    ];
    const malformed = archive([entry('file', '0', Buffer.from('x'))]); malformed[0] ^= 1;
    cases.push({ bytes: malformed, maximum: '10', code: 'CONTROLLED_RECOVERY_ARCHIVE_HEADER_INVALID' });
    for (const item of cases) {
      await expect(extractDeterministicTarStream({ source: chunks(item.bytes), outputRoot: await output(), maximumBytes: item.maximum,
        maximumEntries: 8, maximumPathBytes: 128 })).rejects.toMatchObject({ code: item.code });
    }
  });

  it('terminates a stalled async generator before its queued return and settles cancellation without leaks', async () => {
    let release!: () => void; const gate = new Promise<void>((resolve) => { release = resolve; }); const events: string[] = [];
    let entered!: () => void; const enteredGate = new Promise<void>((resolve) => { entered = resolve; });
    async function* stalled(): AsyncGenerator<Uint8Array> { try { yield Buffer.alloc(1); events.push('next-stalled'); entered(); await gate; } finally { events.push('generator-finally'); } }
    const terminateAndJoin = vi.fn(async () => { events.push('terminate-and-join'); release(); }); const controller = new AbortController();
    const pending = extractControlledDecryptProcess({ process: { output: stalled(), terminateAndJoin }, outputRoot: await output(), maximumBytes: '1024', maximumEntries: 8, maximumPathBytes: 128, signal: controller.signal });
    await enteredGate; controller.abort(new Error('fixture-cancelled'));
    await expect(pending).rejects.toThrow(); expect(terminateAndJoin).toHaveBeenCalledWith('CANCELLED');
    expect(events).toEqual(['next-stalled', 'terminate-and-join', 'generator-finally']);
  });

  it('terminates and joins the decrypt boundary before cleaning up an extraction error', async () => {
    const events: string[] = []; async function* malformed(): AsyncGenerator<Uint8Array> { try { yield Buffer.from('not-a-tar'); } finally { events.push('generator-finally'); } }
    const terminateAndJoin = vi.fn(async () => { events.push('terminate-and-join'); });
    await expect(extractControlledDecryptProcess({ process: { output: malformed(), terminateAndJoin }, outputRoot: await output(), maximumBytes: '1024', maximumEntries: 8, maximumPathBytes: 128 }))
      .rejects.toMatchObject({ code: 'CONTROLLED_RECOVERY_ARCHIVE_TRUNCATED' });
    expect(terminateAndJoin).toHaveBeenCalledWith('FAILED'); expect(events).toEqual(['generator-finally', 'terminate-and-join']);
  });
});
