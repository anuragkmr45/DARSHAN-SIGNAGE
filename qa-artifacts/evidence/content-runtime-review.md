# Actual Content And Player Behavior

Static source review: 2026-09-25, commit `a6e401d2479cd0dee34c33552671cd0f86d4d173`.

Scope: BQ-007, BQ-011, BQ-012 and BQ-013. Findings below come from application handlers, repositories, runtime code and configuration generation, not documentary claims. No tests, services, database requests, browser sessions or deployments were executed. No application files were changed. These observations do not resolve the corresponding business questions or approve the behavior as correct.

User response on 2026-09-25 supplied these same code-derived findings as answers. The findings are accepted for current-behavior characterization and cross-linked into BR-008/018/026/034/072. They are not silently upgraded to intended business rules. The user's separate explicit approval of administrator self-approval/direct publishing resolves BQ-010 and is recorded in BR-057.

## BQ-007: Content Sharing

There is no uniform creator-only or department-only rule across all content types. The following describes normal named DEPARTMENT/OPERATOR roles; configured ability grants and resource state still matter where handlers check them.

| Resource | Read/list | Edit | Delete |
| --- | --- | --- | --- |
| Media | Own department's creators plus ADMIN-owned media. Detail access also explicitly permits the creator. SUPER_ADMIN ownership does not automatically receive the ADMIN sharing exception. | No general media PATCH/PUT metadata-edit route in the inspected media router. Legacy upload finalization checks update Media plus same-department/admin access. New upload-session operations require the session creator. | Requires delete Media plus creator identity, or ADMIN/SUPER_ADMIN bypass. Same-department membership alone is insufficient. In-use checks can still reject deletion. |
| Layout | Own department plus ADMIN-owned layouts; applicable read Layout permission required. | Requires update Layout; department/operator users must be the creator. | Requires delete Layout; department/operator users must be the creator. |
| Presentation | Basic list/get handlers require authentication/session but do not apply creator/department filtering or read Presentation ability checks. | Basic PATCH requires authentication but no update Presentation or ownership check. Item/slot mutations check update Presentation but not ownership/department. | Basic DELETE requires authentication but no delete Presentation or ownership check. Database references may still prevent a particular deletion. |
| Schedule | Lists are department-filtered for DEPARTMENT/OPERATOR. Detail access uses same-department/admin helper; ordinary detail/item reads also call assertScheduleMutable and can reject reserved schedules. No global ADMIN-owned sharing exception like media/layouts. | update Schedule plus same-department/admin access and applicable state/reservation validation; not creator-only. | No whole-schedule DELETE route is registered in the inspected router/endpoint map. Removing an item is separate. Cancelling a request is requester-or-admin; taking down a published request is admin-only. |

ADMIN/SUPER_ADMIN bypass content ownership through the named-role helpers for media/layouts/schedules, but do not bypass every ability, referential-integrity or lifecycle check. Custom roles do not inherit department behavior merely because their grants look like OPERATOR grants. For example, media/schedule listing applies its department filter only to the two named department-scoped roles; custom-role list versus detail authorization is inconsistent and needs separate testing.

Presentation evidence is a concrete authorization gap to assess, not a claim that broad sharing is intended. The shared server hooks check session/CSRF/rate-limit concerns, not presentation ownership. Its repository update/delete predicates use only the record ID, and the list route does not pass the repository's optional creator filter. No checked-in PostgreSQL row-level-policy declaration was found to supply the missing restriction; a live database was not inspected.

Operator directory: OPERATOR callers are forced to role OPERATOR but are not forced to their own department. Returned records include first name, last name, email and department. DEPARTMENT callers are restricted to their own department's operators. The CMS Operators page requests OPERATOR records without adding a department filter and allows read-only operator access through its module policy.

Source anchors:

- `darshan-server/src/rbac/policy.ts::canAccessOwnedResource`, `canReadLayoutResource`, `canReadAdminSharedResource`, `canReadUserRecord`, `getAdminUserIds`.
- `darshan-server/src/routes/media.ts:999` list; `:1112` detail; `:1153` finalization; `:1197` delete; upload-session owner check near `:450`.
- `darshan-server/src/routes/layouts.ts:121` list; `:182` detail; `:227` update; `:284` delete.
- `darshan-server/src/routes/presentations.ts:104` list; `:151` detail; `:223` items; `:545` update; `:592` delete; `darshan-server/src/db/repositories/presentation.ts`.
- `darshan-server/src/server/index.ts:366` shared preHandler and `:440` presentation registration.
- `darshan-server/src/routes/schedules.ts::assertScheduleAccess`; list at `:314`, detail at `:370`, update at `:634`; `darshan-server/src/config/apiEndpoints.ts::schedules`.
- `darshan-server/src/routes/schedule-requests.ts:1078` cancel; `:1134` take-down.
- `darshan-server/src/routes/users.ts:108` list handler; `darshan-cms/src/pages/Operators.tsx:62`; `darshan-cms/src/lib/access.ts::canAccessModule`, `canManageLayoutRecord`, `canDeleteMediaRecord`.

Example: two ordinary operators in the same department can read one another's uploaded media and layouts, but cannot delete one another's media or edit/delete one another's layouts. They can edit a mutable same-department schedule. Presentation record handlers do not enforce that department boundary, even for callers from another department.

## BQ-011: Webpages

Public HTTPS: supported subject to the navigation host allowlist, allowed port, successful DNS/address checks, valid browser trust and network reachability. Resources use their separate allowlist when populated, otherwise the navigation allowlist. Redirect destinations and resource requests are checked too. A public hostname is not automatically permitted in production.

Private intranet HTTPS: conditionally supported. The hostname/IP must pass the host allowlist, and each private DNS address must match an allowed CIDR. Private ranges include RFC1918, shared-address space and IPv6 unique-local space. Loopback, link-local, unspecified and multicast/reserved ranges in the hard-deny lists are rejected even if a CIDR is supplied. Port and certificate requirements still apply.

HTTP: accepted only when explicitly enabled and NODE_ENV is not production. The source-free production generator supplies HTTPS policy; it does not make arbitrary HTTP intranet pages acceptable.

Login-required content: no dedicated automated authentication/session-provisioning workflow was found in capture or live playback. Backend capture creates a new Playwright context per capture without credentials, saved storage state or imported CMS cookies. URL username/password is prohibited. A redirect to a permitted HTML login page can be captured as the preview; a successful capture does not prove access to protected content.

The player uses a separate persistent Electron partition (`persist:darshan-webpage-playback`), so cookies set there may persist. This is not CMS-login propagation or reliable automated SSO. Permission requests, downloads and popups are blocked; keyboard/pointer input is blocked when the player input policy is locked. Thus ordinary unattended production playback does not provide an interactive sign-in workflow. Browser trust for these embedded pages is distinct from the backend Axios HTTPS agent; allowlisting does not bypass invalid certificates.

Fallback: implemented. The renderer constructs an image fallback from a local/remote preview URL, or displays "Live webpage unavailable" when no URL exists. Loading/blocked/failure states keep that fallback visible; healthy native content hides it. Native load failures, crashes, unresponsive views and unsuccessful readiness probes trigger fallback and bounded retries. It does not require the backend to be offline. No maximum preview-age rejection appears in this rendering path.

Limits/caveats: at most four live native views; readiness checks DOM visibility/content, not whether a business dashboard is correct or signed in. A visible login/error page can pass the DOM probe. An unavailable preview image is not guaranteed to render successfully simply because a fallback URL was supplied.

Source anchors:

- `darshan-server/src/utils/webpage-url-policy.ts::assertWebpageUrlAllowed` and address helpers.
- `darshan-player/src/main/services/webpage-network-policy.ts::assertPlayerWebpageUrlAllowed`.
- `darshan-server/src/utils/webpage-capture.ts::captureWebpagePreview` (new context near `:55`, request policy near `:90`, final capture near `:147`).
- `darshan-player/src/main/services/webpage-view-manager.ts` partition/constants/DOM probe; `configureSession`, `configureContents`, `fail`.
- `darshan-player/src/renderer/webpage-playback.ts:55` fallback construction and `:139` status handling; `darshan-player/src/renderer/player.ts::renderURL`.
- `scripts/bundle/assemble-runtime-bundle.sh::write_player_config` propagates navigation/resource/CIDR/port policy into player artifacts.

## BQ-012: Multiple Group Defaults

Resolution precedence: eligible SCREEN assignment, then eligible GROUP assignment, then ASPECT_RATIO default, then GLOBAL default, then NONE. Eligibility requires READY media and, for screen/group assignments, an exact match to the screen's resolved aspect ratio.

For a screen in multiple groups, the resolver calls `.find()` on the saved assignment array. The first eligible GROUP assignment whose ID is in the screen's membership set wins. This is not group name, creation time, membership-query order, an explicit priority field, or a conflict rejection.

The settings API validates target existence, READY media, group non-emptiness and aspect-ratio consistency. It deduplicates by target type plus target ID and stores the array; it does not reject two distinct groups merely because their memberships overlap. Duplicate entries for the same target use the last supplied value while preserving that key's initial Map insertion position.

Important CMS effect: replacing an assignment removes the old entry and appends the replacement. Example: saved groups [A, B], with the screen in both, selects A. Replacing A through this UI produces [B, A], so B becomes the selected group default if both remain eligible. This conclusion follows from array operations, not an executed scenario.

Source anchors: `darshan-server/src/utils/default-media.ts::getDefaultMediaTargetAssignments`, `resolveDefaultMediaForScreen` (group `.find()`); `darshan-server/src/routes/settings.ts::validateDefaultMediaTargets` and PUT handler near `:852`; `darshan-cms/src/components/settings/DefaultMediaSection.tsx::handleSelectMedia` near `:371`.

## BQ-013: Proof-Of-Play Retention

Implemented policy: bounded best-effort buffering and disk replay, not guaranteed lossless retention for an approved duration.

- Playback-end events first enter an in-memory buffer. Buffer limits are 100 events or 512 KiB; overflow is moved into spool files.
- Disk spool is `<cache.path>/pop-spool`; files contain up to 50 events. The pending spool budget is 32 files and a byte cap equal to 2% of configured cache capacity, clamped between 1 MiB and 16 MiB. Inflight files are handled separately during replay; these limits are not a guaranteed retained-event count.
- The code sorts pending files by modification time and deletes the oldest files when enforcing the file/byte budget, recording discard counters.
- Replay takes at most 25 events per batch, retries POST requests, respools failures and restores inflight files after restart. Successful API responses cause local batch cleanup. The server may accept a durable queued job before the final report row/object is processed; acceptance and final persistence are separate checkpoints.
- No elapsed-time TTL or fixed offline-hours/days retention guarantee appears in the player spool implementation. Actual survivability depends on event volume, file fragmentation, storage budget, crashes and disk writes, not just outage duration.
- Not every recorded event is synchronously durable: an abrupt crash can lose unflushed memory events. Spool write errors are logged; failed respooling can be followed by removal of the old inflight file. These paths further prevent a lossless guarantee.
- The secure-lock purge removes `media`, `objects`, `quarantine` and `cache-index.db`. It does not remove `pop-spool` or `pop-spool-state.json`. Therefore that particular media-erasure path preserves already-spooled evidence; it does not guarantee that other reset/cleanup operations preserve it or that all memory events reach disk when playback stops.

Source anchors:

- `darshan-player/src/main/services/offline-replay-budgets.ts` exact limits and byte-cap formula.
- `darshan-player/src/main/services/pop-service.ts:109` constructor; `recordEnd`; `listSpoolFiles`; `trimLiveBuffer`; `spoolEvents`; `enforceSpoolBudget`; `flushEvents`.
- `darshan-player/src/main/services/network/http-client.ts` HTTP retries, not an implicit second PoP persistence queue.
- `darshan-server/src/routes/device-telemetry.ts:1019` PoP ingest; `darshan-server/src/jobs/device-telemetry.ts::processProofOfPlayTelemetry` idempotent processing.
- `darshan-player/src/main/services/media-cache-purge.ts::clearMediaCacheTargets`; `darshan-player/src/main/services/player-flow.ts::handleSecurePlaybackPurgeRequest`.

## QA Interpretation

Keep these as IMPLEMENTED_RULE evidence, not user-confirmed requirements. BQ-007/011/012/013 have code-derived answers; their remaining acceptance-policy choices are explicitly TBD, not requests to repeat source analysis. Presentation authorization gaps, group selection changes after editing, authenticated webpage limitations and bounded/droppable PoP evidence are represented in the risk register and detailed cases. Characterization results remain separate from release acceptance, and a behavior matching vulnerable code must not become a security pass. Nothing in this review is a runtime pass/fail result.
