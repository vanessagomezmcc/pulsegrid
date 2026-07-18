/** Redpanda topic names. Must match go/shared/events. */
export const topics = {
  telemetryRaw: 'pulsegrid.telemetry.raw',
  telemetryProcessed: 'pulsegrid.telemetry.processed',
  alerts: 'pulsegrid.alerts',
  incidents: 'pulsegrid.incidents',
  deadLetter: 'pulsegrid.deadletter',
} as const;
