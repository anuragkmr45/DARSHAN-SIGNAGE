# Live broadcast implementation and verification loops

Status: **IN PROGRESS — not implemented or release-approved.**

Accepted objective: user-supplied persistent-goal attachment, 2026-11-03.
Contract: [live broadcasting](../contracts/live-broadcast.md).
Developer record: [dated evidence](../../qa-artifacts/evidence/live-broadcast-developer-verification-2026-11-03.md).

## Working baseline

- Work on `codex/live-screen-broadcast-planning-20261103`, starting from
  `499bcdf7161eb8f9e90cf83ed6cf57e95ffb3712`, which was merged into local
  `release-01` before this feature. Preserve unrelated work; stage explicit files.
- Use Docker Engine via `docker --context default`; the selected
  `desktop-linux` socket was unavailable during the initial inspection.
- Isolate the feature API/CMS, database, buckets, notification namespace,
  credentials and player user-data directory from existing deployments.
  Reuse suitable dependency containers without changing their accepted data.
- Use the installed Node 20 runtime explicitly; the default shell initially
  selected Node 22. Build components sequentially on this approximately 6 GiB
  machine. Begin with one real Electron receiver; prove separate profiles and
  singleton locks before adding another.
- The finished live event/media source runs in the same ordinary installed
  DARSHAN desktop player, with normal pairing/lifecycle/cache/emergency. A
  developer-only prototype is a technical gate and is not a separate final app.
- Start with six production VM roles, including one shared media VM. This
  topology is an implementation target; representative 10-run/250-player
  capacity remains a measured release gate.

## The loop completion rule

Every loop follows **inspect → implement → focused checks → run the actual
application → inject/reproduce failure → fix → repeat the affected journey
and neighboring behavior → record evidence → commit**.

A failure keeps its loop open. Code review, fake IPC, mocked HTTP or an authored
test does not close a visible CMS/player journey. After each complete loop,
commit its explicit implementation/test/documentation files with a meaningful
message. Do not push or merge a partially verified feature packet as complete.

## Ordered loops

| Loop | Deliverable | Actual application evidence required |
| --- | --- | --- |
| 0 — Establish baseline | Record source/dependency/runtime versions, ports, health, baseline failures, resources and isolated profiles; prepare image/PDF/video fallback fixtures. | Open current CMS, pair real player, publish ordinary content, trigger/clear emergency and characterize the existing security/offline policy. Preserve existing users, pairings, DBs and runtime folders. |
| 1 — Prove capture and enforcement | Developer-only presenter/receiver prototype to prove the media gate; candidate self-hosted LiveKit adapter; single-use signaling admission; media controller, supervisor and host watchdog; trusted local CMS HTTPS. | Real screen/window/tab capture, preview, cancellation/denial, optional audio, Stop sharing, background/minimized presenter, late picker return, duplicate tab/ticket replay, revocation and already flowing media removal. |
| 2 — Schedule and reserve | Live source with required fallback; session/run records; frozen per-item concrete audience; approval fingerprint; ten logical capacity slots; reference/deletion guards; request/direct-publish parity. | CMS submission/approval/publication, same-size group member replacement, 25/26 targets, 10/11 overlapping runs, deduplicated targets, stale approval, unsupported players and concurrent reservations. |
| 3 — Authority and recovery | Idempotent start/stop; admission/run generations; ordered observations; durable operations and reconciliation; current permission locking; live desired-state version everywhere; authenticated external authority epoch. | Lost responses/retries, presenter membership/permission revocation, old cleanup, API/controller/SFU restart, missed notifications, isolated older-state restore and replacement-run fencing. |
| 4 — Player lifecycle | Integrate the scheduled live event/media source into the same ordinary installed DARSHAN player and its normal pairing/snapshot/cache/emergency lifecycle; main-owned live state/deadlines; restricted IPC; deterministic renderer/audio disposal; fallback prefetch/checksum/pinning; conservative monotonic lease; suspend/resume invalidation; credentials excluded from cache. | Live/fallback/recovery, emergency clear, end boundary, backend loss, revoked identity, missing/corrupt fallback, full cache, renderer crash/hang, static slide, display changes and late callbacks. |
| 5 — CMS options | Live authoring, presenter/fallback selection, preflight/review, capture/audio controls, start/stop/restart/admin disable/re-enable; separate connection/frame/audio/readiness/freshness states. | Every visible control in independent administrator/presenter sessions: stale dialogs, double click, second tab, reload/logout, custom roles/multiple departments, denied controls and audio failures. |
| 6 — Deployment/faults | Sixth signed offline deployment role, pinned images/assets, trusted HTTPS/WSS, reachable media addresses, firewall/transport configuration, health/monitoring, disable/restore/rollback. | Newly built CMS/player artifacts, internet disconnected, isolated component faults, invalid certs and blocked media paths without trust bypass. |
| 7 — Integrated handoff | Resolve observed defects; update contracts/runbooks/QA; repeatable inventory and precise human verification handoff. | Repeat complete administrator → presenter → player journey and run one broader impacted regression at the stable packet boundary. |

Loop 1 is an engine-selection gate. Self-hosted participant removal does not
invalidate an existing LiveKit token; token TTL alone is insufficient. Prove
gateway checks on every new connection/reconnect plus media-node termination
of existing traffic. A failed gate requires revising the integration before
building the complete workflow, not weakening the accepted cutoff.

### Source checkpoints for the scheduling/authority loops

The November 3 source audit found these integration constraints. These are
implementation checkpoints, not completed behavior:

- Schedule-item input is validated independently in `routes/schedules.ts` and
  `schemas/schedule.ts`; align both and repository create/list serialization.
  Keep `presentation_id` as the fallback, add a default ordinary source kind,
  and advertise `live_broadcast_v1` only after the normal player supports it.
- Migration `0048` serializes target-reference writes, but the group-expansion
  read happens earlier. Acquire that same target lock before expansion and
  before the schedule row lock in both request and direct publishing. Preserve
  the existing role graph → user → session authorization lock order.
- Reservation reuse/approval currently compares revision and row counts. Live
  approval must compare sorted concrete targets and the complete frozen policy;
  replacing one group member with another must invalidate approval even when
  the count is unchanged. Allocate screen holds and ten-slot capacity together.
- `schedule-publish-helper.ts` snapshots item group IDs but aggregate resolved
  targets. Add immutable **per-item** resolved live targets and use them in all
  device snapshot/read-model filters; group changes cannot enlarge a live run.
- Fallback media must remain protected through immutable published asset
  revisions, including when the mutable presentation changes. Existing media
  usage/deletion checks do not cover that new reference graph. Historical-only
  screen references must still permit the accepted deletion behavior.
- Apply mutability checks to actual item add/delete operations. Existing checks
  on schedule/item GET handlers do not protect those writes.
- Screens currently have no department-owner mapping. Do not invent target
  authorization from department membership. Evaluate conditional permissions
  against actual records, and assigned presenter/current session authority.
- Extend every desired-state writer/reader, including bulk updates, with live
  versions. The normal player currently rejects lower versions first; verify
  an authenticated authority epoch before that ordering after a restore.
- Keep admission tickets outside persisted snapshots. Extend the ordinary
  main-process state machine and snapshot evaluator; the development dispatcher
  and receiver alone do not implement scheduled playback in the installed app.

## Runtime and fault verification

Use independent real CMS sessions and the newly built Electron application.
Use installed Firefox and Chromium here; do not label those results Chrome or
Edge. Observe actual decoded video and audio where tooling permits. An OS
capture chooser or physical-audio action that needs a human remains an explicit
human step with evidence status, not a fabricated automated pass.

For every injected fault capture **trigger → visible display → audio → permitted
recovery → cleanup**, with source/player screenshots or short recordings,
transition times, sanitized logs and actual room/admission/DB state. Never
commit credentials, raw admission tickets, private keys or generated profiles.

Mandatory combined cases are emergency during reconnect; network loss across
schedule end; revocation racing admission; capture picker returning after
expiry; old cleanup after a new run; missing fallback during SFU failure; and
ten ending runs racing ten replacements. Static imagery must not be classified
as failed only because pixels do not change.

## Verification and QA handoff

- Server: build, focused DB-backed route/repository/realtime tests and screen
  lifecycle dry run. CMS: build, unit and real-service browser journeys,
  including required `/screens` coverage. Player: build, unit, integration,
  fault tests and freshly packaged Electron verification.
- Keep focused checks within loops. At a stable packet boundary run one broader
  regression for ordinary schedules, defaults, emergency, pairing, ownership,
  cache, delivery and proof-of-play; repeat broader work only for a new risk.
- Update QA `00` through `13`, `README`, catalogs and dated evidence as the code
  changes. `LIVE-01..20` start `Not Tested`; developer outcomes do not populate
  independent-QA Pass/Actual Result/Defect fields.
- Local completion requires the complete CMS/player journey and supported local
  faults. Record exact tested commits, artifact hashes, dependency versions,
  environment limits, defects fixed and remaining human checks.
- External release gates remain Windows and actual Chrome/Edge combinations,
  physical display/audio, whole-machine sleep with a separate Backend,
  cross-VM TLS/firewall/TURN, production-sized restore and representative load.
- Measure capacity at 1×25, 5×25 and 10×25. If the six-VM target fails, retain
  the gate and report required resources; do not lower the agreed limits or
  claim additional nodes give seamless failover.

Supporting primary sources:
[LiveKit token lifecycle](https://docs.livekit.io/frontends/reference/tokens-grants/),
[browser capture](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getDisplayMedia),
[background timer behavior](https://developer.chrome.com/blog/timer-throttling-in-chrome-88/).
