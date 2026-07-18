# Deployment

## Local (the supported path)
`docker compose up --build` runs everything. This is the honest deployment story for a demo
that includes Redpanda + six long-running processes.

## Public hosting
- **Frontend** (`apps/web`): Vercel works — set `NEXT_PUBLIC_API_URL` / `NEXT_PUBLIC_WS_URL` to
  the deployed API.
- **API + processor + services**: need long-running hosts (WebSockets + Kafka consumers rule out
  serverless). Railway, Render, or Fly.io each work; run the six Go binaries + API as separate
  services from the same repo, with managed Postgres/Redis and Redpanda Cloud (or a small
  self-hosted broker).
- Set `WEB_ORIGIN` on the API to the deployed frontend origin (CORS + WS origin check).

## Ops endpoints
Every process exposes `/healthz`, `/readyz`, `/metrics` (Prometheus text format) for platform
health checks and scraping.

## Cost-conscious note
The stack idles light (single-digit rps per session), but Redpanda wants ~1 GB RAM. For a
portfolio deployment, one small VM running the compose file behind Caddy is the cheapest
credible option.
