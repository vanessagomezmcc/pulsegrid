# Architecture Decision Records

### ADR-1 — Synthetic traffic, real pipeline
Simulated services generating synthetic traffic; everything downstream (streaming, validation,
metrics, alerting, incidents) is real. A demo needs failures on demand; faking the *pipeline*
would gut the project's point. The dashboard says "synthetic" openly.

### ADR-2 — Redpanda over Kafka/Redis Streams
Kafka-compatible API (franz-go works unchanged) with a single-binary footprint that fits a demo
VM. Redis Streams would blur the "event streaming platform" claim.

### ADR-3 — Manual W3C traceparent instead of the OTel SDK
`go/shared/tracectx` implements traceparent generate/parse directly. Two reasons: it shows the
mechanics rather than hiding them behind an SDK, and the build environment used for this repo
restricted `golang.org/x` module downloads. The interface is deliberately OTel-shaped — swapping
in the SDK later touches one package. Same story for `promtext` (hand-rolled Prometheus text
format) vs `client_golang`.

### ADR-4 — Deterministic alerting & correlation; no LLM in the loop
The alert evaluator is a 5-state machine with `for`-duration semantics; root-cause hints come
from timestamp + dependency-graph walking, always displayed with their evidence. Reviewers can
verify behavior; "AI-powered insights" would be unverifiable garnish on a systems project.

### ADR-5 — Failure flags in Redis, read per request
Scenario control writes a flags JSON per session; services read it on every request. Zero-redeploy
behavior change, per-session isolation for free, and flags TTL out with the session. The TS
`flagsFor` mirror of Go's `failure.ForScenario` is kept in lockstep (documented duplication —
one source of truth per language beats a codegen step at this scale).

### ADR-6 — Queue-pause targets the notification worker, not the telemetry consumer
Pausing the *business* queue worker shows backlog growth + drain on recovery without corrupting
the observability plane itself. Pausing the telemetry consumer would blind the dashboard — a
worse demo and a confusing lesson.

### ADR-7 — Acknowledge is an operator/DB action, not an evaluator input
Ack flips the occurrence row (audited) and notifies live clients; the processor's evaluator
still owns resolution when the condition clears. Matches real-world semantics (acking silences a
page; it doesn't fix the system) and keeps the evaluator single-writer.

### ADR-8 — lib/pq over pgx
The processor's needs are plain parameterized SQL; `lib/pq`'s smaller dependency graph won under
the restricted module proxy. pgx would be the choice at higher throughput (batch copy, prepared
statement cache).

### ADR-9 — Sessions as capability tokens, no accounts
A random id in a header is exactly enough security for a sandbox with no real data, and keeps
the demo one click deep. Documented limits: anyone with the id shares the sandbox (fine — it's a
demo), 30-min idle expiry bounds abuse.

### ADR-10 — Postgres for everything durable (no TSDB)
Metric snapshots at 5 s × 4 services × 30-min sessions is trivially inside Postgres's comfort
zone, and one database keeps traces/alerts/incidents joinable. Prometheus+Grafana still ship for
*pipeline* internals, which is also an honest signal that the author knows where a TSDB belongs.
