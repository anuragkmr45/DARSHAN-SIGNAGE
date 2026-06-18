# Realtime Sync Media Cache Report Retention Plan

Last updated: 2026-05-24
Updated by: Codex
Status: BLOCKED_PENDING_HUMAN_DECISION

## Summary

Phase 6 added the additive `media_cache_reports` table for player media/cache failure visibility. Phase 8 now adds dedicated metrics and alert rules for media/cache report volume and unresolved critical reports, but no destructive retention automation has been enabled.

Retention and partitioning require product and DBA approval because the correct policy depends on support/audit requirements, expected failure volume, and storage budget.

## Current Schema

Source: `darshan-server/src/db/schema.ts`

Table: `media_cache_reports`

Key fields:

- `screen_id`
- `media_id`
- `event_type`
- `severity`
- `status`
- `reported_at`
- `received_at`
- `resolved_at`
- `created_at`
- `updated_at`

Current indexes:

- `media_cache_reports_screen_reported_idx` on `(screen_id, reported_at)`
- `media_cache_reports_media_reported_idx` on `(media_id, reported_at)`
- `media_cache_reports_status_severity_reported_idx` on `(status, severity, reported_at)`
- `media_cache_reports_event_reported_idx` on `(event_type, reported_at)`

## Proposed Policy Options

| Option | Hot retention | Archive retention | Pros | Cons |
|---|---:|---:|---|---|
| Conservative | 180 days | 2 years | Better support history | Higher DB storage and index pressure |
| Balanced | 90 days | 1 year | Good operational history with bounded hot table | Needs export/archive job |
| Lean | 30 days | 180 days | Lower hot DB pressure | Less onsite diagnostic history |

Recommended starting point for QA sizing: Balanced, with 90 days hot and 1 year archive, unless support/audit requirements require longer retention.

## Implementation Plan After Approval

1. Confirm the retention option and archive destination.
2. Measure expected report volume from QA load/chaos runs.
3. Add a non-destructive cleanup/archive job behind a feature flag such as `MEDIA_CACHE_REPORT_RETENTION_ENABLED=false` by default.
4. For large fleets, use monthly partitioning by `reported_at` before enabling production retention automation.
5. Add a dry-run mode that reports rows eligible for archive/delete without mutating data.
6. Add metrics for eligible row count, deleted row count, archive failures, and job duration.
7. Document rollback as disabling the retention job and leaving additive schema intact.

## Required Decision

Before production enablement, a human owner must choose:

- hot retention duration,
- archive retention duration,
- whether archive is required,
- archive destination,
- partitioning threshold,
- whether unresolved `CRITICAL` reports are exempt from deletion until resolved.

Until this decision is recorded, production readiness remains blocked by retention policy, even though media/cache failure metrics and alerts are now available for validation.
