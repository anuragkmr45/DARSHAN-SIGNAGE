import { isIP } from 'node:net';

export function parseTrustedProxyCidrs(raw: string): string[] | false {
  const entries = raw.split(',').map((item) => item.trim()).filter(Boolean);
  if (entries.length === 0) return false;
  for (const entry of entries) {
    const [address, prefix, extra] = entry.split('/');
    const family = isIP(address);
    const bits = family === 4 ? 32 : family === 6 ? 128 : 0;
    if (!bits || extra !== undefined || (prefix !== undefined && (!/^\d+$/.test(prefix) || Number(prefix) < 8 || Number(prefix) > bits))) {
      throw new Error(`Invalid or overly broad trusted proxy address: ${entry}`);
    }
  }
  return entries;
}
