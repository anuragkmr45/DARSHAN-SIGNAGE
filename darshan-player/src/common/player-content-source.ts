import type { PlayerStatus } from './types'

export function shouldDisplaySecurityLock(status: PlayerStatus): boolean {
  return (
    status.securityLock?.locked === true &&
    (status.state === 'PAIRED_RUNTIME' || status.state === 'OFFLINE_USING_LAST_VALID_PAIRING')
  )
}

export function resolvePlayerContentSource(status: PlayerStatus): 'schedule' | 'default' | 'none' {
  if (shouldDisplaySecurityLock(status)) {
    return 'none'
  }

  if (
    status.state === 'BOOT' ||
    status.state === 'LOCAL_IDENTITY_PRESENT' ||
    status.state === 'BOOTSTRAP_AUTH' ||
    status.state === 'RECOVERY_REQUIRED' ||
    status.state === 'HARD_RECOVERY' ||
    status.state === 'PAIRING_PENDING' ||
    status.state === 'PAIRING_CONFIRMED' ||
    status.state === 'PAIRING_COMPLETING'
  ) {
    return 'none'
  }

  if (status.mode === 'default' || status.mode === 'offline' || status.mode === 'empty') {
    return 'default'
  }

  return 'schedule'
}
