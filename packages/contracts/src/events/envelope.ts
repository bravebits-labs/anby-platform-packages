export interface AnbyEvent<T = unknown> {
  id: string;
  type: string;
  source: string;
  tenantId: string;
  timestamp: string;
  version: '1';
  correlationId: string;
  actor: { userId: string; email: string };
  data: T;
}
