package correlate

import (
	"strings"
	"testing"
	"time"
)

func TestRootCausePicksEarliestUpstream(t *testing.T) {
	t0 := time.Now()
	degs := []Degradation{
		{ServiceName: "order-service", State: "degraded", At: t0.Add(15 * time.Second)},
		{ServiceName: "payment-service", State: "degraded", At: t0},
		{ServiceName: "notification-service", State: "degraded", At: t0.Add(30 * time.Second)},
	}
	svc, hint, ok := RootCause(DefaultGraph, degs)
	if !ok || svc != "payment-service" {
		t.Fatalf("expected payment-service as root cause, got %q ok=%v", svc, ok)
	}
	if !strings.Contains(hint, "order-service") || !strings.Contains(hint, "earliest correlated") {
		t.Fatalf("hint lacks evidence: %s", hint)
	}
}

func TestRootCauseIsolatedFault(t *testing.T) {
	degs := []Degradation{{ServiceName: "notification-service", State: "critical", At: time.Now()}}
	svc, hint, ok := RootCause(DefaultGraph, degs)
	if !ok || svc != "notification-service" || !strings.Contains(hint, "isolated") {
		t.Fatalf("isolated fault mishandled: %q / %s", svc, hint)
	}
}

func TestRootCauseNoData(t *testing.T) {
	if _, _, ok := RootCause(DefaultGraph, nil); ok {
		t.Fatal("expected ok=false with no degradations")
	}
}
