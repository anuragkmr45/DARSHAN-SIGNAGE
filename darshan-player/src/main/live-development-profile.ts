import * as fs from 'fs'
import * as path from 'path'
import type { AppConfig } from '../common/types'
const MARKER = '.darshan-normal-live-test.json'
function equalPath(a: string, b: string): boolean { return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b }
function privateOwner(stat: fs.Stats, mode: number): boolean {
  return process.platform === 'win32' || ((stat.mode & 0o777) === mode && (typeof process.getuid !== 'function' || stat.uid === process.getuid()))
}
export function developmentLiveTestRoot(env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (env['DARSHAN_DEV_LIVE_CAPABILITY'] !== '1') return undefined
  if (env['DARSHAN_RUNTIME_MODE'] !== 'dev') throw new Error('Live integration override requires explicit development mode')
  const root = env['DARSHAN_RUNTIME_ROOT']
  if (!root || !path.isAbsolute(root)) throw new Error('Live integration override requires an explicit private profile')
  // Normal startup intentionally migrates legacy Linux identity when only a
  // runtime root is selected. Explicit paths suppress that legacy import.
  if (!['DARSHAN_CONFIG_PATH', 'DARSHAN_CACHE_PATH', 'DARSHAN_MTLS_CERT_DIR'].every(key => env[key] && within(root, env[key]!))) throw new Error('Live integration requires explicit owned config, cache and identity paths')
  const directory = fs.lstatSync(root)
  if (!directory.isDirectory() || directory.isSymbolicLink() || !privateOwner(directory, 0o700) || !equalPath(fs.realpathSync(root), path.resolve(root))) throw new Error('Invalid live integration profile')
  for (const key of ['DARSHAN_PLAYER_CONFIG_FILE', 'SIGNHEX_PLAYER_CONFIG_FILE', 'DARSHAN_CONFIG_PATH', 'SIGNAGE_CONFIG_PATH', 'HEXMON_CONFIG_PATH',
    'DARSHAN_CACHE_PATH', 'HEXMON_CACHE_PATH', 'DARSHAN_MTLS_CERT_DIR', 'HEXMON_MTLS_CERT_DIR', 'DARSHAN_MTLS_CERT_PATH', 'HEXMON_MTLS_CERT_PATH',
    'DARSHAN_MTLS_KEY_PATH', 'HEXMON_MTLS_KEY_PATH', 'DARSHAN_MTLS_CA_PATH', 'HEXMON_MTLS_CA_PATH']) {
    if (env[key] && !within(root, env[key]!)) throw new Error('Live integration paths must stay in the owned profile')
  }
  const markerPath = path.join(root, MARKER), marker = fs.lstatSync(markerPath)
  if (!marker.isFile() || marker.isSymbolicLink() || !privateOwner(marker, 0o600) || marker.size > 1024) throw new Error('Invalid live integration marker')
  const handle = fs.openSync(markerPath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0))
  try {
    const opened = fs.fstatSync(handle)
    if (!opened.isFile() || opened.dev !== marker.dev || opened.ino !== marker.ino || !privateOwner(opened, 0o600)) throw new Error('Changed live integration marker')
    const buffer = Buffer.alloc(1025), bytes = fs.readSync(handle, buffer, 0, buffer.length, 0)
    if (bytes > 1024) throw new Error('Changed live integration marker')
    const value = JSON.parse(buffer.subarray(0, bytes).toString('utf8')) as Record<string, unknown>
    if (!value || typeof value !== 'object' || Object.keys(value).sort().join(',') !== 'purpose,version' || value['version'] !== 1 || value['purpose'] !== 'normal-live-integration') throw new Error('Invalid live integration marker')
  } finally { fs.closeSync(handle) }
  return path.resolve(root)
}
/** Autostart belongs to the OS user, not Electron userData. The isolated LIVE
 * fixture must not remove or replace an ordinary installation's login entry. */
export async function registerNormalProfileAutostart(register: () => Promise<unknown>, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  if (!developmentLiveTestRoot(env)) await register()
}
function within(root: string, value: string): boolean {
  if (!path.isAbsolute(value)) return false
  const relative = path.relative(root, path.resolve(value))
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}
/** Withheld from production until the complete normal-player runtime gate. */
export function developmentLiveCapability(config: AppConfig, env: NodeJS.ProcessEnv = process.env): boolean {
  if (config.runtime.mode !== 'dev' || config.livePlayback?.enabled !== true) return false
  try {
    const root = developmentLiveTestRoot(env)
    if (!root || !within(root, config.cache.path) || ![config.mtls.certPath, config.mtls.keyPath, config.mtls.caPath].every(value => within(root, value))) return false
    const backend = new URL(config.apiBase)
    return !backend.username && !backend.password && !backend.search && !backend.hash && backend.pathname === '/' &&
      ['http:', 'https:'].includes(backend.protocol) && ['localhost', '127.0.0.1', '[::1]'].includes(backend.hostname.toLowerCase())
  } catch { return false }
}
