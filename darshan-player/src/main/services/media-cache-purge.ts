import * as fs from 'fs'
import * as path from 'path'
import { ensureDir } from '../../common/utils'

function pathExists(targetPath: string): boolean {
  try {
    fs.accessSync(targetPath)
    return true
  } catch {
    return false
  }
}

export function clearMediaCacheTargets(cacheRoot: string): string[] {
  const targets = ['media', 'objects', 'quarantine']
  const removed: string[] = []

  for (const name of targets) {
    const targetPath = path.join(cacheRoot, name)
    if (!pathExists(targetPath)) {
      continue
    }

    fs.rmSync(targetPath, { recursive: true, force: true })
    ensureDir(targetPath)
    removed.push(targetPath)
  }

  const legacyIndex = path.join(cacheRoot, 'cache-index.db')
  if (pathExists(legacyIndex)) {
    fs.rmSync(legacyIndex, { force: true })
    removed.push(legacyIndex)
  }

  return removed
}
