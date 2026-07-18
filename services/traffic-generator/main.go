// traffic-generator continuously drives realistic synthetic requests through
// the simulated chain, one stream per active demo session. Rate, mix, ramps,
// and randomness are all controlled here; every request originates a fresh
// W3C trace context so the whole chain shares one trace ID.
package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"math"
	"math/rand"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/pulsegrid/pulsegrid/go/shared/failure"
	"github.com/pulsegrid/pulsegrid/go/shared/logx"
	"github.com/pulsegrid/pulsegrid/go/shared/promtext"
	"github.com/pulsegrid/pulsegrid/go/shared/redisx"
	"github.com/pulsegrid/pulsegrid/go/shared/tracectx"
)

type generator struct {
	authURL string
	baseRPS float64
	rng     *rand.Rand
	rngMu   sync.Mutex
	client  *http.Client
	log     interface{ Info(string, ...any) }
	sent    *promtext.Counter
	flags   *failure.Store
}

func envOr(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

func main() {
	authURL := envOr("AUTH_URL", "http://localhost:7101")
	redisURL := envOr("REDIS_URL", "redis://localhost:6379")
	baseRPS, _ := strconv.ParseFloat(envOr("BASE_RPS", "3"), 64)
	seed, _ := strconv.ParseInt(envOr("SEED", "0"), 10, 64)
	if seed == 0 {
		seed = time.Now().UnixNano()
	}
	port := envOr("PORT", "7110")

	logger := logx.New("traffic-generator", fmt.Sprintf("gen-%d", os.Getpid()))
	rdb, err := redisx.New(redisURL)
	if err != nil {
		log.Fatalf("redis: %v", err)
	}

	reg := promtext.NewRegistry()
	g := &generator{
		authURL: authURL,
		baseRPS: baseRPS,
		rng:     rand.New(rand.NewSource(seed)),
		client:  &http.Client{Timeout: 12 * time.Second},
		log:     logger,
		sent:    reg.Counter("pulsegrid_generated_requests_total", "Synthetic requests originated by the traffic generator"),
		flags:   failure.NewStore(rdb),
	}
	logger.Info("traffic generator starting", "baseRPS", baseRPS, "seed", seed)

	ctx, cancel := context.WithCancel(context.Background())
	var wg sync.WaitGroup

	// One pacing loop; per-tick it fans out across active sessions so every
	// visitor gets an isolated stream and surge multipliers apply per session.
	wg.Add(1)
	go func() {
		defer wg.Done()
		ticker := time.NewTicker(250 * time.Millisecond)
		defer ticker.Stop()
		carry := map[string]float64{}
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
			}
			sessions, err := redisx.ActiveSessions(ctx, rdb)
			if err != nil {
				logger.Warn("list sessions", "error", err)
				continue
			}
			for _, session := range sessions {
				f, _ := g.flags.Get(ctx, session)
				rps := g.baseRPS * rampedMultiplier(f)
				// fractional-request accumulator per session
				carry[session] += rps * 0.25
				n := int(carry[session])
				carry[session] -= float64(n)
				for i := 0; i < n; i++ {
					wg.Add(1)
					go func(s string) { defer wg.Done(); g.fire(ctx, s) }(session)
				}
			}
		}
	}()

	// Ops endpoints.
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(200)
		_, _ = w.Write([]byte(`{"status":"ok"}`))
	})
	mux.HandleFunc("GET /readyz", func(w http.ResponseWriter, r *http.Request) {
		if err := rdb.Ping(r.Context()).Err(); err != nil {
			w.WriteHeader(503)
			return
		}
		w.WriteHeader(200)
	})
	mux.Handle("GET /metrics", reg.Handler())
	srv := &http.Server{Addr: ":" + port, Handler: mux, ReadHeaderTimeout: 5 * time.Second}
	go func() { _ = srv.ListenAndServe() }()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	<-stop
	logger.Info("traffic generator draining")
	cancel()
	shutdownCtx, c2 := context.WithTimeout(context.Background(), 10*time.Second)
	defer c2()
	_ = srv.Shutdown(shutdownCtx)
	done := make(chan struct{})
	go func() { wg.Wait(); close(done) }()
	select {
	case <-done:
	case <-shutdownCtx.Done():
	}
}

// rampedMultiplier applies the Traffic Surge multiplier gradually over 20s
// after scenario start, and ramps back down implicitly when flags clear.
func rampedMultiplier(f failure.Flags) float64 {
	m := f.TrafficMultiplier
	if m <= 0 {
		m = 1
	}
	if m == 1 {
		return 1
	}
	elapsed := time.Since(f.StartedAt).Seconds()
	ramp := math.Min(elapsed/20, 1)
	return 1 + (m-1)*ramp
}

// fire sends one request following the configured traffic mix:
// 78% checkout, 15% login, 5% invalid session (expected auth errors), 2% bursty double-fire.
func (g *generator) fire(ctx context.Context, session string) {
	g.rngMu.Lock()
	roll := g.rng.Intn(100)
	amount := 500 + g.rng.Intn(19500)
	tok := fmt.Sprintf("tok-%08x", g.rng.Uint32())
	g.rngMu.Unlock()

	flow, token := "checkout", tok
	switch {
	case roll < 15:
		flow = "login"
	case roll < 20:
		token = "invalid-" + tok
	case roll >= 98:
		// tiny natural burstiness: fire a second request
		go g.fire(ctx, session)
	}

	tc := tracectx.StartRoot(session)
	payload, _ := json.Marshal(map[string]any{"sessionToken": token, "flow": flow, "amountCents": amount})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, g.authURL+"/api/sessions/validate", bytes.NewReader(payload))
	if err != nil {
		return
	}
	req.Header.Set("Content-Type", "application/json")
	tracectx.Inject(req, tc)

	resp, err := g.client.Do(req)
	status := "network_error"
	if err == nil {
		status = strconv.Itoa(resp.StatusCode)
		_ = resp.Body.Close()
	} else if strings.Contains(err.Error(), "context canceled") {
		return
	}
	g.sent.Inc(map[string]string{"flow": flow, "status": status})
}
