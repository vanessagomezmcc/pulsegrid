// auth-service validates synthetic user sessions and forwards successful
// checkouts to the payment service. First hop of the simulated chain.
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

type authRequest struct {
	SessionToken string `json:"sessionToken"`
	Flow         string `json:"flow"` // "login" | "checkout"
	AmountCents  int    `json:"amountCents"`
}

func main() {
	cfg := simcore.LoadConfig("auth-service", "7101")
	svc, err := simcore.New(cfg)
	if err != nil {
		log.Fatalf("auth-service startup: %v", err)
	}

	svc.Route(http.MethodPost, "/api/sessions/validate", func(ctx context.Context, tc tracectx.Context, f failure.Flags, body []byte) simcore.Outcome {
		req, err := decode[authRequest](body)
		if err != nil {
			return simcore.Outcome{Status: events.StatusError, StatusCode: 400, ErrorType: "bad_request", ErrorMessage: "malformed auth payload"}
		}

		// Baseline auth work: token lookup + validation (5-25ms).
		simcore.Sleep(ctx, simcore.Jitter(5, 25))

		// Tokens prefixed "invalid-" are the traffic generator's expected-error
		// share; they are rejected as a real 401.
		if len(req.SessionToken) < 8 || req.SessionToken[:8] == "invalid-" {
			return simcore.Outcome{
				Status: events.StatusError, StatusCode: 401,
				ErrorType: "invalid_session", ErrorMessage: "session token rejected",
				Metadata: map[string]string{"flow": req.Flow},
			}
		}

		if req.Flow == "login" {
			return simcore.Outcome{Status: events.StatusOK, StatusCode: 200, Body: map[string]string{"userId": "user-" + req.SessionToken[8:14]}, Metadata: map[string]string{"flow": "login"}}
		}

		// Checkout: forward to payment-service with propagated trace context.
		code, err := svc.CallDownstream(ctx, tc, "/api/payments", map[string]any{"amountCents": req.AmountCents, "currency": "USD"}, 6*time.Second)
		if err != nil {
			return simcore.Outcome{Status: events.StatusError, StatusCode: 502, ErrorType: "payment_unreachable", ErrorMessage: "payment service call failed", Metadata: map[string]string{"flow": "checkout"}}
		}
		if code >= 400 {
			return simcore.Outcome{Status: events.StatusError, StatusCode: 502, ErrorType: "payment_failed", ErrorMessage: "payment declined downstream", Metadata: map[string]string{"flow": "checkout"}}
		}
		return simcore.Outcome{Status: events.StatusOK, StatusCode: 200, Body: map[string]string{"result": "checkout-complete"}, Metadata: map[string]string{"flow": "checkout"}}
	})

	if err := svc.Serve(); err != nil {
		log.Fatal(err)
	}
}
