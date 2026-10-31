# Emergency Takeover Frontend and Player Contract

## Trigger
### `POST /api/v1/emergency/trigger`
Request:
```json
{
  "emergency_type_id": "uuid",
  "message": "Optional ad hoc message",
  "severity": "CRITICAL",
  "media_id": "uuid",
  "target_all": true,
  "screen_ids": [],
  "screen_group_ids": [],
  "expires_at": "2026-03-14T12:00:00.000Z",
  "audit_note": "Evacuation notice"
}
```
Rules:
- Exactly one scope is allowed: `target_all`, `screen_ids`, or `screen_group_ids`.
- Multiple active emergency rows are allowed.
- Missing media references are rejected.
- Loop behavior is not a trigger choice. The server derives it from the resolved emergency media type.
- A successful trigger writes the emergency and durable START transition while fencing
  any active maintenance capture in the same database transaction. An idempotent replay,
  invalid request, or unauthorized request does not fence capture work.

## Status
### `GET /api/v1/emergency/status`
Response:
```json
{
  "active": true,
  "active_count": 2,
  "emergency": { "id": "uuid", "scope": "GLOBAL" },
  "active_emergencies": []
}
```
Rules:
- `emergency` is the highest-precedence active emergency in admin view ordering.
- `active_emergencies` contains all active rows with lifecycle metadata.

## Clear
### `POST /api/v1/emergency/:id/clear`
Request:
```json
{
  "clear_reason": "Incident resolved"
}
```
Behavior:
- Sets `cleared_at`, `cleared_by`, `clear_reason`, and `is_active=false`.
- A real clear transition and its durable CLEAR row atomically fence active maintenance
  capture work. Repeated clear requests remain idempotent and do not preempt.

Natural expiry uses the PostgreSQL clock. The expiry state change, durable EXPIRE row,
and maintenance capture fencing commit together; normal emergency playback-command
reconciliation continues from that outbox row.

## Player behavior
- Player consumes only the resolved `emergency` embedded in device snapshot.
- A ready resolved emergency video is serialized with `loop_enabled: true`; images, documents, webpages and native messages are serialized with `loop_enabled: false`.
- The first acquisition of a video-emergency authority starts at zero and uses one native looping element for complete decoded cycles until that authority ends.
- Equivalent snapshot/wake refreshes for the same emergency version do not remount or restart the video. A changed winning emergency/version starts a new authority at zero.
- Resolver precedence is `GLOBAL > GROUP > SCREEN`, then severity, then newest record.
- If emergency is present in snapshot, it overrides scheduled/default playback immediately.
- Clear, expiry, replacement, security lock, disposal and shutdown stop emergency picture/audio and pending callbacks before the player returns to schedule/default evaluation.
- Offline player continues using last cached emergency only while it remains the last known authoritative snapshot state.
