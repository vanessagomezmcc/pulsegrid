package health

import (
	"math"
	"testing"
	"time"
)

func TestPercentile(t *testing.T) {
	vals := []float64{10, 20, 30, 40, 50, 60, 70, 80, 90, 100}
	cases := map[float64]float64{0: 10, 50: 55, 95: 95.5, 99: 99.1, 100: 100}
	for p, want := range cases {
		if got := Percentile(vals, p); math.Abs(got-want) > 0.001 {
			t.Fatalf("p%v = %v, want %v", p, got, want)
		}
	}
	if Percentile(nil, 95) != 0 {
		t.Fatal("empty slice should yield 0")
	}
	// must not mutate input
	if vals[0] != 10 {
		t.Fatal("input mutated")
	}
}

func win(reqs, errs int, lat []float64, ageSec int) Window {
	return Window{RequestCount: reqs, ErrorCount: errs, LatenciesMs: lat,
		LastEventAt: time.Now().Add(-time.Duration(ageSec) * time.Second)}
}

func TestComputeStates(t *testing.T) {
	now := time.Now()
	th := DefaultThresholds

	if r := Compute(win(100, 1, fill(100, 50), 2), th, now, true); r.State != Healthy {
		t.Fatalf("expected healthy, got %s (%v)", r.State, r.Reasons)
	}
	if r := Compute(win(100, 10, fill(100, 50), 2), th, now, true); r.State != Degraded {
		t.Fatalf("expected degraded on 10%% errors, got %s", r.State)
	}
	if r := Compute(win(100, 40, fill(100, 50), 2), th, now, true); r.State != Critical {
		t.Fatalf("expected critical on 40%% errors, got %s", r.State)
	}
	if r := Compute(win(100, 0, fill(100, 2000), 2), th, now, true); r.State != Degraded {
		t.Fatalf("expected degraded on p95=2000ms, got %s", r.State)
	}
	if r := Compute(win(100, 0, fill(100, 5000), 2), th, now, true); r.State != Critical {
		t.Fatalf("expected critical on p95=5000ms, got %s", r.State)
	}
	if r := Compute(win(0, 0, nil, 120), th, now, true); r.State != Offline {
		t.Fatalf("expected offline on silence with active traffic, got %s", r.State)
	}
	if r := Compute(win(0, 0, nil, 120), th, now, false); r.State != Unknown {
		t.Fatalf("expected unknown on silence without traffic, got %s", r.State)
	}
	q := win(100, 0, fill(100, 50), 2)
	q.QueueDepth = 500
	if r := Compute(q, th, now, true); r.State != Critical {
		t.Fatalf("expected critical on queue depth 500, got %s", r.State)
	}
	thin := win(1, 1, []float64{9000}, 2)
	if r := Compute(thin, th, now, true); r.State != Healthy {
		t.Fatalf("thin sample must not flap to critical, got %s", r.State)
	}
}

func fill(n int, v float64) []float64 {
	out := make([]float64, n)
	for i := range out {
		out[i] = v
	}
	return out
}
