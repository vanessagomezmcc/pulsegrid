// telemetry-processor is the heart of the pipeline:
//
//	Redpanda raw topic -> validate -> dedup -> PostgreSQL (events/spans/traces)
//	                                        -> in-memory windows -> health, metrics,
//	                                           alerts, incidents -> Redis live state
//	                                        -> Redis pub/sub -> WebSocket gateway
//
// Invalid events are wrapped in a dead-letter envelope and published to the
// dead-letter topic, which this same process consumes and persists. Failed
// events are never silently discarded.
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/redis/go-redis/v9"
	"github.com/twmb/franz-go/pkg/kgo"

	"github.com/pulsegrid/pulsegrid/go/shared/deadletter"
	"github.com/pulsegrid/pulsegrid/go/shared/events"
	"github.com/pulsegrid/pulsegrid/go/shared/kafkax"
	"github.com/pulsegrid/pulsegrid/go/shared/logx"
	"github.com/pulsegrid/pulsegrid/go/shared/promtext"
	"github.com/pulsegrid/pulsegrid/go/shared/redisx"
	"github.com/pulsegrid/pulsegrid/go/shared/tracectx"
)

func envOr(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

func main() {
	brokers := strings.Split(envOr("KAFKA_BROKERS", "localhost:19092"), ",")
	redisURL := envOr("REDIS_URL", "redis://localhost:6379")
	dsn := envOr("DATABASE_URL", "postgres://pulsegrid:pulsegrid@localhost:5432/pulsegrid?sslmode=disable")
	port := envOr("PORT", "7120")

	hostname, _ := os.Hostname()
	log := logx.New("telemetry-processor", hostname)

	st, err := newStore(dsn)
	if err != nil {
		log.Error("postgres connect", "error", err)
		os.Exit(1)
	}
	rdb, err := redisx.New(redisURL)
	if err != nil {
		log.Error("redis connect", "error", err)
		os.Exit(1)
	}
	producer, err := kafkax.NewProducer(brokers, log)
	if err != nil {
		log.Error("kafka producer", "error", err)
		os.Exit(1)
	}

	consumer, err := kgo.NewClient(
		kgo.SeedBrokers(brokers...),
		kgo.ConsumerGroup(envOr("GROUP_ID", "pulsegrid-processor")),
		kgo.ConsumeTopics(events.TopicTelemetryRaw, events.TopicDeadLetter),
		kgo.DisableAutoCommit(),
	)
	if err != nil {
		log.Error("kafka consumer", "error", err)
		os.Exit(1)
	}

	rules, err := st.loadRules(context.Background())
	if err != nil {
		log.Error("load alert rules", "error", err)
		os.Exit(1)
	}
	log.Info("alert rules loaded", "count", len(rules))
	agg := newAggregator(st, rdb, rules, log)

	reg := promtext.NewRegistry()
	processed := reg.Counter("pulsegrid_processor_events_total", "Events consumed by outcome")
	lagAge := reg.Gauge("pulsegrid_processor_last_event_age_seconds", "Age of most recently consumed event; a proxy for consumer lag")

	ctx, cancel := context.WithCancel(context.Background())

	// Ops HTTP server.
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

	// Evaluation + retention tickers.
	go func() {
		tick := time.NewTicker(5 * time.Second)
		clean := time.NewTicker(10 * time.Minute)
		defer tick.Stop()
		defer clean.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case now := <-tick.C:
				agg.tick(ctx, now.UTC())
			case <-clean.C:
				st.cleanupExpired(ctx)
			}
		}
	}()

	// Consumer loop.
	go func() {
		for {
			if ctx.Err() != nil {
				return
			}
			fetches := consumer.PollFetches(ctx)
			if fetches.IsClientClosed() || ctx.Err() != nil {
				return
			}
			fetches.EachError(func(t string, p int32, err error) { log.Warn("fetch error", "topic", t, "partition", p, "error", err) })
			fetches.EachRecord(func(rec *kgo.Record) {
				lagAge.Set(nil, time.Since(rec.Timestamp).Seconds())
				switch rec.Topic {
				case events.TopicTelemetryRaw:
					outcome := handleRaw(ctx, rec.Value, st, rdb, producer, agg, log)
					processed.Inc(map[string]string{"topic": rec.Topic, "outcome": outcome})
				case events.TopicDeadLetter:
					outcome := handleDeadLetter(ctx, rec.Value, st, agg, log)
					processed.Inc(map[string]string{"topic": rec.Topic, "outcome": outcome})
				}
			})
			if err := consumer.CommitUncommittedOffsets(ctx); err != nil && ctx.Err() == nil {
				log.Warn("offset commit failed", "error", err)
			}
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	<-stop
	log.Info("processor shutting down")
	cancel()
	shutdownCtx, c2 := context.WithTimeout(context.Background(), 10*time.Second)
	defer c2()
	_ = srv.Shutdown(shutdownCtx)
	consumer.Close()
	producer.Close(shutdownCtx)
}

// handleRaw processes one raw telemetry record. Returns an outcome label for
// metrics: ok | duplicate | dead_lettered | persist_error.
func handleRaw(ctx context.Context, raw []byte, st *store, rdb *redis.Client, producer *kafkax.Producer, agg *aggregator, log interface {
	Warn(string, ...any)
	Error(string, ...any)
}) string {
	deadLetter := func(payload []byte, verrs []string, reason, sessionID, traceID string) {
		now := time.Now().UTC()
		env := deadletter.Envelope{
			ID: tracectx.NewTraceID(), Kind: deadletter.KindInvalidTelemetry,
			SessionID: sessionID, TraceID: traceID, SourceTopic: events.TopicTelemetryRaw,
			OriginalPayload: string(payload), ValidationErrs: verrs, FailureReason: reason,
			FirstFailureAt: now, LastFailureAt: now, Status: deadletter.StatusFailed,
		}
		b, err := json.Marshal(env)
		if err != nil {
			log.Error("encode DLQ envelope", "error", err)
			return
		}
		producer.Publish(ctx, events.TopicDeadLetter, env.ID, b)
	}

	e, err := events.Decode(raw)
	if err != nil {
		deadLetter(raw, []string{err.Error()}, "payload is not valid JSON for the telemetry schema", "", "")
		return "dead_lettered"
	}
	if verrs := events.Validate(e); len(verrs) > 0 {
		msgs := make([]string, len(verrs))
		for i, v := range verrs {
			msgs[i] = v.Error()
		}
		deadLetter(raw, msgs, "telemetry event failed schema validation", e.SessionID, e.TraceID)
		return "dead_lettered"
	}

	// Idempotency: first writer wins for 10 minutes per event ID.
	fresh, err := rdb.SetNX(ctx, redisx.KeyDedupPrefix+e.EventID, 1, 10*time.Minute).Result()
	if err != nil {
		log.Warn("dedup check failed; processing anyway (DB PK is the backstop)", "error", err)
	} else if !fresh {
		return "duplicate"
	}

	if err := st.insertEvent(ctx, e); err != nil {
		log.Error("persist event", "error", err)
		return "persist_error"
	}
	if e.EventType == events.EventRequest || e.EventType == events.EventDependency {
		if err := st.insertSpan(ctx, e); err != nil {
			log.Warn("persist span", "error", err)
		}
		if err := st.upsertTrace(ctx, e); err != nil {
			log.Warn("upsert trace", "error", err)
		}
	}
	if err := st.upsertInstance(ctx, e); err != nil {
		log.Warn("upsert instance", "error", err)
	}

	agg.add(e)
	agg.publishTrace(ctx, e)
	agg.publish(ctx, e.SessionID, "event", map[string]any{
		"eventId": e.EventID, "service": e.ServiceName, "eventType": e.EventType, "endpoint": e.Endpoint,
		"traceId": e.TraceID, "status": e.Status, "durationMs": e.DurationMs, "ts": e.Timestamp,
		"queueName": e.QueueName, "topic": events.TopicTelemetryRaw,
	})
	return "ok"
}

func handleDeadLetter(ctx context.Context, raw []byte, st *store, agg *aggregator, log interface{ Warn(string, ...any) }) string {
	var env deadletter.Envelope
	if err := json.Unmarshal(raw, &env); err != nil {
		log.Warn("undecodable dead-letter envelope", "error", err)
		return "undecodable"
	}
	if err := st.upsertDeadLetter(ctx, &env); err != nil {
		log.Warn("persist dead-letter", "error", err)
		return "persist_error"
	}
	agg.addDLQ(env.SessionID, env.LastFailureAt)
	agg.publish(ctx, env.SessionID, "dlq", map[string]any{
		"id": env.ID, "kind": env.Kind, "reason": env.FailureReason, "status": env.Status, "retryCount": env.RetryCount,
	})
	return fmt.Sprintf("stored_%s", env.Status)
}
