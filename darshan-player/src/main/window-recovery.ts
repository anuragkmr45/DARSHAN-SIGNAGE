export interface RecoverableWindow {
  isDestroyed(): boolean
  isMinimized(): boolean
  restore(): void
  focus(): void
}

export type WindowRecoveryResult = 'created' | 'focused'

/** Restore a usable player window, or create one when the long-lived process has none. */
export function recoverOrFocusWindow(
  currentWindow: RecoverableWindow | null,
  createWindow: () => void
): WindowRecoveryResult {
  if (!currentWindow || currentWindow.isDestroyed()) {
    createWindow()
    return 'created'
  }

  if (currentWindow.isMinimized()) currentWindow.restore()
  currentWindow.focus()
  return 'focused'
}
