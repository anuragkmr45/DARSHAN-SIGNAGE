# Maintenance worker admission and telemetry durability

The capture barrier classifies pg-boss queues before they are fetched. Content-mutating
queues use an application-owned poller that checks for eligible work, acquires a durable
maintenance operation permit, and only then calls `pg-boss.fetch`. If capture admission
is closed, the delivery stays in pg-boss's CREATED/RETRY state: no handler-expiration
clock is running and no business retry is consumed. Once fetched, normal pg-boss
complete/fail retry semantics apply. Work admitted before closure retains its permit and
drains, settles the delivery, and releases the permit normally.

The gated pollers are stopped before the pg-boss client during shutdown. Cancellation
immediately aborts admission and polling waits when no job has been fetched; an already
admitted handler and its complete/fail acknowledgement are awaited before shutdown
continues. This prevents a dormant maintenance wait from surviving shutdown and later
starting a mutation.

The following recovery and player-control queues intentionally remain live during capture:
`backup`, `backup:check`, `backup:reconcile`, `emergency:reconcile`, and
`playback:refresh-dispatch`. Every other registered worker queue is gated by default, so a
new mutating queue cannot accidentally become operational merely by being registered.

The exported webpage capture/refresh processors and chat, deleted-user upload, and
orphaned-object cleanup services also enter worker admission. This closes direct-call
bypasses from scripts and services. When they are invoked inside an already-admitted HTTP
or worker flow, their independently constructed scope reuses the active process-local
permit, including if capture closes between the outer and inner call.

Telemetry HTTP ingestion writes only to the durable pg-boss queues. Queue failure is
reported as an ingestion failure and never falls back to inline object-storage or database
persistence. The queued payload owns the receipt timestamp and stable event identity:
heartbeat and screenshot deliveries carry a generated storage-object id, while
proof-of-play carries its deterministic idempotency key. Replays are idempotent in the
worker processors. Proof-of-play deliberately uses ordinary durable queue delivery, not
pg-boss singleton throttling: duplicate HTTP receipts are both accepted by the queue and
the database idempotency key converges them to one persisted row. The heartbeat storage
id also participates in its object key, so identical same-millisecond receipts cannot
collide. Heartbeat screen status, playback observation, and display-profile
writes travel in the same durable job and are applied only after worker admission. A
heartbeat's durable event identity is claimed before its observation transaction;
delayed jobs cannot replace a newer screen heartbeat, identity session, or display
profile, and an exact replay does not reapply observations or upload the object. The
exported telemetry processors also enter worker admission, which
prevents scripts or direct callers from bypassing the barrier.

Device authentication, realtime HELLO, command claim/delivery, emergency reconciliation,
and backup coordination are operational control paths and are not deferred by this worker
gate. Their database observations do not write inline: successful HTTP/socket-auth rollout
evidence, pairing-status identity sessions, and HELLO capability reports are durably
enqueued on `telemetry:device-observation`. Heartbeat identity sessions travel with the
existing heartbeat job. Media/cache failure reports are durably enqueued on
`telemetry:media-cache-report` with a route-assigned report id. Both workers are gated by
the capture barrier, preserve the original receipt timestamp, and make replay idempotent;
HELLO and HTTP handlers await the enqueue attempt rather than spawning detached database
work. Command claim/delivery remains operational and is not part of this observational
boundary.
