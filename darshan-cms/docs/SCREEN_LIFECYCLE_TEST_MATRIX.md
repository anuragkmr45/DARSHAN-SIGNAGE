# Screen Lifecycle Test Matrix

| Scenario | Current test files | Test level | Gap status |
| --- | --- | --- | --- |
| First-time pairing operator flow | `tests/screens.e2e.spec.ts` | browser/e2e | Covered |
| Already-paired boot | N/A in CMS scope | N/A | Out of scope |
| Same-device recovery operator flow | `tests/screens.e2e.spec.ts` | browser/e2e | Covered |
| Stale heartbeat rendering | `tests/screens.e2e.spec.ts` | browser/e2e | Covered |
| Deleted screen handling | `tests/screens.e2e.spec.ts` | browser/e2e | Covered |
| Expired/revoked credentials rendering | `tests/screens.e2e.spec.ts` | browser/e2e | Covered |
| Transient network failure | Manual-only | manual-only | Missing |
| Unsupported codec targeting | Backend responsibility | N/A | Out of scope |
| Realtime dashboard update patching | `src/hooks/screens/screensRealtimeUtils.test.ts`, `tests/screens.e2e.spec.ts` | unit, browser/e2e | Covered |
| Proof-of-play backlog replay | N/A in CMS scope | N/A | Out of scope |
| Screenshot failure | N/A in CMS scope | N/A | Out of scope |
| Command dedupe | N/A in CMS scope | N/A | Out of scope |
| Invalid CSR / expired code / device-id mismatch operator messaging | `tests/screens.e2e.spec.ts` | browser/e2e | Partial |

## Standard validation commands
- `npm run build`
- `npm run test:unit`
- `npx playwright test tests/screens.e2e.spec.ts`
