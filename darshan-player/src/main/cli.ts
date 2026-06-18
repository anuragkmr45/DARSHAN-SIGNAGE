import {
  clearCache,
  collectLogs,
  pairingStatusForCli,
  requestPairingCodeForCli,
  resetPairingForCli,
  runDoctor,
  submitPairingCodeForCli,
} from './services/operator-tools'

export type OperatorCommand =
  | { name: 'doctor' }
  | { name: 'clear-cache' }
  | { name: 'collect-logs' }
  | { name: 'pairing-status' }
  | { name: 'reset-pairing'; reason?: string; dryRun?: boolean; clearCache?: boolean }
  | { name: 'pair-request' }
  | { name: 'pair-submit'; pairingCode: string }

function getTokens(argv: string[]) {
  return argv.slice(1)
}

function findSubcommand(tokens: string[], name: string) {
  return tokens.findIndex((token) => token === name)
}

export function parseOperatorCommand(argv: string[]): OperatorCommand | null {
  const tokens = getTokens(argv)

  if (tokens.includes('--doctor') || findSubcommand(tokens, 'doctor') >= 0) {
    return { name: 'doctor' }
  }

  if (tokens.includes('--collect-logs') || findSubcommand(tokens, 'collect-logs') >= 0) {
    return { name: 'collect-logs' }
  }

  if (tokens.includes('--pairing-status') || findSubcommand(tokens, 'pairing-status') >= 0) {
    return { name: 'pairing-status' }
  }

  if (tokens.includes('--reset-pairing') || findSubcommand(tokens, 'reset-pairing') >= 0) {
    const reasonFlag = tokens.find((token) => token.startsWith('--reason='))
    const reason = reasonFlag ? reasonFlag.split('=').slice(1).join('=').trim() : undefined
    return {
      name: 'reset-pairing',
      reason,
      dryRun: tokens.includes('--dry-run'),
      clearCache: tokens.includes('--clear-cache'),
    }
  }

  if (tokens.includes('--clear-cache') || findSubcommand(tokens, 'clear-cache') >= 0) {
    return { name: 'clear-cache' }
  }

  if (tokens.includes('--pair-request')) {
    return { name: 'pair-request' }
  }

  const pairFlag = tokens.find((token) => token.startsWith('--pair='))
  if (pairFlag) {
    const pairingCode = pairFlag.split('=').slice(1).join('=').trim()
    if (pairingCode) {
      return { name: 'pair-submit', pairingCode }
    }
  }

  const pairIndex = findSubcommand(tokens, 'pair')
  if (pairIndex >= 0) {
    const action = tokens[pairIndex + 1]
    if (action === 'request' || !action) {
      return { name: 'pair-request' }
    }

    if (action === 'submit') {
      const pairingCode = (tokens[pairIndex + 2] || '').trim()
      if (pairingCode) {
        return { name: 'pair-submit', pairingCode }
      }
    }
  }

  return null
}

export async function runOperatorCommand(command: OperatorCommand) {
  switch (command.name) {
    case 'doctor':
      return await runDoctor()
    case 'clear-cache':
      return await clearCache()
    case 'collect-logs':
      return await collectLogs()
    case 'pairing-status':
      return await pairingStatusForCli()
    case 'reset-pairing':
      return await resetPairingForCli(command)
    case 'pair-request':
      return await requestPairingCodeForCli()
    case 'pair-submit':
      return await submitPairingCodeForCli(command.pairingCode)
    default:
      return 1
  }
}
