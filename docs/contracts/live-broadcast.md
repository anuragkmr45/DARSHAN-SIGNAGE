# Live broadcast behavior contract

Status: **ACCEPTED TARGET; IMPLEMENTATION IN PROGRESS.** This document defines
intended behavior, not evidence that it is implemented. The starting code at
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

Freeze concrete **per-item** screen targets, presenter, time window, fallback
asset revisions and audio policy with the hold. Approval/publication compare a
fingerprint, including same-size group-member replacement. A relevant change
requires renewed approval; published live audience cannot expand with later
group edits. Device snapshots, now-playing and reporting use that frozen set.

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

Use trusted CMS HTTPS, media WSS and approved UDP/TCP/TURN paths; test browser
and Electron Chromium trust separately from Node HTTP trust. Package pinned
images/assets and configuration for offline installation. Six-VM capacity is
not established by the design. Require representative ten-broadcast/250-player
measurements and explicit Windows/browser/display/audio/network/restore gates.

All `LIVE-01..20` human cases remain Not Tested until independent execution.
The current developer record carries loop-specific evidence and limitations.
