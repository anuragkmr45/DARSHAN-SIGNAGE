# Emergency Takeover Video Loop Audit — 2026-10-27

## Conclusion

The original defect was confirmed by static contract inspection: scheduled
presentation videos could carry loop intent, but emergency takeover videos could
not. The current working tree now contains the smallest compatible correction:
`getActiveEmergencyForScreen` derives `loop_enabled` from the resolved READY
media type (`true` only for `VIDEO`), and the existing player parser, timeline,
fingerprint and native video lifecycle consume that value without a second loop
system or database migration.

Focused server/player/CMS tests have been added but have not yet been executed in
this evidence revision because the workstation was below the goal's free-swap
start gate. Independent QA status remains `Not Tested`; implementation presence
must not be reported as a runtime Pass.

## Current end-to-end evidence

1. **CMS trigger contract has no loop value.**
   `darshan-cms/src/api/domains/emergency.ts::EmergencyTriggerPayload` contains
   `media_id`, scope, expiry and audit fields but no `loop`/`loop_enabled` field.
   `darshan-cms/src/components/requests/EmergencyTakeoverModal.tsx::triggerMutation`
   sends the selected `media_id` without loop intent.
2. **Server request and persistence have no loop value.**
   `darshan-server/src/routes/emergency.ts::triggerEmergencySchema` accepts no
   loop field. `darshan-server/src/db/schema.ts::emergencies` stores no loop
   column. This also means an over-posted loop field is discarded by the Zod
   object instead of becoming player authority.
3. **Emergency snapshot serialization now derives loop intent.**
   `darshan-server/src/screens/playback.ts::getActiveEmergencyForScreen` returns
   the resolved emergency media/type/URL and authority metadata plus
   `loop_enabled: effectiveMedia?.type === 'VIDEO'`. The trigger and persistence
   contracts intentionally still omit an operator-controlled loop value because
   looping is derived emergency-authority behavior.
4. **Player normalization consumes the derived value strictly.**
   `darshan-player/src/main/services/snapshot-parser.ts::normalizeItem` uses only
   `input.loop ?? input.loop_enabled`; it enables loop only for an exact boolean
   `true` and only when normalized media type is video. Images, documents,
   webpages and messages remain non-looping even if malformed input requests it.
5. **Renderer and authority behavior use existing centralized paths.**
   `darshan-player/src/renderer/player.ts::renderVideo` passes `item.loop` into
   both `configureScheduledVideoElement` and `attachScheduledVideoLifecycle`.
   `darshan-player/src/renderer/scheduled-video-lifecycle.ts` assigns
   `video.loop = options.loop`. `PlaybackEngine::fingerprintPlaylist` ignores
   snapshot IDs and presigned-query churn but includes emergency-version metadata,
   so equivalent refresh remains mounted while replacement restarts authority.
6. **Snapshot representation validation covers rollout.**
   `darshan-server/src/routes/device-telemetry.ts` includes the derived emergency
   `loop_enabled` value in the representation revision hash. A cached pre-fix
   snapshot therefore cannot remain valid through a `304`; once refreshed, later
   equivalent ETags remain stable and do not remount playback.
7. **Presentation-status revisions do not bypass playlist identity.**
   `darshan-player/src/renderer/player.ts::applyPresentation` updates status and
   `updateContentSource`; when emergency/normal timeline content remains the
   authoritative `schedule` source, that branch only keeps the scheduled surface
   active. It does not call `clearScheduledPlayback` or `playMedia`. Therefore an
   equivalent status revision cannot undo `PlaybackEngine`'s fingerprint-based
   no-restart decision.

## Coverage status

- `PLAYER-11`, `PLAYER-12`, `API-07`, BR-083 and the tests around
  `scheduled-video-lifecycle.ts` cover loop-enabled **scheduled presentation
  occurrences** and prove that old scheduled media stops when emergency takes
  authority.
- `FUN-07`, `AUTHZ-03` and the emergency route/browser tests cover selection,
  authorization, idempotency, ranking, clear/expiry and takeover precedence.
- New unexecuted focused coverage now checks server video/non-video contract,
  player emergency parsing, expiry/default restoration, equivalent-refresh
  identity, replacement-version restart, CMS operator wording and absence of a
  misleading trigger loop field.
- Existing renderer lifecycle coverage models three natural wraps on one native
  element plus bounded failure, disposal, listener/timer and stale-callback cleanup.
- A packaged player with real decoded media is still required to prove visual and
  audio behavior across clear/expiry/replacement/security-lock/shutdown boundaries.

## Historical finding

Git history shows this was not introduced by the October scheduled-loop fix.
The emergency API contract has existed without loop intent since its earlier
implementation. Commit `c25c49f` added strict scheduled snapshot loop parsing
on 2026-10-15 (`loop` is enabled only by explicit boolean `true`) but did not
change the emergency request, persistence or snapshot contract. The emergency
video therefore remained non-looping before and after that scheduled-loop
change. No historical implementation was found that serialized emergency loop
intent and was later removed.

## Required behavior and implementation boundary

Business rule BR-109 requires an active emergency video to be continuous by
authority semantics, not by an arbitrary schedule duration:

- first authority acquisition starts at video time zero;
- the full decoded video plays and restarts from zero for complete native cycles;
- equivalent refresh/wake events for the same emergency version do not remount
  or restart the active cycle;
- a different winning emergency starts its own video at zero;
- clear, expiry, replacement, secure lock, disposal and shutdown cancel picture,
  audio, timers, listeners and pending callbacks before restoring the next
  authority.

The implementation uses one canonical derived contract: the server snapshot sets
an explicit boolean loop value for resolved video media while images, documents,
webpages and native emergency messages remain non-looping. It does not reuse a
Schedule occurrence's stored loop choice because emergency media is selected
directly and has a different authority lifetime.

## Required verification

- Server unit/route contract: video emergency snapshot has boolean loop intent;
  non-video emergency content cannot acquire it.
- Player parser/lifecycle: emergency video becomes one native looping element;
  equivalent refresh is identity-stable; replacement is identity-changing.
- CMS/API contract: the operator does not need a misleading Schedule-only loop
  option; preview/help text communicates continuous takeover behavior.
- Packaged-player runtime: `PLAYER-17` on Windows and Ubuntu physical targets,
  including long video, audio, three full wraps, clear, expiry, replacement,
  secure lock, restart and restoration of the underlying Schedule/default.
- Long-run characterization: include emergency looping in `PERF-06`; record
  CPU/GPU/RAM, media/DOM/listener/timer counts, gaps, drift and hidden audio.

## Goal coverage

The active goal explicitly includes BR-109/R-46/PLAYER-17, low-resource gates,
implementation, focused automation and QA synchronization. Resource-gated
player/server/CMS developer execution is recorded in
`emergency-video-loop-developer-verification-2026-10-27.md`. The packaged
Electron/physical-player journey was intentionally moved to the larger QA host
because the complete dependency/media-decoding topology is unsafe on this
workstation; `PLAYER-17` and R-46 therefore remain open.
