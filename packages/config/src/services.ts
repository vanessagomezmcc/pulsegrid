/** Service identities shared by the API and web app. Mirrors the services seed rows. */
export const serviceIds = [
  'auth-service',
  'payment-service',
  'order-service',
  'notification-service',
] as const;
export type ServiceId = (typeof serviceIds)[number];

export const serviceMeta: Record<ServiceId, { displayName: string; description: string }> = {
  'auth-service': {
    displayName: 'Authentication',
    description: 'Validates synthetic user sessions and starts the checkout chain.',
  },
  'payment-service': {
    displayName: 'Payments',
    description: 'Processes synthetic payments with configurable latency, failures, and timeouts.',
  },
  'order-service': {
    displayName: 'Orders',
    description: 'Persists synthetic orders and dispatches confirmations.',
  },
  'notification-service': {
    displayName: 'Notifications',
    description: 'Queues and delivers synthetic confirmations; supports outage and backlog scenarios.',
  },
};

/** upstream -> downstream edges of the simulated dependency graph. */
export const dependencyEdges: ReadonlyArray<readonly [ServiceId, ServiceId]> = [
  ['auth-service', 'payment-service'],
  ['payment-service', 'order-service'],
  ['order-service', 'notification-service'],
];
