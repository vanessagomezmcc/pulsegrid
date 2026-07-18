// notification-service accepts confirmation jobs over HTTP, queues them in a
// per-session Redis list, and drains the queue with a background worker. The
// Notification Outage scenario makes the HTTP endpoint fail for real; the
// Queue Worker Pause scenario stops the drain loop so backlog visibly grows.
package main

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"time"

	"github.com/pulsegrid/pulsegrid/go/shared/events"
	"github.com/pulsegrid/pulsegrid/go/shared/failure"
	"github.com/pulsegrid/pulsegrid/go/shared/redisx"
	"github.com/pulsegrid/pulsegrid/go/shared/simcore"
	"github.com/pulsegrid/pulsegrid/go/shared/tracectx"
)

// QueueName is the simulated notification work queue.
const QueueName = "notifications"

type notifyRequest struct {
	OrderID string `json:"orderId"`
	Channel string `json:"channel"`
}

type queuedJob struct {
	OrderID   string    `json:"orderId"`
	Channel   string    `json:"channel"`
	SessionID string    `json:"sessionId"`
	TraceID   string    `json:"traceId"`
	SpanID    string    `json:"spanId"`
	Enqueued  time.Time `json:"enqueued"`
	Retries   int       `json:"retries"`
}

func main() {
	cfg := simcore.LoadConfig("notification-service", "7104")
	svc, err := simcore.New(cfg)
	if err != nil {
		log.Fatalf("notification-service startup: %v", err)
	}

	svc.Route(http.MethodPost, "/api/notifications", func(ctx context.Context, tc tracectx.Context, f failure.Flags, body []byte) simcore.Outcome {
		req, err := decode[notifyRequest](body)
		if err != nil || req.OrderID == "" {
			return simcore.Outcome{Status: events.StatusError, StatusCode: 400, ErrorType: "bad_request", ErrorMessage: "invalid notification payload"}
		}

		// Full outage: the endpoint itself fails, upstream sees real 503s.
		if f.NotificationOutage {
			return simcore.Outcome{Status: events.StatusError, StatusCode: 503, ErrorType: "notification_outage", ErrorMessage: "notification provider unavailable (simulated outage)"}
		}

		simcore.Sleep(ctx, simcore.Jitter(5, 20))
		job := queuedJob{OrderID: req.OrderID, Channel: req.Channel, SessionID: tc.SessionID, TraceID: tc.TraceID, SpanID: tc.SpanID, Enqueued: time.Now().UTC()}
		raw, _ := json.Marshal(job)
		if err := svc.Redis.LPush(ctx, redisx.QueueKey(tc.SessionID, QueueName), raw).Err(); err != nil {
			return simcore.Outcome{Status: events.StatusError, StatusCode: 500, ErrorType: "enqueue_failed", ErrorMessage: "could not enqueue notification job"}
		}
		svc.Redis.Expire(ctx, redisx.QueueKey(tc.SessionID, QueueName), 30*time.Minute)
		svc.EmitQueue(ctx, tc, events.EventQueuePublish, QueueName, events.StatusOK, 0, 0, "", "")
		return simcore.Outcome{Status: events.StatusOK, StatusCode: 202, Body: map[string]string{"queued": "true"}}
	})

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go worker(ctx, svc)

	if err := svc.Serve(); err != nil {
		log.Fatal(err)
	}
}

// worker drains per-session notification queues every 250ms. It honors the
// QueueWorkerPaused and NotificationDelayMs flags, retries failed sends up to
// twice, then routes the job to the dead-letter path.
func worker(ctx context.Context, svc *simcore.Service) {
	ticker := time.NewTicker(250 * time.Millisecond)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
		sessions, err := redisx.ActiveSessions(ctx, svc.Redis)
		if err != nil {
			svc.Log.Warn("worker: list sessions", "error", err)
			continue
		}
		for _, session := range sessions {
			flags, _ := svc.Flags.Get(ctx, session)
			if flags.QueueWorkerPaused {
				continue // real backlog: nothing is consumed while paused
			}
			for i := 0; i < 5; i++ { // bounded batch per tick per session
				raw, err := svc.Redis.RPop(ctx, redisx.QueueKey(session, QueueName)).Bytes()
				if err != nil {
					break // empty queue
				}
				var job queuedJob
				if json.Unmarshal(raw, &job) != nil {
					continue
				}
				processJob(ctx, svc, flags, job)
			}
		}
	}
}

func processJob(ctx context.Context, svc *simcore.Service, flags failure.Flags, job queuedJob) {
	tc := tracectx.Context{TraceID: job.TraceID, SpanID: job.SpanID, SessionID: job.SessionID}
	start := time.Now()
	if flags.NotificationDelayMs > 0 {
		simcore.Sleep(ctx, time.Duration(flags.NotificationDelayMs)*time.Millisecond)
	}
	simcore.Sleep(ctx, simcore.Jitter(10, 40)) // the synthetic "send"

	failed := flags.NotificationOutage || simcore.Chance(1)
	durMs := float64(time.Since(start).Microseconds()) / 1000
	if !failed {
		svc.EmitQueue(ctx, tc, events.EventQueueConsume, QueueName, events.StatusOK, durMs, job.Retries, "", "")
		return
	}
	if job.Retries < 2 {
		job.Retries++
		raw, _ := json.Marshal(job)
		svc.Redis.LPush(ctx, redisx.QueueKey(job.SessionID, QueueName), raw)
		svc.EmitQueue(ctx, tc, events.EventQueueConsume, QueueName, events.StatusError, durMs, job.Retries, "delivery_failed", "send failed; requeued for retry")
		return
	}
	svc.EmitQueue(ctx, tc, events.EventQueueConsume, QueueName, events.StatusError, durMs, job.Retries, "delivery_failed", "send failed after max retries; dead-lettered")
	svc.PublishDeliveryFailure(ctx, tc, job.OrderID, "notification send failed after max retries", job.Retries)
}
