# Project-Wide Doctor, Drill, And Diagnostics Plan

## Purpose
This document captures the project-wide feature vision, current implementation baseline, next-phase roadmap, and future scope for an enterprise operational verification and troubleshooting system across the DARSHAN platform.

Repos in scope:
- Backend: `darshan-server`
- CMS: `darshan-cms`
- Player: `darshan-player`

This is not limited to screens. The intended long-term scope includes:
- authentication and sessions
- device pairing and recovery
- screen lifecycle and realtime status
- media upload, readiness, and deletion
- publish and playback flows
- emergency takeover
- proof-of-play and telemetry
- chat and notifications
- storage and background jobs
- environment and infrastructure health

## Problem Statement
Users and operators need a reliable way to answer two classes of questions.

### 1. Is the platform healthy?
Examples:
- can users authenticate?
- is backend reachable?
- is CMS functioning?
- are websockets working?
- is MinIO reachable?
- are queues and jobs alive?
- are migrations up to date?

### 2. Does a real business flow work end to end?
Examples:
- can a device pair and recover?
- can content publish and reach a player?
- can proof-of-play be sent and replayed?
- can notifications increment and realtime update?
- can chat send/reply/recover correctly?

The desired outcome is not a single unrealistic “magic command”, but a structured, enterprise-grade operational toolkit that makes failures visible, classifiable, and supportable.

## Feasibility Summary
Yes. It is possible.

Not with a single command that proves every physical or product condition in every deployment, but with a controlled doctor/drill/diagnose system, the platform can get very close.

## Capability Model
The recommended model has three layers.

### 1. Environment Doctor
One command checks prerequisites only.

Example scope:
- backend reachable
- CMS reachable
- database reachable
- migrations applied
- MinIO reachable
- websocket namespaces reachable
- required env vars present
- CA cert paths valid
- queue/job worker running
- Redis seam or fallback expectations clear where applicable
- API base URLs and public URLs consistent

This tells the user:
- the system is bootable
- it does not prove the full business lifecycle works end to end

### 2. Synthetic End-To-End Drill
One command runs a controlled scripted scenario.

This should support multiple drills over time.

Examples:
- device pairing and recovery drill
- publish-to-player playback drill
- media upload/complete/delete drill
- notification badge drill
- chat send/reply/recovery drill

Example screen/device recovery flow:
1. create or use a test device identity
2. request pairing
3. confirm pairing from CMS/API
4. complete pairing with synthetic player client
5. publish test content
6. simulate player boot
7. send snapshot/heartbeat/proof-of-play
8. force cert failure
9. trigger recovery on same `device_id`
10. complete recovery
11. verify resumed heartbeat, playback, and dashboard state

This tells the user:
- the core business flow works end to end

This is the closest thing to a one-command validation.

### 3. Production Diagnostics / Support Bundle
One command collects evidence when something is broken.

Example output:
- backend health
- CMS reachability
- screen health
- current pairing status
- current recovery diagnostics
- last heartbeat
- active pairing
- certificate expiry/revocation state
- pending commands
- publish status
- websocket connectivity check
- player local identity state
- player cached playback state
- proof-of-play backlog
- media/job/storage health
- recent logs
- relevant error codes and probable cause classification

This tells the user:
- where the failure is likely happening
- what to try next
- what to send to support if self-recovery fails

## Current Implemented Baseline
This section records what is already implemented today and can be treated as the current baseline.

### Backend baseline
Currently implemented in backend:
- device pairing request / confirm / complete flow
- in-place recovery on the same `device_id`
- dedicated recovery diagnostics and recovery-start routes
- structured runtime auth failure reasons
- canonical screen health fields in screen responses
- realtime `/screens` namespace with state/update refresh flow
- screen creation restricted to pairing completion
- codec-aware publish validation for screens
- certificate expiry enforcement and migration support

### CMS baseline
Currently implemented in CMS:
- screens list and detail wired to backend health/recovery fields
- explicit pair device flow
- explicit recover screen flow
- no operational dependence on manual “add screen” creation
- live dashboard integration via `/screens` realtime updates
- operator-facing health and recovery indicators in screens UI

### Player baseline
Currently implemented in player:
- explicit lifecycle state machine
- authenticated bootstrap using snapshot + heartbeat
- transient failure separation from auth failure
- same-`device_id` recovery support using `active_pairing.mode === "RECOVERY"`
- fresh pairing path for hard recovery
- cached playback preservation during bootstrap and transient failure
- proof-of-play local queue/replay behavior
- command dedupe and centralized device-auth header usage

### Validation baseline
Currently validated in code/build:
- backend build
- focused backend tests for pairing, recovery, runtime auth, and screens
- CMS build
- player build
- focused player tests for lifecycle, runtime auth classification, command dedupe, and pairing integration

## Next-Phase Implementation Roadmap
This section describes the next practical work to build on top of the current baseline.

### Phase 1. Doctor
Build a safe, read-only operational readiness command.

Target outputs:
- backend reachable
- CMS reachable
- DB reachable
- migrations current
- storage reachable
- websockets reachable
- workers healthy
- required envs present

Recommended shape:
- `darshan doctor`

Acceptance:
- no side effects
- machine-readable output plus human-readable summary
- clear pass/fail by subsystem

### Phase 2. Drill
Build synthetic end-to-end scenarios for critical workflows.

Recommended initial drills:
- `device-recovery`
- `publish-playback`
- `media-lifecycle`
- `notifications`
- `chat-core`

Recommended shape:
- `darshan drill <scenario>`

Acceptance:
- controlled cleanup
- explicit stage-by-stage pass/fail
- useful failure cause reporting

### Phase 3. Diagnose
Build read-only evidence collection for broken live systems.

Recommended shape:
- `darshan diagnose backend`
- `darshan diagnose screen --screen-id <id>`
- `darshan diagnose player --device-id <id>`
- `darshan diagnose media --media-id <id>`

Acceptance:
- safe in production
- gathers actionable evidence
- points operators toward probable failure domain and next action

### Phase 4. Reporting And Support Bundles
Make diagnostics exportable and support-friendly.

Recommended outputs:
- JSON bundle
- compact operator summary
- support handoff artifact

Acceptance:
- reproducible
- timestamped
- usable by support without re-running the issue interactively

## Future Scope
These are valuable extensions, but they are not required to declare the first doctor/drill/diagnose model useful.

### Backend future scope
- dedicated diagnostics aggregation endpoints
- orchestrated synthetic drill helpers
- broader failure catalogs for media, chat, notifications, and jobs
- deeper observability hooks and metrics export
- support bundle APIs where useful

### CMS future scope
- drill-launch UI for operators
- downloadable diagnostic reports
- richer health dashboards
- guided troubleshooting workflows and runbook integration

### Player future scope
- local diagnostics export
- support bundle generation
- richer playback cache inspection
- hardware capability and codec validation reporting
- one-click recovery-readiness checks

## Non-Goals For Initial Version
The first release of this initiative should not try to solve everything.

Initial non-goals:
- proving physical monitor/cable/power health
- proving every production device in the fleet is healthy at all times
- replacing customer support entirely
- adding destructive production actions by default
- building perfect environment parity for every deployment topology
- guaranteeing codec/hardware behavior on every physical device through software-only checks

## Design Constraints
- avoid destructive effects on production resources unless explicitly operating in a sandbox/test mode
- separate synthetic drill identities from real production identities where possible
- make read-only diagnostics safe for production use
- report cause and action clearly, not only status codes
- preserve contract clarity across backend, CMS, and player
- prefer structured machine-readable results so automation and support tooling can consume them

## What This Enables For Users
Users can answer:
- is the platform healthy?
- is login/session working?
- is pairing working?
- is recovery working?
- is publishing working?
- is the player able to authenticate?
- is realtime updating?
- is proof-of-play flowing?
- are notifications flowing?
- is chat functioning?
- exactly which stage is failing?

That is the right enterprise operations model.

## What This Cannot Fully Guarantee
A one-command drill still has real limits.

Examples:
- it may use a synthetic device, not the exact deployed kiosk hardware
- codec or hardware playback issues may only happen on the actual device
- LAN, firewall, Wi-Fi, proxy, or site-specific issues may differ by environment
- display hardware, power, and cable issues are outside software
- a synthetic drill can prove software path correctness, not that every production surface is healthy at all times
- a passing drill does not eliminate intermittent infra or operator-side misconfiguration

So the correct expectation is:
- strong troubleshooting and confidence
- not absolute proof of every physical deployment condition

## Recommendation
Yes, build this later.

The right product shape is:
1. operator-facing doctor
2. synthetic end-to-end drill
3. support-grade diagnostics bundle

That gives users a practical way to:
- self-check
- self-troubleshoot
- isolate likely failures
- escalate with evidence when needed

## Bottom Line
A project-wide enterprise-grade operational workflow is possible if it is built intentionally as:
- doctor
- drill
- diagnose

That is the right long-term model for reliability, troubleshooting, release confidence, and customer support readiness across the full DARSHAN platform.

## Engineering Ticket Breakdown
This section translates the roadmap into practical implementation batches with repo ownership and acceptance criteria.

### P1. Doctor Foundation
Goal:
- ship a safe, read-only platform doctor that validates environment readiness and major subsystem availability

#### Backend tickets
Owner: `darshan-server`
- add doctor-facing readiness checks for:
  - API health
  - DB connectivity
  - migration/version visibility
  - MinIO reachability
  - websocket namespace reachability
  - worker/job readiness
- expose structured machine-readable health payloads where needed
- normalize failure reasons for infra readiness checks

Acceptance criteria:
- doctor can determine backend reachable vs degraded vs unavailable
- doctor can identify schema/migration drift
- doctor can identify storage/worker failures clearly

#### CMS tickets
Owner: `darshan-cms`
- no large UI work required in first pass
- optionally add a lightweight operator page or admin panel entry for doctor summary consumption later

Acceptance criteria:
- CMS can consume doctor output without guessing field semantics

#### Player tickets
Owner: `darshan-player`
- add local readiness checks for:
  - persisted identity presence
  - certificate/key readability
  - cache directory access
  - queue/spool readability
  - player config validity
- expose local machine-readable diagnostics for doctor aggregation

Acceptance criteria:
- player can report local readiness without attempting destructive recovery
- player doctor output distinguishes local corruption from backend outage

### P2. Drill Foundation
Goal:
- ship synthetic end-to-end workflow drills for the most important business paths

#### Backend tickets
Owner: `darshan-server`
- define safe sandbox/test drill semantics
- add helper orchestration support where needed for:
  - device pairing/recovery drill
  - publish/playback drill
  - media lifecycle drill
- ensure drill paths can produce stage-by-stage structured results
- ensure cleanup paths exist for drill-created resources

Acceptance criteria:
- drill flows can be executed repeatably
- drill cleanup does not leave uncontrolled residue in shared environments
- failures are reported by stage, cause, and suggested action

#### CMS tickets
Owner: `darshan-cms`
- add optional operator-facing drill launch surface for safe environments
- add drill result rendering for:
  - pass/fail per stage
  - cause summary
  - recommended next action

Acceptance criteria:
- operator can understand drill output without reading raw logs
- CMS does not treat drill state as production business state by accident

#### Player tickets
Owner: `darshan-player`
- add synthetic player-side participation for drills:
  - simulated boot
  - simulated authenticated bootstrap
  - simulated proof-of-play send/replay
  - simulated recovery completion
- add cache-preserving drill execution paths where appropriate

Acceptance criteria:
- player can participate in a drill without destabilizing normal runtime logic
- drill failures clearly distinguish player-local vs backend/CMS failures

### P3. Diagnose And Support Bundle
Goal:
- provide production-safe troubleshooting and support-grade evidence collection

#### Backend tickets
Owner: `darshan-server`
- add diagnostics aggregation endpoints or internal collectors for:
  - auth/session state
  - screen/device recovery state
  - publish state
  - media/storage state
  - notification/chat realtime state where possible
- standardize probable-cause mapping and next-action guidance

Acceptance criteria:
- diagnostics output is safe to run in production
- output identifies likely failure domain with structured evidence

#### CMS tickets
Owner: `darshan-cms`
- add downloadable diagnostic reports or operator summaries
- add runbook links for common failure classes
- add guided troubleshooting entry points for operators

Acceptance criteria:
- operators can collect and export a support-ready bundle
- runbooks map directly to the current backend/player contract

#### Player tickets
Owner: `darshan-player`
- add support bundle generation for:
  - local identity state
  - cached playback state
  - proof-of-play backlog
  - last known lifecycle state
  - recent player logs
- add one-shot local diagnostics export

Acceptance criteria:
- support can diagnose common field failures from the bundle without immediate remote access
- local diagnostics do not expose secrets unnecessarily

## Repo Ownership Summary
- `darshan-server`
  - system-of-record readiness checks
  - diagnostics truth for backend-owned state
  - drill-safe orchestration and validation
  - failure reason normalization
- `darshan-cms`
  - operator workflow
  - drill and diagnostics presentation
  - runbook entry points
  - support-facing summaries
- `darshan-player`
  - local machine diagnostics
  - runtime participation in drills
  - local cache/recovery visibility
  - support bundle generation for field issues

## Cross-Repo Acceptance Matrix
### Doctor
- backend reports infra and service readiness correctly
- player reports local identity/cache readiness correctly
- CMS can present the result clearly

### Drill
- one selected workflow can run end to end in a safe environment
- every stage emits explicit pass/fail output
- cleanup is predictable

### Diagnose
- one command can collect enough evidence to identify the likely failing subsystem
- support receives structured evidence instead of screenshots and raw logs only

## Suggested Ownership By Priority
### P1
- backend lead
- player lead
- CMS as consumer of doctor output

### P2
- backend lead for orchestration
- player and CMS in parallel for drill participation and presentation

### P3
- player and backend in parallel for diagnostics capture
- CMS lead for operator/support presentation
