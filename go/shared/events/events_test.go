package events

import (
	"testing"
	"time"
)

func valid() *TelemetryEvent {
	return &TelemetryEvent{
		EventID: "e1", EventVersion: SchemaVersion, SessionID: "s1", TraceID: "t1", SpanID: "sp1",
		ServiceName: "payment-service", ServiceInstance: "i1", Environment: "test", Region: "local",
		EventType: EventRequest, Endpoint: "/api/payments", HTTPMethod: "POST",
		Status: StatusOK, StatusCode: 200, DurationMs: 12.5, Timestamp: time.Now().UTC(),
	}
}

func TestValidatePasses(t *testing.T) {
	if errs := Validate(valid()); len(errs) != 0 {
		t.Fatalf("expected no errors, got %v", errs)
	}
}

func TestValidateCatchesEveryRule(t *testing.T) {
	cases := []struct {
		name  string
		mut   func(*TelemetryEvent)
		field string
	}{
		{"missing eventId", func(e *TelemetryEvent) { e.EventID = "" }, "eventId"},
		{"missing traceId", func(e *TelemetryEvent) { e.TraceID = " " }, "traceId"},
		{"bad version", func(e *TelemetryEvent) { e.EventVersion = "0.9" }, "eventVersion"},
		{"bad type", func(e *TelemetryEvent) { e.EventType = "nope" }, "eventType"},
		{"bad status", func(e *TelemetryEvent) { e.Status = "meh" }, "status"},
		{"negative duration", func(e *TelemetryEvent) { e.DurationMs = -1 }, "durationMs"},
		{"negative retries", func(e *TelemetryEvent) { e.RetryCount = -2 }, "retryCount"},
		{"zero timestamp", func(e *TelemetryEvent) { e.Timestamp = time.Time{} }, "timestamp"},
		{"future timestamp", func(e *TelemetryEvent) { e.Timestamp = time.Now().Add(time.Hour) }, "timestamp"},
		{"error without type", func(e *TelemetryEvent) { e.Status = StatusError; e.ErrorType = "" }, "errorType"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			e := valid()
			c.mut(e)
			errs := Validate(e)
			found := false
			for _, err := range errs {
				if err.Field == c.field {
					found = true
				}
			}
			if !found {
				t.Fatalf("expected violation on %q, got %v", c.field, errs)
			}
		})
	}
}

func TestDecodeRoundTrip(t *testing.T) {
	e := valid()
	raw, err := Encode(e)
	if err != nil {
		t.Fatal(err)
	}
	got, err := Decode(raw)
	if err != nil {
		t.Fatal(err)
	}
	if got.EventID != e.EventID || got.TraceID != e.TraceID || got.DurationMs != e.DurationMs {
		t.Fatalf("round trip mismatch: %+v", got)
	}
}

func TestDecodeRejectsGarbage(t *testing.T) {
	if _, err := Decode([]byte("{not json")); err == nil {
		t.Fatal("expected decode error")
	}
}
