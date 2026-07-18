// Package promtext is a small, dependency-free Prometheus metrics registry
// that renders the text exposition format (v0.0.4). PulseGrid's Go components
// use it to expose counters, gauges, and latency histograms on /metrics for
// the bundled Prometheus + Grafana stack.
//
// Deliberate scope: only the metric shapes PulseGrid needs. The official
// client_golang library pulls in a transitive dependency tree that is not
// required for this project's exposition needs.
package promtext

import (
	"fmt"
	"net/http"
	"sort"
	"strings"
	"sync"
)

// Registry holds named metrics and renders them for scraping.
type Registry struct {
	mu         sync.RWMutex
	counters   map[string]*Counter
	gauges     map[string]*Gauge
	histograms map[string]*Histogram
	help       map[string]string
	types      map[string]string
}

func NewRegistry() *Registry {
	return &Registry{
		counters:   map[string]*Counter{},
		gauges:     map[string]*Gauge{},
		histograms: map[string]*Histogram{},
		help:       map[string]string{},
		types:      map[string]string{},
	}
}

// Counter is a monotonically increasing metric with optional label sets.
type Counter struct {
	mu   sync.Mutex
	vals map[string]float64 // rendered label string -> value
}

// Gauge is a metric that can go up and down.
type Gauge struct {
	mu   sync.Mutex
	vals map[string]float64
}

// Histogram tracks observations in cumulative buckets plus sum and count.
type Histogram struct {
	mu      sync.Mutex
	bounds  []float64
	buckets map[string][]uint64
	sums    map[string]float64
	counts  map[string]uint64
}

// Labels renders a label map deterministically: {a="1",b="2"}.
func Labels(kv map[string]string) string {
	if len(kv) == 0 {
		return ""
	}
	keys := make([]string, 0, len(kv))
	for k := range kv {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	parts := make([]string, 0, len(keys))
	for _, k := range keys {
		parts = append(parts, fmt.Sprintf("%s=%q", k, kv[k]))
	}
	return "{" + strings.Join(parts, ",") + "}"
}

func (r *Registry) Counter(name, help string) *Counter {
	r.mu.Lock()
	defer r.mu.Unlock()
	if c, ok := r.counters[name]; ok {
		return c
	}
	c := &Counter{vals: map[string]float64{}}
	r.counters[name] = c
	r.help[name] = help
	r.types[name] = "counter"
	return c
}

func (r *Registry) Gauge(name, help string) *Gauge {
	r.mu.Lock()
	defer r.mu.Unlock()
	if g, ok := r.gauges[name]; ok {
		return g
	}
	g := &Gauge{vals: map[string]float64{}}
	r.gauges[name] = g
	r.help[name] = help
	r.types[name] = "gauge"
	return g
}

// DefaultLatencyBuckets suit millisecond request latencies.
var DefaultLatencyBuckets = []float64{5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000}

func (r *Registry) Histogram(name, help string, bounds []float64) *Histogram {
	r.mu.Lock()
	defer r.mu.Unlock()
	if h, ok := r.histograms[name]; ok {
		return h
	}
	if bounds == nil {
		bounds = DefaultLatencyBuckets
	}
	h := &Histogram{bounds: bounds, buckets: map[string][]uint64{}, sums: map[string]float64{}, counts: map[string]uint64{}}
	r.histograms[name] = h
	r.help[name] = help
	r.types[name] = "histogram"
	return h
}

func (c *Counter) Add(labels map[string]string, v float64) {
	l := Labels(labels)
	c.mu.Lock()
	c.vals[l] += v
	c.mu.Unlock()
}

func (c *Counter) Inc(labels map[string]string) { c.Add(labels, 1) }

func (g *Gauge) Set(labels map[string]string, v float64) {
	l := Labels(labels)
	g.mu.Lock()
	g.vals[l] = v
	g.mu.Unlock()
}

func (h *Histogram) Observe(labels map[string]string, v float64) {
	l := Labels(labels)
	h.mu.Lock()
	defer h.mu.Unlock()
	b, ok := h.buckets[l]
	if !ok {
		b = make([]uint64, len(h.bounds))
		h.buckets[l] = b
	}
	for i, bound := range h.bounds {
		if v <= bound {
			b[i]++
		}
	}
	h.sums[l] += v
	h.counts[l]++
}

// Render produces the full exposition document.
func (r *Registry) Render() string {
	r.mu.RLock()
	defer r.mu.RUnlock()
	var sb strings.Builder
	names := make([]string, 0, len(r.types))
	for n := range r.types {
		names = append(names, n)
	}
	sort.Strings(names)
	for _, name := range names {
		fmt.Fprintf(&sb, "# HELP %s %s\n# TYPE %s %s\n", name, r.help[name], name, r.types[name])
		switch r.types[name] {
		case "counter":
			c := r.counters[name]
			c.mu.Lock()
			writeVals(&sb, name, c.vals)
			c.mu.Unlock()
		case "gauge":
			g := r.gauges[name]
			g.mu.Lock()
			writeVals(&sb, name, g.vals)
			g.mu.Unlock()
		case "histogram":
			h := r.histograms[name]
			h.mu.Lock()
			ls := make([]string, 0, len(h.counts))
			for l := range h.counts {
				ls = append(ls, l)
			}
			sort.Strings(ls)
			for _, l := range ls {
				for i, bound := range h.bounds {
					fmt.Fprintf(&sb, "%s_bucket%s %d\n", name, mergeLabel(l, fmt.Sprintf(`le="%g"`, bound)), h.buckets[l][i])
				}
				fmt.Fprintf(&sb, "%s_bucket%s %d\n", name, mergeLabel(l, `le="+Inf"`), h.counts[l])
				fmt.Fprintf(&sb, "%s_sum%s %g\n", name, l, h.sums[l])
				fmt.Fprintf(&sb, "%s_count%s %d\n", name, l, h.counts[l])
			}
			h.mu.Unlock()
		}
	}
	return sb.String()
}

func writeVals(sb *strings.Builder, name string, vals map[string]float64) {
	ls := make([]string, 0, len(vals))
	for l := range vals {
		ls = append(ls, l)
	}
	sort.Strings(ls)
	for _, l := range ls {
		fmt.Fprintf(sb, "%s%s %g\n", name, l, vals[l])
	}
}

func mergeLabel(existing, extra string) string {
	if existing == "" {
		return "{" + extra + "}"
	}
	return strings.TrimSuffix(existing, "}") + "," + extra + "}"
}

// Handler serves the registry over HTTP.
func (r *Registry) Handler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
		_, _ = w.Write([]byte(r.Render()))
	})
}
