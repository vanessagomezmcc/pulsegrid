# Testing

| Layer | Tool | Where | Needs infra? |
|---|---|---|---|
| Go shared packages | `go test` | `go/shared/*/_test.go` | no |
| Event schemas | vitest + zod | `packages/event-schemas` | no |
| Pipeline integration | `go test` (gated) | `tests/integration` | yes |
| End-to-end flows | Playwright | `tests/e2e` | yes |
| Load baseline | k6 | `tests/load` | yes |

Unit tests cover the deterministic cores: alert state machine (incl. flap-prevention), health
thresholds, W3C traceparent parse/generate round-trips, dependency correlation, failure-flag
scenario mapping, and schema validation edge cases.

Integration tests (`PULSEGRID_INTEGRATION=1`) publish a real event to Redpanda and assert it
emerges through processor → PostgreSQL → API, plus readiness and session-isolation checks.

E2E specs walk the demo's promises: healthy boot; slowdown → firing alert; outage → DLQ →
successful retry after recovery; malformed event → DLQ with validation errors; severe spike →
incident opened → recovery resolves it. They poll patiently because alert `for`-durations are
real time.

CI runs formatting, typechecks, unit tests, and all three Docker builds on every push; the
full-stack e2e job is present but non-blocking (image size), promotable once cached.
