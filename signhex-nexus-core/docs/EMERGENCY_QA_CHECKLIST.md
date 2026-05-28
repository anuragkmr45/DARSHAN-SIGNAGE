# Emergency QA Checklist

## Backend contract reference
- Backend contract source: `../signhex-server/docs/EMERGENCY_TAKEOVER_FRONTEND_AND_PLAYER_CONTRACT.md`
- CMS trigger/clear flow must stay aligned with:
  - `POST /api/v1/emergency/trigger`
  - `GET /api/v1/emergency/status`
  - `POST /api/v1/emergency/:id/clear`

## Operator checks
- Open `/schedule` and launch `Emergency Takeover`.
- Verify active emergencies are listed with:
  - severity
  - scope
  - timestamps
  - audit note
- Trigger a new emergency using:
  - ad hoc message or media
  - severity
  - scope
  - optional expiry
  - required audit note
- Clear an active emergency with a required clear reason.

## Validation cases
- Global emergency requires explicit confirmation.
- Screen scope requires at least one screen.
- Group scope requires at least one group.
- Message or media must be provided before trigger.
- Clear reason must be provided before clear.

## Regression commands
- `npm run build`
- `npm run test:unit`
- `npx playwright test tests/scheduling-emergency.e2e.spec.ts --grep "emergency modal"`
