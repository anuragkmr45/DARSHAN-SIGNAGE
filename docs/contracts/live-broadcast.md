# Live broadcast behavior contract

Status: **ACCEPTED TARGET; PARTIAL IMPLEMENTATION VERIFIED.** Product requirements
below are acceptance targets except where the implemented-interface checkpoint
explicitly records current code. The starting code at
`499bcdf` supports presentation schedules and has no live broadcast receiver.
See [execution loops](../plans/live-broadcast-implementation-loops.md) and the
[developer evidence](../../qa-artifacts/evidence/live-broadcast-developer-verification-2026-11-03.md).

## Product behavior

The final deliverable is a scheduled live event/media source inside the **same
ordinary DARSHAN desktop player**. It uses that installed application's normal
pairing, main-process lifecycle, schedule/cache/default handling, emergency and
security behavior. It must not require a separate installed player or an
operator to launch a dedicated receiver application. A developer-only presenter
or receiver prototype proves the media technical gate; it is not the finished
scheduled feature or production acceptance.

- Initial production topology is the existing five VM roles plus one shared
  media VM. Support up to ten simultaneous broadcasts, one presenter and at
  most 25 distinct approved screens per broadcast. All are inside the site's
  network; operation must not require the public internet.
- V1 is fullscreen live video, optional microphone and captured sound according
  to browser/OS support. Recording, remote input, additional administrator
  viewers and multiple live layout slots are excluded.
- A scheduled live event is selected automatically by the already paired,
  installed DARSHAN desktop player. Receivers need no separate application,
  manual launch, browser page or interaction at each event. The presenter alone
  chooses the capture source and explicitly starts transmission in the CMS.
- A schedule item identifies a live session and a required approved fallback
  presentation. The player downloads/verifies the fallback before joining live.
  Missing/corrupt fallback shows **Content unavailable** during that live window.
- A presenter explicitly selects a capture source, inspects the local preview
  and starts inside the approved window. Pre-window preview cannot transmit to
  the audience. Cancel/denial or a late capture-picker result cannot start an
  expired or unauthorized attempt. Reload/revoked capture needs new consent.
- Presenter stop ends the attempt but permits an explicit new attempt in the
  remaining window. Administrator stop disables the occurrence until an
  authorized controller re-enables it. Intentional stop cannot auto-reconnect.

## Schedule, authorization and capacity

Keep `presentation_id` required. Add `source_kind: PRESENTATION | LIVE` and
`live_session_id`; on LIVE items the presentation is the fallback. Snapshots
contain policy/identifiers, never transient tickets/tokens, SDP or private keys.

Freeze authored/explicit group provenance and concrete **per-item** screen targets, presenter, time window, fallback
asset revisions and audio policy with the hold. Approval/publication compare a
fingerprint, including same-size group-member replacement. A relevant change
requires renewed approval; published live audience cannot expand with later
group edits. Device snapshots, now-playing and reporting use that frozen set.

Reusable live-source edits apply to future approvals. General `revision`
changes for all edits; `policy_revision` changes only for presenter, audio or
availability changes. Pending/unpublished approvals must recheck that policy.
Published occurrences keep their approved settings. Disabling a source prevents
new approvals/publications; stopping an already published occurrence uses its
separate stop/takedown controls.

Fallback preparation copies the final approved playback bytes into a separate
content-addressed namespace before approval. Referencing a storage-object ID
alone is insufficient: existing processing jobs can replace bytes at their
ordinary delivery keys. Image and native PDF fallback may use verified source
bytes; converted PDF/video use the verified final representation. Webpage
fallback freezes the approved screenshot as an offline image, without cookies
or a live URL. Internal VOD HLS is prepared as an explicit local MP4 rendition
before approval; FFmpeg receives private local segments and no network access.
The resulting MP4 revision, rather than mutable HLS segments, is approved.

Preparation is durable asynchronous work. Repeated requests coalesce by creator
and exact source fingerprint; a queue outage preserves PENDING work for retry.
Current account, authoring and record-bound library access are checked before
copying and before READY. UUID-fenced leases prevent a replaced worker from
finalizing or failing its successor. Explicit failed-work retry is persisted
before dispatch. Temporary files use private claim markers; bounded cleanup
may remove only known inactive claims after its grace period. Unknown or
unmarked directories require separate review. Complete immutable CAS copies
are retained, including unreferenced copies; automatic permanent CAS cleanup is
outside this packet and storage growth must be monitored.

Apply current effective permissions, stable ownership and target checks to
request publication and direct administrator publication. Additional department
membership is not global screen control. Assigned presenter, current account,
session, permissions and active approved occurrence are rechecked at start and
renewal. Revoke access for account/session/permission/membership changes.

Reserve a logical broadcast slot and screen windows in the same transaction,
using half-open windows and PostgreSQL constraints. At most ten overlapping
scheduled slots and 25 distinct screens per occurrence are allowed; do not
silently truncate. One active run per occurrence and one presenter admission
are enforced. Retain occupied runtime capacity until actual teardown or node
isolation; adjacent replacements may show Preparing instead of overcommitting.

Require player capability before live publication; an old player/CMS must not
silently change a live item into an ordinary presentation. Preserve ordinary
schedule compatibility. Add durable start/end boundary notifications plus REST
reconciliation so a current earlier publish cannot hide the next live window.

## Authority, interfaces and failure behavior

Every LIVE device REST path requires a cryptographically verified device
signature, independently of the site's legacy/dual rollout setting. The trusted
route sets `requireSignature: true`; CMS bearer and serial-only identities cannot
fall back into this path. Certificate revocation/expiry still deny access.
Authentication metrics retain the configured site mode and separately report
the method actually verified. Ordinary serial-only legacy routes remain
compatible; supplying signature headers still requires valid RSA verification.

The player runtime UUID is a REST request/admission binding. LIVE routes compare
an advertised runtime header with the body/query when the header is supplied;
they do not require a WebSocket HELLO connection or infer authority from it.
Current certificate, frozen audience, capability and fallback readiness remain
authoritative checks. Capability advertisement and current-process fencing are
separate from proving media playback.

For one screen and live run, only one receiver admission may remain unconfirmed
for teardown. A new player runtime with the same screen certificate receives
`LIVE_RECEIVER_ACTIVE` while the old admission was authorized within the last
10 seconds; it cannot evict a renewing player. Once that bounded authority is
stale, the server durably marks the old admission revoking and queues exact
media removal. The new runtime receives retryable `LIVE_TEARDOWN_PENDING` until
the media node confirms teardown; only then may it receive a new admission.
The old ticket and renewal paths stop granting authority as soon as revocation
commits. Media unavailability leaves the new player on its approved fallback.

Current foundation routes use the `/api/v1` prefix:

| Route | Current purpose |
| --- | --- |
| `POST /live-sessions`, `GET /live-sessions`, `GET /live-sessions/:id` | Create/list/read reusable source policies with current permissions and ownership |
| `PATCH /live-sessions/:id`, `DELETE /live-sessions/:id` | Require `expected_revision`; return a conflict for stale writes or blocking references |
| `POST /live-fallback-preparations` | Accept `presentation_id` and optional explicit `retry_failed`; durably prepare the exact current fallback graph |
| `GET /live-fallback-preparations/:id` | Recheck current access/fingerprint and return preparation state; READY includes its immutable manifest |
| Existing schedule-item create/list | Preserve `source_kind`, `live_session_id` and required fallback `presentation_id`; legacy source defaults to PRESENTATION |
| `POST /schedules/live-preflight` | Accept `schedule_id`, optional explicit screen/group scope and `fallback_preparation_ids`; return current schedule revision, `approval_fingerprint` and frozen item policies, without admission credentials |
| `POST /schedules/:id/publish` | LIVE direct publication requires the reviewed `expected_live_fingerprint` and fallback preparation IDs; snapshot, screen reservations and logical live reservations commit together |
| Existing Schedule Request create/approve/publish | Creation stores versioned `schedule_payload.live_approval`; approval/publication rebuild policy using those preparation IDs and reject changed review with `409`; responses expose `live_approval` |
| Existing Screen/Screen Group snapshots | Return only the frozen approved live audience; refresh immutable fallback download URLs outside the persisted policy, after current CMS-record or genuine device-identity authorization |
| `GET /live-occurrences/:id/preflight` | Read-only presenter advisory bound to current authority epoch, control revision and item fingerprint. Separately reports business eligibility, trusted media readiness and runtime/audience capacity without node identity or credentials. It performs no durable write and does not replace Start checks. |
| `POST /live-occurrences/:id/start` | Final authority: repeats presenter, publication/window, revision/fingerprint, media epoch/readiness, audience capacity and ten-slot checks before committing a run/admission/media operation atomically. A ready preflight never guarantees Start across a later race. |

The November 3 publication/authorization packet connects capability-gated
request and direct publication. A LIVE direct publish without review still
returns `409 LIVE_APPROVAL_REQUIRED`; changed approval returns a safe conflict.
The current normal player does **not** advertise `live_broadcast_v1`, because
scheduled live rendering is unfinished. The supporting runtime verifier uses
two explicitly synthetic, unpaired OFFLINE screens carrying that capability;
it is not evidence that a deployed player supports this feature.

Published retry endpoints return the existing publication without reapproving
the mutable draft/source. Source policy edits affect future approvals and do
not rewrite the published policy. Authored live groups receive frozen publish
targets even when the publish request omits explicit groups. Current group
membership can change independently: an original member retains its frozen
publication, and a replacement does not inherit that live audience.

Schedule and Schedule Request reads apply current record conditions to GET,
list rows, totals and summaries. Conditional management cannot become global
department access. Unsupported stored condition shapes fail closed. CMS
Screen/Group reads are authorized before signing artifact URLs; authenticated
device access retains its own identity path. Active normalized live references
also protect sources, screens, groups, fallback media and storage dependencies
when mutable drafts or group membership change. Ended/released history alone
does not create a permanent active blocker.

Implemented recovery prerequisite checkpoint `e546630` adds current record-bound
presenter publish permission at preflight/approval/publication, nullable desired
`live_version` with omission preservation, exact approved-asset preparation/
repair in the cache, and injectable nonce/fence media checks with confirmed
teardown semantics. Desired-state REST/CMS projections expose the optional
nullable field; there is no public live-version setter. Cache primitives do
not enable player capability or consume scheduled live manifests yet. The
strict media protocol was tested against fixture authority; the ordinary media
entrypoint remains prototype-only, with no production Backend verifier.
See [prerequisite evidence](../../qa-artifacts/evidence/live-recovery-prerequisites-developer-verification-2026-11-03.md)
for bounded verification and source/build identities.

The current branch packet adds production-shaped run/start/admission APIs,
presenter controls and normal-player live playback behind the default-OFF live
runtime gate. These interfaces have focused and bounded local runtime evidence;
they are not a production acceptance result. See the
[runtime/authoring checkpoint](../../qa-artifacts/evidence/live-runtime-authoring-developer-verification-2026-11-03.md)
for the exact executable identities, results and open gates.

API families add live-session CRUD/preflight, run start/status/stop/targets,
authenticated device live-state/admission, and admission renewal. A start
identifies the published occurrence and expected revision. Mutations use
idempotency keys; stale approval, unsupported target, capacity, ended window and
stopping run return distinguishable safe conflicts. Exact implemented routes
and wire shapes must be reflected here when each API loop lands.

Each attempt has a unique run/generation/room. Each connection uses a single-use
ticket and unique admission identity. A ticket replay or second tab must not
evict a legitimate connection. Receiver grants never allow camera, microphone,
publication or arbitrary data. All signaling/reconnect paths pass admission;
clients cannot bypass it by reaching the underlying SFU signaling port.

Live authority renews every **3 seconds** and expires within **10 seconds** if
it cannot be renewed. Both live video and audio must stop within that bound.
Account conservatively for in-flight request time; late responses cannot extend
authority. The main process owns monotonic deadlines and invalidates authority
on suspend/resume. Receiving media is not authenticated Backend success.

The approved schedule end is enforced locally with **one-second running-player
observation tolerance**. This live-specific acceptance does not relax the
existing ordinary-media boundary rules. Existing identity/security lock is
outer authority; emergency takes precedence per affected screen. Unavailable
emergency content cannot expose the live stream underneath. After clear, fresh
admission is required and the run/window must still be valid.

A discovery or presenter epoch response taking over one second cannot shorten
an already established monotonic window boundary. A new live window waits for
a fresh clock sample before joining media. This keeps backend processing delay
from silently removing seconds of an otherwise valid live window, while stale
clock information never extends live authority.
Once that boundary is verified, admission renewal can shorten the independent
ten-second media lease but cannot subtract backend processing delay from the
same schedule end a second time. The backend rejects grants after its
authoritative window ends, and revocation still has the ten-second local
lease cutoff.

Keep approved cached fallback visible until the authorized generation has a
decoded frame ready. Pin/checksum fallback dependencies for the window and
guard published references against deletion or cleanup; security purge still
takes precedence. Stop live audio whenever leaving live. Restore live only
with fresh current authority and the correct generation's frame. Optional
audio failure can leave video running with truthful degraded status.

Media interruption can reconnect for up to **30 seconds** while authority stays
valid and the schedule remains active. Revocation, expiry and intentional stop
end that attempt. Bound retry/backoff and callbacks by occurrence/run/admission/
playback generation. Main process can destroy an unresponsive receiver view.

Commit state and durable media operations together, then call the SFU outside
the transaction. Reconcile intent with actual media state; lost/duplicate
webhooks are observations only. Controller/supervisor own current participant
expiry; a host watchdog stops media service if supervision fails. If removal
cannot be enforced, isolate the affected node and retain its runtime capacity
until isolation is observed.

Every verified media health sample is a durable boot observation, including
idle discovery before the first run. The Backend binds the node UUID to the
current authority epoch, managed-instance UUID and configured endpoint
fingerprint. Health observation and host death-witness acceptance serialize on
the same node-scoped transaction lock. If an authenticated current-epoch death
witness reaches the Backend before the first health sample, it creates an
already-dead node record; later health cannot revive or reuse that identity.
An existing node UUID cannot be rebound to a different managed instance,
endpoint, epoch or previously observed-dead process. A witness from an old
epoch or for mismatched recorded boot metadata fails closed.

Restore stops live, invalidates admissions, rotates external authority
epoch/signing material and reconciles old rooms before new starts. Authenticate
an epoch change before resetting player version ordering. All desired-state
writers preserve unspecified live fields. Delayed operations from an older
generation cannot close or reopen a replacement run.

## Reporting and acceptance

Snapshot delivery Success retains its existing applied-snapshot meaning. Live
observations separately identify connection, subscription, first frame, audio,
fallback readiness/reason and freshness using run/generation, player runtime
session, sequence and server receipt time. Stale data becomes unknown. A
reported frame is not proof of physical-display viewing; live observations must
not invent proof-of-play for media that never rendered.
While a receiver remains authorized, it refreshes its current observation at
most once every five seconds on renderer heartbeat; a one-time first-frame
report must not become stale during healthy continuous playback.

The ordinary player keeps its approved fallback visible until the isolated
receiver has a current-track decoded frame (`loadeddata` with current media
data and nonzero video dimensions, or a video frame callback), then disposes
the fallback renderer and activates the live view. A hidden receiver view may
not receive compositor frame callbacks, so the decoded-frame event is also
required. A screenshot or physical-display check remains separate evidence of
the visible result. The private Media VM advertises its configured VM address
and its Docker bridge address as ICE candidates; clients on other hosts use
the routed VM address, while same-host clients can reach the bridge address.

Use trusted CMS HTTPS, media WSS and approved UDP/TCP/TURN paths; test browser
and Electron Chromium trust separately from Node HTTP trust. Package pinned
images/assets and configuration for offline installation. Six-VM capacity is
not established by the design. Require representative ten-broadcast/250-player
measurements and explicit Windows/browser/display/audio/network/restore gates.

All `LIVE-01..20` human cases remain Not Tested until independent execution.
The current developer record carries loop-specific evidence and limitations.
