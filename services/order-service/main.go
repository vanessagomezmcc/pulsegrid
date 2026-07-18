// order-service persists a synthetic order (Redis-backed, deliberately) and
// hands the confirmation off to notification-service. The Order DB Delay
// scenario slows the real persistence step.
package main

import (
	"context"
	"log"
	"net/http"
	"time"

	"github.com/pulsegrid/pulsegrid/go/shared/events"
	"github.com/pulsegrid/pulsegrid/go/shared/failure"
	"github.com/pulsegrid/pulsegrid/go/shared/simcore"
	"github.com/pulsegrid/pulsegrid/go/shared/tracectx"
)

type orderRequest struct {
	AmountCents int    `json:"amountCents"`
	PaymentRef  string `json:"paymentRef"`
}

func main() {
	cfg := simcore.LoadConfig("order-service", "7103")
	svc, err := simcore.New(cfg)
	if err != nil {
		log.Fatalf("order-service startup: %v", err)
	}

	svc.Route(http.MethodPost, "/api/orders", func(ctx context.Context, tc tracectx.Context, f failure.Flags, body []byte) simcore.Outcome {
		req, err := decode[orderRequest](body)
		if err != nil || req.PaymentRef == "" {
			return simcore.Outcome{Status: events.StatusError, StatusCode: 400, ErrorType: "bad_request", ErrorMessage: "invalid order payload"}
		}

		orderID := "ord_" + tc.SpanID

		// Real persistence of the synthetic order, with scenario-injected DB delay.
		simcore.Sleep(ctx, simcore.Jitter(15, 60))
		if f.OrderDBDelayMs > 0 {
			simcore.Sleep(ctx, time.Duration(f.OrderDBDelayMs)*time.Millisecond)
		}
		persistStart := time.Now()
		err = svc.Redis.HSet(ctx, "pulsegrid:orders:"+tc.SessionID, orderID, req.PaymentRef).Err()
		svc.Redis.Expire(ctx, "pulsegrid:orders:"+tc.SessionID, 30*time.Minute)
		if err != nil {
			return simcore.Outcome{Status: events.StatusError, StatusCode: 500, ErrorType: "persistence_error", ErrorMessage: "order store write failed"}
		}
		_ = persistStart

		// Notify downstream. A notification failure must NOT fail the order:
		// retry once, then publish a delivery-failure to the dead-letter path.
		outcome := simcore.Outcome{Status: events.StatusOK, StatusCode: 201, Body: map[string]string{"orderId": orderID}, Metadata: map[string]string{"paymentRef": req.PaymentRef}}
		var lastErr string
		for attempt := 0; attempt <= 1; attempt++ {
			code, err := svc.CallDownstream(ctx, tc, "/api/notifications", map[string]any{"orderId": orderID, "channel": "email"}, 4*time.Second)
			if err == nil && code < 400 {
				lastErr = ""
				break
			}
			outcome.RetryCount = attempt + 1
			if err != nil {
				lastErr = err.Error()
			} else {
				lastErr = "notification service returned " + itoa(code)
			}
			simcore.Sleep(ctx, 150*time.Millisecond)
		}
		if lastErr != "" {
			outcome.Metadata["notificationDelivery"] = "failed"
			svc.PublishDeliveryFailure(ctx, tc, orderID, lastErr, outcome.RetryCount)
		}
		return outcome
	})

	if err := svc.Serve(); err != nil {
		log.Fatal(err)
	}
}
