import type { ActiveSlotPlayback } from '../../../common/types'

/**
 * Keep already-recorded slots and add new ones only after PoP accepts them.
 * Rejected first-frame reports remain eligible for a later retry.
 */
export function retainRecordedActiveSlots(
  recorded: ReadonlyMap<string, ActiveSlotPlayback>,
  reported: ReadonlyMap<string, ActiveSlotPlayback>,
  recordStart: (slot: ActiveSlotPlayback) => boolean
): Map<string, ActiveSlotPlayback> {
  const nextRecorded = new Map<string, ActiveSlotPlayback>()

  for (const [playbackInstanceId, slot] of reported.entries()) {
    if (recorded.has(playbackInstanceId) || recordStart(slot)) {
      nextRecorded.set(playbackInstanceId, slot)
    }
  }

  return nextRecorded
}
