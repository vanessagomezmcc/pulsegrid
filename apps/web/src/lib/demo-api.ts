'use client';

import type {
  AlertOccurrence,
  DeadLetterEvent,
  DemoSession,
  Incident,
  IncidentEvent,
  LiveMessage,
  MetricPoint,
  ScenarioRun,
  ServiceSummary,
  Span,
  TraceSummary,
} from '@pulsegrid/shared-types';

type StreamEvent = {
  eventId: string;
  service: string;
  eventType: string;
  endpoint: string;
  traceId: string;
  status: string;
  durationMs: number;
  ts: string;
  queueName?: string;
  errorType?: string;
};

type TraceDetail = {
  trace: TraceSummary & { endedAt: string };
  spans: Span[];
};

type DemoState = {
  session: DemoSession;
  services: ServiceSummary[];
  metrics: Record<string, MetricPoint[]>;
  traces: TraceSummary[];
  traceDetails: Record<string, TraceDetail>;
  alerts: AlertOccurrence[];
  incidents: Incident[];
  incidentTimelines: Record<string, IncidentEvent[]>;
  events: StreamEvent[];
  deadLetters: DeadLetterEvent[];
  runs: ScenarioRun[];
  activeScenario: string | null;
  intensity: number;
};

const STORAGE_KEY = 'pulsegrid-browser-demo-v1';
const LIVE_EVENT = 'pulsegrid:demo-live';
const serviceOrder = [
  'auth-service',
  'payment-service',
  'order-service',
  'notification-service',
];

const nowIso = () => new Date().toISOString();
const minutesAgo = (minutes: number) =>
  new Date(Date.now() - minutes * 60_000).toISOString();
const id = (prefix: string) =>
  `${prefix}-${
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2)
  }`;

function baseServices(): ServiceSummary[] {
  return [
    {
      id: 'auth-service',
      displayName: 'Authentication',
      description: 'Validates synthetic user sessions and starts the checkout chain.',
      tier: 'tier-1',
      health: 'healthy',
      rps: 3.2,
      errorRate: 0.006,
      p50Ms: 72,
      p95Ms: 184,
      p99Ms: 246,
      queueDepth: 0,
      upstream: [],
      downstream: ['payment-service'],
    },
    {
      id: 'payment-service',
      displayName: 'Payments',
      description: 'Processes synthetic payments with configurable latency, failures, and timeouts.',
      tier: 'tier-1',
      health: 'healthy',
      rps: 3.0,
      errorRate: 0.009,
      p50Ms: 91,
      p95Ms: 216,
      p99Ms: 286,
      queueDepth: 0,
      upstream: ['auth-service'],
      downstream: ['order-service'],
    },
    {
      id: 'order-service',
      displayName: 'Orders',
      description: 'Persists synthetic orders and dispatches confirmations.',
      tier: 'tier-1',
      health: 'healthy',
      rps: 2.9,
      errorRate: 0.004,
      p50Ms: 84,
      p95Ms: 202,
      p99Ms: 269,
      queueDepth: 0,
      upstream: ['payment-service'],
      downstream: ['notification-service'],
    },
    {
      id: 'notification-service',
      displayName: 'Notifications',
      description: 'Queues and delivers synthetic confirmations; supports outage and backlog scenarios.',
      tier: 'tier-2',
      health: 'healthy',
      rps: 2.8,
      errorRate: 0.005,
      p50Ms: 65,
      p95Ms: 173,
      p99Ms: 228,
      queueDepth: 1,
      upstream: ['order-service'],
      downstream: [],
    },
  ];
}

function makeTrace(
  sessionId: string,
  durationMs: number,
  status: 'ok' | 'error' = 'ok',
  slowService = 'payment-service',
): TraceDetail {
  const traceId = id('trace');
  const startedAt = nowIso();
  const base = Math.max(20, Math.round(durationMs * 0.06));
  const payment = slowService === 'payment-service' ? Math.round(durationMs * 0.72) : base * 2;
  const order = slowService === 'order-service' ? Math.round(durationMs * 0.68) : base * 2;
  const notification = Math.max(25, durationMs - base - payment - order);
  const spans: Span[] = [
    {
      spanId: id('span'),
      traceId,
      parentSpanId: null,
      serviceName: 'auth-service',
      operation: 'POST /checkout',
      startedAt,
      durationMs,
      status,
      errorType: status === 'error' ? 'upstream_failure' : null,
    },
    {
      spanId: id('span'),
      traceId,
      parentSpanId: null,
      serviceName: 'payment-service',
      operation: 'POST /payments',
      startedAt: new Date(new Date(startedAt).getTime() + base).toISOString(),
      durationMs: payment,
      status: status === 'error' && slowService === 'payment-service' ? 'error' : 'ok',
      errorType: status === 'error' && slowService === 'payment-service' ? 'payment_timeout' : null,
    },
    {
      spanId: id('span'),
      traceId,
      parentSpanId: null,
      serviceName: 'order-service',
      operation: 'INSERT synthetic_order',
      startedAt: new Date(new Date(startedAt).getTime() + base + payment).toISOString(),
      durationMs: order,
      status: status === 'error' && slowService === 'order-service' ? 'error' : 'ok',
      errorType: status === 'error' && slowService === 'order-service' ? 'database_timeout' : null,
    },
    {
      spanId: id('span'),
      traceId,
      parentSpanId: null,
      serviceName: 'notification-service',
      operation: 'enqueue confirmation',
      startedAt: new Date(new Date(startedAt).getTime() + base + payment + order).toISOString(),
      durationMs: notification,
      status: status === 'error' && slowService === 'notification-service' ? 'error' : 'ok',
      errorType: status === 'error' && slowService === 'notification-service' ? 'delivery_failed' : null,
    },
  ];
  const summary: TraceSummary & { endedAt: string } = {
    traceId,
    sessionId,
    rootService: 'auth-service',
    rootEndpoint: 'POST /checkout',
    startedAt,
    endedAt: new Date(new Date(startedAt).getTime() + durationMs).toISOString(),
    durationMs,
    status,
    spanCount: spans.length,
    errorCount: status === 'error' ? 1 : 0,
    isSeed: false,
  };
  return { trace: summary, spans };
}

function metricHistory(services: ServiceSummary[]): Record<string, MetricPoint[]> {
  const result: Record<string, MetricPoint[]> = {};
  for (const service of services) {
    result[service.id] = Array.from({ length: 30 }, (_, index) => {
      const drift = ((index % 6) - 3) * 0.02;
      return {
        ts: new Date(Date.now() - (29 - index) * 30_000).toISOString(),
        serviceName: service.id,
        rps: Math.max(0, service.rps + drift),
        errorRate: Math.max(0, service.errorRate + drift / 100),
        p50Ms: Math.max(1, service.p50Ms + drift * 50),
        p95Ms: Math.max(1, service.p95Ms + drift * 110),
        p99Ms: Math.max(1, service.p99Ms + drift * 140),
        queueDepth: service.queueDepth,
        healthState: service.health,
      };
    });
  }
  return result;
}

function initialState(): DemoState {
  const sessionId = id('demo');
  const services = baseServices();
  const firstTrace = makeTrace(sessionId, 268);
  const secondTrace = makeTrace(sessionId, 311);
  const historicalIncidentId = id('incident');
  const historicalAlertId = id('alert');
  const session: DemoSession = {
    id: sessionId,
    status: 'active',
    activeScenario: null,
    createdAt: nowIso(),
    expiresAt: new Date(Date.now() + 24 * 60 * 60_000).toISOString(),
  };
  const historicalAlert: AlertOccurrence = {
    id: historicalAlertId,
    ruleId: 'payment-p95-high',
    ruleName: 'Payment p95 latency high',
    description: 'Payment latency remained above the configured threshold.',
    serviceName: 'payment-service',
    state: 'resolved',
    severity: 'critical',
    value: 2120,
    threshold: 1500,
    metric: 'p95_latency_ms',
    startedAt: minutesAgo(42),
    firingAt: minutesAgo(41.8),
    acknowledgedAt: minutesAgo(40.5),
    resolvedAt: minutesAgo(38),
    incidentId: historicalIncidentId,
  };
  const historicalIncident: Incident = {
    id: historicalIncidentId,
    sessionId,
    title: 'Payment latency degraded checkout',
    severity: 'critical',
    status: 'resolved',
    startedAt: minutesAgo(41.8),
    resolvedAt: minutesAgo(38),
    durationMs: 228_000,
    detectionMs: 12_000,
    rootCauseService: 'payment-service',
    rootCauseHint:
      'Payment latency crossed the threshold before downstream order latency. Dependency ordering and span timing identify payment-service as the earliest degraded hop.',
    isSeed: true,
  };
  const events: StreamEvent[] = [firstTrace, secondTrace].flatMap((detail) =>
    detail.spans.map((span) => ({
      eventId: id('event'),
      service: span.serviceName,
      eventType: 'request.completed',
      endpoint: span.operation,
      traceId: detail.trace.traceId,
      status: span.status,
      durationMs: span.durationMs,
      ts: span.startedAt,
    })),
  );
  return {
    session,
    services,
    metrics: metricHistory(services),
    traces: [firstTrace.trace, secondTrace.trace],
    traceDetails: {
      [firstTrace.trace.traceId]: firstTrace,
      [secondTrace.trace.traceId]: secondTrace,
    },
    alerts: [historicalAlert],
    incidents: [historicalIncident],
    incidentTimelines: {
      [historicalIncidentId]: [
        {
          id: 1,
          incidentId: historicalIncidentId,
          ts: historicalIncident.startedAt,
          kind: 'alert_firing',
          message: 'Payment p95 latency alert fired.',
          serviceName: 'payment-service',
          alertId: historicalAlertId,
        },
        {
          id: 2,
          incidentId: historicalIncidentId,
          ts: historicalIncident.resolvedAt ?? nowIso(),
          kind: 'resolved',
          message: 'Latency returned to baseline and the incident resolved.',
          serviceName: 'payment-service',
          alertId: historicalAlertId,
        },
      ],
    },
    events,
    deadLetters: [
      {
        id: id('dlq'),
        kind: 'invalid_telemetry',
        sessionId,
        traceId: null,
        sourceTopic: 'telemetry.raw',
        originalPayload: JSON.stringify({ service: 'payment-service', duration_ms: 'not-a-number' }),
        validationErrors: ['duration_ms must be a number'],
        failureReason: 'Schema validation failed',
        firstFailureAt: minutesAgo(25),
        lastFailureAt: minutesAgo(25),
        retryCount: 0,
        status: 'resolved',
        isSeed: true,
      },
    ],
    runs: [],
    activeScenario: null,
    intensity: 2,
  };
}

function loadState(): DemoState {
  if (typeof window === 'undefined') return initialState();
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    const state = initialState();
    saveState(state, false);
    return state;
  }
  try {
    return JSON.parse(raw) as DemoState;
  } catch {
    const state = initialState();
    saveState(state, false);
    return state;
  }
}

function saveState(state: DemoState, notify = true): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  if (notify) emit('metrics', metricsPayload(state), state.session.id);
}

function emit<T>(type: LiveMessage<T>['type'], payload: T, sessionId: string): void {
  if (typeof window === 'undefined') return;
  const message: LiveMessage<T> = { type, sessionId, at: nowIso(), payload };
  window.dispatchEvent(new CustomEvent(LIVE_EVENT, { detail: message }));
}

function metricsPayload(state: DemoState) {
  const requests60s = Math.round(state.services.reduce((sum, service) => sum + service.rps, 0) * 60);
  return {
    totals: {
      rps: state.services.reduce((sum, service) => sum + service.rps, 0),
      errorRate:
        state.services.reduce((sum, service) => sum + service.errorRate, 0) /
        Math.max(1, state.services.length),
      p95Ms: Math.max(...state.services.map((service) => service.p95Ms)),
      deadLetter1m: state.deadLetters.filter(
        (entry) => Date.now() - new Date(entry.lastFailureAt).getTime() < 60_000,
      ).length,
      requests60s,
    },
  };
}

function updateMetricHistory(state: DemoState): void {
  for (const service of state.services) {
    const list = state.metrics[service.id] ?? [];
    list.push({
      ts: nowIso(),
      serviceName: service.id,
      rps: service.rps,
      errorRate: service.errorRate,
      p50Ms: service.p50Ms,
      p95Ms: service.p95Ms,
      p99Ms: service.p99Ms,
      queueDepth: service.queueDepth,
      healthState: service.health,
    });
    state.metrics[service.id] = list.slice(-60);
  }
}

function addTrace(state: DemoState, detail: TraceDetail): void {
  state.traces.unshift(detail.trace);
  state.traces = state.traces.slice(0, 80);
  state.traceDetails[detail.trace.traceId] = detail;
  for (const span of detail.spans) {
    const event: StreamEvent = {
      eventId: id('event'),
      service: span.serviceName,
      eventType: span.status === 'error' ? 'request.failed' : 'request.completed',
      endpoint: span.operation,
      traceId: detail.trace.traceId,
      status: span.status,
      durationMs: span.durationMs,
      ts: span.startedAt,
      errorType: span.errorType ?? undefined,
    };
    state.events.unshift(event);
    emit('event', event, state.session.id);
  }
  emit('trace', detail.trace, state.session.id);
}

function findService(state: DemoState, serviceId: string): ServiceSummary {
  const service = state.services.find((item) => item.id === serviceId);
  if (!service) throw new Error(`Unknown service: ${serviceId}`);
  return service;
}

function createOrUpdateIncident(
  state: DemoState,
  alert: AlertOccurrence,
  title: string,
  rootCauseService: string,
  hint: string,
): Incident {
  let incident = state.incidents.find((item) => item.status === 'open' && !item.isSeed);
  if (!incident) {
    incident = {
      id: id('incident'),
      sessionId: state.session.id,
      title,
      severity: 'critical',
      status: 'open',
      startedAt: nowIso(),
      resolvedAt: null,
      durationMs: null,
      detectionMs: 6000,
      rootCauseService,
      rootCauseHint: hint,
      isSeed: false,
    };
    state.incidents.unshift(incident);
    state.incidentTimelines[incident.id] = [
      {
        id: 1,
        incidentId: incident.id,
        ts: nowIso(),
        kind: 'alert_firing',
        message: `${alert.ruleName} fired and opened the incident.`,
        serviceName: alert.serviceName,
        alertId: alert.id,
      },
      {
        id: 2,
        incidentId: incident.id,
        ts: nowIso(),
        kind: 'health_transition',
        message: `${rootCauseService} changed from healthy to degraded.`,
        serviceName: rootCauseService,
        alertId: alert.id,
      },
    ];
  }
  alert.incidentId = incident.id;
  emit('incident', incident, state.session.id);
  return incident;
}

function upsertAlert(
  state: DemoState,
  input: Omit<AlertOccurrence, 'id' | 'startedAt' | 'firingAt' | 'acknowledgedAt' | 'resolvedAt' | 'incidentId'>,
  stateValue: AlertOccurrence['state'],
): AlertOccurrence {
  let alert = state.alerts.find(
    (item) => item.ruleId === input.ruleId && item.state !== 'resolved',
  ) as (AlertOccurrence & { isSeed?: boolean }) | undefined;
  if (!alert) {
    alert = {
      ...input,
      id: id('alert'),
      state: stateValue,
      startedAt: nowIso(),
      firingAt: stateValue === 'firing' ? nowIso() : null,
      acknowledgedAt: null,
      resolvedAt: null,
      incidentId: null,
    };
    state.alerts.unshift(alert);
  } else {
    alert.value = input.value;
    alert.state = stateValue;
    if (stateValue === 'firing' && !alert.firingAt) alert.firingAt = nowIso();
  }
  emit('alert', alert, state.session.id);
  return alert;
}

function resolveActive(state: DemoState): void {
  const resolvedAt = nowIso();
  for (const alert of state.alerts) {
    if (!['resolved', 'inactive'].includes(alert.state)) {
      alert.state = 'resolved';
      alert.resolvedAt = resolvedAt;
      emit('alert', alert, state.session.id);
    }
  }
  for (const incident of state.incidents) {
    if (incident.status === 'open') {
      incident.status = 'resolved';
      incident.resolvedAt = resolvedAt;
      incident.durationMs = Date.now() - new Date(incident.startedAt).getTime();
      const timeline = state.incidentTimelines[incident.id] ?? [];
      timeline.push({
        id: timeline.length + 1,
        incidentId: incident.id,
        ts: resolvedAt,
        kind: 'recovery',
        message: 'Recovery restored service metrics to the healthy baseline.',
        serviceName: incident.rootCauseService,
        alertId: null,
      });
      timeline.push({
        id: timeline.length + 1,
        incidentId: incident.id,
        ts: resolvedAt,
        kind: 'resolved',
        message: 'All active alerts cleared; incident resolved.',
        serviceName: incident.rootCauseService,
        alertId: null,
      });
      state.incidentTimelines[incident.id] = timeline;
      emit('incident', incident, state.session.id);
    }
  }
}

function applyScenarioEffects(state: DemoState): void {
  const running = state.runs.find((run) => run.status === 'running');
  if (!running) return;
  const elapsed = Date.now() - new Date(running.startedAt).getTime();
  const intensity = Math.max(1, state.intensity);

  if (state.activeScenario === 'payment-slowdown') {
    const service = findService(state, 'payment-service');
    service.health = 'degraded';
    service.p50Ms = 650 * intensity;
    service.p95Ms = 1050 * intensity;
    service.p99Ms = 1250 * intensity;
    if (elapsed >= 2000) {
      const phase = elapsed >= 6000 ? 'firing' : 'pending';
      const alert = upsertAlert(
        state,
        {
          ruleId: 'payment-p95-high',
          ruleName: 'Payment p95 latency high',
          description: 'Payment p95 latency exceeded 1.5 seconds for a sustained evaluation window.',
          serviceName: 'payment-service',
          state: phase,
          severity: 'critical',
          value: service.p95Ms,
          threshold: 1500,
          metric: 'p95_latency_ms',
        },
        phase,
      );
      if (phase === 'firing') {
        createOrUpdateIncident(
          state,
          alert,
          'Payment latency degraded checkout',
          'payment-service',
          'Payment spans became slow before order and notification spans. Dependency ordering and measured span offsets identify payment-service as the earliest degraded hop.',
        );
      }
    }
  }

  if (state.activeScenario === 'queue-worker-pause') {
    const service = findService(state, 'notification-service');
    service.health = 'degraded';
    service.queueDepth = Math.min(500, 20 + Math.round(elapsed / 300) * intensity);
    if (elapsed >= 3500) {
      upsertAlert(
        state,
        {
          ruleId: 'notification-queue-high',
          ruleName: 'Notification queue backlog high',
          description: 'Notification queue depth is growing while the worker is paused.',
          serviceName: 'notification-service',
          state: 'firing',
          severity: 'warning',
          value: service.queueDepth,
          threshold: 50,
          metric: 'queue_depth',
        },
        'firing',
      );
    }
  }
}

function startScenario(state: DemoState, scenarioId: string, intensity: number): ScenarioRun {
  for (const run of state.runs) {
    if (run.status === 'running') {
      run.status = 'stopped';
      run.stoppedAt = nowIso();
    }
  }
  state.activeScenario = scenarioId;
  state.intensity = intensity;
  state.session.activeScenario = scenarioId;
  const run: ScenarioRun = {
    id: id('run'),
    scenarioId,
    sessionId: state.session.id,
    intensity,
    status: 'running',
    startedAt: nowIso(),
    stoppedAt: null,
  };
  state.runs.unshift(run);

  if (scenarioId === 'normal-traffic' || scenarioId === 'full-recovery') {
    state.services = baseServices();
    resolveActive(state);
    state.activeScenario = scenarioId === 'normal-traffic' ? 'normal-traffic' : null;
    state.session.activeScenario = state.activeScenario;
    run.status = 'completed';
    run.stoppedAt = nowIso();
  }

  if (scenarioId === 'payment-slowdown') {
    const service = findService(state, 'payment-service');
    service.health = 'degraded';
    service.p50Ms = 650 * intensity;
    service.p95Ms = 1050 * intensity;
    service.p99Ms = 1250 * intensity;
    addTrace(state, makeTrace(state.session.id, 950 * intensity, 'ok', 'payment-service'));
  }

  if (scenarioId === 'payment-error-spike') {
    const service = findService(state, 'payment-service');
    service.health = 'critical';
    service.errorRate = Math.min(0.45, 0.08 * intensity);
    addTrace(state, makeTrace(state.session.id, 780, 'error', 'payment-service'));
    const alert = upsertAlert(
      state,
      {
        ruleId: 'payment-error-rate-high',
        ruleName: 'Payment error rate high',
        description: 'Payment failures exceeded the configured error-rate threshold.',
        serviceName: 'payment-service',
        state: 'firing',
        severity: 'critical',
        value: service.errorRate * 100,
        threshold: 5,
        metric: 'error_rate_percent',
      },
      'firing',
    );
    createOrUpdateIncident(
      state,
      alert,
      'Payment failures disrupted checkout',
      'payment-service',
      'Failed payment spans appeared before downstream calls, so payment-service is the first failing dependency in the trace chain.',
    );
  }

  if (scenarioId === 'notification-outage') {
    const service = findService(state, 'notification-service');
    service.health = 'offline';
    service.errorRate = 1;
    service.queueDepth = 85 * intensity;
    addTrace(state, makeTrace(state.session.id, 620, 'error', 'notification-service'));
    const dlq: DeadLetterEvent = {
      id: id('dlq'),
      kind: 'notification_delivery',
      sessionId: state.session.id,
      traceId: state.traces[0]?.traceId ?? null,
      sourceTopic: 'notification.delivery',
      originalPayload: JSON.stringify({ recipient: 'demo@example.com', template: 'order-confirmation' }),
      validationErrors: null,
      failureReason: 'Notification endpoint returned 503 after retries were exhausted',
      firstFailureAt: nowIso(),
      lastFailureAt: nowIso(),
      retryCount: 3,
      status: 'failed',
      isSeed: false,
    };
    state.deadLetters.unshift(dlq);
    emit('dlq', dlq, state.session.id);
    const alert = upsertAlert(
      state,
      {
        ruleId: 'notification-no-success',
        ruleName: 'Notification delivery unavailable',
        description: 'No successful notification deliveries were observed.',
        serviceName: 'notification-service',
        state: 'firing',
        severity: 'critical',
        value: 0,
        threshold: 1,
        metric: 'successful_deliveries',
      },
      'firing',
    );
    createOrUpdateIncident(
      state,
      alert,
      'Notification outage caused delivery failures',
      'notification-service',
      'Orders completed, but the terminal notification hop failed consistently and exhausted retries.',
    );
  }

  if (scenarioId === 'order-db-delay') {
    const service = findService(state, 'order-service');
    service.health = 'degraded';
    service.p50Ms = 500 * intensity;
    service.p95Ms = 920 * intensity;
    service.p99Ms = 1100 * intensity;
    addTrace(state, makeTrace(state.session.id, 920 * intensity, 'ok', 'order-service'));
  }

  if (scenarioId === 'traffic-surge') {
    for (const service of state.services) {
      service.rps *= 4 * intensity;
      service.p95Ms *= 1.35;
      if (service.id === 'notification-service') service.queueDepth = 18 * intensity;
    }
    addTrace(state, makeTrace(state.session.id, 540));
  }

  if (scenarioId === 'queue-worker-pause') {
    const service = findService(state, 'notification-service');
    service.health = 'degraded';
    service.queueDepth = 20;
  }

  if (scenarioId === 'malformed-event') {
    const dlq: DeadLetterEvent = {
      id: id('dlq'),
      kind: 'invalid_telemetry',
      sessionId: state.session.id,
      traceId: null,
      sourceTopic: 'telemetry.raw',
      originalPayload: JSON.stringify({ version: 99, service: '', duration_ms: 'slow', status: 200 }),
      validationErrors: [
        'version: unsupported schema version 99',
        'service: must be a non-empty service identifier',
        'duration_ms: expected number, received string',
      ],
      failureReason: 'Event failed schema validation and was routed to the dead-letter topic',
      firstFailureAt: nowIso(),
      lastFailureAt: nowIso(),
      retryCount: 0,
      status: 'failed',
      isSeed: false,
    };
    state.deadLetters.unshift(dlq);
    emit('dlq', dlq, state.session.id);
    run.status = 'completed';
    run.stoppedAt = nowIso();
  }

  updateMetricHistory(state);
  emit('scenario', { activeScenario: state.activeScenario, run }, state.session.id);
  emit('health', state.services, state.session.id);
  return run;
}

export function createDemoSession(): Promise<{ id: string; expiresAt: string }> {
  const state = loadState();
  saveState(state);
  return Promise.resolve({ id: state.session.id, expiresAt: state.session.expiresAt });
}

export async function demoApi<T>(path: string, init?: RequestInit): Promise<T> {
  const state = loadState();
  applyScenarioEffects(state);
  updateMetricHistory(state);
  const method = (init?.method ?? 'GET').toUpperCase();
  const url = new URL(path, 'https://pulsegrid.local');
  const pathname = url.pathname;

  if (pathname === '/api/demo/sessions' && method === 'POST') {
    saveState(state);
    return { id: state.session.id, expiresAt: state.session.expiresAt } as T;
  }

  const resetMatch = pathname.match(/^\/api\/demo\/sessions\/[^/]+\/reset$/);
  if (resetMatch && method === 'POST') {
    const fresh = initialState();
    saveState(fresh);
    return fresh.session as T;
  }

  if (pathname === '/api/services') {
    saveState(state);
    return state.services as T;
  }

  const serviceMetricsMatch = pathname.match(/^\/api\/services\/([^/]+)\/metrics$/);
  if (serviceMetricsMatch) {
    saveState(state, false);
    return (state.metrics[decodeURIComponent(serviceMetricsMatch[1] ?? '')] ?? []) as T;
  }

  const serviceMatch = pathname.match(/^\/api\/services\/([^/]+)$/);
  if (serviceMatch) {
    saveState(state, false);
    return state.services.find((service) => service.id === decodeURIComponent(serviceMatch[1] ?? '')) as T;
  }

  if (pathname === '/api/traces') {
    let traces = [...state.traces];
    const status = url.searchParams.get('status');
    const service = url.searchParams.get('service');
    const minDurationMs = Number(url.searchParams.get('minDurationMs') ?? 0);
    if (status) traces = traces.filter((trace) => trace.status === status);
    if (service) {
      traces = traces.filter((trace) =>
        state.traceDetails[trace.traceId]?.spans.some((span) => span.serviceName === service),
      );
    }
    if (minDurationMs > 0) traces = traces.filter((trace) => trace.durationMs >= minDurationMs);
    saveState(state, false);
    return traces as T;
  }

  const traceMatch = pathname.match(/^\/api\/traces\/([^/]+)$/);
  if (traceMatch) {
    saveState(state, false);
    return state.traceDetails[decodeURIComponent(traceMatch[1] ?? '')] as T;
  }

  if (pathname === '/api/alerts/rules') return [] as T;
  if (pathname === '/api/alerts') {
    saveState(state);
    return state.alerts as T;
  }

  const acknowledgeMatch = pathname.match(/^\/api\/alerts\/([^/]+)\/acknowledge$/);
  if (acknowledgeMatch && method === 'POST') {
    const alert = state.alerts.find((item) => item.id === decodeURIComponent(acknowledgeMatch[1] ?? ''));
    if (alert) {
      alert.state = 'acknowledged';
      alert.acknowledgedAt = nowIso();
      emit('alert', alert, state.session.id);
    }
    saveState(state);
    return alert as T;
  }

  const alertMatch = pathname.match(/^\/api\/alerts\/([^/]+)$/);
  if (alertMatch) {
    saveState(state, false);
    return state.alerts.find((alert) => alert.id === decodeURIComponent(alertMatch[1] ?? '')) as T;
  }

  if (pathname === '/api/incidents') {
    saveState(state);
    return state.incidents as T;
  }

  const incidentMatch = pathname.match(/^\/api\/incidents\/([^/]+)$/);
  if (incidentMatch) {
    const incidentId = decodeURIComponent(incidentMatch[1] ?? '');
    saveState(state, false);
    return {
      incident: state.incidents.find((incident) => incident.id === incidentId),
      timeline: state.incidentTimelines[incidentId] ?? [],
    } as T;
  }

  if (pathname === '/api/events') {
    const limit = Math.max(1, Number(url.searchParams.get('limit') ?? 100));
    saveState(state, false);
    return state.events.slice(0, limit) as T;
  }

  if (pathname === '/api/dead-letter') {
    saveState(state);
    return state.deadLetters as T;
  }

  const dlqActionMatch = pathname.match(/^\/api\/dead-letter\/([^/]+)\/(retry|discard)$/);
  if (dlqActionMatch && method === 'POST') {
    const entry = state.deadLetters.find((item) => item.id === decodeURIComponent(dlqActionMatch[1] ?? ''));
    if (entry) {
      entry.status = dlqActionMatch[2] === 'discard' ? 'discarded' : 'resolved';
      if (dlqActionMatch[2] === 'retry') entry.retryCount += 1;
      entry.lastFailureAt = nowIso();
    }
    saveState(state);
    return {
      detail:
        dlqActionMatch[2] === 'discard'
          ? 'Dead-letter event discarded in the browser demo.'
          : 'Retry completed successfully in the browser demo.',
    } as T;
  }

  const dlqMatch = pathname.match(/^\/api\/dead-letter\/([^/]+)$/);
  if (dlqMatch) {
    saveState(state, false);
    return state.deadLetters.find((entry) => entry.id === decodeURIComponent(dlqMatch[1] ?? '')) as T;
  }

  if (pathname === '/api/simulation/scenarios') return [] as T;
  if (pathname === '/api/simulation/state') {
    saveState(state);
    return {
      flags: state.activeScenario
        ? { activeScenario: state.activeScenario, intensity: state.intensity }
        : null,
      runs: state.runs,
    } as T;
  }

  const scenarioMatch = pathname.match(/^\/api\/simulation\/scenarios\/([^/]+)\/start$/);
  if (scenarioMatch && method === 'POST') {
    const body = init?.body ? (JSON.parse(String(init.body)) as { intensity?: number }) : {};
    const run = startScenario(
      state,
      decodeURIComponent(scenarioMatch[1] ?? ''),
      Number(body.intensity ?? 2),
    );
    saveState(state);
    return run as T;
  }

  if (pathname === '/api/simulation/stop' && method === 'POST') {
    for (const run of state.runs) {
      if (run.status === 'running') {
        run.status = 'stopped';
        run.stoppedAt = nowIso();
      }
    }
    state.activeScenario = null;
    state.session.activeScenario = null;
    saveState(state);
    return { ok: true } as T;
  }

  throw new Error(`Browser demo does not implement ${method} ${pathname}`);
}

export function subscribeDemoLive(handler: (message: LiveMessage) => void): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const listener = (event: Event) => {
    handler((event as CustomEvent<LiveMessage>).detail);
  };
  window.addEventListener(LIVE_EVENT, listener);

  const tick = () => {
    const state = loadState();
    applyScenarioEffects(state);
    updateMetricHistory(state);
    if (state.activeScenario && state.activeScenario !== 'normal-traffic') {
      const slowService = state.activeScenario === 'order-db-delay' ? 'order-service' : 'payment-service';
      const status = state.activeScenario === 'payment-error-spike' ? 'error' : 'ok';
      addTrace(
        state,
        makeTrace(
          state.session.id,
          Math.max(260, Math.round(Math.max(...state.services.map((service) => service.p95Ms)))),
          status,
          slowService,
        ),
      );
    }
    saveState(state, false);
    handler({
      type: 'metrics',
      sessionId: state.session.id,
      at: nowIso(),
      payload: metricsPayload(state),
    });
  };

  tick();
  const interval = window.setInterval(tick, 2500);
  return () => {
    window.removeEventListener(LIVE_EVENT, listener);
    window.clearInterval(interval);
  };
}
