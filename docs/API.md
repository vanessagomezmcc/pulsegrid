# Control-plane API

Base URL `http://localhost:4000`. Interactive Swagger at `/docs`.
All `/api/*` endpoints except session creation require the `x-pulsegrid-session` header; scoping
is enforced server-side on every query. Global limit 120 req/min/IP plus per-action session
limits noted below.

| Method & path | Purpose | Limits |
|---|---|---|
| POST /api/demo/sessions | create sandbox | 5/min/IP |
| GET /api/demo/sessions/:id · POST :id/reset · DELETE :id | inspect / wipe / destroy own session | — |
| GET /api/services · /:id · /:id/metrics?minutes=15 | live state + snapshot history | — |
| GET /api/traces?status&service&minDurationMs&limit · /:id | trace list + spans | — |
| GET /api/alerts?state · /rules · /:id | alert occurrences & rules | — |
| POST /api/alerts/:id/acknowledge | firing → acknowledged (audited) | 20/min |
| GET /api/incidents · /:id | incidents + timeline | — |
| GET /api/events?service&status&eventType | raw event backfill | — |
| GET /api/dead-letter?status&kind · /:id | DLQ inspection | — |
| POST /api/dead-letter/:id/retry | **real** retry (re-deliver / re-publish) | 10/min |
| POST /api/dead-letter/:id/discard | mark discarded (audited) | — |
| GET /api/simulation/scenarios · /state | catalog + current flags/runs | — |
| POST /api/simulation/scenarios/:id/start {intensity} | activate scenario | 10/min |
| POST /api/simulation/stop | full recovery | — |
| GET /healthz · /readyz · /metrics | ops endpoints | — |

## WebSocket `/ws`

Send `{"type":"subscribe","sessionId":"sess-..."}` once. Messages:
`{type: metrics|health|alert|incident|trace|event|dlq|scenario, sessionId, at, payload}` —
only your session's messages are delivered.
