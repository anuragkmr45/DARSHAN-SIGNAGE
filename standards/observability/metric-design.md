# Metric Design Standard

## Naming

- Use stable `darshan_*` metric names for application metrics.
- Use exporter-native names for third-party exporters and normalize with recording rules where useful.
- Use nouns for gauges and totals for counters.
- Suffix counters with `_total`.
- Suffix durations and latencies with `_seconds`.
- Suffix byte sizes with `_bytes`.

## Labels

- Keep labels bounded and enumerable.
- Prefer `role`, `site`, `environment`, `job`, `instance`, `status_class`, `result`, `reason`, and fixed command or queue names.
- Use route templates, not raw URLs.
- Use stable IDs only when they are operationally necessary and bounded.

## Cardinality Rules

Never use any of the following as labels:

- raw URLs
- filenames
- object keys
- stack traces
- raw error strings
- request IDs
- media IDs
- schedule IDs
- arbitrary JSON keys

## Metric Types

- Counter: monotonic event totals such as request outcomes, job runs, upload attempts
- Gauge: current state such as queue depth, active websocket connections, cache bytes
- Histogram: latency and size distributions with pre-defined buckets
- Summary: avoid unless the metric must stay local to one process and does not need central aggregation

## Failure Safety

- Instrumentation failures must never break playback, pairing, API serving, jobs, or CMS rendering.
- Metric collection must degrade silently to logs when required.
