export interface AnbyNotification {
  id: string;
  tenantId: string;
  recipientId: string;
  sourceAppId: string;
  title: string;
  body: string;
  url?: string;
  read: boolean;
  createdAt: string;
}
