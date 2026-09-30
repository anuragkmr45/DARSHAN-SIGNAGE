# Performance and Reliability Planning Baseline

This reference is for test design. Do not run load, stress, chaos, or fault-injection tests unless the user explicitly changes scope.

## Performance test families

Use only those applicable to the product:

- Smoke: minimal traffic to validate scenario correctness and gross performance failures.
- Baseline/Average load: expected normal traffic for comparison over time.
- Peak load: expected busy-period traffic.
- Stress: traffic at or beyond expected peak to observe degradation.
- Spike: sudden large traffic increase.
- Soak/Endurance: sustained traffic to reveal leaks, buildup, or degradation.
- Breakpoint/Capacity: progressive load until an agreed failure/SLO threshold is crossed.
- Volume: large datasets/payloads/queues rather than only high concurrency.

## Never invent capacity targets

If business/ops documentation does not define concurrency, request rate, traffic mix, dataset size, SLOs, RPO, or RTO, use `TBD` and create a business/operations question.

## Performance scenario schema

For each planned scenario capture:

- Scenario ID
- Business journey/API
- Test type
- Goal
- Workload model
- User/traffic mix
- Concurrency or request rate
- Duration and ramp pattern
- Dataset/record volume
- Environment assumptions
- Dependencies included/mocked
- Metrics
- Pass/fail threshold/SLO
- Resource metrics to observe
- Abort/safety condition
- Recovery expectation

## Metrics to consider

- p50 latency
- p95 latency
- p99 latency
- throughput / requests per second
- error/failure rate
- timeout rate
- CPU
- memory
- disk/IO
- network
- database query latency
- database connection-pool usage
- lock contention
- cache hit/miss ratio
- queue depth and consumer lag
- worker utilization
- external dependency latency/error rate

## Reliability/failure modes

Choose based on architecture:

- instance/process restart
- deployment restart
- DB unavailable/slow
- cache unavailable/stale
- broker/queue unavailable
- queue backlog
- object/file storage failure
- third-party timeout or 4xx/5xx
- DNS/network interruption
- connection-pool exhaustion
- disk/storage full
- partial response/corrupt schema from dependency
- repeated retry/retry exhaustion
- duplicate event/webhook
- out-of-order event
- scheduled job rerun
- crash after external side effect but before local commit
- stale cache after update
- mixed-version deployment
- recovery and reconciliation after dependency returns

## Reliability expected-result dimensions

Check not only availability, but also:

- no silent data loss
- no duplicate irreversible side effect
- state consistency after recovery
- bounded retry behavior
- meaningful user-facing error/degradation
- operator-visible logs/metrics/alerts
- successful reconciliation/resume where designed
