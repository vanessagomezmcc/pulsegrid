// payment-service processes synthetic payments. Scenario flags inject real
// latency, real failures, and real timeouts here — the dashboard only ever
// reflects measured behavior.
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

type paymentRequest struct {
	AmountCents int    `json:"amountCents"`
	Currency    string `json:"currency"`
}

func main() {
	cfg := simcore.LoadConfig("payment-service", "7102")
	svc, err := simcore.New(cfg)
	if err != nil {
		log.Fatalf("payment-service startup: %v", err)
	}

	svc.Route(http.MethodPost, "/api/payments", func(ctx context.Context, tc tracectx.Context, f failure.Flags, body []byte) simcore.Outcome {
		req, err := decode[paymentRequest](body)
		if err != nil || req.AmountCents <= 0 {
			return simcore.Outcome{Status: events.StatusError, StatusCode: 400, ErrorType: "bad_request", ErrorMessage: "invalid payment payload"}
		}

		// Baseline processor latency 40-120ms + scenario-injected latency.
		simcore.Sleep(ctx, simcore.Jitter(40, 120))
		if f.PaymentExtraLatencyMs > 0 {
			simcore.Sleep(ctx, time.Duration(f.PaymentExtraLatencyMs)*time.Millisecond)
		}

		// Scenario-injected timeout: hang past any sane client timeout.
		if simcore.Chance(f.PaymentTimeoutRatePct) {
			simcore.Sleep(ctx, 10*time.Second)
			return simcore.Outcome{Status: events.StatusTimeout, StatusCode: 504, ErrorType: "gateway_timeout", ErrorMessage: "payment processor timed out"}
		}

		// Scenario-injected failures plus a small realistic baseline (1%).
		if simcore.Chance(f.PaymentFailureRatePct) || simcore.Chance(1) {
			return simcore.Outcome{Status: events.StatusError, StatusCode: 502, ErrorType: "payment_declined", ErrorMessage: "synthetic processor declined the charge", Metadata: map[string]string{"amountCents": itoa(req.AmountCents)}}
		}

		code, err := svc.CallDownstream(ctx, tc, "/api/orders", map[string]any{"amountCents": req.AmountCents, "paymentRef": "pay_" + tc.SpanID}, 6*time.Second)
		if err != nil || code >= 400 {
			return simcore.Outcome{Status: events.StatusError, StatusCode: 502, ErrorType: "order_failed", ErrorMessage: "order creation failed downstream"}
		}
		return simcore.Outcome{Status: events.StatusOK, StatusCode: 200, Body: map[string]string{"paymentRef": "pay_" + tc.SpanID}, Metadata: map[string]string{"amountCents": itoa(req.AmountCents)}}
	})

	if err := svc.Serve(); err != nil {
		log.Fatal(err)
	}
}
