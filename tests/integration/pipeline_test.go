// Package integration verifies the running pipeline end-to-end.
// Gated behind PULSEGRID_INTEGRATION=1 because it needs docker compose up.
package integration

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"testing"
	"time"

	"github.com/twmb/franz-go/pkg/kgo"
)

func gate(t *testing.T) {
	t.Helper()
	if os.Getenv("PULSEGRID_INTEGRATION") != "1" {
		t.Skip("set PULSEGRID_INTEGRATION=1 with the stack running to enable")
	}
}

func apiBase() string {
	if v := os.Getenv("API_URL"); v != "" {
		return v
	}
	return "http://localhost:4000"
}

func createSession(t *testing.T) string {
	t.Helper()
	res, err := http.Post(apiBase()+"/api/demo/sessions", "application/json", nil)
	if err != nil {
		t.Fatalf("create session: %v", err)
	}
	defer res.Body.Close()
	var body struct {
		ID string `json:"id"`
	}
	if err := json.NewDecoder(res.Body).Decode(&body); err != nil || body.ID == "" {
		t.Fatalf("bad session response: %v", err)
	}
	return body.ID
}

func get(t *testing.T, session, path string, out any) int {
	t.Helper()
	req, _ := http.NewRequest(http.MethodGet, apiBase()+path, nil)
	req.Header.Set("x-pulsegrid-session", session)
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("GET %s: %v", path, err)
	}
	defer res.Body.Close()
	if out != nil {
		_ = json.NewDecoder(res.Body).Decode(out)
	}
	return res.StatusCode
}

// TestAPIReady confirms the control plane reports its dependencies healthy.
func TestAPIReady(t *testing.T) {
	gate(t)
	res, err := http.Get(apiBase() + "/readyz")
	if err != nil || res.StatusCode != 200 {
		t.Fatalf("readyz failed: err=%v status=%v", err, res)
	}
}

// TestTelemetryFlow publishes a valid event straight to the raw topic and
// waits for it to surface through processor → PostgreSQL → API.
func TestTelemetryFlow(t *testing.T) {
	gate(t)
	session := createSession(t)
	brokers := os.Getenv("KAFKA_BROKERS")
	if brokers == "" {
		brokers = "localhost:19092"
	}
	cl, err := kgo.NewClient(kgo.SeedBrokers(brokers))
	if err != nil {
		t.Fatalf("kafka client: %v", err)
	}
	defer cl.Close()

	eventID := fmt.Sprintf("evt-int-%d", time.Now().UnixNano())
	now := time.Now().UTC()
	payload := map[string]any{
		"eventId": eventID, "eventVersion": "1.0", "sessionId": session,
		"traceId": fmt.Sprintf("%032x", time.Now().UnixNano()), "spanId": fmt.Sprintf("%016x", time.Now().UnixNano()),
		"serviceName": "payment-service", "instanceId": "int-test-1",
		"eventType": "http_request", "endpoint": "POST /api/payments",
		"status": "ok", "statusCode": 200, "durationMs": 42.5,
		"startedAt": now.Add(-50 * time.Millisecond).Format(time.RFC3339Nano),
		"ts":        now.Format(time.RFC3339Nano),
		"metadata":  map[string]any{"environment": "demo", "region": "local"},
	}
	raw, _ := json.Marshal(payload)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := cl.ProduceSync(ctx, &kgo.Record{Topic: "pulsegrid.telemetry.raw", Key: []byte(session), Value: raw}).FirstErr(); err != nil {
		t.Fatalf("produce: %v", err)
	}

	deadline := time.Now().Add(45 * time.Second)
	for time.Now().Before(deadline) {
		var events []map[string]any
		get(t, session, "/api/events?service=payment-service&limit=200", &events)
		for _, e := range events {
			if e["eventId"] == eventID {
				return // made it through the whole pipeline
			}
		}
		time.Sleep(2 * time.Second)
	}
	t.Fatalf("event %s never appeared via the API", eventID)
}

// TestSessionIsolation confirms one session cannot read another's scoping.
func TestSessionIsolation(t *testing.T) {
	gate(t)
	a := createSession(t)
	req, _ := http.NewRequest(http.MethodGet, apiBase()+"/api/demo/sessions/"+a, bytes.NewReader(nil))
	req.Header.Set("x-pulsegrid-session", createSession(t)) // different session header
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("request: %v", err)
	}
	if res.StatusCode != http.StatusForbidden {
		t.Fatalf("expected 403 cross-session read, got %d", res.StatusCode)
	}
}
