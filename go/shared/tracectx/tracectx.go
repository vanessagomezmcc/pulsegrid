// Package tracectx implements W3C Trace Context propagation (the same wire
// format used by OpenTelemetry) plus span-ID generation. Every simulated
// service uses this package so a single trace ID follows a request across the
// whole dependency chain: auth -> payment -> order -> notification.
package tracectx

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"net/http"
	"strings"
)

// Header is the W3C trace-context header name.
const Header = "traceparent"

// SessionHeader carries the PulseGrid demo-session ID between services.
const SessionHeader = "x-pulsegrid-session"

// Context is the trace context attached to a single hop of a request.
type Context struct {
	TraceID      string
	SpanID       string
	ParentSpanID string
	SessionID    string
}

func randomHex(n int) string {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return strings.Repeat("0", n*2)
	}
	return hex.EncodeToString(b)
}

// NewTraceID returns a 32-hex-char trace ID.
func NewTraceID() string { return randomHex(16) }

// NewSpanID returns a 16-hex-char span ID.
func NewSpanID() string { return randomHex(8) }

// StartRoot creates a fresh root context for a new synthetic request.
func StartRoot(sessionID string) Context {
	return Context{TraceID: NewTraceID(), SpanID: NewSpanID(), SessionID: sessionID}
}

// Child derives a child context: same trace, new span, parent set to current span.
func (c Context) Child() Context {
	return Context{TraceID: c.TraceID, SpanID: NewSpanID(), ParentSpanID: c.SpanID, SessionID: c.SessionID}
}

// Traceparent renders the context in W3C format: version-traceid-spanid-flags.
func (c Context) Traceparent() string {
	return fmt.Sprintf("00-%s-%s-01", c.TraceID, c.SpanID)
}

// Inject writes trace + session headers onto an outbound request.
func Inject(r *http.Request, c Context) {
	r.Header.Set(Header, c.Traceparent())
	r.Header.Set(SessionHeader, c.SessionID)
}

// Extract reads trace context from an inbound request. The extracted span ID
// becomes the parent, and a new span ID is minted for this hop. If no valid
// traceparent is present a new root context is started.
func Extract(r *http.Request) Context {
	session := r.Header.Get(SessionHeader)
	traceID, parentSpan, ok := Parse(r.Header.Get(Header))
	if !ok {
		return StartRoot(session)
	}
	return Context{TraceID: traceID, SpanID: NewSpanID(), ParentSpanID: parentSpan, SessionID: session}
}

// Parse validates a traceparent header and returns (traceID, spanID, ok).
func Parse(tp string) (string, string, bool) {
	parts := strings.Split(tp, "-")
	if len(parts) != 4 || len(parts[1]) != 32 || len(parts[2]) != 16 {
		return "", "", false
	}
	if _, err := hex.DecodeString(parts[1]); err != nil {
		return "", "", false
	}
	if _, err := hex.DecodeString(parts[2]); err != nil {
		return "", "", false
	}
	if parts[1] == strings.Repeat("0", 32) || parts[2] == strings.Repeat("0", 16) {
		return "", "", false
	}
	return parts[1], parts[2], true
}
