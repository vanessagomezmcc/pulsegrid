package simcore

import (
	"context"
	"encoding/json"
	"math/rand"
	"sync"
	"time"

	"github.com/pulsegrid/pulsegrid/go/shared/deadletter"
	"github.com/pulsegrid/pulsegrid/go/shared/events"
	"github.com/pulsegrid/pulsegrid/go/shared/tracectx"
)

var (
	rngMu sync.Mutex
	rng   = rand.New(rand.NewSource(time.Now().UnixNano()))
)

// SeedRandom makes service randomness reproducible for tests.
func SeedRandom(seed int64) {
	rngMu.Lock()
	defer rngMu.Unlock()
	rng = rand.New(rand.NewSource(seed))
}

// Chance returns true pct% of the time.
func Chance(pct int) bool {
	if pct <= 0 {
		return false
	}
	if pct >= 100 {
		return true
	}
	rngMu.Lock()
	defer rngMu.Unlock()
	return rng.Intn(100) < pct
}

// Jitter returns a random duration in [minMs, maxMs] milliseconds.
func Jitter(minMs, maxMs int) time.Duration {
	if maxMs <= minMs {
		return time.Duration(minMs) * time.Millisecond
	}
	rngMu.Lock()
	n := minMs + rng.Intn(maxMs-minMs+1)
	rngMu.Unlock()
	return time.Duration(n) * time.Millisecond
}

// Sleep is a context-aware sleep so shutdown never blocks on simulated delay.
func Sleep(ctx context.Context, d time.Duration) {
	if d <= 0 {
		return
	}
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
	case <-t.C:
	}
}

// PublishDeliveryFailure sends a notification-delivery failure to the
// dead-letter topic. Retrying it later from the DLQ UI performs a real
// re-delivery attempt through the notification service.
func (s *Service) PublishDeliveryFailure(ctx context.Context, tc tracectx.Context, orderID, reason string, retries int) {
	now := time.Now().UTC()
	payload, _ := json.Marshal(map[string]string{"orderId": orderID, "channel": "email", "sessionId": tc.SessionID})
	env := deadletter.Envelope{
		ID: tracectx.NewTraceID(), Kind: deadletter.KindNotificationDelivery,
		SessionID: tc.SessionID, TraceID: tc.TraceID,
		SourceTopic: "queue:notifications", OriginalPayload: string(payload),
		FailureReason: reason, FirstFailureAt: now, LastFailureAt: now,
		RetryCount: retries, Status: deadletter.StatusFailed,
	}
	raw, err := json.Marshal(env)
	if err != nil {
		s.Log.Error("encode dead-letter envelope", "error", err)
		return
	}
	s.Producer.Publish(ctx, events.TopicDeadLetter, env.ID, raw)
}
