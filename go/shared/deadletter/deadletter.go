// Package deadletter defines the envelope shared by everything that publishes
// to or consumes from the dead-letter topic. Two producers exist today:
// the telemetry processor (schema-invalid telemetry) and order/notification
// services (notification delivery failures).
package deadletter

import "time"

type Kind string

const (
	KindInvalidTelemetry     Kind = "invalid_telemetry"
	KindNotificationDelivery Kind = "notification_delivery"
)

type Status string

const (
	StatusFailed    Status = "failed"
	StatusRetrying  Status = "retrying"
	StatusResolved  Status = "resolved"
	StatusDiscarded Status = "discarded"
)

// Envelope is the wire + storage shape of one dead-letter record.
type Envelope struct {
	ID              string    `json:"id"`
	Kind            Kind      `json:"kind"`
	SessionID       string    `json:"sessionId"`
	TraceID         string    `json:"traceId,omitempty"`
	SourceTopic     string    `json:"sourceTopic"`
	OriginalPayload string    `json:"originalPayload"`
	ValidationErrs  []string  `json:"validationErrors,omitempty"`
	FailureReason   string    `json:"failureReason"`
	FirstFailureAt  time.Time `json:"firstFailureAt"`
	LastFailureAt   time.Time `json:"lastFailureAt"`
	RetryCount      int       `json:"retryCount"`
	Status          Status    `json:"status"`
}
