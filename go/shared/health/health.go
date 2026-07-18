// Package health computes service health states from real recent telemetry.
//
// The rules are deliberately deterministic and documented (see
// docs/ARCHITECTURE.md "Health scoring"). A scenario button never sets health
// directly: it changes service behavior, the behavior changes telemetry, and
// this engine detects the change.
package health

import (
	"math"
	"sort"
	"time"
)

// State is the computed health of one service.
type State string

const (
	Healthy  State = "healthy"
	Degraded State = "degraded"
	Critical State = "critical"
	Offline  State = "offline"
	Unknown  State = "unknown"
)

// Thresholds define the scoring rules. Defaults live in DefaultThresholds and
// are documented; they can be tuned per deployment via configuration.
type Thresholds struct {
	OfflineAfter        time.Duration // no events at all for this long, while system is active -> offline
	DegradedErrorRate   float64       // fraction, e.g. 0.05
	CriticalErrorRate   float64       // fraction, e.g. 0.25
	DegradedP95Ms       float64
	CriticalP95Ms       float64
	DegradedTimeoutRate float64
	QueueDegraded       int
	QueueCritical       int
	MinSampleSize       int // below this many requests the window is too thin to judge
}

// DefaultThresholds are the documented defaults.
var DefaultThresholds = Thresholds{
	OfflineAfter:        30 * time.Second,
	DegradedErrorRate:   0.05,
	CriticalErrorRate:   0.25,
	DegradedP95Ms:       1200,
	CriticalP95Ms:       3000,
	DegradedTimeoutRate: 0.05,
	QueueDegraded:       50,
	QueueCritical:       200,
	MinSampleSize:       3,
}

// Window is an aggregate over a service's recent telemetry (typically the
// last 60 seconds), assembled by the telemetry processor.
type Window struct {
	RequestCount   int
	ErrorCount     int
	TimeoutCount   int
	LatenciesMs    []float64 // request durations observed in the window
	LastEventAt    time.Time // most recent event of any type from this service
	HealthProbeOK  bool      // last synthetic health-probe result
	HasHealthProbe bool
	QueueDepth     int // depth of the queue this service consumes, if any
}

// Percentile returns the p-th percentile (0-100) of values using linear
// interpolation between closest ranks. It does not mutate its input.
func Percentile(values []float64, p float64) float64 {
	if len(values) == 0 {
		return 0
	}
	sorted := make([]float64, len(values))
	copy(sorted, values)
	sort.Float64s(sorted)
	if p <= 0 {
		return sorted[0]
	}
	if p >= 100 {
		return sorted[len(sorted)-1]
	}
	rank := (p / 100) * float64(len(sorted)-1)
	lo := int(math.Floor(rank))
	hi := int(math.Ceil(rank))
	if lo == hi {
		return sorted[lo]
	}
	frac := rank - float64(lo)
	return sorted[lo] + (sorted[hi]-sorted[lo])*frac
}

// Result carries the state plus the evidence that produced it, so the UI and
// incident engine can explain the classification.
type Result struct {
	State       State
	ErrorRate   float64
	TimeoutRate float64
	P95Ms       float64
	Reasons     []string
}

// Compute classifies one service window. `now` is injected for testability.
// `systemActive` indicates whether the session's traffic generator is running;
// silence while inactive is Unknown, silence while active is Offline.
func Compute(w Window, t Thresholds, now time.Time, systemActive bool) Result {
	res := Result{State: Healthy}
	if w.RequestCount > 0 {
		res.ErrorRate = float64(w.ErrorCount) / float64(w.RequestCount)
		res.TimeoutRate = float64(w.TimeoutCount) / float64(w.RequestCount)
	}
	res.P95Ms = Percentile(w.LatenciesMs, 95)

	// Silence handling first: it overrides everything else.
	if w.LastEventAt.IsZero() || now.Sub(w.LastEventAt) > t.OfflineAfter {
		if systemActive {
			res.State = Offline
			res.Reasons = append(res.Reasons, "no telemetry received within the offline window while traffic is active")
		} else {
			res.State = Unknown
			res.Reasons = append(res.Reasons, "no recent telemetry and no active traffic")
		}
		return res
	}

	// A failing health probe with zero successful requests is critical even in
	// a thin window.
	if w.HasHealthProbe && !w.HealthProbeOK && w.RequestCount-w.ErrorCount == 0 {
		res.State = Critical
		res.Reasons = append(res.Reasons, "health probe failing and no successful requests")
		return res
	}

	if w.RequestCount < t.MinSampleSize {
		res.State = Healthy
		res.Reasons = append(res.Reasons, "thin sample; defaulting to healthy while telemetry warms up")
		return res
	}

	critical := false
	degraded := false
	if res.ErrorRate >= t.CriticalErrorRate {
		critical = true
		res.Reasons = append(res.Reasons, "error rate above critical threshold")
	} else if res.ErrorRate >= t.DegradedErrorRate {
		degraded = true
		res.Reasons = append(res.Reasons, "error rate above degraded threshold")
	}
	if res.P95Ms >= t.CriticalP95Ms {
		critical = true
		res.Reasons = append(res.Reasons, "p95 latency above critical threshold")
	} else if res.P95Ms >= t.DegradedP95Ms {
		degraded = true
		res.Reasons = append(res.Reasons, "p95 latency above degraded threshold")
	}
	if res.TimeoutRate >= t.DegradedTimeoutRate {
		degraded = true
		res.Reasons = append(res.Reasons, "timeout rate above degraded threshold")
	}
	if w.QueueDepth >= t.QueueCritical {
		critical = true
		res.Reasons = append(res.Reasons, "queue backlog above critical threshold")
	} else if w.QueueDepth >= t.QueueDegraded {
		degraded = true
		res.Reasons = append(res.Reasons, "queue backlog above degraded threshold")
	}

	switch {
	case critical:
		res.State = Critical
	case degraded:
		res.State = Degraded
	default:
		res.State = Healthy
		res.Reasons = append(res.Reasons, "all indicators within healthy thresholds")
	}
	return res
}
