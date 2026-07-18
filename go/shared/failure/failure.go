// Package failure implements the scenario control plane shared by the API,
// the simulated services, and the traffic generator.
//
// The control-plane API writes per-session failure flags into Redis when a
// visitor activates a scenario in the Simulation Lab. Each simulated service
// reads the flags for the session attached to the incoming request and changes
// its *actual* behavior (sleeps, injected errors, dropped requests, paused
// consumers). The dashboard never fakes anything: it only ever displays
// telemetry derived from this real behavior.
package failure

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
)

// Scenario IDs. These must match packages/config/src/scenarios.ts and the
// simulation_scenarios seed rows.
const (
	ScenarioNormal             = "normal-traffic"
	ScenarioPaymentSlowdown    = "payment-slowdown"
	ScenarioPaymentErrorSpike  = "payment-error-spike"
	ScenarioNotificationOutage = "notification-outage"
	ScenarioOrderDBDelay       = "order-db-delay"
	ScenarioTrafficSurge       = "traffic-surge"
	ScenarioQueueWorkerPause   = "queue-worker-pause"
	ScenarioMalformedEvent     = "malformed-event"
	ScenarioFullRecovery       = "full-recovery"
)

// Flags is the effective failure configuration for one demo session. Zero
// value == fully healthy behavior.
type Flags struct {
	ActiveScenario         string    `json:"activeScenario"`
	StartedAt              time.Time `json:"startedAt"`
	PaymentExtraLatencyMs  int       `json:"paymentExtraLatencyMs"`
	PaymentFailureRatePct  int       `json:"paymentFailureRatePct"`
	PaymentTimeoutRatePct  int       `json:"paymentTimeoutRatePct"`
	NotificationOutage     bool      `json:"notificationOutage"`
	NotificationDelayMs    int       `json:"notificationDelayMs"`
	OrderDBDelayMs         int       `json:"orderDbDelayMs"`
	TrafficMultiplier      float64   `json:"trafficMultiplier"`
	QueueWorkerPaused      bool      `json:"queueWorkerPaused"`
	AuthRejectInvalidBoost bool      `json:"authRejectInvalidBoost"`
}

// TTL keeps flags alive slightly longer than a demo session so orphaned flags
// self-clean.
const TTL = 45 * time.Minute

func key(sessionID string) string { return "pulsegrid:flags:" + sessionID }

// Store reads and writes failure flags.
type Store struct{ rdb *redis.Client }

func NewStore(rdb *redis.Client) *Store { return &Store{rdb: rdb} }

// Get returns the flags for a session, or a zero (healthy) Flags when none
// are set. Errors other than redis.Nil are returned so callers can decide how
// to degrade.
func (s *Store) Get(ctx context.Context, sessionID string) (Flags, error) {
	var f Flags
	if sessionID == "" {
		return f, nil
	}
	raw, err := s.rdb.Get(ctx, key(sessionID)).Bytes()
	if err == redis.Nil {
		return f, nil
	}
	if err != nil {
		return f, fmt.Errorf("get failure flags: %w", err)
	}
	if err := json.Unmarshal(raw, &f); err != nil {
		return Flags{}, fmt.Errorf("decode failure flags: %w", err)
	}
	return f, nil
}

// Set replaces the flags for a session.
func (s *Store) Set(ctx context.Context, sessionID string, f Flags) error {
	raw, err := json.Marshal(f)
	if err != nil {
		return err
	}
	return s.rdb.Set(ctx, key(sessionID), raw, TTL).Err()
}

// Clear resets a session to healthy behavior (Full Recovery).
func (s *Store) Clear(ctx context.Context, sessionID string) error {
	return s.rdb.Del(ctx, key(sessionID)).Err()
}

// ForScenario translates a scenario ID (+ optional intensity 1-3) into flags.
// Deterministic and centrally defined so API, docs, and services agree.
func ForScenario(scenario string, intensity int) (Flags, error) {
	if intensity < 1 || intensity > 3 {
		intensity = 2
	}
	f := Flags{ActiveScenario: scenario, StartedAt: time.Now().UTC(), TrafficMultiplier: 1}
	switch scenario {
	case ScenarioNormal, ScenarioFullRecovery:
		f.ActiveScenario = ScenarioNormal
	case ScenarioPaymentSlowdown:
		f.PaymentExtraLatencyMs = []int{800, 1800, 3500}[intensity-1]
	case ScenarioPaymentErrorSpike:
		f.PaymentFailureRatePct = []int{15, 35, 60}[intensity-1]
		f.PaymentTimeoutRatePct = 5
	case ScenarioNotificationOutage:
		f.NotificationOutage = true
	case ScenarioOrderDBDelay:
		f.OrderDBDelayMs = []int{400, 900, 2000}[intensity-1]
	case ScenarioTrafficSurge:
		f.TrafficMultiplier = []float64{2, 4, 8}[intensity-1]
	case ScenarioQueueWorkerPause:
		f.QueueWorkerPaused = true
	case ScenarioMalformedEvent:
		// One-shot scenario: the API publishes malformed events directly; no
		// standing service behavior changes.
	default:
		return Flags{}, fmt.Errorf("unknown scenario %q", scenario)
	}
	return f, nil
}

// Conflicts reports whether a new scenario cannot be layered on the current
// flags. Traffic surge intentionally composes with failure scenarios; two
// different standing failure scenarios do not.
func Conflicts(current Flags, next string) bool {
	if current.ActiveScenario == "" || current.ActiveScenario == ScenarioNormal {
		return false
	}
	switch next {
	case ScenarioNormal, ScenarioFullRecovery, ScenarioMalformedEvent, ScenarioTrafficSurge:
		return false
	}
	if current.ActiveScenario == ScenarioTrafficSurge {
		return false
	}
	return current.ActiveScenario != next
}
