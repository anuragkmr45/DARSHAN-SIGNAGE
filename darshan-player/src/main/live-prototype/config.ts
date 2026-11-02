import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

export interface LivePrototypeConfig {
  authority_url: string
  renewal_token: string
  receiver_session_id: string
  fallback_path?: string
  evidence_dir?: string
}

export function validatePrototypeEvidenceDirectory(value: unknown): string {
  if (typeof value !== 'string' || !path.isAbsolute(value) || !process.getuid) throw new Error('Invalid private evidence directory')
  const stat = fs.lstatSync(value)
  const canonical = fs.realpathSync(value)
  const temporaryRoot = fs.realpathSync(os.tmpdir())
  const relative = path.relative(temporaryRoot, canonical)
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid() || (stat.mode & 0o077) !== 0 ||
      !relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('Evidence requires a private owned temporary subdirectory')
  }
  return canonical
}

export function assertLivePrototypeMode(mode: string | undefined): void {
  if (mode !== 'dev') throw new Error('Live prototype requires explicit dev mode')
}

export function preparePrototypeProfile(receiverSessionId: string): string {
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(receiverSessionId)) throw new Error('Invalid receiver session')
  const temporaryRoot = fs.realpathSync(os.tmpdir())
  const profile = path.join(temporaryRoot, `darshan-live-prototype-${receiverSessionId}`)
  try { fs.mkdirSync(profile, { mode: 0o700 }) }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
  const stat = fs.lstatSync(profile)
  if (!stat.isDirectory() || stat.isSymbolicLink() || fs.realpathSync(profile) !== profile ||
      (process.getuid && (stat.uid !== process.getuid() || (stat.mode & 0o077) !== 0))) {
    throw new Error('Unsafe prototype profile directory')
  }
  return profile
}

export function parseLivePrototypeArgument(args: string[]): string | undefined {
  const matches = args.flatMap((arg, index) => arg === '--live-prototype'
    ? [args[index + 1] || '']
    : arg.startsWith('--live-prototype=') ? [arg.slice('--live-prototype='.length)] : [])
  if (matches.length === 0) return undefined
  if (matches.length !== 1 || !matches[0] || matches[0].startsWith('--')) throw new Error('Invalid prototype argument')
  return path.resolve(matches[0])
}

export function isLoopback(hostname: string): boolean {
  return ['127.0.0.1', 'localhost', '[::1]', '::1'].includes(hostname)
}

export function loadLivePrototypeConfig(configPath: string): LivePrototypeConfig {
  const stat = fs.statSync(configPath)
  if (!stat.isFile() || stat.size > 16_384 || (process.platform !== 'win32' && (stat.mode & 0o077) !== 0)) {
    throw new Error('Prototype config must be a small private file')
  }
  const value = JSON.parse(fs.readFileSync(configPath, 'utf8')) as Record<string, unknown>
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).some((key) => !['authority_url', 'renewal_token', 'receiver_session_id', 'fallback_path', 'evidence_dir'].includes(key))) {
    throw new Error('Invalid prototype config')
  }
  if (typeof value['authority_url'] !== 'string' || typeof value['renewal_token'] !== 'string' ||
      value['renewal_token'].length < 16 || value['renewal_token'].length > 4096 || /[\r\n\x00]/.test(value['renewal_token']) ||
      !/^[A-Za-z0-9_-]{1,80}$/.test(String(value['receiver_session_id'] || ''))) throw new Error('Invalid prototype config')
  const authority = new URL(value['authority_url'])
  if (!['http:', 'https:'].includes(authority.protocol) || !isLoopback(authority.hostname) ||
      authority.username || authority.password || authority.search || authority.hash) throw new Error('Invalid authority URL')
  let fallbackPath: string | undefined
  if (value['fallback_path'] !== undefined) {
    if (typeof value['fallback_path'] !== 'string' || !path.isAbsolute(value['fallback_path']) ||
        !/\.(png|jpe?g|webp)$/i.test(value['fallback_path'])) throw new Error('Invalid local fallback')
    fallbackPath = fs.realpathSync(value['fallback_path'])
    if (!fs.statSync(fallbackPath).isFile()) throw new Error('Invalid local fallback')
  }
  return {
    authority_url: authority.toString(), renewal_token: value['renewal_token'],
    receiver_session_id: String(value['receiver_session_id']), fallback_path: fallbackPath,
    ...(value['evidence_dir'] !== undefined ? { evidence_dir: validatePrototypeEvidenceDirectory(value['evidence_dir']) } : {}),
  }
}
