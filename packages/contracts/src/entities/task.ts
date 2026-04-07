export interface AnbyTask {
  id: string;
  title: string;
  assigneeId: string;
  status: 'todo' | 'in_progress' | 'done' | 'cancelled';
  dueDate?: string;
}
