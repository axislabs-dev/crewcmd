export type AgentStatus = "online" | "idle" | "working" | "offline";
export type TaskStatus = "backlog" | "inbox" | "queued" | "in_progress" | "review" | "done";
export type TaskPriority = "low" | "medium" | "high" | "critical";
export type TaskSource = "manual" | "error_log" | "test_failure" | "ui_scan" | "ci_failure" | "agent_initiative";
export type ProjectStatus = "active" | "completed" | "archived";
export type DocCategory = "Architecture" | "Strategy" | "Research" | "Guide" | "Report" | "Meeting Notes";

export interface Agent {
  id: string;
  callsign: string;
  name: string;
  title: string;
  emoji: string;
  color: string;
  status: AgentStatus;
  currentTask: string | null;
  lastActive: string;
  reportsTo: string | null;
  soulContent: string | null;
  adapterType: string;
  adapterConfig: Record<string, unknown>;
  role: string;
  model: string | null;
  workspacePath: string | null;
  tokenUsage?: {
    totalTokens: number;
    sessionCount: number;
  } | null;
}

export interface Task {
  id: string;
  shortId: number;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  assignedAgentId: string | null;
  humanAssignee: string | null;
  prUrl: string | null;
  prStatus: string | null;
  branch: string | null;
  repo: string | null;
  projectId: string | null;
  source: TaskSource;
  errorHash: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  sortIndex: number;
  images: Array<{ url: string; filename: string; uploadedAt: string }>;
}

export interface Project {
  id: string;
  name: string;
  description: string | null;
  color: string;
  status: ProjectStatus;
  ownerAgentId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Doc {
  id: string;
  title: string;
  content: string;
  category: DocCategory;
  authorAgentId: string | null;
  projectId: string | null;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface Activity {
  id: string;
  agentId: string;
  actionType: string;
  description: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface TimeEntry {
  id: string;
  taskId: string;
  humanAssignee: string;
  startedAt: string;
  stoppedAt: string | null;
  durationSeconds: number | null;
  note: string | null;
  createdAt: string;
}
// Sentinel test - Sun Mar  8 20:15:06 AEST 2026
