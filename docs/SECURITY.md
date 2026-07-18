# Security posture

Scope: a public demo with **no accounts and no real data** — the threat model is abuse and
cross-session interference, not data theft.

- **Session isolation**: random 72-bit session tokens; every DB query and Redis key is scoped
  server-side; the WS gateway fans out only your session's messages; cross-session access
  returns 403 (covered by an integration test).
- **Abuse limits**: 120 req/min/IP globally; 5 sessions/min/IP; 10 scenario starts, 10 DLQ
  retries, 20 acks per session/min; sessions idle-expire in 30 min; telemetry expires in 2 h.
- **Injection**: 100% parameterized SQL (`pg` / `lib/pq`); table names in the reset path come
  from a fixed allow-list; session ids validated against `^[a-z0-9-]{8,64}$`.
- **CORS/WS**: API allows only the configured web origin; WS closes foreign-origin connections.
- **Containers**: non-root users, multi-stage builds, pinned image versions.
- **Honest gaps**: no TLS termination in compose (put Caddy/nginx in front for public
  deployments), no auth by design, Grafana is anonymous-viewer. These are demo trade-offs,
  documented rather than hidden.
