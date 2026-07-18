// Package simcore is the shared runtime for PulseGrid's simulated services
// (auth, payment, order, notification). It provides:
//
//   - env-driven configuration
//   - structured logging and Prometheus metrics
//   - W3C trace-context extraction/propagation
//   - telemetry emission to the Redpanda raw topic (validated before publish)
//   - failure-flag lookup so scenarios change real behavior
//   - health/readiness endpoints and graceful shutdown
//
// Each service's main.go supplies only its business behavior.
package simcore

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/redis/go-redis/v9"

	"github.com/pulsegrid/pulsegrid/go/shared/events"
	"github.com/pulsegrid/pulsegrid/go/shared/failure"
	"github.com/pulsegrid/pulsegrid/go/shared/kafkax"
	"github.com/pulsegrid/pulsegrid/go/shared/logx"
	"github.com/pulsegrid/pulsegrid/go/shared/promtext"
	"github.com/pulsegrid/pulsegrid/go/shared/redisx"
	"github.com/pulsegrid/pulsegrid/go/shared/tracectx"
)

// Config is populated from the environment.
type Config struct {
	ServiceName   string
	Port          string
	RedisURL      string
	KafkaBrokers  []string
	DownstreamURL string // next service in the chain, empty for the tail
	Environment   string
	Region        string
}

func env(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

// LoadConfig reads configuration with sane local-dev defaults.
func LoadConfig(serviceName, defaultPort string) Config {
	return Config{
		ServiceName:   serviceName,
		Port:          env("PORT", defaultPort),
		RedisURL:      env("REDIS_URL", "redis://localhost:6379"),
		KafkaBrokers:  strings.Split(env("KAFKA_BROKERS", "localhost:19092"), ","),
		DownstreamURL: os.Getenv("DOWNSTREAM_URL"),
		Environment:   env("PG_ENVIRONMENT", "local"),
		Region:        env("PG_REGION", "local-1"),
	}
}

// Service bundles the shared runtime.
type Service struct {
	Cfg      Config
	Log      *slog.Logger
	Redis    *redis.Client
	Producer *kafkax.Producer
	Flags    *failure.Store
	Metrics  *promtext.Registry
	Instance string
	mux      *http.ServeMux
	client   *http.Client

	reqTotal   *promtext.Counter
	reqLatency *promtext.Histogram
}

// New wires the runtime. It fails fast on unreachable infrastructure since
// the services are worthless without Redis and the broker.
func New(cfg Config) (*Service, error) {
	instance := fmt.Sprintf("%s-%d", cfg.ServiceName, os.Getpid())
	if h, err := os.Hostname(); err == nil {
		instance = h
	}
	log := logx.New(cfg.ServiceName, instance)

	rdb, err := redisx.New(cfg.RedisURL)
	if err != nil {
		return nil, fmt.Errorf("redis config: %w", err)
	}
	producer, err := kafkax.NewProducer(cfg.KafkaBrokers, log)
	if err != nil {
		return nil, fmt.Errorf("kafka producer: %w", err)
	}

	reg := promtext.NewRegistry()
	s := &Service{
		Cfg: cfg, Log: log, Redis: rdb, Producer: producer,
		Flags: failure.NewStore(rdb), Metrics: reg, Instance: instance,
		mux:    http.NewServeMux(),
		client: &http.Client{Timeout: 8 * time.Second},
	}
	s.reqTotal = reg.Counter("pulsegrid_requests_total", "Requests handled by this simulated service")
	s.reqLatency = reg.Histogram("pulsegrid_request_duration_ms", "Request duration in milliseconds", nil)

	s.mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok", "service": cfg.ServiceName})
	})
	s.mux.HandleFunc("GET /readyz", func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
		defer cancel()
		if err := rdb.Ping(ctx).Err(); err != nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"status": "not-ready", "reason": "redis unreachable"})
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"status": "ready"})
	})
	s.mux.Handle("GET /metrics", reg.Handler())
	return s, nil
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

// Outcome is what a business handler reports back to the framework.
type Outcome struct {
	Status       events.Status
	StatusCode   int
	ErrorType    string
	ErrorMessage string
	RetryCount   int
	Metadata     map[string]string
	Body         any // response payload for the caller
}

// Handler is a service's business behavior for one endpoint.
type Handler func(ctx context.Context, tc tracectx.Context, f failure.Flags, body []byte) Outcome

// Route registers a business endpoint. The framework handles trace
// extraction, failure-flag lookup, timing, telemetry emission, Prometheus
// metrics, and structured logging; the handler handles behavior.
func (s *Service) Route(method, path string, h Handler) {
	s.mux.HandleFunc(method+" "+path, func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		tc := tracectx.Extract(r)
		body := readBody(r)

		flags, err := s.Flags.Get(r.Context(), tc.SessionID)
		if err != nil {
			// Degrade to healthy-behavior defaults rather than failing the request.
			s.Log.Warn("failure flags unavailable", "error", err, "session", tc.SessionID)
		}

		out := h(r.Context(), tc, flags, body)
		durMs := float64(time.Since(start).Microseconds()) / 1000

		labels := map[string]string{"endpoint": path, "status": string(out.Status)}
		s.reqTotal.Inc(labels)
		s.reqLatency.Observe(map[string]string{"endpoint": path}, durMs)

		s.EmitRequest(r.Context(), tc, path, method, out, durMs, len(body))
		s.Log.Info("request handled",
			"endpoint", path, "status", out.Status, "code", out.StatusCode,
			"durationMs", durMs, "traceId", tc.TraceID, "sessionId", tc.SessionID)

		resp := map[string]any{"traceId": tc.TraceID, "status": out.Status}
		if out.Body != nil {
			resp["data"] = out.Body
		}
		if out.ErrorMessage != "" {
			resp["error"] = out.ErrorMessage
		}
		writeJSON(w, out.StatusCode, resp)
	})
}

func readBody(r *http.Request) []byte {
	if r.Body == nil {
		return nil
	}
	defer r.Body.Close()
	buf := new(bytes.Buffer)
	_, _ = buf.ReadFrom(http.MaxBytesReader(nil, r.Body, 64*1024))
	return buf.Bytes()
}

// EmitRequest publishes a validated request-telemetry event.
func (s *Service) EmitRequest(ctx context.Context, tc tracectx.Context, endpoint, method string, out Outcome, durMs float64, payloadBytes int) {
	e := &events.TelemetryEvent{
		EventID:          tracectx.NewTraceID(), // 32-hex unique id
		EventVersion:     events.SchemaVersion,
		SessionID:        tc.SessionID,
		TraceID:          tc.TraceID,
		SpanID:           tc.SpanID,
		ParentSpanID:     tc.ParentSpanID,
		ServiceName:      s.Cfg.ServiceName,
		ServiceInstance:  s.Instance,
		Environment:      s.Cfg.Environment,
		Region:           s.Cfg.Region,
		EventType:        events.EventRequest,
		Endpoint:         endpoint,
		HTTPMethod:       method,
		Status:           out.Status,
		StatusCode:       out.StatusCode,
		DurationMs:       durMs,
		Timestamp:        time.Now().UTC(),
		ErrorType:        out.ErrorType,
		ErrorMessage:     out.ErrorMessage,
		RetryCount:       out.RetryCount,
		PayloadSizeBytes: payloadBytes,
		Metadata:         out.Metadata,
	}
	s.emit(ctx, e)
}

// EmitQueue publishes queue_publish / queue_consume telemetry.
func (s *Service) EmitQueue(ctx context.Context, tc tracectx.Context, evtType events.EventType, queue string, status events.Status, durMs float64, retry int, errType, errMsg string) {
	e := &events.TelemetryEvent{
		EventID: tracectx.NewTraceID(), EventVersion: events.SchemaVersion,
		SessionID: tc.SessionID, TraceID: tc.TraceID, SpanID: tracectx.NewSpanID(), ParentSpanID: tc.SpanID,
		ServiceName: s.Cfg.ServiceName, ServiceInstance: s.Instance,
		Environment: s.Cfg.Environment, Region: s.Cfg.Region,
		EventType: evtType, Endpoint: "queue:" + queue, Status: status,
		DurationMs: durMs, Timestamp: time.Now().UTC(), QueueName: queue,
		RetryCount: retry, ErrorType: errType, ErrorMessage: errMsg,
	}
	s.emit(ctx, e)
}

func (s *Service) emit(ctx context.Context, e *events.TelemetryEvent) {
	if verrs := events.Validate(e); len(verrs) > 0 {
		// A producer-side validation failure is a programming error; log loudly
		// but never take down the request path.
		s.Log.Error("refusing to publish invalid telemetry", "errors", fmt.Sprint(verrs))
		return
	}
	raw, err := events.Encode(e)
	if err != nil {
		s.Log.Error("encode telemetry", "error", err)
		return
	}
	s.Producer.Publish(ctx, events.TopicTelemetryRaw, e.TraceID, raw)
}

// CallDownstream invokes the next service in the chain with propagated trace
// context, emits a dependency span, and returns the downstream status code.
func (s *Service) CallDownstream(ctx context.Context, tc tracectx.Context, path string, payload any, timeout time.Duration) (int, error) {
	child := tc.Child()
	start := time.Now()

	body, _ := json.Marshal(payload)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, s.Cfg.DownstreamURL+path, bytes.NewReader(body))
	if err != nil {
		return 0, err
	}
	req.Header.Set("Content-Type", "application/json")
	tracectx.Inject(req, child)

	client := s.client
	if timeout > 0 {
		client = &http.Client{Timeout: timeout}
	}
	resp, err := client.Do(req)
	durMs := float64(time.Since(start).Microseconds()) / 1000

	dep := &events.TelemetryEvent{
		EventID: tracectx.NewTraceID(), EventVersion: events.SchemaVersion,
		SessionID: tc.SessionID, TraceID: tc.TraceID, SpanID: child.SpanID, ParentSpanID: tc.SpanID,
		ServiceName: s.Cfg.ServiceName, ServiceInstance: s.Instance,
		Environment: s.Cfg.Environment, Region: s.Cfg.Region,
		EventType: events.EventDependency, Endpoint: path, HTTPMethod: http.MethodPost,
		DurationMs: durMs, Timestamp: time.Now().UTC(), PayloadSizeBytes: len(body),
	}
	switch {
	case err != nil && (errors.Is(err, context.DeadlineExceeded) || strings.Contains(err.Error(), "Client.Timeout")):
		dep.Status = events.StatusTimeout
		dep.ErrorType = "downstream_timeout"
		dep.ErrorMessage = "downstream call exceeded timeout"
		s.emit(ctx, dep)
		return 0, err
	case err != nil:
		dep.Status = events.StatusError
		dep.ErrorType = "downstream_unreachable"
		dep.ErrorMessage = err.Error()
		s.emit(ctx, dep)
		return 0, err
	}
	defer resp.Body.Close()
	dep.StatusCode = resp.StatusCode
	if resp.StatusCode >= 400 {
		dep.Status = events.StatusError
		dep.ErrorType = "downstream_error"
		dep.ErrorMessage = fmt.Sprintf("downstream returned %d", resp.StatusCode)
	} else {
		dep.Status = events.StatusOK
	}
	s.emit(ctx, dep)
	return resp.StatusCode, nil
}

// Serve runs the HTTP server until SIGINT/SIGTERM, then drains gracefully.
func (s *Service) Serve() error {
	srv := &http.Server{
		Addr:              ":" + s.Cfg.Port,
		Handler:           s.mux,
		ReadHeaderTimeout: 5 * time.Second,
	}
	errCh := make(chan error, 1)
	go func() {
		s.Log.Info("listening", "port", s.Cfg.Port)
		errCh <- srv.ListenAndServe()
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	select {
	case err := <-errCh:
		return err
	case <-stop:
		s.Log.Info("shutting down")
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = srv.Shutdown(ctx)
		s.Producer.Close(ctx)
		_ = s.Redis.Close()
		return nil
	}
}
