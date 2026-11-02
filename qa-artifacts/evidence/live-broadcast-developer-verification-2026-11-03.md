# Live broadcast developer verification — 2026-11-03

Status: **IN PROGRESS — LOOP 0 IN PROGRESS; LOOP 1 UNDER DEVELOPMENT.**
This is a developer work record, not a completed feature or independent-QA pass.

## Recorded baseline

- Repository: `/home/hexmon/Desktop/DARSHAN-SIGNAGE`.
- Feature branch: `codex/live-screen-broadcast-planning-20261103`.
- Starting commit: `499bcdf7161eb8f9e90cf83ed6cf57e95ffb3712`, equal to local
  `release-01` at initial inspection; working tree was clean then.
- Initial source supports presentation schedules; no live source/receiver is
  implemented at that starting commit. Review found current-group snapshot
  filtering, revision/count-based hold reuse, currently playing cache protection,
  and no live authority version. These are implementation targets, not passes.
- Initial host inspection: 8 logical CPUs; 6,362 MiB RAM; 4,095 MiB swap, with
  approximately 2,287 MiB swap used. Values are a point-in-time observation.
- Default shell Node was `v22.23.2`; execution must explicitly select installed
  Node 20. Default selected Docker context was `desktop-linux` and its socket
  was unavailable; `default` targets `/var/run/docker.sock`. Successful Engine
  and feature-service checks must be recorded separately below.
- Build sequentially and begin with one isolated real Electron receiver.
  A second receiver requires independent user-data/singleton verification.

## Accepted target and plan

Contract: `docs/contracts/live-broadcast.md`.
Execution plan: `docs/plans/live-broadcast-implementation-loops.md`.
QA: `LIVE-01..20`, `BR-109..116`, `R-44..51`, `UC-030..032`, `BQ-027`.

Six initial VM roles, ten concurrent broadcasts, one presenter, 25 approved
screens/run; fullscreen video and browser-supported optional audio; approved
window/frozen audience; verified pinned fallback; missing/corrupt fallback is
Content unavailable; renew every 3 seconds, live cutoff within 10 seconds,
local schedule end within 1 second. These are acceptance targets, not measured
results. LiveKit remains conditional on actual enforcement evidence.

## Loop ledger

| Loop | Status | Evidence |
| --- | --- | --- |
| 0 baseline | In progress | Initial source/Git/resource inspection; root observed actual CMS login, CMS OTP confirmation and real Electron PAIRED_RUNTIME. API fixture preparation succeeded. Visible ordinary media, emergency and security/offline baseline still pending. |
| 1 capture/enforcement | In progress — partial technical runtime | Root reported real getDisplayMedia capture and real Electron first-frame event; interruption caused disconnect/fallback. No pixel artifact, audio/security-cutoff evidence or completed loop pass. |
| 2 scheduling/reservations | Not executed | Pending |
| 3 authority/recovery | Not executed | Pending |
| 4 player behavior | Not executed | Pending |
| 5 CMS options | Not executed | Pending |
| 6 deployment/faults | Not executed | Pending |
| 7 integrated handoff | Not executed | Pending |

## Runtime evidence to append as executed

Record exact commands/build and artifact SHA-256, source commit/worktree delta,
selected Node and dependency versions, isolated ports/data/profiles, visible
CMS actions, presenter capture, real player display/audio, timing, injected
fault, permitted recovery, and room/admission/cache/capacity cleanup. Link
sanitized screenshots/logs. Do not store raw tickets, credentials, certificates,
private keys or generated runtime folders here.

At the initial documentation checkpoint no live automated/runtime execution was
claimed. The partial root-reported technical run below supersedes that initial
absence for its stated scope only. No completed SFU enforcement or integrated
scheduled feature journey is claimed; root execution must add outcomes and
defects before closing any loop.

## Remaining independent/release gates

All new human cases remain Not Tested. Local developer evidence cannot close
Windows, actual Chrome/Edge, physical display/audio, whole-machine sleep with a
separate Backend, cross-VM TLS/firewall/TURN, production-sized restore or
representative 1×25/5×25/10×25 capacity/soak. Existing unrelated release blockers
remain visible in `11_RELEASE_READINESS_CHECKLIST.md`.

## Documentation/catalog validation

The initial documentation packet validated 150 unique cases (120 Not Tested,
30 Partially Tested), 51 unique risks and 152 unique traceability rows. All
pre-existing CSV records and their QA-owned values are preserved; all 20 new
cases have Expected Result/planning fields, valid rule/use-case/risk links and
empty Actual Result/Execution Evidence/Defect ID. Markdown whitespace check
passed. This is catalog integrity only; it is not application test execution.

## Loop 0 fixture preparation and partial pairing observation

The root runtime observer reported actual CMS login, OTP confirmation through
CMS and the real Electron player reaching PAIRED_RUNTIME. This closes only that
pairing portion; this record does not yet claim visible media, emergency or
security/offline verification. At that fixture-preparation checkpoint the baseline artifacts were existing
built code. Later prototype builds/runtime are reported separately below.

Executed `scripts/qa/live-baseline-fixtures.mjs --prepare-isolated-live-fixtures`
with `/home/hexmon/.nvm/versions/node/v20.20.2/bin/node` against feature-only API
`http://127.0.0.1:18120` and MinIO `127.0.0.1:59100`. The helper generated two
deterministic 1280x720 PNGs, uploaded them through actual verified upload-session
APIs, observed both READY, and created the own-marked 16:9 fullscreen layout and
normal-image presentation. Upload API bucket initialization succeeded for its
staging/canonical buckets; this is not a statement that every application bucket
is provisioned. A second execution reused the same IDs successfully. Syntax
check passed. The generated normal PNG was visually inspected and reads NORMAL
CONTENT on teal/green; emergency is a distinct red/yellow EMERGENCY image.

| Fixture | Non-secret ID |
| --- | --- |
| Live Loop Baseline Player | 7be1093c-cd8d-488c-9f48-bd6971e9565f |
| Live Loop Baseline Normal PNG | 4d09b722-c012-4b47-aeb2-ad7cc4deb0ce |
| Live Loop Baseline Emergency PNG | d66e7474-4ec2-45a4-b402-400399df8b4f |
| Live Loop Baseline 16x9 Fullscreen Layout | 231e1269-2154-4c2a-8128-5dfdfcddc442 |
| Live Loop Baseline Normal Presentation | 63e7f5aa-1084-4c21-b54f-da935cf65c6c |

The ignored local manifest `.local/live-broadcast/baseline-fixtures.json` holds
IDs, filenames and SHA-256 values without credentials. Private login material
remained mode0600 and no token/cookie/signed upload URL was logged. The helper
never creates or publishes schedules and never triggers emergency; those
journeys remain actual CMS actions for the root runtime observer. No existing
account, pairing or other deployment data was edited.

## Loop 1 partial technical runtime — root report, 2026-11-03 IST

The user clarified that the final feature must be a scheduled live event/media
source inside the **same ordinary installed DARSHAN desktop player**, sharing
normal pairing, main-process lifecycle, cache/defaults, emergency and security.
The temporary developer-only presenter/receiver prototype is a technical gate,
not a separate final player application or proof of completed scheduling.

Root reported actual `getDisplayMedia` monitor capture at **1920x1080, 30 fps,
no audio track**, followed by an explicit Start action on the visible developer
prototype. The real gateway/SFU (`LiveKit v1.13.11`) and real Electron receiver
produced a `first-frame` event timestamped **22:52:17.176Z** during this IST
session. The capture tab then closed on a turn interruption, after which the
receiver disconnected/fell back. No exact transition timing was measured.

This is a root-reported runtime event observation. No saved source/player pixel
artifact, human-visible content confirmation, physical sound result or measured
security/authority cutoff is attached. Therefore **loop 1 remains open** and
`LIVE-01..20` remain Not Tested. Background/minimized capture, adversarial
original/refreshed reconnect, already flowing removal, watchdog, expiry and full
ordinary-player scheduled lifecycle acceptance are still required.

Root also reported a passing full player source build and passing **30 core**
and **16 prototype** checks. This documentation agent did not rerun those suites
or independently inspect their command outputs; treat the counts as reported
until root links exact commands/logs and tested source/artifact identifiers.
These supporting checks cannot replace the missing real-media evidence.
