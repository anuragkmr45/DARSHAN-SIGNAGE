# Current live player reports

`GET /api/v1/live-occurrences/:id/targets` returns current server-received
receiver declarations for the occurrence's frozen audience (1–25 screens).
It uses the same locked current-user/session/role/source authorization as the
occurrence read. Assigned presenters can read their own authorized occurrence
without receiving Screen-library access. Screen names require current bound
`read Screen` access; otherwise CMS labels use a masked ID. No hardware,
certificate serial, participant/runtime identity, signing credential, transport
URL or immutable storage descriptor is returned.

The response is `no-store` JSON with version1, occurrence ID, `server_now`,
`fresh_for_ms:10000`, current run ID/generation/state (or null), and one row per
frozen screen. Changing current group membership does not change these rows.
Only receiver admissions from that exact current run/generation are considered.
A non-torn-down admission takes precedence over old admissions; a newer pending
runtime must not inherit an older runtime's report. Presenter observations and
other screens/runs are excluded.

Each target has `freshness:FRESH|UNKNOWN`, a nullable machine-readable reason,
`received_at`, `age_ms`, and an optional player `report`:

```text
sequence, connection, subscription, frame, audio, fallback_ready, fallback_reason
```

The latest sequence-ordered observation must match its admission's runtime and
canonical receiver participant identity. Freshness uses **server receipt time**,
not a player clock. An active current admission with a valid report aged at most
ten seconds can be Fresh. Missing reports/admissions, pending/revoked admissions,
stale reports, runtime mismatches, disabled/stopped/obsolete authority, inactive
publications or windows, and unavailable presenter authorization are Unknown.
A future receipt timestamp is `CLOCK_UNCERTAIN`, with null age; it is never
clamped to a fresh zero. No report means null receipt/age rather than invented
uptime or downtime.

Valid last observations may remain attached to Unknown rows for diagnosis, with
explicit **Last report** labels. Mismatched-runtime observations are not exposed
as the current admission's history. Fallback reasons are uppercase diagnostic
codes only; arbitrary client text is replaced with `PLAYER_REASON_REDACTED`.
Connection does not imply subscription, a decoded frame, audible sound,
successful player display or proof-of-play. Every fact remains a player report.

CMS loads reports on demand and polls every three seconds while visible. Its
monotonic request-start anchor conservatively ages retained responses, including
failed refreshes. After ten seconds they display Unknown, and detected browser
clock/suspend uncertainty also displays Unknown until a new response. Current
401/403 responses hide retained report data. The occurrence list's initial UTC
reporting dates come from an authenticated nonce-bound backend time response.
Manual UTC filters persist until the operator explicitly resets to the current
server window. No player/SFU subscription or media connection is created by
these diagnostics.

Developer checks cover actual isolated PostgreSQL/Fastify role/session/conditional
Screen ACLs, frozen audience and current-run selection, runtime replacement,
staleness/future receipts, revoked fallback failures and secret redaction; CMS
checks validate DTO binding, freshness mapping, masked names and the rendered
table. Actual CMS/browser, signed-player reports and production networking remain
integrated runtime/release verification; these tests do not establish physical
display or proof-of-play.
