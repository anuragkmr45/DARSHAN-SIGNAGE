# Scheduling QA Checklist

## Backend contract reference
- Backend contract source: `../signhex-server/docs/SCHEDULING_FRONTEND_AND_PLAYER_CONTRACT.md`
- CMS uses UTC execution timestamps and stores `timezone` for audit/display only.

## Operator checks
- Create a schedule with:
  - layout
  - slot media
  - target screens or groups
  - explicit timezone
  - future UTC-backed start and end
- Confirm the review step shows:
  - audit timezone
  - UTC-backed start/end values rendered locally
  - target screens/groups
- Submit a schedule request and verify request status appears in `/schedule`.

## Validation cases
- Start time must be in the future.
- End time must be after start time.
- Overlap/conflict errors from backend are shown to the operator.
- Schedule creation stores timezone in the POST `/api/v1/schedules` payload.

## Regression commands
- `npm run build`
- `npm run test:unit`
- `npx playwright test tests/scheduling-emergency.e2e.spec.ts --grep "schedule creator"`
