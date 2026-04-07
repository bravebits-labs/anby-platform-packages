export interface AnbySearchResult {
  id: string;
  sourceAppId: string;
  entityType: string;
  title: string;
  snippet: string;
  url: string;
  score: number;
  metadata?: Record<string, unknown>;
}
