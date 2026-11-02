import * as fs from 'fs'
import * as path from 'path'
import { randomBytes, randomUUID } from 'crypto'
import { getConfigManager } from '../../common/config'

/** Kept outside device-state.json, which is written with world-readable permissions. */
export class PairingCredentialStore {
  private readonly filePath: string

  constructor(filePath?: string) {
    this.filePath = filePath || path.join(path.dirname(getConfigManager().getConfigPath()), 'pairing-credential')
  }

  read(): string | null {
    if (!fs.existsSync(this.filePath)) return null
    const file = fs.lstatSync(this.filePath)
    if (!file.isFile() || file.isSymbolicLink()) {
      throw new Error('Pairing credential path is not a regular file; operator recovery is required')
    }
    const fd = fs.openSync(this.filePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0))
    try {
      if (!fs.fstatSync(fd).isFile()) {
        throw new Error('Pairing credential path is not a regular file; operator recovery is required')
      }
      const value = fs.readFileSync(fd, 'utf8').trim()
      if (!/^[a-f0-9]{64}$/.test(value)) {
        throw new Error('Pairing credential file is damaged; operator recovery is required')
      }
      if (process.platform !== 'win32') fs.fchmodSync(fd, 0o600)
      return value
    } finally {
      fs.closeSync(fd)
    }
  }

  ensure(): string {
    const existing = this.read()
    if (existing) return existing
    const directory = path.dirname(this.filePath)
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
    const temporaryPath = `${this.filePath}.${randomUUID()}.tmp`
    const credential = randomBytes(32).toString('hex')
    try {
      fs.writeFileSync(temporaryPath, credential, { flag: 'wx', mode: 0o600 })
      // Linking is exclusive: a second player process cannot replace a
      // credential already sent to the server and orphan its device identity.
      try {
        fs.linkSync(temporaryPath, this.filePath)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
        const winner = this.read()
        if (!winner) throw new Error('Pairing credential vanished during creation')
        return winner
      }
      if (process.platform !== 'win32') fs.chmodSync(this.filePath, 0o600)
    } finally {
      if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath)
    }
    return credential
  }

  clear(): void {
    if (fs.existsSync(this.filePath)) fs.unlinkSync(this.filePath)
  }
}

let credentialStore: PairingCredentialStore | null = null

export function getPairingCredentialStore(): PairingCredentialStore {
  if (!credentialStore) credentialStore = new PairingCredentialStore()
  return credentialStore
}
