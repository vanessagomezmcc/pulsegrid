package tracectx

import (
	"net/http/httptest"
	"testing"
)

func TestInjectExtractPropagatesTrace(t *testing.T) {
	root := StartRoot("sess-1")
	req := httptest.NewRequest("POST", "http://x/api", nil)
	Inject(req, root)

	got := Extract(req)
	if got.TraceID != root.TraceID {
		t.Fatalf("trace id lost: %s vs %s", got.TraceID, root.TraceID)
	}
	if got.ParentSpanID != root.SpanID {
		t.Fatalf("parent span mismatch")
	}
	if got.SpanID == root.SpanID {
		t.Fatalf("new hop must mint a new span id")
	}
	if got.SessionID != "sess-1" {
		t.Fatalf("session lost")
	}
}

func TestExtractWithoutHeaderStartsRoot(t *testing.T) {
	req := httptest.NewRequest("POST", "http://x/api", nil)
	got := Extract(req)
	if len(got.TraceID) != 32 || len(got.SpanID) != 16 {
		t.Fatalf("bad root ids: %+v", got)
	}
	if got.ParentSpanID != "" {
		t.Fatalf("root must have no parent")
	}
}

func TestParseRejectsMalformed(t *testing.T) {
	bad := []string{"", "00-short-short-01", "xx-yy", "00-" + string(make([]byte, 32)) + "-1234567890abcdef-01",
		"00-00000000000000000000000000000000-0000000000000000-01"}
	for _, tp := range bad {
		if _, _, ok := Parse(tp); ok {
			t.Fatalf("accepted malformed traceparent %q", tp)
		}
	}
	c := StartRoot("s")
	if id, span, ok := Parse(c.Traceparent()); !ok || id != c.TraceID || span != c.SpanID {
		t.Fatalf("failed to parse own traceparent")
	}
}
