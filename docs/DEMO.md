# 5-minute recruiter demo script

**0:00 — Land.** Open the site, click **Enter Live Demo**. Point out: no signup, isolated
sandbox, everything on screen is derived from live telemetry.

**0:30 — Overview.** Four services, all green. Note the live totals ticking; open Auth's card →
service detail: four real time-series (p95, error rate, rps, queue depth) built from 5-second
snapshots.

**1:15 — Traces.** Open any checkout trace. Waterfall shows auth → payment → order →
notification with real offsets; call out W3C traceparent propagation.

**1:45 — Break it.** Simulation Lab → *Payment Slowdown*, intensity 2. Explain: this writes
failure flags to Redis; the payment service reads them per-request and genuinely sleeps — no
faked dashboards.

**2:15 — Watch detection.** Overview p95 climbs → Alerts: latency rule goes `pending` (breach
must persist 20 s), then `firing`. Click the alert: full lifecycle timestamps. Acknowledge it.

**3:15 — Incident.** Incidents page: one opened automatically. Open it: severity, time-to-detect,
live timeline, and a root-cause card — "payment-service, via dependency correlation" with the
evidence listed. Emphasize deterministic, not ML.

**4:00 — Deeper failure.** Lab → *Notification Outage*. Dead-Letter Queue fills with
notification_delivery entries: full payload, failure reason, retry count. Inspect one.

**4:30 — Recover.** Lab → *Full Recovery*. Alerts resolve, the incident closes with MTTD and
duration, services return green. Retry a dead letter → it actually re-delivers now.

**Close.** "Every layer here is real: Redpanda streaming, schema validation with a DLQ, windowed
metrics, a 5-state alert machine, incident correlation. The repo has ADRs for every design
decision."
