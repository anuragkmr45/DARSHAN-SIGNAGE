# Chat history and exact-link developer verification — 2026-11-04

## Scope and implementation

The main conversation and thread now open at their newest page. The operator can load older pages, check for newer messages after a missed realtime event, and follow a link to an older main message or an exact thread reply. The server adds mutually exclusive `latest`, `beforeSeq`, and `aroundMessageId` cursors while retaining the existing forward `afterSeq` contract. Responses to newest/older/anchored requests include `hasOlder`; all message arrays remain ascending by sequence. A thread response retains its root message.

The CMS preserves multiple history pages in its cache when a realtime event or manual catch-up arrives. The ordinary timeline cursor governs reconnect continuity even if a focused deep-link cache contains a later isolated message. Thread notifications keep the reply ID in their destination URL. A focused reply is highlighted and scrolled into view.

## Developer checks completed

| Check | Result |
| --- | --- |
| Database-backed Chat route suite in dedicated `darshan_thread_context_test` database | 27/27 passed; includes newest, older, forward and anchored main/thread pages, hidden reply rejection and invalid cursor combinations |
| CMS Chat and Notifications browser run, one Chromium worker | 18/18 passed; includes 120 main messages, 120 replies, 55 later messages, old main/reply links, notification destination, phone/thread navigation and failure/Retry flows |
| CMS unit suite | 280/280 passed; includes cursor merge and reconnect cursor selection |
| CMS TypeScript check | `npx tsc --noEmit --ignoreDeprecations 5.0` passed |
| Server build | `npm run build` passed |
| CMS production build and bundle budget | `npm run build` passed |
| Isolated local QA login | Existing local administrator reached `https://localhost:18445/dashboard` with the Dashboard heading and no sign-in error |

## Evidence boundary and remaining QA

The isolated CMS at port 18445 is an older pinned build, so its successful sign-in is an authentication smoke check, not validation of these new history controls against a matched backend. Browser history checks used the current CMS source with route fixtures; the API suite used a real dedicated PostgreSQL test database. Independent QA must repeat the history, exact-link and reconnect journeys in a matched CMS/API deployment with multiple signed-in operators, real notifications, and interrupted WebSocket/network service. Check authorization withdrawal, long history beyond the bounded 20-page catch-up, scrolling stability, and phone/assistive-technology behavior. Keep the master checklist open until those journeys pass.
