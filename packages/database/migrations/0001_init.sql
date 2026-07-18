-- PulseGrid schema v1. See docs/DATA_MODEL.md for the diagram and rationale.
-- Searchable fields get dedicated typed columns; JSONB is reserved for
-- genuinely flexible metadata.

CREATE TABLE IF NOT EXISTS demo_sessions (
  id              TEXT PRIMARY KEY,
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','expired','reset')),
  active_scenario TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at      TIMESTAMPTZ NOT NULL,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS services (
  id           TEXT PRIMARY KEY,          -- slug, e.g. payment-service
  display_name TEXT NOT NULL,
  description  TEXT NOT NULL,
  tier         TEXT NOT NULL DEFAULT 'core',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS service_dependencies (
  upstream   TEXT NOT NULL REFERENCES services(id),
  downstream TEXT NOT NULL REFERENCES services(id),
  PRIMARY KEY (upstream, downstream)
);

CREATE TABLE IF NOT EXISTS service_instances (
  id            TEXT PRIMARY KEY,          -- service/hostname
  service_id    TEXT NOT NULL REFERENCES services(id),
  hostname      TEXT NOT NULL,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS telemetry_events (
  event_id           TEXT PRIMARY KEY,
  session_id         TEXT NOT NULL,
  trace_id           TEXT NOT NULL,
  span_id            TEXT NOT NULL,
  parent_span_id     TEXT,
  service_name       TEXT NOT NULL,
  service_instance   TEXT NOT NULL,
  environment        TEXT NOT NULL,
  region             TEXT NOT NULL,
  event_type         TEXT NOT NULL CHECK (event_type IN ('request','dependency','queue_publish','queue_consume','health_probe')),
  endpoint           TEXT NOT NULL,
  http_method        TEXT,
  status             TEXT NOT NULL CHECK (status IN ('ok','error','timeout','skipped')),
  status_code        INT  NOT NULL DEFAULT 0,
  duration_ms        DOUBLE PRECISION NOT NULL,
  ts                 TIMESTAMPTZ NOT NULL,
  error_type         TEXT,
  error_message      TEXT,
  retry_count        INT NOT NULL DEFAULT 0,
  queue_name         TEXT,
  payload_size_bytes INT NOT NULL DEFAULT 0,
  metadata           JSONB,
  expires_at         TIMESTAMPTZ NOT NULL,   -- data-retention boundary
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_events_session_ts ON telemetry_events (session_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_events_trace      ON telemetry_events (trace_id);
CREATE INDEX IF NOT EXISTS idx_events_service_ts ON telemetry_events (service_name, ts DESC);
CREATE INDEX IF NOT EXISTS idx_events_status_ts  ON telemetry_events (status, ts DESC);
CREATE INDEX IF NOT EXISTS idx_events_expires    ON telemetry_events (expires_at);

CREATE TABLE IF NOT EXISTS traces (
  trace_id      TEXT PRIMARY KEY,
  session_id    TEXT NOT NULL,
  root_service  TEXT,
  root_endpoint TEXT,
  started_at    TIMESTAMPTZ NOT NULL,
  ended_at      TIMESTAMPTZ NOT NULL,
  duration_ms   DOUBLE PRECISION NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'ok' CHECK (status IN ('ok','error')),
  span_count    INT NOT NULL DEFAULT 0,
  error_count   INT NOT NULL DEFAULT 0,
  is_seed       BOOLEAN NOT NULL DEFAULT false,   -- distinguishes historical seed data
  expires_at    TIMESTAMPTZ NOT NULL,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_traces_session_started ON traces (session_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_traces_status          ON traces (status, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_traces_duration        ON traces (duration_ms DESC);

CREATE TABLE IF NOT EXISTS spans (
  span_id        TEXT PRIMARY KEY,
  trace_id       TEXT NOT NULL,
  parent_span_id TEXT,
  service_name   TEXT NOT NULL,
  operation      TEXT NOT NULL,
  started_at     TIMESTAMPTZ NOT NULL,
  duration_ms    DOUBLE PRECISION NOT NULL,
  status         TEXT NOT NULL,
  error_type     TEXT
);
CREATE INDEX IF NOT EXISTS idx_spans_trace ON spans (trace_id);

CREATE TABLE IF NOT EXISTS metric_snapshots (
  id             BIGSERIAL PRIMARY KEY,
  session_id     TEXT NOT NULL,
  service_name   TEXT NOT NULL,
  window_seconds INT NOT NULL,
  ts             TIMESTAMPTZ NOT NULL,
  request_count  INT NOT NULL,
  error_count    INT NOT NULL,
  timeout_count  INT NOT NULL,
  rps            DOUBLE PRECISION NOT NULL,
  error_rate     DOUBLE PRECISION NOT NULL,
  p50_ms         DOUBLE PRECISION NOT NULL,
  p95_ms         DOUBLE PRECISION NOT NULL,
  p99_ms         DOUBLE PRECISION NOT NULL,
  queue_depth    INT NOT NULL DEFAULT 0,
  health_state   TEXT NOT NULL,
  is_seed        BOOLEAN NOT NULL DEFAULT false,
  expires_at     TIMESTAMPTZ NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_snapshots_lookup ON metric_snapshots (session_id, service_name, ts DESC);

CREATE TABLE IF NOT EXISTS alert_rules (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  service_name TEXT REFERENCES services(id),
  metric       TEXT NOT NULL,
  comparator   TEXT NOT NULL CHECK (comparator IN ('gt','lt')),
  threshold    DOUBLE PRECISION NOT NULL,
  for_seconds  INT NOT NULL DEFAULT 0,
  severity     TEXT NOT NULL CHECK (severity IN ('info','warning','critical')),
  enabled      BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS alert_occurrences (
  id              TEXT PRIMARY KEY,
  rule_id         TEXT NOT NULL REFERENCES alert_rules(id),
  session_id      TEXT NOT NULL,
  state           TEXT NOT NULL CHECK (state IN ('inactive','pending','firing','acknowledged','resolved')),
  severity        TEXT NOT NULL,
  value           DOUBLE PRECISION NOT NULL,
  threshold       DOUBLE PRECISION NOT NULL,
  started_at      TIMESTAMPTZ NOT NULL,
  firing_at       TIMESTAMPTZ,
  acknowledged_at TIMESTAMPTZ,
  resolved_at     TIMESTAMPTZ,
  incident_id     TEXT,
  is_seed         BOOLEAN NOT NULL DEFAULT false,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_alerts_session_state ON alert_occurrences (session_id, state);

CREATE TABLE IF NOT EXISTS incidents (
  id                 TEXT PRIMARY KEY,
  session_id         TEXT NOT NULL,
  title              TEXT NOT NULL,
  severity           TEXT NOT NULL,
  status             TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
  started_at         TIMESTAMPTZ NOT NULL,
  resolved_at        TIMESTAMPTZ,
  duration_ms        BIGINT,
  detection_ms       BIGINT,                    -- time from first degradation to first firing alert (MTTD)
  root_cause_service TEXT,
  root_cause_hint    TEXT,
  is_seed            BOOLEAN NOT NULL DEFAULT false,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_incidents_session ON incidents (session_id, started_at DESC);

CREATE TABLE IF NOT EXISTS incident_events (
  id           BIGSERIAL PRIMARY KEY,
  incident_id  TEXT NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  ts           TIMESTAMPTZ NOT NULL,
  kind         TEXT NOT NULL,   -- health_transition | alert_firing | alert_resolved | queue_growth | recovery | resolved | scenario
  message      TEXT NOT NULL,
  service_name TEXT,
  alert_id     TEXT
);
CREATE INDEX IF NOT EXISTS idx_incident_events ON incident_events (incident_id, ts);

CREATE TABLE IF NOT EXISTS simulation_scenarios (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT NOT NULL,
  category    TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS simulation_runs (
  id          TEXT PRIMARY KEY,
  scenario_id TEXT NOT NULL REFERENCES simulation_scenarios(id),
  session_id  TEXT NOT NULL,
  intensity   INT NOT NULL DEFAULT 2,
  status      TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running','stopped','completed')),
  started_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  stopped_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_runs_session ON simulation_runs (session_id, started_at DESC);

CREATE TABLE IF NOT EXISTS dead_letter_events (
  id                TEXT PRIMARY KEY,
  kind              TEXT NOT NULL,
  session_id        TEXT NOT NULL DEFAULT '',
  trace_id          TEXT,
  source_topic      TEXT NOT NULL,
  original_payload  TEXT NOT NULL,
  validation_errors JSONB,
  failure_reason    TEXT NOT NULL,
  first_failure_at  TIMESTAMPTZ NOT NULL,
  last_failure_at   TIMESTAMPTZ NOT NULL,
  retry_count       INT NOT NULL DEFAULT 0,
  status            TEXT NOT NULL CHECK (status IN ('failed','retrying','resolved','discarded')),
  is_seed           BOOLEAN NOT NULL DEFAULT false,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_dlq_session_status ON dead_letter_events (session_id, status, last_failure_at DESC);

CREATE TABLE IF NOT EXISTS audit_events (
  id          BIGSERIAL PRIMARY KEY,
  session_id  TEXT NOT NULL,
  actor       TEXT NOT NULL DEFAULT 'guest',
  action      TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id   TEXT NOT NULL,
  detail      JSONB,
  ts          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_session ON audit_events (session_id, ts DESC);
