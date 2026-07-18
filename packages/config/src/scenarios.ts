/** Simulation scenarios. IDs must match go/shared/failure and the DB seed. */
export const scenarios = [
  { id: 'normal-traffic', name: 'Normal Traffic', category: 'baseline',
    description: 'Steady synthetic request mix with a small share of expected errors.' },
  { id: 'payment-slowdown', name: 'Payment Slowdown', category: 'latency',
    description: 'Injects real latency into payment processing; p95 climbs until the latency alert fires.' },
  { id: 'payment-error-spike', name: 'Payment Error Spike', category: 'errors',
    description: 'Raises the real payment failure probability; error-rate alert and failed traces follow.' },
  { id: 'notification-outage', name: 'Notification Outage', category: 'outage',
    description: 'Notification endpoint fails outright; orders still succeed while retries and dead-letters grow.' },
  { id: 'order-db-delay', name: 'Order Database Delay', category: 'latency',
    description: 'Slows real order persistence; order latency rises and downstream pressure builds.' },
  { id: 'traffic-surge', name: 'Traffic Surge', category: 'load',
    description: 'Ramps request volume up to a multiplier over 20 seconds; watch throughput and queues.' },
  { id: 'queue-worker-pause', name: 'Queue Worker Pause', category: 'queue',
    description: 'Pauses the notification queue consumer; backlog grows, then drains on recovery.' },
  { id: 'malformed-event', name: 'Malformed Event Injection', category: 'pipeline',
    description: 'Publishes a schema-invalid telemetry event that lands in the dead-letter queue.' },
  { id: 'full-recovery', name: 'Full Recovery', category: 'recovery',
    description: 'Clears every failure flag, resumes workers, and lets health, alerts, and incidents recover.' },
] as const;
export type ScenarioId = (typeof scenarios)[number]['id'];
