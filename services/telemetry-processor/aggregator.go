package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"github.com/redis/go-redis/v9"

	"github.com/pulsegrid/pulsegrid/go/shared/alerting"
	"github.com/pulsegrid/pulsegrid/go/shared/correlate"
	"github.com/pulsegrid/pulsegrid/go/shared/events"
	"github.com/pulsegrid/pulsegrid/go/shared/health"
	"github.com/pulsegrid/pulsegrid/go/shared/redisx"
	"github.com/pulsegrid/pulsegrid/go/shared/tracectx"
)

var knownServices = []string{"auth-service", "payment-service", "order-service", "notification-service"}

type obs struct {
	at      time.Time
	durMs   float64
	status  events.Status
	isReq   bool
	queueOK bool // successful queue_consume, used for no_success tracking
}

// aggregator maintains 60-second sliding windows per (session, service),
// evaluates health + alert rules every tick, drives the incident engine, and
// publishes live updates to the Redis channel the WS gateway relays.
type aggregator struct {
	mu       sync.Mutex
	windows  map[string]map[string][]obs // session -> service -> observations
	lastOK   map[string]map[string]time.Time
	states   map[string]map[string]health.State
	degraded map[string][]correlate.Degradation // per session, since last full-healthy
	evals    map[string]*alerting.Evaluator
	incident map[string]string // session -> open incident id
	dlqCount map[string][]time.Time

	rules []alerting.Rule
	st    *store
	rdb   *redis.Client
	log   *slog.Logger
}

func newAggregator(st *store, rdb *redis.Client, rules []alerting.Rule, log *slog.Logger) *aggregator {
	return &aggregator{
		windows: map[string]map[string][]obs{}, lastOK: map[string]map[string]time.Time{},
		states: map[string]map[string]health.State{}, degraded: map[string][]correlate.Degradation{},
		evals: map[string]*alerting.Evaluator{}, incident: map[string]string{},
		dlqCount: map[string][]time.Time{},
		rules:    rules, st: st, rdb: rdb, log: log,
	}
}

func (a *aggregator) add(e *events.TelemetryEvent) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.windows[e.SessionID] == nil {
		a.windows[e.SessionID] = map[string][]obs{}
		a.lastOK[e.SessionID] = map[string]time.Time{}
	}
	o := obs{at: e.Timestamp, durMs: e.DurationMs, status: e.Status,
		isReq: e.EventType == events.EventRequest, queueOK: e.EventType == events.EventQueueConsume && e.Status == events.StatusOK}
	a.windows[e.SessionID][e.ServiceName] = append(a.windows[e.SessionID][e.ServiceName], o)
	if e.Status == events.StatusOK && (o.isReq || o.queueOK) {
		a.lastOK[e.SessionID][e.ServiceName] = e.Timestamp
	}
}

func (a *aggregator) addDLQ(sessionID string, at time.Time) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.dlqCount[sessionID] = append(a.dlqCount[sessionID], at)
}

// publish sends a typed live-update message onto the Redis channel.
func (a *aggregator) publish(ctx context.Context, sessionID, msgType string, payload any) {
	msg, err := json.Marshal(map[string]any{"type": msgType, "sessionId": sessionID, "at": time.Now().UTC(), "payload": payload})
	if err != nil {
		return
	}
	if err := a.rdb.Publish(ctx, redisx.LiveChannel, msg).Err(); err != nil {
		a.log.Warn("live publish failed", "error", err)
	}
}

// publishTrace pushes a lightweight trace summary when a root span arrives so
// the Traces page streams in near-real time without polling.
func (a *aggregator) publishTrace(ctx context.Context, e *events.TelemetryEvent) {
	if e.ParentSpanID != "" || e.EventType != events.EventRequest {
		return
	}
	a.publish(ctx, e.SessionID, "trace", map[string]any{
		"traceId": e.TraceID, "rootService": e.ServiceName, "endpoint": e.Endpoint,
		"status": e.Status, "durationMs": e.DurationMs, "startedAt": e.Timestamp,
	})
}

func prune(list []obs, cutoff time.Time) []obs {
	out := list[:0]
	for _, o := range list {
		if o.at.After(cutoff) {
			out = append(out, o)
		}
	}
	return out
}

// tick runs the 5-second evaluation cycle.
func (a *aggregator) tick(ctx context.Context, now time.Time) {
	sessions, err := redisx.ActiveSessions(ctx, a.rdb)
	if err != nil {
		a.log.Warn("tick: list sessions", "error", err)
		return
	}

	a.mu.Lock()
	defer a.mu.Unlock()

	cutoff := now.Add(-60 * time.Second)
	for _, session := range sessions {
		if a.windows[session] == nil {
			a.windows[session] = map[string][]obs{}
			a.lastOK[session] = map[string]time.Time{}
		}
		if a.states[session] == nil {
			a.states[session] = map[string]health.State{}
		}
		if a.evals[session] == nil {
			a.evals[session] = alerting.NewEvaluator(a.rules)
		}

		var samples []alerting.Sample
		liveServices := map[string]any{}
		totalReq, totalErr := 0, 0
		var allLat []float64

		for _, svcName := range knownServices {
			a.windows[session][svcName] = prune(a.windows[session][svcName], cutoff)
			w := a.windows[session][svcName]

			reqs, errs, timeouts := 0, 0, 0
			var lat []float64
			var lastEvent time.Time
			for _, o := range w {
				if o.at.After(lastEvent) {
					lastEvent = o.at
				}
				if !o.isReq {
					continue
				}
				reqs++
				lat = append(lat, o.durMs)
				switch o.status {
				case events.StatusError:
					errs++
				case events.StatusTimeout:
					timeouts++
					errs++
				}
			}
			queueDepth := 0
			if svcName == "notification-service" || svcName == "order-service" {
				if n, err := a.rdb.LLen(ctx, redisx.QueueKey(session, "notifications")).Result(); err == nil && svcName == "notification-service" {
					queueDepth = int(n)
				}
			}

			hw := health.Window{RequestCount: reqs, ErrorCount: errs, TimeoutCount: timeouts,
				LatenciesMs: lat, LastEventAt: lastEvent, QueueDepth: queueDepth}
			res := health.Compute(hw, health.DefaultThresholds, now, true)

			prev := a.states[session][svcName]
			if prev == "" {
				prev = health.Unknown
			}
			if res.State != prev {
				a.states[session][svcName] = res.State
				a.onHealthTransition(ctx, session, svcName, prev, res.State, res.Reasons, now)
			}

			p50 := health.Percentile(lat, 50)
			p95 := health.Percentile(lat, 95)
			p99 := health.Percentile(lat, 99)
			rps := float64(reqs) / 60
			errRate := 0.0
			if reqs > 0 {
				errRate = float64(errs) / float64(reqs)
			}
			totalReq += reqs
			totalErr += errs
			allLat = append(allLat, lat...)

			if err := a.st.insertSnapshot(ctx, session, svcName, 60, now, reqs, errs, timeouts, rps, errRate, p50, p95, p99, queueDepth, string(res.State)); err != nil {
				a.log.Warn("snapshot insert", "error", err)
			}

			liveServices[svcName] = map[string]any{
				"state": res.State, "reasons": res.Reasons, "rps": round2(rps),
				"errorRate": round4(errRate), "p50Ms": round2(p50), "p95Ms": round2(p95), "p99Ms": round2(p99),
				"requests60s": reqs, "queueDepth": queueDepth,
			}

			samples = append(samples,
				alerting.Sample{Metric: "p95_latency_ms", ServiceName: svcName, Value: p95, At: now},
				alerting.Sample{Metric: "error_rate_pct", ServiceName: svcName, Value: errRate * 100, At: now},
				alerting.Sample{Metric: "queue_depth", ServiceName: svcName, Value: float64(queueDepth), At: now},
			)
			// Seconds since last success, but only meaningful while traffic flows.
			if reqs > 0 || svcName == "notification-service" {
				last := a.lastOK[session][svcName]
				noSuccess := 0.0
				if !last.IsZero() {
					noSuccess = now.Sub(last).Seconds()
				} else if reqs > 0 {
					noSuccess = 60
				}
				samples = append(samples, alerting.Sample{Metric: "no_success_seconds", ServiceName: svcName, Value: noSuccess, At: now})
			}
		}

		// dead-letter rate over the last minute
		recent := a.dlqCount[session][:0]
		for _, t := range a.dlqCount[session] {
			if t.After(cutoff) {
				recent = append(recent, t)
			}
		}
		a.dlqCount[session] = recent
		samples = append(samples, alerting.Sample{Metric: "dead_letter_count_1m", ServiceName: "", Value: float64(len(recent)), At: now})

		// Alert evaluation + persistence + incident hooks.
		for _, tr := range a.evals[session].Evaluate(samples, now) {
			occID := occurrenceID(session, tr.Rule.ID)
			if err := a.st.applyAlertTransition(ctx, session, occID, tr); err != nil {
				a.log.Warn("alert transition persist", "error", err)
			}
			a.publish(ctx, session, "alert", map[string]any{
				"occurrenceId": occID, "ruleId": tr.Rule.ID, "rule": tr.Rule.Name, "service": tr.Rule.ServiceName,
				"from": tr.From, "to": tr.To, "value": round2(tr.Value), "threshold": tr.Rule.Threshold, "severity": tr.Rule.Severity,
			})
			a.onAlertTransition(ctx, session, occID, tr, now)
		}

		// Session-level live snapshot for the overview page.
		overall := map[string]any{
			"services": liveServices,
			"totals": map[string]any{
				"rps": round2(float64(totalReq) / 60), "requests60s": totalReq,
				"errorRate": round4(safeDiv(totalErr, totalReq)), "p95Ms": round2(health.Percentile(allLat, 95)),
				"deadLetter1m": len(recent),
			},
			"activeIncident": a.incident[session],
		}
		raw, _ := json.Marshal(overall)
		a.rdb.Set(ctx, redisx.KeyLivePrefix+session, raw, 2*time.Minute)
		a.publish(ctx, session, "metrics", overall)
	}
}

func (a *aggregator) onHealthTransition(ctx context.Context, session, svcName string, from, to health.State, reasons []string, now time.Time) {
	a.publish(ctx, session, "health", map[string]any{"service": svcName, "from": from, "to": to, "reasons": reasons})
	if to == health.Degraded || to == health.Critical || to == health.Offline {
		a.degraded[session] = append(a.degraded[session], correlate.Degradation{ServiceName: svcName, State: string(to), At: now})
	}
	if inc := a.incident[session]; inc != "" {
		msg := fmt.Sprintf("%s transitioned %s → %s", svcName, from, to)
		_ = a.st.appendIncidentEvent(ctx, inc, now, "health_transition", msg, svcName, "")
		a.publish(ctx, session, "incident", map[string]any{"incidentId": inc, "kind": "health_transition", "message": msg, "service": svcName})
		if to == health.Healthy {
			_ = a.st.appendIncidentEvent(ctx, inc, now, "recovery", svcName+" returned to healthy", svcName, "")
		}
	}
	// Reset degradation history once everything is healthy and no incident is open.
	if to == health.Healthy && a.incident[session] == "" && a.allHealthy(session) {
		a.degraded[session] = nil
	}
}

func (a *aggregator) allHealthy(session string) bool {
	for _, s := range knownServices {
		if st, ok := a.states[session][s]; ok && st != health.Healthy && st != health.Unknown {
			return false
		}
	}
	return true
}

func (a *aggregator) onAlertTransition(ctx context.Context, session, occID string, tr alerting.Transition, now time.Time) {
	inc := a.incident[session]

	if tr.To == alerting.StateFiring {
		if inc == "" && tr.Rule.Severity == alerting.SeverityCritical {
			inc = "inc_" + tracectx.NewSpanID()
			a.incident[session] = inc
			started := now
			var detectionMs int64
			if degs := a.degraded[session]; len(degs) > 0 {
				started = degs[0].At
				detectionMs = now.Sub(started).Milliseconds()
			}
			title := fmt.Sprintf("%s: %s", tr.Rule.ServiceName, tr.Rule.Name)
			if tr.Rule.ServiceName == "" {
				title = tr.Rule.Name
			}
			if err := a.st.createIncident(ctx, inc, session, title, string(tr.Rule.Severity), started, detectionMs); err != nil {
				a.log.Warn("create incident", "error", err)
			}
			for _, d := range a.degraded[session] {
				_ = a.st.appendIncidentEvent(ctx, inc, d.At, "health_transition", fmt.Sprintf("%s entered %s state", d.ServiceName, d.State), d.ServiceName, "")
			}
			if svcName, hint, ok := correlate.RootCause(correlate.DefaultGraph, a.degraded[session]); ok {
				_ = a.st.setIncidentRootCause(ctx, inc, svcName, hint)
			}
			a.publish(ctx, session, "incident", map[string]any{"incidentId": inc, "kind": "opened", "message": title, "severity": tr.Rule.Severity})
		}
		if inc != "" {
			_ = a.st.linkAlertToIncident(ctx, occID, inc)
			_ = a.st.appendIncidentEvent(ctx, inc, now, "alert_firing", fmt.Sprintf("Alert firing: %s (value %.1f, threshold %.1f)", tr.Rule.Name, tr.Value, tr.Rule.Threshold), tr.Rule.ServiceName, occID)
		}
	}

	if tr.To == alerting.StateResolved && inc != "" {
		_ = a.st.appendIncidentEvent(ctx, inc, now, "alert_resolved", "Alert resolved: "+tr.Rule.Name, tr.Rule.ServiceName, occID)
		if a.noActiveAlerts(session) && a.allHealthy(session) {
			_ = a.st.appendIncidentEvent(ctx, inc, now, "resolved", "All alerts resolved and services healthy; incident closed", "", "")
			_ = a.st.resolveIncident(ctx, inc, now)
			a.publish(ctx, session, "incident", map[string]any{"incidentId": inc, "kind": "resolved", "message": "Incident resolved"})
			a.incident[session] = ""
			a.degraded[session] = nil
		}
	}
}

func (a *aggregator) noActiveAlerts(session string) bool {
	for _, inst := range a.evals[session].Instances() {
		if inst.State == alerting.StateFiring || inst.State == alerting.StateAcknowledged || inst.State == alerting.StatePending {
			return false
		}
	}
	return true
}

// occurrenceID is stable per session+rule so a firing cycle updates one row.
func occurrenceID(session, ruleID string) string {
	if len(session) > 12 {
		session = session[:12]
	}
	return "alrt_" + session + "_" + ruleID
}

func safeDiv(a, b int) float64 {
	if b == 0 {
		return 0
	}
	return float64(a) / float64(b)
}
func round2(v float64) float64 { return float64(int(v*100+0.5)) / 100 }
func round4(v float64) float64 { return float64(int(v*10000+0.5)) / 10000 }
