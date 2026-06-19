import type { TimelineItem } from './types'

export function shouldRepeatScheduledItem(itemCount: number, item?: Pick<TimelineItem, 'loop'> | null): boolean {
  return itemCount > 1 || item?.loop === true
}
