import { z } from 'zod';

/**
 * TypeScript mirror of go/shared/events.TelemetryEvent (schema version 1.0).
 * The control-plane API validates everything it re-publishes or accepts with
 * this schema; the Go side validates independently. Keep the two in lockstep.
 */
export const SCHEMA_VERSION = '1.0';

export const eventTypeSchema = z.enum([
  'request',
  'dependency',
  'queue_publish',
  'queue_consume',
  'health_probe',
]);
export const statusSchema = z.enum(['ok', 'error', 'timeout', 'skipped']);

export const telemetryEventSchema = z
  .object({
    eventId: z.string().min(1),
    eventVersion: z.literal(SCHEMA_VERSION),
    sessionId: z.string().min(1),
    traceId: z.string().min(1),
    spanId: z.string().min(1),
    parentSpanId: z.string().optional(),
    serviceName: z.string().min(1),
    serviceInstance: z.string().min(1),
    environment: z.string().min(1),
    region: z.string().min(1),
    eventType: eventTypeSchema,
    endpoint: z.string().min(1),
    httpMethod: z.string().optional(),
    status: statusSchema,
    statusCode: z.number().int().optional(),
    durationMs: z.number().min(0),
    timestamp: z.coerce.date(),
    errorType: z.string().optional(),
    errorMessage: z.string().optional(),
    retryCount: z.number().int().min(0),
    queueName: z.string().optional(),
    payloadSizeBytes: z.number().int().min(0),
    metadata: z.record(z.string()).optional(),
  })
  .superRefine((e, ctx) => {
    if (e.status === 'error' && !e.errorType) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['errorType'],
        message: 'errorType is required when status is error',
      });
    }
  });

export type TelemetryEvent = z.infer<typeof telemetryEventSchema>;

export const deadLetterStatusSchema = z.enum(['failed', 'retrying', 'resolved', 'discarded']);
export const deadLetterKindSchema = z.enum(['invalid_telemetry', 'notification_delivery']);

export const deadLetterEnvelopeSchema = z.object({
  id: z.string().min(1),
  kind: deadLetterKindSchema,
  sessionId: z.string(),
  traceId: z.string().optional(),
  sourceTopic: z.string(),
  originalPayload: z.string(),
  validationErrors: z.array(z.string()).optional(),
  failureReason: z.string(),
  firstFailureAt: z.coerce.date(),
  lastFailureAt: z.coerce.date(),
  retryCount: z.number().int().min(0),
  status: deadLetterStatusSchema,
});
export type DeadLetterEnvelope = z.infer<typeof deadLetterEnvelopeSchema>;
