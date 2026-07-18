// Package correlate produces evidence-based root-cause hints for incidents.
//
// Method (fully deterministic, no LLM): given the static service dependency
// graph and the timestamp at which each service first entered a non-healthy
// state during the incident window, the earliest-degraded service that is a
// (transitive) dependency of the other degraded services is the most likely
// origin. Ties break toward the most-upstream node.
package correlate

import (
	"fmt"
	"sort"
	"time"
)

// Degradation records when a service first left the healthy state.
type Degradation struct {
	ServiceName string
	State       string // degraded | critical | offline
	At          time.Time
}

// Graph maps service -> its direct downstream dependents
// (e.g. payment -> [order] because order depends on payment's success).
type Graph map[string][]string

// DefaultGraph mirrors the simulated request flow:
// auth -> payment -> order -> notification.
var DefaultGraph = Graph{
	"auth-service":         {"payment-service"},
	"payment-service":      {"order-service"},
	"order-service":        {"notification-service"},
	"notification-service": {},
}

// reachable returns every service transitively downstream of start.
func (g Graph) reachable(start string) map[string]bool {
	seen := map[string]bool{}
	stack := []string{start}
	for len(stack) > 0 {
		cur := stack[len(stack)-1]
		stack = stack[:len(stack)-1]
		for _, next := range g[cur] {
			if !seen[next] {
				seen[next] = true
				stack = append(stack, next)
			}
		}
	}
	return seen
}

// RootCause identifies the earliest correlated degraded dependency and renders
// a human-readable, evidence-based hint. Returns ok=false when there is no
// degradation to explain.
func RootCause(g Graph, degradations []Degradation) (service string, hint string, ok bool) {
	if len(degradations) == 0 {
		return "", "", false
	}
	sorted := make([]Degradation, len(degradations))
	copy(sorted, degradations)
	sort.Slice(sorted, func(i, j int) bool { return sorted[i].At.Before(sorted[j].At) })

	first := sorted[0]
	downstream := g.reachable(first.ServiceName)

	var affected []string
	for _, d := range sorted[1:] {
		if downstream[d.ServiceName] {
			affected = append(affected, fmt.Sprintf("%s (%s +%s)", d.ServiceName, d.State, d.At.Sub(first.At).Round(time.Second)))
		}
	}

	if len(affected) > 0 {
		hint = fmt.Sprintf(
			"%s entered %s state first (%s). Downstream dependencies degraded afterwards: %s. %s is the earliest correlated degraded dependency and the most likely origin.",
			first.ServiceName, first.State, first.At.UTC().Format(time.RFC3339), joinComma(affected), first.ServiceName,
		)
	} else {
		hint = fmt.Sprintf(
			"%s entered %s state at %s with no correlated downstream degradation, indicating an isolated fault in %s.",
			first.ServiceName, first.State, first.At.UTC().Format(time.RFC3339), first.ServiceName,
		)
	}
	return first.ServiceName, hint, true
}

func joinComma(parts []string) string {
	out := ""
	for i, p := range parts {
		if i > 0 {
			out += ", "
		}
		out += p
	}
	return out
}
