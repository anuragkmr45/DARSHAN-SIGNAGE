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
| 0 baseline | In progress — ordinary/emergency pixels observed | Root observed CMS login/pair/approve/publish/emergency/clear; own screenshot command confirmed ordinary NORMAL CONTENT pixels after clear. Security/offline baseline still pending; no transition timing pass. |
| 1 capture/enforcement | In progress — partial technical runtime | Root reported real getDisplayMedia capture/first-frame event; a later separate transport prototype PNG shows decoded counter pixels. No physical audio/security-cutoff evidence or completed loop pass. |
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

This was the initial root-reported runtime event checkpoint. At that point no
saved source/player pixel artifact, physical sound result or measured
security/authority cutoff was attached; later pixel artifacts are recorded
separately below and do not establish the missing timing or sound results. Therefore **loop 1 remains open** and
`LIVE-01..20` remain Not Tested. Background/minimized capture, adversarial
original/refreshed reconnect, already flowing removal, watchdog, expiry and full
ordinary-player scheduled lifecycle acceptance are still required.

Root also reported a passing full player source build and passing **30 core**
and **16 prototype** checks. This documentation agent did not rerun those suites
or independently inspect their command outputs; treat the counts as reported
until root links exact commands/logs and tested source/artifact identifiers.
These supporting checks cannot replace the missing real-media evidence.

## Loop 0 actual CMS publication/emergency and normal screenshot evidence

Root reported completing ordinary schedule approval/publication through visible
CMS actions, then activating the emergency. The missing-audit-note negative
case rejected activation; providing the required note allowed it. Root then
cleared the emergency through CMS with a clear reason. These are root-observed
CMS actions; the supporting collector below does not publish, trigger or clear.

The red emergency screenshot `.local/live-broadcast/baseline-emergency.png` was
downloaded from this isolated player's own screenshot object. Root image
inspection confirmed the red EMERGENCY fixture and matching emergency message.
PNG: 1803x968, 81,278 bytes; SHA-256
`3aacc079851c148b1d003cf1196bfb76869d8b600e1252cab25ac73c7acd4b6f`.

Added reusable support collector `scripts/qa/live-baseline-evidence.mjs`. It
validates API port18120, the fixed baseline screen ID, the dedicated
`darshan_live_20261103_test` configuration against both private backend.env and
the actual feature container, and loopback MinIO port59100. It uses private
mode0600 cookie/CSRF/S3 inputs without printing tokens or signed URLs; polls
ordinary reported media after CMS clear; requests TAKE_SCREENSHOT; waits for
that exact command; downloads only its resulting object under the fixed screen
key; and saves PNG/metadata privately. It never mutates schedule/emergency state.

Collector development found the actual command API stores objectKey under
`result_payload.result_payload.objectKey`; the extractor was corrected. One
rapid second screenshot returned the exact terminal error **Rate limited**,
matching the player's existing 60-second command policy. The helper now waits
for the existing completed-shot cooldown and can resume its own exact completed
command without issuing another screenshot. This was a collector parsing fix
and a respected existing policy, not a claimed player feature defect.

Exact screenshot command `74c5dd78-9cea-47d2-ba68-ca87a6311e63` was created
`2026-11-02T23:01:27.791Z` and completed `2026-11-02T23:01:28.387Z`
(2026-11-03 IST session). The resulting file is:

`.local/live-broadcast/evidence/baseline-normal-after-clear-1793660555214-74c5dd78-9cea-47d2-ba68-ca87a6311e63.png`

PNG: 1803x968, 22,172 bytes; SHA-256
`567173a98ecd1ad3602200beffff9df59cb02903fb5695fa9ca9f5ad613f4f6a`.
The documentation/runtime agent viewed the identical first download: it shows
the actual ordinary player ONLINE overlay and the teal **NORMAL CONTENT** image
with green bars after emergency clearance. Capture support confirmed current
normal media and no active emergency; no display transition latency was measured.
The collector itself labels downloaded output captured_not_visually_verified;
this separate image inspection supplies the developer pixel observation.

Node20 syntax check passed. A port3000 override was rejected in configuration
validation before login or screenshot request; the fixed configuration/exact
command resume run succeeded. No files/data were deleted and no code was pushed
or committed by this collector task. The player's existing behavior is only a
loop0 baseline; this does not verify the final live schedule integration.

## Later loop 1 prototype pixel artifact

A separate **synthetic-pattern** technical transport attempt produced
`/tmp/darshan-live-pixel-evidence-20261103/1793660316087-first-frame-a98d4c34-8b45-4304-907c-24216581f612.png`.
Root and the documentation/runtime agent viewed it: the receiver displays
**DARSHAN TRANSPORT TEST**, a **9.9 seconds** counter, green bar and
**Live video rendering** label. This confirms decoded synthetic-pattern pixels in the developer
transport receiver for that later attempt. It does not close actual OS screen
capture, physical video/audio or final scheduled ordinary-player acceptance;
the earlier real monitor-capture event still has no linked pixel screenshot.

Artifact PNG: 1205x764, 73,161 bytes; SHA-256 `4e819b37821abd99b1e8c2626c30a169205fccf2a3840c4d62f61e5abe4857aa`.

Physical sound, exact end/security cutoff, replay/removal/watchdog and all final
same-player scheduling/lifecycle gates remain open. No independent human
`LIVE-01..20` status or QA-owned result field was changed.

## Preserved sanitized pixel artifacts

Root reviewed the images and copied these own-fixture PNGs into the tracked
evidence directory. Checksums below were read from the preserved copies, not
inferred from filenames. These links supersede private/tmp locations for
reviewable pixel evidence; private originals remain untouched.

| Artifact | Size | SHA-256 | Proven scope |
| --- | --- | --- | --- |
| [baseline-emergency.png](runtime-live-2026-11-03/baseline-emergency.png) | 1803x968; 81,278 bytes | `3aacc079851c148b1d003cf1196bfb76869d8b600e1252cab25ac73c7acd4b6f` | Actual ordinary installed player: red emergency fixture/message; root CMS activation |
| [baseline-normal-after-clear.png](runtime-live-2026-11-03/baseline-normal-after-clear.png) | 1803x968; 22,172 bytes | `567173a98ecd1ad3602200beffff9df59cb02903fb5695fa9ca9f5ad613f4f6a` | Actual ordinary installed player: NORMAL CONTENT after root CMS clear |
| [prototype-synthetic-live-frame.png](runtime-live-2026-11-03/prototype-synthetic-live-frame.png) | 1205x764; 73,161 bytes | `4e819b37821abd99b1e8c2626c30a169205fccf2a3840c4d62f61e5abe4857aa` | Synthetic transport pattern decoded by developer receiver only; not OS capture acceptance |

Loop 0 offline/security baseline and normal-player dispatch/restart regression
remain pending. Real monitor-capture first-frame telemetry has no corresponding
pixel artifact here; the synthetic frame cannot substitute for it. No exact
cutoff, physical sound or completed loop 1 security gate is claimed. Root
reported the persistent goal paused; these evidence updates do not mark it
resumed or complete. Human LIVE cases remain Not Tested.

## Measured prototype authority withdrawal — 2026-11-03 IST

This later checkpoint supersedes the earlier absence of measured SFU cutoff
evidence only for the specific run below. It does not close loop 1 or final
scheduled same-player integration.

Root disabled the **Renew** control through the actual visible presenter UI
(tab 16) for run `09b883bd-b386-43dd-81a7-13bf47ba354f`, generation 1. The fixture
was **synthetic canvas video over actual WebRTC and actual Electron**, with
**no audio track**. The root-reviewed observer result is `PASS_SFU_CUTOFF`,
`same_run_confirmed: true`, based on 93 samples and 9,303 ms observer elapsed time.
The preserved result file was independently read by this documentation agent.

| Participant | Observed renewals | Absence after last authority, upper bound | Margin versus full 10-second deadline | Deadline uncertainty | Last control state |
| --- | --- | --- | --- | --- | --- |
| Presenter | 1 | 7,139 ms | 2,861 ms before deadline | 4 ms | REVOKED |
| Receiver | 3 | 1,375 ms | 8,625 ms before its deadline | 3 ms | REVOKED |

Both absences were observed at 9,276 ms after observer readiness. These values
prove participant absence at the SFU against the observed full authority
deadlines for this attempt. They are not a standalone player-local timer test
or a measurement of physical audio clearance. The receiver's shorter bound
also does not extend its independent authority lease.

The matching actual Electron event log records first-frame at
`2026-11-02T23:02:52.268Z`, disconnected at `23:03:47.095Z` and fallback at
`23:03:47.120Z` (25 ms between those latter events). Root reported the fallback
pixel capture at `23:03:47.533Z`; the log records its saved event at
`23:03:47.535Z`. Root and this agent reviewed the preserved PNG and saw
**Content unavailable — reconnecting**. Event intervals describe this observed
transition; they do not establish an unmeasured physical-display/audio deadline.

The media Dockerfile pins were source-verified as:

- `livekit/livekit-server:v1.13.11@sha256:25cd902de7cacbd5f1f779f6a6ac1eae20ba8f56b0935934ce6b0ab80d1e3d20`.
- `node:20-bookworm-slim@sha256:2cf067cfed83d5ea958367df9f966191a942351a2df77d6f0193e162b5febfc0`.

Root reported rebuilding the runtime image with the latest join-race correction.
The source pins and that root report are recorded distinctly; this agent did
not independently attest the running image/source digest mapping.

| Artifact | Size | SHA-256 | Proven scope |
| --- | --- | --- | --- |
| [prototype-authority-cutoff-result.json](runtime-live-2026-11-03/prototype-authority-cutoff-result.json) | 1,084 bytes | `58d828942f80d629f48f8ad6d06faaadbd7744ebc8e2f20e6bd84c5291c9273d` | Same-run SFU participant absence against observed authority deadlines |
| [prototype-measured-player-events.json](runtime-live-2026-11-03/prototype-measured-player-events.json) | 1,780 bytes | `32ec2028f7862f3175a2497adacfb0a695ccba323d4d94391a78a79f44581477` | Actual Electron event times for this synthetic video-only attempt |
| [prototype-authority-cutoff-fallback.png](runtime-live-2026-11-03/prototype-authority-cutoff-fallback.png) | 1203x764; 10,102 bytes | `4490c2dc2b0f968b73d4c8699a7754b79470f73eda6902b3211c48b3ead64441` | Root/agent image review: Content unavailable — reconnecting |
| [prototype-measured-live-before-cutoff.png](runtime-live-2026-11-03/prototype-measured-live-before-cutoff.png) | 1205x764; 72,863 bytes | `bd64480a01da6ad3e2829d82b5316ee23d3c0d6cb6eb1e7b00e26be3fd9d0eec` | Root-reviewed synthetic live pixels before authority renewal disabled |

**Still open:** host watchdog and fault/partition matrix, trusted TLS, browser
capture screen/window/tab and optional audio matrix, physical sound, the one-second local
schedule boundary, and integration as a scheduled event/media source inside the
same ordinary installed DARSHAN player. Loop 0 offline/security and normal
dispatch/restart baseline are pending. The synthetic fixture and this one
measured authority withdrawal are bounded technical evidence only.

Loop 1 remains in progress. No `LIVE-01..20` human QA result/status/Defect field
was changed, and no commit or push was performed by this documentation update.


## Player hardening and Linux v2 package — 2026-11-03 IST

This checkpoint records developer code checks and packaging. The v2 package was
not launched, and no v2 playback, capture, sound, TLS or cutoff result is claimed.
The root-owned receiver used for the separate TLS experiment was not stopped or
replaced by this packaging task. The temporary prototype remains a development
mode inside the same DARSHAN player binary; final ordinary-player schedule and
lifecycle integration remains pending.

Independent review found and corrected three player boundary issues:

- Authority validation previously retained unexpected response properties. It
  now constructs the documented grant fields explicitly, so an accidental
  renewal token/server-secret property cannot cross renderer IPC.
- A predictable temporary Chromium profile previously accepted an existing
  directory without checking ownership or symlinks. Profile preparation now
  rejects symlinks, non-directories and canonical-path redirection; Unix
  profiles also require the current owner and no group/other permissions.
- The HTTP socket timeout previously measured inactivity. A peer sending small
  chunks could hold renewal single-flight work open indefinitely. An absolute
  1.5-second deadline now aborts the request, independent of arriving bytes.

The actual HTTP dribble fixture rejected at approximately 1,503 ms in the first
focused run; this is HTTP request timing evidence, not media/display cutoff
measurement. Focused coverage also verifies an ordinary complete POST,
unknown-secret stripping, symlink/shared-profile rejection, foreign-owner
rejection, stale authority, local deadline caps and private pixel artifacts.
The ordinary `src/main/application.ts` remains byte-for-byte equal to commit
`499bcdf`'s original `src/main/index.ts` (35,345 bytes); prototype dispatch is the
separate entrypoint change.

| Validation checkpoint | Result | Evidence and qualification |
| --- | --- | --- |
| Full player suites **before these three hardening changes** | Unit 410 passed; integration 5 passed; fault 21 passed; no failures | Sequential Node 20.20.2 runs with 768 MiB heap cap; ignored sanitized logs `.local/live-broadcast/player-unit-20261103.txt`, `player-integration-20261103.txt`, `player-fault-20261103.txt`. These are not post-hardening full regression results. |
| Current post-hardening focused player suite | 23 passed; no failures | Real HTTP transport plus configuration, profile, grant, evidence and lease/fault coverage. Sanitized ignored log `.local/live-broadcast/player-hardening-focused-20261103.txt`. |
| Current post-hardening main/renderer TypeScript checks | Passed | Ignored logs `.local/live-broadcast/player-hardening-main-types-20261103.txt` and `player-hardening-renderer-types-20261103.txt`. |
| Current post-hardening `npm run build` | Passed | Node 20.20.2, 768 MiB heap cap; ignored log `.local/live-broadcast/player-hardening-build-20261103.txt`. |
| Current Linux x64 unpacked v2 package | Built; runtime not executed | Existing local Electron 33.4.11, npm offline, directory target, no dependency installation/download and no native-dependency rebuild. Ignored log `.local/live-broadcast/player-package-linux-v2-20261103.txt`. |

The v2 output is
`darshan-player/build/live-prototype-20261103-v2/linux-unpacked/`.
Package inspection confirmed normal/prototype main, preload, evidence and
renderer assets are present and root private fixture/config paths are absent.
The following hashes describe the current package bytes only:

| Package file | SHA-256 |
| --- | --- |
| `darshan-player` executable | `ee99780b5878638df40bf577cfcdbc3c157b0b3581ada099a13db446f1af84d8` |
| `resources/app.asar` | `01eb3ca09dc95d3168d399c3a8112bfc6fdc68a5aa21eb6ce1b476d0db893066` |

A sanitized local manifest with repository-relative paths, package inspection,
hashes and validation chronology is saved at
`.local/live-broadcast/player-package-v2-summary-20261103.json`. Generated
packages and local logs remain ignored. The executable hash alone identifies
Electron; `app.asar` identifies the packaged application changes.

Full regression on the stable final packet and v2 packaged runtime are still
pending. Earlier synthetic/older-package runtime observations do not establish
v2 runtime acceptance. The prototype's initial `410 RUN_ENDED` response is
terminal, so launching it while no harness run exists currently requires a
fresh receiver launch after a run starts; final desired-state/new-run behavior
is part of the pending ordinary-player integration. No independent human
`LIVE-01..20` result/status/Defect field was changed. No commit or push was made
by this player-hardening/package task.

## Independent prototype review and later runtime checkpoints — 2026-11-03 IST

These later observations supersede the earlier pending ordinary-player security
baseline and trusted-local-TLS notes for the specific scenarios below. They do
not close loop 1, final scheduled integration, human audio checks or production
deployment acceptance.

The independent code review reproduced and corrected three presenter/authority
issues in the development-only prototype:

- A Stop request could reach the control plane before a concurrent admission
  Create. Its DELETE returned 404; the later successful create was deleted but
  remained in the authority's client map. The next run then incorrectly returned
  `409 TEARDOWN_NOT_CONFIRMED` despite zero remaining admissions. After a
  confirmed late DELETE, the authority now removes only the exact captured
  admission, preserving any replacement at the same key. The regression uses a
  realistic absent-admission 404 and verifies that a new run can subsequently
  obtain an admission.
- An old capture source's delayed `ended` event could stop the newer source and
  its broadcast. Its callback now checks both the source identity and generation;
  coverage also verifies that the current source's end still stops transmission.
- Microphone denial was immediately replaced by generic ready text, and a stale
  microphone rejection could replace the newer preview's details. The explicit
  microphone-unavailable message now remains visible and stale results are
  ignored. Video-only authority correctly excludes the missing audio source.

After those changes, the prototype tests independently passed **21/21**
(13 authority, 8 presenter), `git diff --check` passed and the presenter bundle
rebuilt with the existing local esbuild. These are code and fixture tests;
microphone permission coverage does not establish successful physical sound.
The running authority requires a restart to load its source change, and an
already-open presenter requires a reload to load the rebuilt bundle. These
fixes do not retroactively change the bytes used by earlier runtime attempts.

A subsequent root UI observation on the previously loaded presenter showed a
stale renewal failure message after the controller fault. Review confirmed
that an older in-flight renewal's rejection could overwrite a terminal
Stop/Disconnected message and its `finally` could release a newer run's
single-flight flag. Both updates are now generation-scoped; the error message
also requires a current room. Two deferred-response regressions cover terminal
status preservation and the newer run's renewal guard. The later complete
prototype retest passed **23/23** (13 authority, 10 presenter), and the presenter
bundle rebuilt successfully. Exact HTTPS-loopback-origin tests remain passing.
The earlier 21/21 checkpoint is historical; 23/23 describes this latest source.

### Ordinary player security lock and recovery

Root restarted the ordinary player through the new application dispatcher with
its private runtime profile, the existing 120-second playback security window
and realtime configuration. Root reported the isolated backend stopped at
`2026-11-02T23:08:53Z`; the last successful backend validation was
`23:08:34.4Z`. The actual player recorded stopped playback at `23:10:34.670Z`
and cache purge at `23:10:34.701Z`. The stop was therefore approximately
120.270 seconds after the reported last validation, rather than 120 seconds
after the later backend-stop command.

Root captured the lock pixels at `23:11:11.224Z`. Both root and this
documentation agent viewed the preserved PNG: **PLAYBACK LOCKED**, **DARSHAN
requires backend validation**, with the 120-second policy explanation. After
backend REST recovery and cache refresh, root recorded the ordinary normal
scene at `23:11:34.941Z`. Both agents viewed the corresponding **NORMAL CONTENT**
and **ONLINE** pixels. These are ordinary-player lifecycle regression
observations on the isolated local system; no unmeasured reconnect latency,
physical display timing or long-duration offline endurance is claimed.

### Trusted local HTTPS/WSS and independent controller-stall observation

Root exercised actual CMS login and the Screens page at
`https://localhost:18443` using a trusted, two-day local test root in the
dedicated test trust/profile setup. Root reported no TLS bypass and no host
package installation; the certificate utility came from a privately extracted
official package. This establishes the developer test-origin journey only,
not production certificate provisioning or every browser/OS trust path.

Root reported all six isolated backend readiness checks healthy after using the
current migration set and explicitly adopting the dedicated seed administrator.
That readiness observation is a root report, not an attached readiness artifact
or a verification of unrelated deployment data.

The matching v1 packaged Linux receiver then rendered synthetic video through
trusted `wss://localhost:18444`, with first-frame at
`2026-11-02T23:13:25.133Z`. The preserved root-reviewed result identifies run
`30f74a35-3d27-48dc-83be-a44957c730c5` and two SFU participants with one
screen-share track before the fault. The presenter browser was visible and the
fixture had **no audio**. Root and this agent viewed the preserved live PNG:
**DARSHAN TRANSPORT TEST**, **14.6 seconds** and **Live video rendering**.
Although root navigated to other CMS pages during the session, the presenter
document's observed `visibilityState` remained `visible`. This session provides
no hidden-tab, minimized-browser or background-timer acceptance evidence.

For this real-flowing-video attempt, root suspended the controller with
`SIGSTOP` at `23:15:23.929Z`. The receiver disconnected at `23:15:27.181Z`
and entered fallback at `23:15:27.223Z`, **3,294 ms after the fault trigger**.
Both agents viewed **Content unavailable — reconnecting** in the fallback
PNG. The result records the container stopped, exit code 1, not OOM, observed
at `23:15:27.540Z`: a **3,611 ms container-stop upper bound** including Docker
execution/inspection overhead. It is not a direct SFU PID-death measurement
and must not be substituted for the media agent's separate direct-PID
watchdog timing. Root reported this media container remained fault-stopped
pending its next deliberate restart.

The preserved JSON was independently read by this documentation agent. It
explicitly excludes hidden/minimized browser and audio acceptance. The
screenshots establish the observed rendered/fallback states; they do not
independently measure physical sound clearance or a production network fault.

| Artifact | Size | SHA-256 | Proven scope |
| --- | --- | --- | --- |
| [baseline-security-lock.png](runtime-live-2026-11-03/baseline-security-lock.png) | 1803x968; 609,810 bytes | `53d377f3a76bc5970fd1335fcc62d22580cc0afd5251a7a921c33c936eabd78a` | Actual ordinary player security-lock pixels after backend validation expired |
| [baseline-normal-after-security-recovery.png](runtime-live-2026-11-03/baseline-normal-after-security-recovery.png) | 1803x968; 21,949 bytes | `d15e536310e7062dc239e28e567a49b0fb4c9df881c5b97059033630f471bb38` | Actual ordinary player NORMAL CONTENT/ONLINE after backend recovery and cache refresh |
| [prototype-trusted-tls-controller-stall-result.json](runtime-live-2026-11-03/prototype-trusted-tls-controller-stall-result.json) | 934 bytes | `41cfb52fd2ad4381951e37333b94be53de88b3f03b3c1633057305f6231a171c` | Trusted-local-WSS synthetic-video controller-stall event/container bounds; no audio |
| [prototype-trusted-tls-live-frame.png](runtime-live-2026-11-03/prototype-trusted-tls-live-frame.png) | 1205x764; 72,855 bytes | `2434d9a03b2706719b4b083c106edbe44810a938d9cb69507ff5c4dab8c7a684` | Synthetic pattern decoded by the v1 packaged receiver through trusted local WSS |
| [prototype-controller-stall-fallback.png](runtime-live-2026-11-03/prototype-controller-stall-fallback.png) | 1203x764; 10,102 bytes | `4490c2dc2b0f968b73d4c8699a7754b79470f73eda6902b3211c48b3ead64441` | Content unavailable — reconnecting after the controller-stall attempt |

Checksums and PNG dimensions above were read from the actual preserved files.
The fallback PNG is byte-identical to the earlier text-only fallback image;
the accompanying scenario JSON supplies the distinct controller-stall timing.
No independent human `LIVE-01..20` result/status/Defect field changed. No commit
or push was performed by this evidence update. Remaining loop gates, including
host-watchdog/partition coverage, the capture/audio matrix, v2 packaged runtime,
the one-second local schedule boundary and same ordinary-player scheduled live
integration, remain open unless a later scoped checkpoint supplies evidence.

## Optional document/video fallback fixture preparation — 2026-11-03 IST

The loop-0 fixture helper now accepts a fixed optional media-fixture flag:

```sh
node scripts/qa/live-baseline-fixtures.mjs --prepare-isolated-live-fixtures --include-media-fallbacks
```

This prepares test data only. It neither publishes a schedule nor activates an
emergency, and it does not change the ordinary published snapshot. Its existing
normal presentation draft is assigned the same normal image. No CMS/browser
actions were taken by this fixture task while the root's OS capture chooser was
pending.

The PDF and MP4 are the existing tracked synthetic media from the
`runtime-2026-10-16` QA packet, whose environment manifest identifies synthetic
test data only. The helper accepts only these two fixed source paths and pinned
SHA-256 values; it provides no arbitrary upload-path or remote-URL option.
Existing `pdfinfo` found five pages, no encryption and no JavaScript in the PDF.
Metadata probing inside the already-running API container identified H.264
640x360 video and AAC audio in the two-second MP4. No host software was installed
or fixture regenerated. Audio metadata is not a sound-playback observation.

The generalized media helper requires exact names, media types, source MIME and
size, READY state, and expected document pages/video dimensions/duration. It
checks the dedicated database `darshan_live_20261103_test`, loopback API 18120,
loopback MinIO 59100 and the running isolated API container's storage settings
against the private mode-0600 configuration before authentication or writes.
Manifest ownership is checked. Upload completion runs the API's SHA-256
validation; the helper also re-reads each named fixture's source object from
isolated S3 and independently verifies its bytes/MIME/SHA-256, including reuse.
Credentials, signed URLs and object paths are not printed or committed.

Both fixtures became READY through the actual isolated upload/processing API;
the optional helper then ran again successfully and retained these same IDs:

| Named fixture | Media ID | Verified source | Processed metadata | Source SHA-256 |
| --- | --- | --- | --- | --- |
| Live Loop Baseline Fallback PDF | `8122f538-e6d1-40a3-9656-135319a795f8` | DOCUMENT; `application/pdf`; 7,726 bytes | READY; 5 pages | `8362c191e2e483d4582d6c6b41b0ef463a9100ae915096962202bb991ccf4477` |
| Live Loop Baseline Fallback Video | `11cb9b9d-44b1-4374-8d47-3e2ba6a76488` | VIDEO; `video/mp4`; 217,985 bytes | READY; 640x360; 2 seconds | `d097080d06c34f999cf3efae77b1ab485f264e3646feb30ea9b044346951a45e` |

IDs, source provenance, checksums, ownership and server-reported metadata are in
the ignored `.local/live-broadcast/baseline-fixtures.json`; source copies remain
under the ignored private fixture directory. The normal/emergency fixture IDs
and existing layout/presentation IDs remained unchanged. Node20 syntax and
whitespace checks passed. This checkpoint proves **fixture preparation and
checksum validation only**: no PDF-page rendering, video looping, sound,
live-to-fallback transition or independent human `LIVE-01..20` acceptance is
claimed. No QA-owned result/status/Defect field changed and no commit/push was
performed.

### Current player packet regression after hardening

The final sequential Node 20.20.2 run, with a 768 MiB heap cap, passed
**415 unit, 5 integration and 21 fault tests**, with no failures or pending
tests. This supersedes the earlier 410-unit pre-hardening result for current
player source. Sanitized mode-0600 logs remain in ignored
`.local/live-broadcast/player-{unit,integration,fault}-v2-20261103.txt` and the
relative-path summary is `player-final-packet-v2-summary-20261103.json`.
Available-memory gates before each suite were 2438, 2264 and 2173 MiB. Builds
and both TypeScript checks also passed after the hardening changes.

The hardened Linux v2 package was built from local Electron 33.4.11 without
downloads; its `app.asar` SHA-256 is
`01eb3ca09dc95d3168d399c3a8112bfc6fdc68a5aa21eb6ce1b476d0db893066`.
The actual TLS/video/fault screenshots above came from the earlier v1 package;
they do not establish a v2 runtime pass. A new HTTPS native capture chooser was
requested, with human selection pending. No chooser selection, captured audio,
hidden/minimized behavior, or human QA Pass is inferred from elapsed time.

The final product remains the **same ordinarily paired DARSHAN desktop player**:
published live items must be selected automatically by its existing schedule
lifecycle. The developer-only flag/window is a transport test harness and does
not complete that integration. Loops 2–7 and the outstanding loop-1 application
matrix remain open; this packet must not be merged or described as a finished
scheduled-broadcast feature.

### Final media-node and independent watchdog checkpoint

Current Node 20 checks passed **40 local tests**, with **7 opt-in runtime tests
skipped by default**; Python watchdog units passed **11 tests**. The two earlier
actual-SFU RPC/race tests were run separately. The final five-case actual Docker
fault run was **4 passed, 1 failed/open gate**, with no skips. It used unique
256 MiB / 0.5 CPU containers and current source mounted read-only over the
recorded test image. All fault containers were removed afterward.

| Injected fault | Actual SFU termination upper bound | Result |
| --- | --- | --- |
| Controller SIGSTOP | 1820 ms / 2000 ms limit | Pass |
| Controller crash | 46 ms / 2000 ms limit | Pass |
| SFU management timeout → isolation | 1578 ms / 3000 ms limit | Pass |
| Supervisor PID1 SIGSTOP → host Docker watchdog | 1717 ms / 3000 ms limit | Pass |
| Supervisor stall plus watchdog Docker CLI unavailable → held pidfd | Not confirmed; SIGKILL returned EACCES 13 | **Open gate** |

The last case failed in this Codex application's LSM context despite successful
pinning and signal-0 checks. No AppArmor/profile override, sudo, system-service
installation, unsafe numeric-PID fallback or invented timing was used. The
watchdog reports `UNCONFIRMED`; direct-pidfd actuation must be measured from the
actual production host-service privilege/LSM context before that gate closes.
Only the test's cleanup stopped the failed-case container. These process/RPC
tests do not prove rendered video/audio or physical display termination.

The supervisor now sends the first controller IPC heartbeat before admission
listeners open, limits readiness to the short runtime watchdog deadline,
and writes its own private atomic host-watchdog state before spawning children.
The host watchdog validates a local Unix Docker socket, exact full container
ID/instance/labels/mount, UID/mode, private PID namespace/cgroup/start ticks,
boot clock and ordered state. Its held pidfd is never reopened by numeric PID.
Both monitor and writer reject their own boot-clock gaps; whole-machine sleep,
systemd restart and production-load scheduling remain runtime QA gates.

Sanitized measured results are preserved in
[prototype-media-fault-results.json](runtime-live-2026-11-03/prototype-media-fault-results.json).
Its SHA-256 is `be66465668e99501a82f1ff71d6d66863ee1df75a32cdde6ec0caed700164e79`.
Their test-image IDs and source hashes distinguish the mounted-source checks
from the subsequent image rebuild. The source corpus hash was
`5fdbbf524b22b2cb003d56f10a66b2d6815e8880d8c9cb3751b812e175465d98`;
the host-watchdog file SHA-256 was
`ab08cd8b5953dbd9e1e631fc8df7efd1583adc0d98c753daadb851ec9fe89b3e`.

The final media Docker build passed, producing local image
`sha256:702c71b504c8673747809191195e3c8248c56947ddaa3f36486369f14346475f`.
The isolated node was recreated from that exact image with UID 1000, fresh
instance/state directory, private PID namespace, no restart policy, and the
independent host watchdog. It reported `watchdog_ready`; the CMS/backend
readiness endpoint simultaneously passed all six checks. This proves configured
startup, not a rerun of every fault against this new image. No systemd service
was installed. The native capture chooser and v2 player runtime remain pending;
the loop and feature remain unfinished, with no independent QA Pass claimed.

### Later continuous-runtime findings — acceptance remains open

After checkpoint `cf44fa2`, the host watchdog stopped the configured test node
with `HEARTBEAT_FILE_OWNERSHIP`, despite its last file being owned by UID 1000
with mode 0600 in a private 0700 directory. A deterministic real-filesystem
test reproduced the defect: opening the old file, atomically replacing its
path, then checking the opened inode yields link count **zero**. The earlier
guard incorrectly rejected that safely opened inode. The scoped fix allows
link counts zero or one only for the already-opened regular, private,
correctly-owned file. Symlinks and extra hardlinks remain blocked; content,
instance and clock checks stay enforced. Python tests initially passed **12/12**.

The systemd template also now uses `Wants=docker.service` with `After=`.
Installed systemd documentation confirmed that `Requires=` would stop the host
watchdog when Docker was explicitly stopped, defeating its independent
actuation path. `systemd-analyze verify` passed without installing a service.

The fresh one-CPU root node initially remained healthy for 134.027 seconds,
with 1336 heartbeats and no restarts/OOM. **It subsequently exited at about
152.5 seconds**, after `SUPERVISOR_HEARTBEAT_STALE`; direct pidfd signaling again
returned EACCES and enforcement was reported unconfirmed. Its last heartbeat
was sequence 1495/RUNNING, written 2330 ms before container exit. Comparing the
boot-clock age with the file mtime agreed within 8 ms. The separate half-CPU
steady experiment also stopped early, around 91.5 seconds, through the stale
heartbeat path. These observations do not establish a CPU, memory or IO cause.

The zero-link regression is fixed, but **steady-runtime acceptance and the
host-service/LSM actuation gate remain open**. The shorter healthy observation
must not be presented as an overall soak pass. Sanitized initial-failure,
regression, shorter checkpoint and later failure evidence is preserved in
[prototype-watchdog-atomic-replace-result.json](runtime-live-2026-11-03/prototype-watchdog-atomic-replace-result.json).
Its SHA-256 is `0cf506e8b6481e5ed86f8a962b940e52f68a598a500ad55ec90be991eadc7fe2`.
No liveness threshold or security profile was relaxed and no QA-owned case was
changed to Pass. The newly built image's separate actual-SFU RPC/race suite
passed **2/2**, without skips; that result does not close these runtime gates.

A separate reporting race was then corrected: after Docker has requested
SIGKILL, a denied fallback signal must still observe the already-held pidfd
until the original deadline. Otherwise a process exiting just afterward can
be reported unconfirmed prematurely. The new event explicitly reports observed
exit with `pidfd_signal_confirmed=false`; it does not claim the denied signal
killed anything. A real delayed child exits about 60 ms after denial and is
observed, while a denied child that stays alive remains unconfirmed at the
same 180 ms test deadline. Current Python tests passed **13/13**. No deadline
was extended, PID reopened or production pidfd gate declared passed. Further
instrumented steady-runtime diagnosis is still required.

### Instrumented disk wait and private tmpfs correction

Further parity diagnostics now directly observed the supervisor in Linux D state
with `folio_wait_bit_common` while its ext4 heartbeat stopped advancing. The
203.744-second run failed; I/O pressure rose while CPU throttling did not advance
and OOM/swap counters stayed zero. This identifies observed I/O wait, without
claiming the underlying disk/journal cause or blaming CPU/RAM generally.

The supervisor now rejects a disk-backed heartbeat directory **before spawning
children**, and the independent host watchdog checks the real mount filesystem
before monitoring. Both require private tmpfs state. Production preparation is
documented in `darshan-media/deploy/LINUX_MEDIA_NODE.md`; no service was installed.
Timeouts, certificate checks and the host security profile were not relaxed.

With the current guards mounted into the test image, the actual idle media node
remained healthy for **240.062 seconds**, maximum heartbeat age **108.040 ms**.
Intentional PID1 stop was followed by actual process/listener termination within
**1818.787 ms**, below the 3000 ms test bound, without OOM or restart. Actual
disk-backed startup was rejected with `SUPERVISOR_HEARTBEAT_REQUIRES_TMPFS` and
no child-start marker. Node tests: **41 passed / 7 opt-in skipped**; Python tests:
**15 passed**. Syntax and systemd unit validation passed.

[Sanitized measurements](runtime-live-2026-11-03/prototype-watchdog-tmpfs-results.json)
SHA-256: `a08087468bbe228e972ca60be891d49db7b904a2c4c56a6abdd6b5a159b6bed1`. The artifact records image IDs and mounted source hashes;
these are not all fault reruns against the subsequently rebuilt image.

The current Docker image build passed: `sha256:bb7764897b65e3aacb98f0d8e5d79b42b54c8c5a1118b22f845c6ed859aaa090`.
The normal network-enabled source build was used; an attempted network-disabled
source build could not populate its uncached dependency layer. This is not
evidence for offline artifact deployment. A fresh feature-owned node from the
new image started with private tmpfs state and reported `watchdog_ready`.

The short steady check addresses the reproduced disk-backed heartbeat failure;
it is **not a soak/load acceptance pass**. Direct pidfd signalling still returns
EACCES under this agent's host security profile. Production root/systemd/LSM
actuation, Docker-unavailable isolation, native capture options/audio, and the
full same-player CMS live journey remain open. No human QA case was marked Pass.

### Player fallback cache foundation

The verified immutable-asset pin primitive and its limitations are recorded in
[live-fallback-cache-pins-developer-verification-2026-11-03.md](live-fallback-cache-pins-developer-verification-2026-11-03.md).
The unchanged cache source passed the player build and **428 unit / 5 integration
/ 21 fault** checks. The normal player's live coordinator does not yet consume
these pins; no live player capability or integrated completion is claimed.

### Live scheduling and immutable fallback foundation packet

This packet follows `e634150`; exact source and compiled-module hashes are in
[live-scheduling-foundation-results.json](runtime-live-2026-11-03/live-scheduling-foundation-results.json),
SHA-256 `bc068a178cebef306ae03eb3e628231e22a995beb28a4ff245123383d7fa0a1f`. It is **not completion of loop2 or the feature**.

Implemented foundations:

- Migration0057 live-source CRUD, record-bound permissions/ownership, separate
  metadata/policy revisions, shared sorted actor/presenter locks and soft deletion.
  Missing department condition values now deny rather than remove the condition.
- LIVE draft source/fallback fields round-trip through the existing schedule
  routes. Legacy items default to PRESENTATION. Live publication still rejects
  with `LIVE_APPROVAL_REQUIRED` until complete frozen-publication wiring lands;
  it cannot silently publish fallback as ordinary content.
- Migration0058 frozen preparations/assets and live scheduled occurrences,
  exact frozen audience/fingerprint checks, half-open10-slot capacity exclusion,
  optimal recoloring and shared screen/live reservation transactions. Explicit
  selected empty groups reject instead of broadening live targets. Expiry and
  takedown change scheduled metadata only, never free a transmitting room.
- The adopted local test database lacked the physical0021 screen exclusion
  despite its ledger.0058 repairs it; conflicting legacy rows abort migration
  without deleting or rewriting records. Only the isolated feature DB was changed.
- Durable preparation API/queue reconciliation, current authorization before
  copy and READY, streaming SHA/size checks, conditional CAS publication and
  read-back checks. UUID leases fence late owners. Explicit retries survive
  dispatch failure. A30-second progress-idle bound preserves large progressing
  transfers; a hung renewal cannot retain the claim indefinitely.
- Private claim-marked staging and bounded inactive-claim cleanup; active,
  unknown, unsafe and unmarked directories remain protected. Complete CAS
  copies and normalized references are excluded from automatic orphan cleanup.

Validation after fixes:

| Check | Result |
| --- | --- |
| Server build, Node20.20.2 / heap768MiB | PASS |
| Six focused authorization/ownership/manifest/preparation/HLS unit files |68/68 PASS |
| Real PostgreSQL/Fastify live-source suite |13/13 PASS |
| Real PostgreSQL service/DDL/reservation/retention suite |24/24 PASS |
| Real PostgreSQL/Fastify preparation API suite |8/8 PASS |
| Real PostgreSQL/Fastify schedule-authoring suite |7/7 PASS |
| New focused source/test lint and diff checks |PASS; existing any warnings remain in reservation service |

The three latter DB files reran together: **39/39 PASS**. Isolated temporary
test databases were removed only after their pools closed. The preparation API
suite replaces JWT decoding and queue dispatch only; authorization, source
collection and writes use PostgreSQL. The source API also passed actual HTTP
cookie/CSRF login, CRUD, stale409, forged422, unauthorized401 and tombstone404.

Fresh actual API→pg-boss worker→PostgreSQL→MinIO preparations both reached READY
(1685ms / 1814ms). Each copied/verified image, native PDF(page2) and final
processed video: **273399 bytes**, three normalized assets, exact SHA/MIME/size,
a separate immutable storage ID and released claim. Duplicate requests
coalesced; a second presentation reused exact CAS bytes. A separate actual
worker-image FFmpeg check generated internal HLS, used the restricted local-only
remux helper and decoded its approved MP4 output. That HLS check uses a local
segment adapter; it is not S3-HLS or player-rendering acceptance.

Runtime is source-mounted developer API/worker on the existing local image, not
a newly packaged release artifact. PostgreSQL session TimeZone was UTC. The new
media-image node remained running without OOM/restarts during this checkpoint.

Still required: production live occurrence snapshots/reference guards and
request/direct publish routes, run/admission/epoch authority, same-player
coordinator/renderer and fallback lifecycle, complete CMS options, new release
bundles and integrated browser/Electron faults. Native capture input remains a
human/tooling gate. Screens lifecycle dry-run and broader impacted regression
remain at the completed feature packet boundary. No QA-owned status, Actual
Result, defect or sign-off field was changed.

The final equivalent HLS control-character lint correction reran20/20 focused
checks and the complete server build. Fresh API/worker processes then reran the
real three-asset preparation checks. The artifact distinguishes the earlier
actual FFmpeg helper checksum from the final compiled modules.
