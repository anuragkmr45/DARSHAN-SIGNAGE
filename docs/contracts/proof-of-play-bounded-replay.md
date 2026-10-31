# Proof-of-Play Bounded Replay

The player holds at most 100 events or 512 KiB in memory. Overflow is written to pending spool files, at most 50 events per file. The pending spool is bounded to 32 files and 2% of configured cache capacity, clamped to 1–16 MiB. Successful spooling is counted as compaction, not loss. When the spool budget is exceeded, the oldest pending file is discarded with a warning and `droppedEvents`/`droppedBytes` increments. If a disk write fails, the player logs the failure; it cannot claim successful persistence and does not invent a discard count. Replay is paced and successful batches are removed.

This is bounded best effort. A crash, full disk or failed write may lose events. There is no fixed offline retention duration, new alert rule or lossless guarantee. The secure offline media-cache purge preserves already-spooled PoP files. QA should compare event creation, accepted delivery and discard counters separately.
