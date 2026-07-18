// Package events defines the versioned telemetry event schema shared by every
// PulseGrid producer and consumer. The TypeScript mirror of this schema lives
// in packages/event-schemas; the two are kept in lockstep via SchemaVersion.
package events

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

// SchemaVersion is bumped whenever a breaking change is made to TelemetryEvent.
const SchemaVersion = "1.0"

// Topic names. Centralized so producers and consumers never drift.
const (
	TopicTelemetryRaw       = "pulsegrid.telemetry.raw"
	TopicTelemetryProcessed = "pulsegrid.telemetry.processed"
	TopicAlerts             = "pulsegrid.alerts"
	TopicIncidents          = "pulsegrid.incidents"
	TopicDeadLetter         = "pulsegrid.deadletter"
)

// EventType enumerates the telemetry event categories PulseGrid understands.
type EventType string

const (
	EventRequest      EventType = "request"       // an inbound HTTP request handled by a service
	EventDependency   EventType = "dependency"    // an outbound call to a downstream service
	EventQueuePublish EventType = "queue_publish" // a message enqueued to an internal work queue
	EventQueueConsume EventType = "queue_consume" // a message dequeued from an internal work queue
	EventHealthProbe  EventType = "health_probe"  // a synthetic health-check observation
)

// Status enumerates request outcomes.
type Status string

const (
	StatusOK      Status = "ok"
	StatusError   Status = "error"
	StatusTimeout Status = "timeout"
	StatusSkipped Status = "skipped"
)

// TelemetryEvent is the wire format for every telemetry record flowing through
// Redpanda. Fields intentionally mirror packages/event-schemas/src/telemetry.ts.
type TelemetryEvent struct {
	EventID          string            `json:"eventId"`
	EventVersion     string            `json:"eventVersion"`
	SessionID        string            `json:"sessionId"`
	TraceID          string            `json:"traceId"`
	SpanID           string            `json:"spanId"`
	ParentSpanID     string            `json:"parentSpanId,omitempty"`
	ServiceName      string            `json:"serviceName"`
	ServiceInstance  string            `json:"serviceInstance"`
	Environment      string            `json:"environment"`
	Region           string            `json:"region"`
	EventType        EventType         `json:"eventType"`
	Endpoint         string            `json:"endpoint"`
	HTTPMethod       string            `json:"httpMethod,omitempty"`
	Status           Status            `json:"status"`
	StatusCode       int               `json:"statusCode,omitempty"`
	DurationMs       float64           `json:"durationMs"`
	Timestamp        time.Time         `json:"timestamp"`
	ErrorType        string            `json:"errorType,omitempty"`
	ErrorMessage     string            `json:"errorMessage,omitempty"`
	RetryCount       int               `json:"retryCount"`
	QueueName        string            `json:"queueName,omitempty"`
	PayloadSizeBytes int               `json:"payloadSizeBytes"`
	Metadata         map[string]string `json:"metadata,omitempty"`
}

// ValidationError describes one failed validation rule for a telemetry event.
type ValidationError struct {
	Field  string `json:"field"`
	Reason string `json:"reason"`
}

func (v ValidationError) Error() string { return fmt.Sprintf("%s: %s", v.Field, v.Reason) }

var validEventTypes = map[EventType]bool{
	EventRequest: true, EventDependency: true, EventQueuePublish: true,
	EventQueueConsume: true, EventHealthProbe: true,
}

var validStatuses = map[Status]bool{
	StatusOK: true, StatusError: true, StatusTimeout: true, StatusSkipped: true,
}

// Validate applies every schema rule and returns the full list of violations.
// Consumers must treat a non-empty result as a dead-letter condition, never a
// crash condition.
func Validate(e *TelemetryEvent) []ValidationError {
	var errs []ValidationError
	req := func(field, val string) {
		if strings.TrimSpace(val) == "" {
			errs = append(errs, ValidationError{field, "required field is empty"})
		}
	}
	req("eventId", e.EventID)
	req("sessionId", e.SessionID)
	req("traceId", e.TraceID)
	req("spanId", e.SpanID)
	req("serviceName", e.ServiceName)
	req("endpoint", e.Endpoint)

	if e.EventVersion != SchemaVersion {
		errs = append(errs, ValidationError{"eventVersion", fmt.Sprintf("unsupported version %q (expected %q)", e.EventVersion, SchemaVersion)})
	}
	if !validEventTypes[e.EventType] {
		errs = append(errs, ValidationError{"eventType", fmt.Sprintf("unknown event type %q", e.EventType)})
	}
	if !validStatuses[e.Status] {
		errs = append(errs, ValidationError{"status", fmt.Sprintf("unknown status %q", e.Status)})
	}
	if e.DurationMs < 0 {
		errs = append(errs, ValidationError{"durationMs", "must be >= 0"})
	}
	if e.RetryCount < 0 {
		errs = append(errs, ValidationError{"retryCount", "must be >= 0"})
	}
	if e.PayloadSizeBytes < 0 {
		errs = append(errs, ValidationError{"payloadSizeBytes", "must be >= 0"})
	}
	if e.Timestamp.IsZero() {
		errs = append(errs, ValidationError{"timestamp", "missing or zero timestamp"})
	} else if e.Timestamp.After(time.Now().Add(5 * time.Minute)) {
		errs = append(errs, ValidationError{"timestamp", "timestamp is unreasonably far in the future"})
	}
	if e.Status == StatusError && e.ErrorType == "" {
		errs = append(errs, ValidationError{"errorType", "errorType is required when status is error"})
	}
	return errs
}

// Decode unmarshals raw bytes into a TelemetryEvent without validating it.
// Validation is a separate, explicit step so malformed-but-parseable events can
// still be routed to the dead-letter queue with full context.
func Decode(raw []byte) (*TelemetryEvent, error) {
	var e TelemetryEvent
	if err := json.Unmarshal(raw, &e); err != nil {
		return nil, fmt.Errorf("decode telemetry event: %w", err)
	}
	return &e, nil
}

// Encode marshals an event for publication.
func Encode(e *TelemetryEvent) ([]byte, error) {
	return json.Marshal(e)
}
