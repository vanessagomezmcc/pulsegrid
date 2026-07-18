package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"time"

	_ "github.com/lib/pq"

	"github.com/pulsegrid/pulsegrid/go/shared/alerting"
	"github.com/pulsegrid/pulsegrid/go/shared/deadletter"
	"github.com/pulsegrid/pulsegrid/go/shared/events"
)

// store wraps all PostgreSQL access for the processor. Every statement is
// parameterized; no string-built SQL.
type store struct{ db *sql.DB }

func newStore(dsn string) (*store, error) {
	db, err := sql.Open("postgres", dsn)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(10)
	db.SetConnMaxLifetime(5 * time.Minute)
	if err := db.Ping(); err != nil {
		return nil, err
	}
	return &store{db: db}, nil
}

// retention for high-volume demo data.
const telemetryRetention = 2 * time.Hour

func (s *store) insertEvent(ctx context.Context, e *events.TelemetryEvent) error {
	meta, _ := json.Marshal(e.Metadata)
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO telemetry_events (
			event_id, session_id, trace_id, span_id, parent_span_id, service_name,
			service_instance, environment, region, event_type, endpoint, http_method,
			status, status_code, duration_ms, ts, error_type, error_message,
			retry_count, queue_name, payload_size_bytes, metadata, expires_at
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
		ON CONFLICT (event_id) DO NOTHING`,
		e.EventID, e.SessionID, e.TraceID, e.SpanID, nullable(e.ParentSpanID), e.ServiceName,
		e.ServiceInstance, e.Environment, e.Region, string(e.EventType), e.Endpoint, nullable(e.HTTPMethod),
		string(e.Status), e.StatusCode, e.DurationMs, e.Timestamp, nullable(e.ErrorType), nullable(e.ErrorMessage),
		e.RetryCount, nullable(e.QueueName), e.PayloadSizeBytes, meta, e.Timestamp.Add(telemetryRetention),
	)
	return err
}

func (s *store) insertSpan(ctx context.Context, e *events.TelemetryEvent) error {
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO spans (span_id, trace_id, parent_span_id, service_name, operation, started_at, duration_ms, status, error_type)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
		ON CONFLICT (span_id) DO NOTHING`,
		e.SpanID, e.TraceID, nullable(e.ParentSpanID), e.ServiceName, e.Endpoint,
		e.Timestamp.Add(-time.Duration(e.DurationMs*float64(time.Millisecond))), e.DurationMs, string(e.Status), nullable(e.ErrorType))
	return err
}

// upsertTrace assembles the trace incrementally as spans arrive: extends the
// time bounds, bumps counts, and marks the trace errored if any span errored.
func (s *store) upsertTrace(ctx context.Context, e *events.TelemetryEvent) error {
	started := e.Timestamp.Add(-time.Duration(e.DurationMs * float64(time.Millisecond)))
	isRoot := e.ParentSpanID == "" && e.EventType == events.EventRequest
	rootService, rootEndpoint := "", ""
	if isRoot {
		rootService, rootEndpoint = e.ServiceName, e.Endpoint
	}
	errInc := 0
	if e.Status == events.StatusError || e.Status == events.StatusTimeout {
		errInc = 1
	}
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO traces (trace_id, session_id, root_service, root_endpoint, started_at, ended_at, duration_ms, status, span_count, error_count, expires_at, updated_at)
		VALUES ($1,$2,NULLIF($3,''),NULLIF($4,''),$5,$6, GREATEST(EXTRACT(EPOCH FROM ($6::timestamptz - $5::timestamptz))*1000, $7), $8, 1, $9, $10, now())
		ON CONFLICT (trace_id) DO UPDATE SET
			root_service   = COALESCE(traces.root_service, EXCLUDED.root_service),
			root_endpoint  = COALESCE(traces.root_endpoint, EXCLUDED.root_endpoint),
			started_at     = LEAST(traces.started_at, EXCLUDED.started_at),
			ended_at       = GREATEST(traces.ended_at, EXCLUDED.ended_at),
			duration_ms    = GREATEST(EXTRACT(EPOCH FROM (GREATEST(traces.ended_at, EXCLUDED.ended_at) - LEAST(traces.started_at, EXCLUDED.started_at)))*1000, traces.duration_ms),
			span_count     = traces.span_count + 1,
			error_count    = traces.error_count + $9,
			status         = CASE WHEN traces.error_count + $9 > 0 THEN 'error' ELSE traces.status END,
			updated_at     = now()`,
		e.TraceID, e.SessionID, rootService, rootEndpoint, started, e.Timestamp, e.DurationMs,
		statusForTrace(e), errInc, e.Timestamp.Add(telemetryRetention))
	return err
}

func statusForTrace(e *events.TelemetryEvent) string {
	if e.Status == events.StatusError || e.Status == events.StatusTimeout {
		return "error"
	}
	return "ok"
}

func (s *store) upsertInstance(ctx context.Context, e *events.TelemetryEvent) error {
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO service_instances (id, service_id, hostname, first_seen_at, last_seen_at)
		VALUES ($1,$2,$3,now(),now())
		ON CONFLICT (id) DO UPDATE SET last_seen_at = now()`,
		e.ServiceName+"/"+e.ServiceInstance, e.ServiceName, e.ServiceInstance)
	return err
}

func (s *store) insertSnapshot(ctx context.Context, sessionID, service string, windowSec int, ts time.Time,
	reqs, errs, timeouts int, rps, errRate, p50, p95, p99 float64, queueDepth int, healthState string) error {
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO metric_snapshots (session_id, service_name, window_seconds, ts, request_count, error_count,
			timeout_count, rps, error_rate, p50_ms, p95_ms, p99_ms, queue_depth, health_state, expires_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
		sessionID, service, windowSec, ts, reqs, errs, timeouts, rps, errRate, p50, p95, p99, queueDepth, healthState,
		ts.Add(telemetryRetention))
	return err
}

func (s *store) loadRules(ctx context.Context) ([]alerting.Rule, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, name, COALESCE(service_name,''), metric, comparator, threshold, for_seconds, severity
		FROM alert_rules WHERE enabled`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []alerting.Rule
	for rows.Next() {
		var r alerting.Rule
		var cmp, sev string
		if err := rows.Scan(&r.ID, &r.Name, &r.ServiceName, &r.Metric, &cmp, &r.Threshold, &r.ForSeconds, &sev); err != nil {
			return nil, err
		}
		r.Comparator = alerting.Comparator(cmp)
		r.Severity = alerting.Severity(sev)
		out = append(out, r)
	}
	return out, rows.Err()
}

// applyAlertTransition persists one alert state change and returns the
// occurrence ID (stable per rule+session firing cycle).
func (s *store) applyAlertTransition(ctx context.Context, sessionID, occurrenceID string, tr alerting.Transition) error {
	switch tr.To {
	case alerting.StatePending:
		_, err := s.db.ExecContext(ctx, `
			INSERT INTO alert_occurrences (id, rule_id, session_id, state, severity, value, threshold, started_at, updated_at)
			VALUES ($1,$2,$3,'pending',$4,$5,$6,$7,now())
			ON CONFLICT (id) DO UPDATE SET state='pending', value=$5, started_at=$7, firing_at=NULL, resolved_at=NULL, acknowledged_at=NULL, updated_at=now()`,
			occurrenceID, tr.Rule.ID, sessionID, string(tr.Rule.Severity), tr.Value, tr.Rule.Threshold, tr.At)
		return err
	case alerting.StateInactive:
		_, err := s.db.ExecContext(ctx, `UPDATE alert_occurrences SET state='inactive', value=$2, updated_at=now() WHERE id=$1`, occurrenceID, tr.Value)
		return err
	case alerting.StateFiring:
		_, err := s.db.ExecContext(ctx, `UPDATE alert_occurrences SET state='firing', value=$2, firing_at=$3, updated_at=now() WHERE id=$1`, occurrenceID, tr.Value, tr.At)
		return err
	case alerting.StateAcknowledged:
		_, err := s.db.ExecContext(ctx, `UPDATE alert_occurrences SET state='acknowledged', acknowledged_at=$2, updated_at=now() WHERE id=$1`, occurrenceID, tr.At)
		return err
	case alerting.StateResolved:
		_, err := s.db.ExecContext(ctx, `UPDATE alert_occurrences SET state='resolved', value=$2, resolved_at=$3, updated_at=now() WHERE id=$1`, occurrenceID, tr.Value, tr.At)
		return err
	}
	return nil
}

func (s *store) createIncident(ctx context.Context, id, sessionID, title, severity string, startedAt time.Time, detectionMs int64) error {
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO incidents (id, session_id, title, severity, status, started_at, detection_ms)
		VALUES ($1,$2,$3,$4,'open',$5,$6) ON CONFLICT (id) DO NOTHING`,
		id, sessionID, title, severity, startedAt, detectionMs)
	return err
}

func (s *store) resolveIncident(ctx context.Context, id string, resolvedAt time.Time) error {
	_, err := s.db.ExecContext(ctx, `
		UPDATE incidents SET status='resolved', resolved_at=$2,
			duration_ms = EXTRACT(EPOCH FROM ($2::timestamptz - started_at))*1000, updated_at=now()
		WHERE id=$1 AND status='open'`, id, resolvedAt)
	return err
}

func (s *store) setIncidentRootCause(ctx context.Context, id, service, hint string) error {
	_, err := s.db.ExecContext(ctx, `UPDATE incidents SET root_cause_service=$2, root_cause_hint=$3, updated_at=now() WHERE id=$1`, id, service, hint)
	return err
}

func (s *store) linkAlertToIncident(ctx context.Context, occurrenceID, incidentID string) error {
	_, err := s.db.ExecContext(ctx, `UPDATE alert_occurrences SET incident_id=$2, updated_at=now() WHERE id=$1`, occurrenceID, incidentID)
	return err
}

func (s *store) appendIncidentEvent(ctx context.Context, incidentID string, ts time.Time, kind, message, service, alertID string) error {
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO incident_events (incident_id, ts, kind, message, service_name, alert_id)
		VALUES ($1,$2,$3,$4,NULLIF($5,''),NULLIF($6,''))`,
		incidentID, ts, kind, message, service, alertID)
	return err
}

func (s *store) upsertDeadLetter(ctx context.Context, env *deadletter.Envelope) error {
	verrs, _ := json.Marshal(env.ValidationErrs)
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO dead_letter_events (id, kind, session_id, trace_id, source_topic, original_payload,
			validation_errors, failure_reason, first_failure_at, last_failure_at, retry_count, status)
		VALUES ($1,$2,$3,NULLIF($4,''),$5,$6,$7,$8,$9,$10,$11,$12)
		ON CONFLICT (id) DO UPDATE SET
			last_failure_at = EXCLUDED.last_failure_at,
			retry_count     = EXCLUDED.retry_count,
			status          = EXCLUDED.status,
			failure_reason  = EXCLUDED.failure_reason,
			updated_at      = now()`,
		env.ID, string(env.Kind), env.SessionID, env.TraceID, env.SourceTopic, env.OriginalPayload,
		verrs, env.FailureReason, env.FirstFailureAt, env.LastFailureAt, env.RetryCount, string(env.Status))
	return err
}

// cleanupExpired enforces the documented retention policy.
func (s *store) cleanupExpired(ctx context.Context) {
	for _, table := range []string{"telemetry_events", "traces", "metric_snapshots"} {
		_, _ = s.db.ExecContext(ctx, `DELETE FROM `+table+` WHERE expires_at < now()`) //nolint: table names are a fixed allowlist above
	}
	_, _ = s.db.ExecContext(ctx, `DELETE FROM spans WHERE started_at < now() - interval '2 hours'`)
}

func nullable(v string) any {
	if v == "" {
		return nil
	}
	return v
}
