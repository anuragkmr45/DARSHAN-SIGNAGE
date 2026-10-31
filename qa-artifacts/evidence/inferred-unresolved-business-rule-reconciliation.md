# Step 2C — Inferred And Unresolved Business-Rule Reconciliation

Date: 2026-10-21  
Application-source baseline: `release-01` at
`db137152cdb8eda7ecf1f836df33e0373b9fc278`, equal to
`origin/release-01` at review time.

## Scope And Result

This static pass reconciled every row that was classified as `INFERRED_RULE`
or `NEEDS_BUSINESS_CONFIRMATION` after Steps 2A and 2B. Application source,
tests, services and databases were not changed or executed.

| Original class | Reviewed | Result |
| --- | ---: | --- |
| Inferred | 4 | BR-048 and BR-049 reclassified as confirmed; BR-047 and BR-050 remain inferred |
| Needs business confirmation | 8 | BR-052 reclassified as confirmed; BR-060..066 remain unresolved |
| **Total** | **12** | **3 reclassified, 2 inferred, 7 unresolved** |

The full active catalogue now has 105 stable IDs: 44 confirmed, 52
implemented, 2 inferred and 7 needing business confirmation. Eight human
answers remain because BR-062 contains two distinct decisions: BQ-015
retention/legal policy and BQ-020 Media/chat recycle behavior.

## Review Method

The review used three passes:

1. **Classification pass** — compared the wording with all explicit user
   decisions already recorded in BQ-001..020 and BR-051..107. A source-backed
   uncertainty was not promoted merely because code implements something.
2. **Cross-layer source pass** — checked the applicable server policy,
   database shape, CMS control, player behavior and deployment/operations
   source for what the repository actually establishes.
3. **Contradiction and boundary pass** — checked restart, deletion, outage,
   reporting-time, retention, platform, capacity, recovery and network edge
   cases. Confirmed policy/source conflicts remain defects or test targets;
   reclassification does not turn them into passes.

## Row-By-Row Reconciliation

| Rule | Final class | Decision and current-source evidence |
| --- | --- | --- |
| BR-047 | `INFERRED_RULE` | **Kept.** Production configuration is keyed by one `SITE_NAME`, the generated topology is site-scoped, and core users/content/screens use departments or stable owner scopes rather than a ubiquitous tenant key. This supports a one-site interpretation but cannot authorize a contractual “single tenant” claim. Evidence: `scripts/bundle/production-bundle-config.mjs`; `darshan-server/src/db/schema.ts`; `deploy/production/README.md`. |
| BR-048 | `CONFIRMED_BUSINESS_RULE` | **Reclassified.** The user explicitly selected the Media/Layout/Presentation/Schedule ownership matrix and ADMIN-shared/SUPER_ADMIN-private template behavior. `ownershipForNewContent`, `canReadContentResource`, `canManageContentResource` and `canReferenceContentResource` implement the stable organization/department/restricted model. Evidence: user decisions 3-7; BR-085..093; `darshan-server/src/rbac/content-ownership.ts`; migration `0045_deleted_user_content_ownership.sql`. |
| BR-049 | `CONFIRMED_BUSINESS_RULE` | **Reclassified with a source conflict.** BQ-008 and the custom-role decision require fixed built-ins and persistent custom-role grants/inheritance. The server blocks built-in deletion and startup synchronization restores defaults, but the role PUT route and CMS still allow hierarchy-authorized built-in edits until restart. Evidence: BR-071/092; `darshan-server/src/rbac/system-roles.ts::syncSystemRolePermissions`; `darshan-server/src/server/index.ts`; `darshan-server/src/routes/roles.ts`; `darshan-cms/src/components/settings/RolesPermissionsTab.tsx`. |
| BR-050 | `INFERRED_RULE` | **Kept.** The production model has five VM roles with ordinary Compose services, restart policies, readiness checks, backup and recovery procedures. No repository-proven replica election, clustered data service or automatic role failover was found. These signals establish recovery mechanisms, not an approved HA promise. Evidence: `deploy/production/README.md`; generated role Compose in `scripts/bundle/assemble-runtime-bundle.sh`; role Compose files under `deploy/production/docker/`. |
| BR-052 | `CONFIRMED_BUSINESS_RULE` | **Reclassified as a resolved umbrella rule.** User decisions 1-12 now define the last-SUPER_ADMIN, directory, ownership, custom-role, emergency, Requests and immediate-session-removal boundaries. Current source still partially conflicts through BR-070, BR-071/049 and BR-091; those defects remain visible. Evidence: BR-056, BR-067, BR-068, BR-070, BR-071 and BR-084..096; authorization/session/ownership evidence reports. |
| BR-060 | `NEEDS_BUSINESS_CONFIRMATION` | **Kept.** PoP memory is capped at 100 events/512 KiB; pending spool is capped at 32 files, 50 events/file and a 1-16 MiB derived byte budget. Overflow drops oldest pending files with counters; crash/write failures can also lose events. Code defines bounded best effort, not acceptable evidence loss or an offline-duration guarantee. Evidence: `darshan-player/src/main/services/offline-replay-budgets.ts`; `darshan-player/src/main/services/pop-service.ts`; BQ-013. |
| BR-061 | `NEEDS_BUSINESS_CONFIRMATION` | **Kept.** “Uptime” currently means current ACTIVE/(ACTIVE+OFFLINE), COMPLETED PoP means non-null `ended_at`, SQL groups by `date(created_at)` without an explicit site timezone, PDF renders UTC and CMS uses browser locale. Source cannot select the intended reporting meaning, timezone or completion semantics. Evidence: `darshan-server/src/routes/reports.ts`; `darshan-server/src/routes/proof-of-play.ts`; `darshan-cms/src/pages/Reports.tsx`; BQ-014. |
| BR-062 | `NEEDS_BUSINESS_CONFIRMATION` | **Kept.** Weekly log archive and hourly maintenance/backup checks exist; a 30-day old-log handler is not placed on the active schedule, off-host pruning has no production caller identified, and monitoring retention defaults differ between current generated and legacy Compose. Media delete removes object bytes even on the “soft” path; chat cleanup is separate; neither exposes a recycle route. Repository behavior cannot approve retention, legal hold, erasure or recoverability policy. Evidence: `darshan-server/src/jobs/index.ts::scheduleRecurringJobs`; `darshan-server/src/utils/off-host-backup.ts`; `darshan-server/src/routes/media.ts`; `darshan-server/src/jobs/index.ts::cleanupChatMediaAssets`; BQ-015/BQ-020. |
| BR-063 | `NEEDS_BUSINESS_CONFIRMATION` | **Kept.** Documentation/build metadata declare production Windows x64 NSIS and Ubuntu deb/AppImage, development-only macOS, and degraded Wayland-specific behavior; Linux x64/arm64 scripts exist, while CMS Playwright selects Chromium only. Exact OS/browser versions, physical hardware/displays and accessibility obligations are site/product decisions. Evidence: `docs/environments/player-platform-support.md`; `darshan-player/package.json`; `darshan-cms/playwright.config.ts`; BQ-016. |
| BR-064 | `NEEDS_BUSINESS_CONFIRMATION` | **Kept.** Bundle generation requires approved measured capacity evidence with a positive `max_players`, measured artifacts and reviewed resource policy. Resource ceilings and queue bounds do not supply the site's workload mix, p95/p99/error SLO or display-propagation target. Evidence: `scripts/bundle/production-bundle-config.mjs::validateCapacityEvidence`; `deploy/production/bundle.env.example`; BQ-017. |
| BR-065 | `NEEDS_BUSINESS_CONFIRMATION` | **Kept.** Managed update verifies compatibility/restore evidence, stops API/worker, migrates forward and checks readiness; restore targets are isolated and no automatic schema downgrade is promised. Source cannot decide RPO, RTO, maintenance allowance, deployed starting versions or the permitted mixed-version window. Evidence: lifecycle writers in `scripts/bundle/assemble-runtime-bundle.sh`; `darshan-server/src/deployment/migration-ledger.ts`; `darshan-server/scripts/restore-offhost-backup.ts`; `darshan-server/src/deployment/restore-evidence.ts`; BQ-018. |
| BR-066 | `NEEDS_BUSINESS_CONFIRMATION` | **Kept.** Generated cross-VM application/monitoring paths use TLS while local exporter/proxy hops may use HTTP inside role networks. Webpage and explicit webhook-test egress depend on allowlists/configuration, and runbooks describe intended firewall paths rather than actual VM exposure. The site owner must approve egress, exposure and private-network HTTP exceptions. Evidence: `scripts/bundle/assemble-runtime-bundle.sh`; `darshan-server/src/utils/webpage-url-policy.ts`; `darshan-server/src/routes/webhooks.ts`; `deploy/shared/observability/exporters/README.md`; BQ-019. |

## Contradiction And Corner-Case Findings

- Reclassifying BR-049 does not hide the built-in-role edit defect: edits can
  be saved and affect sessions, then startup synchronization overwrites them.
  Restart is therefore an authorization state change, not persistence.
- Reclassifying BR-052 does not imply the combined access matrix passes.
  BR-070, BR-071/049 and BR-091 remain explicit source conflicts, while
  BR-102 remains the separate company-fallback implementation gap.
- A restart policy is not automatic failover. Recovery scripts and backups do
  not prove service continuity or any recovery deadline for BR-050/065.
- A configured cleanup interval is not a legal retention policy. An unused
  cleanup/prune function is not evidence that production data expires.
- A package target is not a supported-client commitment. Physical display,
  GPU/DPI/rotation, browser and assistive-technology acceptance still need the
  selected matrix.
- Existing finite budgets characterize behavior but cannot be used as an
  invented PoP-loss, capacity, latency, RPO or RTO acceptance threshold.

## First Human-Intervention Boundary

Static repository analysis is complete for these 12 rows. The next planning
work that would set acceptance results requires answers to BQ-013..020:

1. acceptable PoP loss/offline retention;
2. report uptime meaning, reporting timezone and completion definition;
3. retention/legal-hold/erasure by data class;
4. supported OS/browser/player/display/accessibility matrix;
5. fleet/workload volumes and measurable performance targets;
6. RPO, RTO, maintenance downtime and version-compatibility window;
7. approved egress, endpoint exposure and private-network HTTP boundary; and
8. Media/chat recycle or undelete window.

Until these are answered, linked tests may characterize current behavior but
must keep the intended policy result as `TBD — NEEDS_BUSINESS_CONFIRMATION`.

## Validation Performed

- Verified all 12 original Step 2C rule IDs are represented exactly once in
  this reconciliation.
- Verified the active business-rule catalogue retains all 105 unique IDs.
- Verified no application-source file differs from the application baseline.
- Used static reads only; no application, service, database or test suite was
  run for this QA-planning step.
