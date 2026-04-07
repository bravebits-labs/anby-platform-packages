export interface AnbyOrgNode {
  id: string;
  name: string;
  level: number;
  parentId: string | null;
  email?: string;
  department?: string;
  team?: string;
}
