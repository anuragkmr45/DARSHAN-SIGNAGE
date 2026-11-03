type Can = (action: string, subject: string) => boolean;

/** The creator always writes a new Presentation, Schedule, item, and Request. */
export const canCreateScheduleFlow = (can: Can) =>
  can("read", "Layout") && can("read", "Media")
  && (can("read", "Screen") || can("read", "ScreenGroup"))
  && can("create", "Presentation") && can("update", "Presentation")
  && can("create", "Schedule") && can("create", "ScheduleItem")
  && can("create", "ScheduleRequest");
