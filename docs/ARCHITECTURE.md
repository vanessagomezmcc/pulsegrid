# Architecture

## Data flow, end to end

1. **Traffic Generator** (`services/traffic-generator`) runs per-session loops. Each tick it picks
   a flow (78% checkout, 15% login, 5% invalid token, 2% burst), mints a fresh W3C
   `traceparent`, and calls `auth-service`. Traffic surges ramp over 20 s rather than stepping.
2. **Service chain** (`auth → payment → order → notification`): plain Go `net/http` services.
   Each hop extracts trace context, does its simulated work, propagates context downstream, and
   emits `http_request` / `downstream_call` / `queue_consume` telemetry events to Redpanda.
   Before every request each service reads its session's failure flags from Redis — this is how
   the Simulation Lab changes behavior with zero redeploys.
3. **Notification queueing**: `order-service` enqueues delivery jobs in a Redis list;
   `notification-service`'s worker drains it every 250 ms. Failed deliveries retry (max 2); on
   exhaustion the job is published to the dead-letter topic with its payload and reason.
4. **Telemetry Processor** (`services/telemetry-processor`) consumes the raw + deadletter topics
   in a consumer group: schema-validate (zod-equivalent rules in Go) → invalid events become DLQ
   envelopes with per-field errors → dedupe via Redis SETNX (10 min) → persist events/spans/
   traces to PostgreSQL → maintain 60 s sliding windows per (session, service).
5. Every **5 s** the aggregator computes rps/error-rate/p50/p95/p99/queue-depth per service,
   derives health via fixed thresholds, evaluates the 6 alert rules through the state machine,
   drives incident open/resolve with timeline events, snapshots metrics for history charts, and
   publishes typed live messages to Redis pub/sub.
6. **Control-plane API** (`apps/api`, NestJS) serves session-scoped reads from PostgreSQL + the
   Redis live-state key, handles scenario control (writing failure flags), DLQ retry/discard,
   alert acknowledgement, and relays live messages to browsers over `/ws`.
7. **Dashboard** (`apps/web`, Next.js App Router) backfills via REST, then applies live messages
   through a single WebSocket routed into the TanStack Query cache.

## Key mechanics

- **Trace context** is W3C-format (`00-<32hex>-<16hex>-01`), parsed/generated in
  `go/shared/tracectx` (unit-tested). Spans reconstruct parent/child by propagated span ids;
  when an upstream hop fails, downstream spans are recorded as `skipped` so waterfalls show what
  *didn't* run.
- **Health is derived, never declared**: `go/shared/health.Compute` maps windowed metrics to
  healthy/degraded/critical/offline. Services cannot claim to be healthy.
- **Alert state machine** (`go/shared/alerting`): breach must persist `for_seconds` before
  `pending → firing`; recovery requires the condition to clear, preventing flap.
- **Root-cause hints** (`go/shared/correlate`): given the set of degraded services and firing
  alerts, walk the dependency graph to the deepest affected node and emit an explanation with
  the evidence (which alerts, which edges). Deterministic and inspectable by design.
- **Session isolation**: every row and Redis key is scoped by `session_id`; the API enforces the
  scope on every query; the WS gateway only fans out a session's own messages.

## Scale posture (honest)

Single-node demo: 1 Redpanda broker, 1 processor instance, no replication. The design leaves the
usual doors open — keyed partitions by session, consumer groups, idempotent upserts — but HA and
horizontal scaling are explicitly out of scope. `docs/DECISIONS.md` covers the trade-offs.
