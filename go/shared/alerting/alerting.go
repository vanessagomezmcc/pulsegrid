// Package alerting implements PulseGrid's deterministic alert-rule engine.
//
// A Rule compares a named metric against a threshold; the condition must hold
// continuously for the rule's ForSeconds before the alert transitions from
// pending to firing (this "for" clause prevents flapping and duplicate
// floods). Recovery below the threshold resolves the alert.
package alerting

import (
	"time"
)

type Severity string

const (
	SeverityInfo     Severity = "info"
	SeverityWarning  Severity = "warning"
	SeverityCritical Severity = "critical"
)

type AlertState string

const (
	StateInactive     AlertState = "inactive"
	StatePending      AlertState = "pending"
	StateFiring       AlertState = "firing"
	StateAcknowledged AlertState = "acknowledged"
	StateResolved     AlertState = "resolved"
)

type Comparator string

const (
	GT Comparator = "gt"
	LT Comparator = "lt"
)

// Rule is a persisted alert rule (see alert_rules table).
type Rule struct {
	ID          string
	Name        string
	ServiceName string // service the rule targets; empty = pipeline-level
	Metric      string // e.g. p95_latency_ms, error_rate_pct, queue_depth, dead_letter_count_1m, no_success_seconds
	Comparator  Comparator
	Threshold   float64
	ForSeconds  int
	Severity    Severity
}

// Sample is one metric observation handed to the evaluator.
type Sample struct {
	Metric      string
	ServiceName string
	Value       float64
	At          time.Time
}

// Instance tracks the live state of one rule for one session.
type Instance struct {
	Rule         Rule
	State        AlertState
	PendingSince time.Time
	FiringSince  time.Time
	ResolvedAt   time.Time
	LastValue    float64
}

// Transition describes a state change the evaluator produced; the processor
// persists these and publishes them to the alerts topic / live channel.
type Transition struct {
	Rule     Rule
	From, To AlertState
	Value    float64
	At       time.Time
}

// Evaluator holds per-rule instances for a single session.
type Evaluator struct {
	instances map[string]*Instance
}

func NewEvaluator(rules []Rule) *Evaluator {
	m := make(map[string]*Instance, len(rules))
	for _, r := range rules {
		m[r.ID] = &Instance{Rule: r, State: StateInactive}
	}
	return &Evaluator{instances: m}
}

// Instances exposes current states (for snapshotting to the UI).
func (e *Evaluator) Instances() []*Instance {
	out := make([]*Instance, 0, len(e.instances))
	for _, i := range e.instances {
		out = append(out, i)
	}
	return out
}

// Acknowledge marks a firing alert acknowledged. Returns false if the alert
// is not currently firing.
func (e *Evaluator) Acknowledge(ruleID string, at time.Time) (*Transition, bool) {
	inst, ok := e.instances[ruleID]
	if !ok || inst.State != StateFiring {
		return nil, false
	}
	inst.State = StateAcknowledged
	return &Transition{Rule: inst.Rule, From: StateFiring, To: StateAcknowledged, Value: inst.LastValue, At: at}, true
}

func breached(r Rule, v float64) bool {
	if r.Comparator == LT {
		return v < r.Threshold
	}
	return v > r.Threshold
}

// Evaluate feeds the latest samples through every rule and returns the state
// transitions that occurred. Samples are matched by metric name + service.
func (e *Evaluator) Evaluate(samples []Sample, now time.Time) []Transition {
	byKey := map[string]Sample{}
	for _, s := range samples {
		byKey[s.Metric+"|"+s.ServiceName] = s
	}
	var out []Transition
	for _, inst := range e.instances {
		s, ok := byKey[inst.Rule.Metric+"|"+inst.Rule.ServiceName]
		if !ok {
			continue // no observation for this rule this tick; hold state
		}
		inst.LastValue = s.Value
		hot := breached(inst.Rule, s.Value)
		switch inst.State {
		case StateInactive, StateResolved:
			if hot {
				inst.State = StatePending
				inst.PendingSince = now
				out = append(out, Transition{inst.Rule, StateInactive, StatePending, s.Value, now})
			}
		case StatePending:
			if !hot {
				inst.State = StateInactive
				out = append(out, Transition{inst.Rule, StatePending, StateInactive, s.Value, now})
			} else if now.Sub(inst.PendingSince) >= time.Duration(inst.Rule.ForSeconds)*time.Second {
				inst.State = StateFiring
				inst.FiringSince = now
				out = append(out, Transition{inst.Rule, StatePending, StateFiring, s.Value, now})
			}
		case StateFiring, StateAcknowledged:
			if !hot {
				from := inst.State
				inst.State = StateResolved
				inst.ResolvedAt = now
				out = append(out, Transition{inst.Rule, from, StateResolved, s.Value, now})
			}
		}
	}
	return out
}
