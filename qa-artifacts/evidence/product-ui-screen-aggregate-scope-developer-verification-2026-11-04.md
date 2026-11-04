# Screen aggregate authorization: developer verification (2026-11-04)

## Candidate and contract

Source: `codex/darshan-product-ui-redesign-20261103`, starting from `5fce52c`; this record accompanies the commit that changes `screens.ts`, `screens/playback.ts`, `screens-namespace.ts`, Dashboard wording and their tests. No released artifact was deployed.

The Dashboard's Total, Online and Active Scheduled KPI values come from site-wide `/metrics/overview`. Their drill-downs come from Screen overview and timeline APIs and now contain only records the current account may read. The aspect-ratio directory follows the same rule. A Group row in overview or no-ID socket sync requires a Group read grant; its membership and derived playback contain only readable Screens. A no-Screen-read caller receives `403` from these aggregate REST routes. No-ID socket sync remains a refresh aid, not a second source of authority.

## Executed developer checks

| Check | Result | Evidence boundary |
| --- | --- | --- |
| `screens.test.ts` against `darshan_screens_ui_test` PostgreSQL | 23/23 passed | Custom actor could read one Screen, one granted Group and only that Group's readable member. Aspect, overview and timeline omitted a second Screen; removing Group read removed Group rows; removing Screen read produced `403`. Existing route behavior remained green. |
| `screens-namespace.test.ts` against the same isolated DB | 10/10 passed | Real Socket.IO subscribe/sync restricted one Screen. No Group grant yielded no Group names; a conditional Group grant returned only its readable Screen member. |
| `npm run screens:dry-run` against the isolated DB and local MinIO | 12/12 passed | Real Fastify/Socket.IO/device heartbeat, emergency refresh, deletion blocker and overview lifecycle. The script seeds test fixtures; this was not a production or physical-player run. |
| Dashboard Playwright suites (`dashboard-online-screens.e2e.spec.ts`, `dashboard-active-scheduled.e2e.spec.ts`, one worker) | 11/11 passed | Rendered Total, Online and Active Scheduled dialogs, scoped wording, existing Grafana and report behaviors, and 390/820/1440 Dashboard widths with fixture API responses. |
| Server TypeScript build; CMS production build and bundle budget; CMS unit suite | Passed; CMS 277/277 | Compile and local regression. These do not prove the five-VM deployment or account withdrawal behavior. |

## Remaining QA and limitations

- Run a matched built CMS/API with real limited and full-read custom roles, then revoke one grant while dialogs and sockets are open. Confirm REST denial, reconnect/refetch and absence of stale rows.
- Verify site-wide KPI versus accessible drill-down wording with nontechnical operators. A future product decision may choose actor-scoped KPI totals; this packet preserves current site-wide metrics semantics and states them explicitly.
- Exercise large-fleet overview/timeline latency and memory, multiple Groups with mixed memberships, source media access, offline/reconnect and cross-VM WSS. The local tests used a small isolated fixture.
- Independent human QA remains open; this developer record is not release acceptance.
