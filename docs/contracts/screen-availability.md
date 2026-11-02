# Screen availability reporting

DARSHAN derives historical availability from server-received player heartbeats. The player clock is never used for outage boundaries.

- `ONLINE` begins when the backend receives an online heartbeat.
- `OFFLINE` begins immediately for an explicit offline/error heartbeat, or 90 seconds after the last received online heartbeat.
- The next online heartbeat closes an offline interval. A delayed or repeated heartbeat is idempotent and cannot create overlapping open intervals.
- Time before a Screen's first heartbeat is `UNKNOWN`.
- API readiness checkpoints are written every 30 seconds. A gap longer than 90 seconds is `UNKNOWN`, so a backend/database outage is not charged as player downtime.
- Uptime percentage is `online / (online + estimated offline)`. Unknown time is displayed separately and excluded from the denominator.
- Daily buckets use `Asia/Kolkata`; rolling report ranges remain absolute UTC instants.

`GET /api/v1/reports/availability?days=N` returns fleet, per-Screen, and daily online/offline/unknown durations for 1–365 days. Existing `screen_uptime_percent` remains the legacy current ACTIVE/(ACTIVE+OFFLINE) ratio. `current_screen_active_percent` is its truthful alias; `availability_uptime_percent` is the historical value for the last 24 hours.

The availability monitor starts with the API process. Existing Screens begin with unknown history and become measurable when a new heartbeat is received; deployment does not invent history from the current status column.
