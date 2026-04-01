import type { OrchestratorClient } from "../client.js";

export interface CreateIssueOptions {
  companyId: string;
  title: string;
  assignee?: string;
  project?: string;
  priority?: string;
  description?: string;
}

interface CreateIssueResponse {
  id: string;
  title: string;
  status: string;
  [key: string]: unknown;
}

export async function createIssueCommand(
  client: OrchestratorClient,
  options: CreateIssueOptions,
  log: (msg: string) => void = console.log,
): Promise<void> {
  const body: Record<string, unknown> = {
    companyId: options.companyId,
    title: options.title,
  };

  if (options.assignee) {
    body.assigneeAgentId = options.assignee;
  }
  if (options.project) {
    body.projectId = options.project;
  }
  if (options.priority) {
    body.priority = options.priority;
  }
  if (options.description) {
    body.description = options.description;
  }

  const issue = await client.post<CreateIssueResponse>(
    "/api/orchestrator/issues",
    body,
  );

  log(`Issue created: ${issue.id}`);
  log(`  Title: ${issue.title}`);
  log(`  Status: ${issue.status}`);
}
