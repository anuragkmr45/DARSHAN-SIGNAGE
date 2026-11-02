import * as fs from 'fs/promises'
import * as path from 'path'
import { randomUUID } from 'crypto'
import { validatePrototypeEvidenceDirectory } from './config'

type EvidenceEvent = 'first-frame' | 'fallback'
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

/** Opt-in evidence from the real Electron view, never a DOM substitute. */
export async function capturePrototypeEvidence(
  directory: string | undefined,
  event: EvidenceEvent,
  capture: () => Promise<Buffer>,
  isCurrent: () => boolean,
): Promise<string | undefined> {
  if (!directory || !isCurrent()) return undefined
  if (event !== 'first-frame' && event !== 'fallback') throw new Error('Invalid evidence event')
  validatePrototypeEvidenceDirectory(directory)
  const png = await capture()
  if (!isCurrent()) return undefined
  if (png.length < 8 || png.length > 8 * 1024 * 1024 || !png.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error('Invalid view capture')
  const canonical = validatePrototypeEvidenceDirectory(directory)
  const file = path.join(canonical, `${Date.now()}-${event}-${randomUUID()}.png`)
  const handle = await fs.open(file, 'wx', 0o600)
  let complete = false
  try {
    if (!isCurrent()) return undefined
    await handle.writeFile(png)
    complete = true
  } finally {
    await handle.close()
    if (!complete) await fs.unlink(file).catch(() => undefined)
  }
  return file
}
