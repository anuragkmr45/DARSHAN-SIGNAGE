export const actionsForPermissionSubject = (
  subject: string,
  actions: string[],
  subjectActions?: Record<string, string[]>,
) => subjectActions?.[subject] ?? actions;
