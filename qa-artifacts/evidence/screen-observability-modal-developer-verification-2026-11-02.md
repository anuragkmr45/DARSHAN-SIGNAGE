# Screen observability modal: developer verification (2026-11-02)

## Scope and observed fault

The `/screens` detail modal previously read CPU, memory, disk and queue only from direct Prometheus player scrapes. A paired player could send a fresh backend heartbeat with those hardware values while the cards remained blank and the scrape badge said `unknown`. The modal printed the full telemetry JSON. The Grafana frame was below that long payload, and the standalone CMS proxy sent `X-Frame-Options: DENY` on `/grafana/` even when Grafana was healthy.

## Implemented contract

- Current cards use a reachable, recent direct scrape where present and fill missing fields from a backend-received `ONLINE` heartbeat no older than 90 seconds. Old/offline reports do not become current values. Percent-only older player reports still provide memory/disk percentages. The modal identifies the measurement source and polls every 30 seconds.
- New players send queue item count and oldest queued age in the heartbeat. The server accepts those optional fields, preserving older player compatibility. An older player without direct scraping may leave queue backlog unavailable.
- The direct scrape badge distinguishes `up`, `down`, `unconfigured`, and `unavailable`. It does not infer scrape success from a backend heartbeat or from unrelated player metric samples.
- The full telemetry JSON is replaced by a readable, whitelisted device-details panel. Grafana trends are placed above it. The CMS checks `/grafana/api/user` before embedding; an unauthenticated operator sees a sign-in instruction instead of an empty frame.
- Standalone, direct Docker, and signed five-VM CMS Nginx sources allow same-origin framing only on `/grafana/`. Ordinary CMS pages retain `DENY`; the generated HTTPS site retains HSTS on locations with their own headers.

## Developer verification

- Server build and focused database-backed observability route tests: passed, including no target, down target, stale scrape, Prometheus unavailable, fresh heartbeat fallback, and stale heartbeat rejection.
- Player build and focused heartbeat service tests: passed; the new queue fields were present in the outbound heartbeat payload. Full player unit suite: 398/398 passed.
- CMS production build and bundle budget: passed. CMS unit suite: 126/126 passed. `/screens` Chromium browser suite: 8/8 passed, including heartbeat fallback, readable details, embedded frame and unauthenticated Grafana message.
- Production bundle configuration contract: 17/17 passed. Bundle assembler shell syntax and `git diff --check`: passed.
- In the isolated running Docker stack at `127.0.0.1:18091`, a real player heartbeat and real CMS login/detail journey showed nonempty CPU, memory and disk values, queue backlog `0`, and `Direct scrape not configured`. Grafana returned health 200, `/grafana/api/user` returned 401 without sign-in, and the CMS displayed the sign-in instruction. A browser page-error check returned zero errors.
- During a controlled local API restart, the player's queued `OFFLINE` report left current measurements unavailable; the next received `ONLINE` heartbeat restored the cards. The server did not present the offline report as current hardware state.
- Local Nginx returned `X-Frame-Options: DENY` for `/screens` and `SAMEORIGIN` for `/grafana/login` after the revised proxy configuration was loaded.

## Remaining environment verification

The production site at `192.168.128.74` was not reachable from this machine. No production deployment or live target inventory was changed. The local Prometheus inventory has no direct player targets, so an authenticated Grafana per-player historical curve and production mTLS scrape remain for site QA. The signed five-VM artifact must be rebuilt from this commit before its generated Nginx change is deployed; earlier artifacts do not contain this fix.
