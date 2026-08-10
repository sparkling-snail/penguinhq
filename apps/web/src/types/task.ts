export interface Task {
  id: string;
  source_agent_id: string;
  destination_agent_id: string | null;
  destination_role: string;
  task_type: string;
  priority: string;
  status: string;
  payload: Record<string, unknown> | null;
  result: Record<string, unknown> | null;
  createdAt: string | null;
  completedAt: string | null;
}
