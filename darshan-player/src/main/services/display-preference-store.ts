import * as fs from 'fs'
import * as path from 'path'
import { EventEmitter } from 'events'
import { getConfigManager } from '../../common/config'
import { DisplayDesiredSelection } from '../../common/display-profile'
import { atomicWrite, ensureDir } from '../../common/utils'
import { getLogger } from '../../common/logger'

const logger = getLogger('display-preference-store')
const DEFAULT_SELECTION: DisplayDesiredSelection = { mode: 'PRIMARY', preferred_key: null }

/** Separate from pairing identity so repairing/re-pairing cannot silently move a screen. */
export class DisplayPreferenceStore {
  private readonly statePath: string
  private selection: DisplayDesiredSelection
  private readonly emitter = new EventEmitter()

  constructor(statePath?: string) {
    this.statePath = statePath || path.join(path.dirname(getConfigManager().getConfigPath()), 'display-preference.json')
    this.selection = this.load()
  }

  private load(): DisplayDesiredSelection {
    try {
      if (!fs.existsSync(this.statePath)) return { ...DEFAULT_SELECTION }
      const parsed = JSON.parse(fs.readFileSync(this.statePath, 'utf8')) as Partial<DisplayDesiredSelection>
      if (parsed.mode === 'PINNED' && typeof parsed.preferred_key === 'string' && parsed.preferred_key.trim()) {
        return {
          mode: 'PINNED',
          preferred_key: parsed.preferred_key.trim(),
          selection_version: parsed.selection_version,
        }
      }
    } catch (error) {
      logger.warn({ error, statePath: this.statePath }, 'Ignoring unreadable display preference')
    }
    return { ...DEFAULT_SELECTION }
  }

  get(): DisplayDesiredSelection {
    return { ...this.selection }
  }

  async set(selection: DisplayDesiredSelection): Promise<DisplayDesiredSelection> {
    this.selection =
      selection.mode === 'PINNED' && selection.preferred_key
        ? { mode: 'PINNED', preferred_key: selection.preferred_key, selection_version: selection.selection_version }
        : { mode: 'PRIMARY', preferred_key: null, selection_version: selection.selection_version }
    ensureDir(path.dirname(this.statePath), 0o755)
    await atomicWrite(this.statePath, JSON.stringify(this.selection, null, 2))
    this.emitter.emit('change', this.get())
    return this.get()
  }

  onChange(listener: (selection: DisplayDesiredSelection) => void): () => void {
    this.emitter.on('change', listener)
    return () => this.emitter.off('change', listener)
  }
}

let displayPreferenceStore: DisplayPreferenceStore | null = null

export function getDisplayPreferenceStore(): DisplayPreferenceStore {
  if (!displayPreferenceStore) displayPreferenceStore = new DisplayPreferenceStore()
  return displayPreferenceStore
}
