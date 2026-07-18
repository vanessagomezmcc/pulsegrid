package alerting

import (
	"testing"
	"time"
)

func rule() Rule {
	return Rule{ID: "r1", Name: "payment p95 high", ServiceName: "payment-service",
		Metric: "p95_latency_ms", Comparator: GT, Threshold: 1500, ForSeconds: 20, Severity: SeverityCritical}
}

func sample(v float64, at time.Time) []Sample {
	return []Sample{{Metric: "p95_latency_ms", ServiceName: "payment-service", Value: v, At: at}}
}

func TestPendingThenFiringThenResolved(t *testing.T) {
	e := NewEvaluator([]Rule{rule()})
	t0 := time.Now()

	trs := e.Evaluate(sample(2000, t0), t0)
	if len(trs) != 1 || trs[0].To != StatePending {
		t.Fatalf("expected pending, got %+v", trs)
	}
	// Still hot but before ForSeconds elapses: no transition, no duplicate flood.
	if trs := e.Evaluate(sample(2100, t0.Add(10*time.Second)), t0.Add(10*time.Second)); len(trs) != 0 {
		t.Fatalf("premature transition: %+v", trs)
	}
	trs = e.Evaluate(sample(2200, t0.Add(21*time.Second)), t0.Add(21*time.Second))
	if len(trs) != 1 || trs[0].To != StateFiring {
		t.Fatalf("expected firing after for-duration, got %+v", trs)
	}
	// Recovery resolves.
	trs = e.Evaluate(sample(300, t0.Add(60*time.Second)), t0.Add(60*time.Second))
	if len(trs) != 1 || trs[0].To != StateResolved {
		t.Fatalf("expected resolved, got %+v", trs)
	}
}

func TestPendingCancelsOnRecovery(t *testing.T) {
	e := NewEvaluator([]Rule{rule()})
	t0 := time.Now()
	e.Evaluate(sample(2000, t0), t0)
	trs := e.Evaluate(sample(100, t0.Add(5*time.Second)), t0.Add(5*time.Second))
	if len(trs) != 1 || trs[0].To != StateInactive {
		t.Fatalf("expected pending to cancel, got %+v", trs)
	}
}

func TestAcknowledgeOnlyWhileFiring(t *testing.T) {
	e := NewEvaluator([]Rule{rule()})
	t0 := time.Now()
	if _, ok := e.Acknowledge("r1", t0); ok {
		t.Fatal("must not ack inactive alert")
	}
	e.Evaluate(sample(2000, t0), t0)
	e.Evaluate(sample(2000, t0.Add(25*time.Second)), t0.Add(25*time.Second))
	tr, ok := e.Acknowledge("r1", t0.Add(30*time.Second))
	if !ok || tr.To != StateAcknowledged {
		t.Fatalf("expected acknowledgement, got %+v ok=%v", tr, ok)
	}
	// Acked alerts still resolve on recovery.
	trs := e.Evaluate(sample(100, t0.Add(40*time.Second)), t0.Add(40*time.Second))
	if len(trs) != 1 || trs[0].To != StateResolved {
		t.Fatalf("acked alert failed to resolve: %+v", trs)
	}
}

func TestLowerThanComparator(t *testing.T) {
	r := rule()
	r.Comparator = LT
	r.Threshold = 1
	r.Metric = "rps"
	e := NewEvaluator([]Rule{r})
	t0 := time.Now()
	trs := e.Evaluate([]Sample{{Metric: "rps", ServiceName: "payment-service", Value: 0.2, At: t0}}, t0)
	if len(trs) != 1 || trs[0].To != StatePending {
		t.Fatalf("LT comparator failed: %+v", trs)
	}
}
