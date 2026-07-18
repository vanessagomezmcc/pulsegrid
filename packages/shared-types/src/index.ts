/** API resource shapes shared between the NestJS API and the Next.js app. */

export type HealthState = 'healthy' | 'degraded' | 'critical' | 'offline' | 'unknown';
export type AlertState = 'inactive' | 'pending' | 'firing' | 'acknowledged' | 'resolved';
export type Severity = 'info' | 'warning' | 'critical';

export interface DemoSession {
  id: string;
  status: 'active' | 'expired' | 'reset';
  activeScenario: string | null;
  createdAt: string;
  expiresAt: string;
}

export interface ServiceSummary {
  id: string;
  displayName: string;
  description: string;
  tier: string;
  health: HealthState;
  rps: number;
  errorRate: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  queueDepth: number;
  upstream: string[];
  downstream: string[];
}

export interface TraceSummary {
  traceId: string;
  sessionId: string;
  rootService: string | null;
  rootEndpoint: string | null;
  startedAt: string;
  durationMs: number;
  status: 'ok' | 'error';
  spanCount: number;
  errorCount: number;
  isSeed: boolean;
}

export interface Span {
  spanId: string;
  traceId: string;
  parentSpanId: string | null;
  serviceName: string;
  operation: string;
  startedAt: string;
  durationMs: number;
  status: string;
  errorType: string | null;
}

export interface AlertOccurrence {
  id: string;
  ruleId: string;
  ruleName: string;
  description: string;
  serviceName: string | null;
  state: AlertState;
  severity: Severity;
  value: number;
  threshold: number;
  metric: string;
  startedAt: string;
  firingAt: string | null;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
  incidentId: string | null;
}

export interface Incident {
  id: string;
  sessionId: string;
  title: string;
  severity: Severity;
  status: 'open' | 'resolved';
  startedAt: string;
  resolvedAt: string | null;
  durationMs: number | null;
  detectionMs: number | null;
  rootCauseService: string | null;
  rootCauseHint: string | null;
  isSeed: boolean;
}

export interface IncidentEvent {
  id: number;
  incidentId: string;
  ts: string;
  kind: string;
  message: string;
  serviceName: string | null;
  alertId: string | null;
}

export interface DeadLetterEvent {
  id: string;
  kind: 'invalid_telemetry' | 'notification_delivery';
  sessionId: string;
  traceId: string | null;
  sourceTopic: string;
  originalPayload: string;
  validationErrors: string[] | null;
  failureReason: string;
  firstFailureAt: string;
  lastFailureAt: string;
  retryCount: number;
  status: 'failed' | 'retrying' | 'resolved' | 'discarded';
  isSeed: boolean;
}

export interface MetricPoint {
  ts: string;
  serviceName: string;
  rps: number;
  errorRate: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  queueDepth: number;
  healthState: HealthState;
}

export interface ScenarioRun {
  id: string;
  scenarioId: string;
  sessionId: string;
  intensity: number;
  status: 'running' | 'stopped' | 'completed';
  startedAt: string;
  stoppedAt: string | null;
}

/** Live WebSocket message envelope published by the telemetry processor. */
export interface LiveMessage<T = unknown> {
  type: 'metrics' | 'health' | 'alert' | 'incident' | 'trace' | 'event' | 'dlq' | 'queue' | 'scenario';
  sessionId: string;
  at: string;
  payload: T;
}
