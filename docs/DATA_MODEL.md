# Data model

PostgreSQL 16. All session-scoped tables carry `session_id` and (for high-volume ones)
`expires_at` for retention cleanup (2 h for telemetry/spans/snapshots; sessions expire after
30 min idle). `is_seed` marks curated historical rows that survive resets.

## Tables (16)

| Table | Purpose | Notable columns |
|---|---|---|
| demo_sessions | one row per visitor sandbox | status, active_scenario, expires_at |
| services | catalog of the 4 simulated services | tier, display_name |
| service_dependencies | dependency edges for correlation | upstream, downstream, kind |
| service_instances | per-session instance registry | last_seen_at |
| telemetry_events | every validated event | trace_id, event_type, status, duration_ms, expires_at |
| traces | roll-up per trace | root_service, duration_ms, span_count, error_count |
| spans | reconstructed spans | parent_span_id, status incl. `skipped` |
| metric_snapshots | 5 s windowed metrics history | rps, error_rate, p50/p95/p99, queue_depth, health_state |
| alert_rules | 6 seeded rules | metric, comparator, threshold, for_seconds, severity |
| alert_occurrences | lifecycle instances | state, firing_at, acknowledged_at, resolved_at, incident_id |
| incidents | auto-managed incidents | detection_ms, duration_ms, root_cause_service, root_cause_hint |
| incident_events | timeline entries | kind, message, alert_id |
| simulation_scenarios | catalog of 9 scenarios | category, supports_intensity |
| simulation_runs | audit of scenario activations | intensity, status |
| dead_letter_events | DLQ with full payloads | kind, validation_errors, retry_count, status |
| audit_events | every mutating guest action | actor, action, target_type/id |

## Identifier conventions

`sess-<18hex>` sessions · 32-hex trace ids / 16-hex span ids (W3C) · `alrt_<sess12>_<rule>`
alert occurrences (idempotent per rule+session episode) · `inc_<12hex>` incidents ·
`dlq_<12hex>` dead letters.

## Retention

The processor deletes expired telemetry/span/snapshot rows every 10 minutes
(`cleanupExpired`); Redpanda topic retention is 2 h (raw/processed) and 24 h (others), so the
DB and the log age out together.
