import { describe, expect, it } from 'vitest';
import { telemetryEventSchema, SCHEMA_VERSION } from './telemetry';

const valid = {
  eventId: 'e1',
  eventVersion: SCHEMA_VERSION,
  sessionId: 's1',
  traceId: 't1',
  spanId: 'sp1',
  serviceName: 'payment-service',
  serviceInstance: 'i1',
  environment: 'test',
  region: 'local',
  eventType: 'request',
  endpoint: '/api/payments',
  status: 'ok',
  durationMs: 12.5,
  timestamp: new Date().toISOString(),
  retryCount: 0,
  payloadSizeBytes: 100,
};

describe('telemetryEventSchema', () => {
  it('accepts a valid event and coerces the timestamp', () => {
    const parsed = telemetryEventSchema.parse(valid);
    expect(parsed.timestamp).toBeInstanceOf(Date);
  });
  it('rejects a wrong schema version', () => {
    expect(telemetryEventSchema.safeParse({ ...valid, eventVersion: '0.9' }).success).toBe(false);
  });
  it('rejects negative duration', () => {
    expect(telemetryEventSchema.safeParse({ ...valid, durationMs: -1 }).success).toBe(false);
  });
  it('requires errorType when status is error', () => {
    expect(telemetryEventSchema.safeParse({ ...valid, status: 'error' }).success).toBe(false);
    expect(
      telemetryEventSchema.safeParse({ ...valid, status: 'error', errorType: 'declined' }).success,
    ).toBe(true);
  });
  it('rejects unknown event types', () => {
    expect(telemetryEventSchema.safeParse({ ...valid, eventType: 'nope' }).success).toBe(false);
  });
});
