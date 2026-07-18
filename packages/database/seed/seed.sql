-- Seed data: the four services, dependency graph, default alert rules,
-- scenarios, plus clearly-flagged historical examples (is_seed = true,
-- session_id = 'seed-history') so the UI is useful before live telemetry lands.

INSERT INTO services (id, display_name, description, tier) VALUES
 ('auth-service','Authentication','Validates synthetic user sessions and starts the checkout chain.','edge'),
 ('payment-service','Payments','Processes synthetic payments with configurable latency, failures, and timeouts.','core'),
 ('order-service','Orders','Persists synthetic orders and dispatches confirmations.','core'),
 ('notification-service','Notifications','Queues and delivers synthetic confirmations; supports outage and backlog scenarios.','async')
ON CONFLICT (id) DO NOTHING;

INSERT INTO service_dependencies (upstream, downstream) VALUES
 ('auth-service','payment-service'),
 ('payment-service','order-service'),
 ('order-service','notification-service')
ON CONFLICT DO NOTHING;

INSERT INTO alert_rules (id, name, description, service_name, metric, comparator, threshold, for_seconds, severity) VALUES
 ('rule-payment-latency','Payment p95 latency high','payment-service p95 latency > 1500 ms sustained for 20 s','payment-service','p95_latency_ms','gt',1500,20,'critical'),
 ('rule-payment-errors','Payment error rate high','payment-service error rate > 5% sustained for 20 s','payment-service','error_rate_pct','gt',5,20,'critical'),
 ('rule-notification-outage','Notification success stalled','notification-service has had no successful request for 30 s while traffic continues','notification-service','no_success_seconds','gt',30,0,'critical'),
 ('rule-order-latency','Order p95 latency elevated','order-service p95 latency > 1200 ms sustained for 20 s','order-service','p95_latency_ms','gt',1200,20,'warning'),
 ('rule-queue-backlog','Notification queue backlog','notification queue depth > 50 sustained for 15 s','notification-service','queue_depth','gt',50,15,'warning'),
 ('rule-dlq-spike','Dead-letter spike','More than 5 dead-letter events within one minute',NULL,'dead_letter_count_1m','gt',5,0,'warning')
ON CONFLICT (id) DO NOTHING;

INSERT INTO simulation_scenarios (id, name, description, category) VALUES
 ('normal-traffic','Normal Traffic','Steady synthetic request mix with a small share of expected errors.','baseline'),
 ('payment-slowdown','Payment Slowdown','Injects real latency into payment processing; p95 climbs until the latency alert fires.','latency'),
 ('payment-error-spike','Payment Error Spike','Raises the real payment failure probability; error-rate alert and failed traces follow.','errors'),
 ('notification-outage','Notification Outage','Notification endpoint fails outright; orders still succeed, retries and dead-letters grow.','outage'),
 ('order-db-delay','Order Database Delay','Slows real order persistence; order latency rises and downstream pressure builds.','latency'),
 ('traffic-surge','Traffic Surge','Ramps request volume up to a multiplier over 20 seconds; watch throughput and queues.','load'),
 ('queue-worker-pause','Queue Worker Pause','Pauses the notification queue consumer; backlog grows, then drains on recovery.','queue'),
 ('malformed-event','Malformed Event Injection','Publishes a schema-invalid telemetry event that lands in the dead-letter queue.','pipeline'),
 ('full-recovery','Full Recovery','Clears every failure flag, resumes workers, and lets health, alerts, and incidents recover.','recovery')
ON CONFLICT (id) DO NOTHING;

-- Historical example: one resolved incident with a full timeline.
INSERT INTO incidents (id, session_id, title, severity, status, started_at, resolved_at, duration_ms, detection_ms, root_cause_service, root_cause_hint, is_seed)
VALUES ('inc_seed0001','seed-history','payment-service: Payment p95 latency high','critical','resolved',
        now() - interval '26 hours', now() - interval '25 hours 49 minutes', 660000, 21000,
        'payment-service',
        'payment-service entered degraded state first. order-service degraded 14s later and notification queue depth began rising 22s later. payment-service is the earliest correlated degraded dependency and the most likely origin.',
        true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO incident_events (incident_id, ts, kind, message, service_name) VALUES
 ('inc_seed0001', now() - interval '26 hours',                    'health_transition','payment-service entered degraded state','payment-service'),
 ('inc_seed0001', now() - interval '26 hours' + interval '14 seconds','health_transition','order-service entered degraded state','order-service'),
 ('inc_seed0001', now() - interval '26 hours' + interval '21 seconds','alert_firing','Alert firing: Payment p95 latency high (value 2140.0, threshold 1500.0)','payment-service'),
 ('inc_seed0001', now() - interval '26 hours' + interval '22 seconds','queue_growth','Notification queue depth began increasing',NULL),
 ('inc_seed0001', now() - interval '25 hours 52 minutes','recovery','Recovery action triggered: full-recovery scenario',NULL),
 ('inc_seed0001', now() - interval '25 hours 50 minutes','health_transition','payment-service returned to healthy','payment-service'),
 ('inc_seed0001', now() - interval '25 hours 49 minutes 30 seconds','alert_resolved','Alert resolved: Payment p95 latency high','payment-service'),
 ('inc_seed0001', now() - interval '25 hours 49 minutes','resolved','All alerts resolved and services healthy; incident closed',NULL);

INSERT INTO alert_occurrences (id, rule_id, session_id, state, severity, value, threshold, started_at, firing_at, resolved_at, incident_id, is_seed)
VALUES ('alrt_seed_rule-payment-latency','rule-payment-latency','seed-history','resolved','critical',2140,1500,
        now() - interval '26 hours', now() - interval '26 hours' + interval '21 seconds',
        now() - interval '25 hours 49 minutes 30 seconds','inc_seed0001',true)
ON CONFLICT (id) DO NOTHING;

-- Historical example traces (one healthy, one slow-failed) with spans.
INSERT INTO traces (trace_id, session_id, root_service, root_endpoint, started_at, ended_at, duration_ms, status, span_count, error_count, is_seed, expires_at) VALUES
 ('seedtrace00000000000000000000ok','seed-history','auth-service','/api/sessions/validate', now() - interval '25 hours', now() - interval '25 hours' + interval '412 milliseconds', 412,'ok',7,0,true, now() + interval '10 years'),
 ('seedtrace0000000000000000slow01','seed-history','auth-service','/api/sessions/validate', now() - interval '26 hours', now() - interval '26 hours' + interval '2934 milliseconds', 2934,'error',5,2,true, now() + interval '10 years')
ON CONFLICT (trace_id) DO NOTHING;

INSERT INTO spans (span_id, trace_id, parent_span_id, service_name, operation, started_at, duration_ms, status, error_type) VALUES
 ('seedspan00000001','seedtrace00000000000000000000ok',NULL,'auth-service','/api/sessions/validate', now() - interval '25 hours', 412,'ok',NULL),
 ('seedspan00000002','seedtrace00000000000000000000ok','seedspan00000001','auth-service','/api/payments', now() - interval '25 hours' + interval '18 milliseconds', 380,'ok',NULL),
 ('seedspan00000003','seedtrace00000000000000000000ok','seedspan00000002','payment-service','/api/payments', now() - interval '25 hours' + interval '22 milliseconds', 361,'ok',NULL),
 ('seedspan00000004','seedtrace00000000000000000000ok','seedspan00000003','payment-service','/api/orders', now() - interval '25 hours' + interval '110 milliseconds', 262,'ok',NULL),
 ('seedspan00000005','seedtrace00000000000000000000ok','seedspan00000004','order-service','/api/orders', now() - interval '25 hours' + interval '115 milliseconds', 248,'ok',NULL),
 ('seedspan00000006','seedtrace00000000000000000000ok','seedspan00000005','order-service','/api/notifications', now() - interval '25 hours' + interval '300 milliseconds', 55,'ok',NULL),
 ('seedspan00000007','seedtrace00000000000000000000ok','seedspan00000006','notification-service','/api/notifications', now() - interval '25 hours' + interval '305 milliseconds', 41,'ok',NULL),
 ('seedspan00000011','seedtrace0000000000000000slow01',NULL,'auth-service','/api/sessions/validate', now() - interval '26 hours', 2934,'error','payment_failed'),
 ('seedspan00000012','seedtrace0000000000000000slow01','seedspan00000011','auth-service','/api/payments', now() - interval '26 hours' + interval '15 milliseconds', 2900,'error','downstream_error'),
 ('seedspan00000013','seedtrace0000000000000000slow01','seedspan00000012','payment-service','/api/payments', now() - interval '26 hours' + interval '20 milliseconds', 2884,'error','payment_declined'),
 ('seedspan00000014','seedtrace0000000000000000slow01','seedspan00000013','payment-service','/api/orders', now() - interval '26 hours' + interval '2850 milliseconds', 0,'skipped',NULL),
 ('seedspan00000015','seedtrace0000000000000000slow01','seedspan00000011','notification-service','notification', now() - interval '26 hours' + interval '2900 milliseconds', 0,'skipped',NULL)
ON CONFLICT (span_id) DO NOTHING;

-- Historical metric snapshots (a plausible resolved-incident curve).
INSERT INTO metric_snapshots (session_id, service_name, window_seconds, ts, request_count, error_count, timeout_count, rps, error_rate, p50_ms, p95_ms, p99_ms, queue_depth, health_state, is_seed, expires_at)
SELECT 'seed-history','payment-service',60, now() - interval '26 hours' + (n || ' minutes')::interval,
       180, CASE WHEN n BETWEEN 1 AND 10 THEN 12 ELSE 2 END, 0, 3,
       CASE WHEN n BETWEEN 1 AND 10 THEN 0.066 ELSE 0.011 END,
       CASE WHEN n BETWEEN 1 AND 10 THEN 1900 ELSE 95 END,
       CASE WHEN n BETWEEN 1 AND 10 THEN 2400 ELSE 180 END,
       CASE WHEN n BETWEEN 1 AND 10 THEN 2900 ELSE 240 END,
       0, CASE WHEN n BETWEEN 1 AND 10 THEN 'degraded' ELSE 'healthy' END, true, now() + interval '10 years'
FROM generate_series(0, 15) AS n;

-- Historical dead-letter example (already discarded, remains visible).
INSERT INTO dead_letter_events (id, kind, session_id, trace_id, source_topic, original_payload, validation_errors, failure_reason, first_failure_at, last_failure_at, retry_count, status, is_seed)
VALUES ('dlq_seed0001','invalid_telemetry','seed-history',NULL,'pulsegrid.telemetry.raw',
        '{"eventId":"bad-1","eventVersion":"0.3","serviceName":"payment-service"}',
        '["eventVersion: unsupported version \"0.3\" (expected \"1.0\")","sessionId: required field is empty","traceId: required field is empty","spanId: required field is empty","endpoint: required field is empty","eventType: unknown event type \"\"","status: unknown status \"\"","timestamp: missing or zero timestamp"]',
        'telemetry event failed schema validation',
        now() - interval '30 hours', now() - interval '29 hours', 2, 'discarded', true)
ON CONFLICT (id) DO NOTHING;
