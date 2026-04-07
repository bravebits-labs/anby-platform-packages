export interface AnbyObjective {
  id: string;
  title: string;
  ownerId: string;
  departmentId?: string;
  status: 'draft' | 'active' | 'completed' | 'cancelled';
  progress: number; // 0-100
  cycleStart: string; // ISO 8601
  cycleEnd: string;
}
