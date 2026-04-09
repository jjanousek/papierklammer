export interface PendingApprovalSummary {
  id: string;
  type: string;
  status: string;
  requestedByAgentId: string | null;
  createdAt: string | null;
}

export interface CompanyIssueSummary {
  id: string;
  identifier: string | null;
  title: string;
  description: string | null;
  status: string;
  projectedStatus?: string | null;
  priority: string;
  assigneeAgentId: string | null;
  updatedAt: string;
  createdAt: string;
}

export interface AgentMutationResult {
  id: string | null;
  status: string | null;
}

type FetchLike = typeof globalThis.fetch;

function normalizeBaseUrl(url: string) {
  return url.replace(/\/+$/, "");
}

async function readJsonError(response: Response) {
  try {
    const payload = (await response.json()) as { error?: unknown };
    if (typeof payload?.error === "string" && payload.error.trim()) {
      return payload.error;
    }
  } catch {
    // Ignore malformed or empty error payloads.
  }

  return `HTTP ${response.status}`;
}

async function requestJson<T>(
  fetchFn: FetchLike,
  input: string,
  init: RequestInit,
): Promise<T> {
  const response = await fetchFn(input, init);
  if (!response.ok) {
    throw new Error(await readJsonError(response));
  }
  return (await response.json()) as T;
}

function authHeaders(apiKey: string) {
  return {
    accept: "application/json",
    authorization: `Bearer ${apiKey}`,
    "content-type": "application/json",
  };
}

export async function listPendingApprovals(
  baseUrl: string,
  apiKey: string,
  companyId: string,
  fetchFn: FetchLike = globalThis.fetch,
): Promise<PendingApprovalSummary[]> {
  const approvals = await requestJson<unknown>(
    fetchFn,
    `${normalizeBaseUrl(baseUrl)}/api/companies/${encodeURIComponent(companyId)}/approvals?status=pending`,
    {
      headers: {
        accept: "application/json",
        authorization: `Bearer ${apiKey}`,
      },
    },
  );

  const approvalList = Array.isArray(approvals) ? approvals : [];

  return [...approvalList].sort((left, right) => {
    const leftTime = left.createdAt ? Date.parse(left.createdAt) : 0;
    const rightTime = right.createdAt ? Date.parse(right.createdAt) : 0;
    return leftTime - rightTime;
  });
}

function compareIssues(left: CompanyIssueSummary, right: CompanyIssueSummary) {
  return Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
}

export async function listCompanyIssues(
  baseUrl: string,
  apiKey: string,
  companyId: string,
  fetchFn: FetchLike = globalThis.fetch,
): Promise<CompanyIssueSummary[]> {
  const issues = await requestJson<unknown>(
    fetchFn,
    `${normalizeBaseUrl(baseUrl)}/api/companies/${encodeURIComponent(companyId)}/issues?status=backlog,todo,in_progress,in_review,blocked`,
    {
      headers: {
        accept: "application/json",
        authorization: `Bearer ${apiKey}`,
      },
    },
  );

  return (Array.isArray(issues) ? issues : [])
    .filter((issue): issue is CompanyIssueSummary => Boolean(issue && typeof issue === "object" && typeof issue.id === "string"))
    .sort(compareIssues);
}

export async function createOrchestratorIssue(
  baseUrl: string,
  apiKey: string,
  input: {
    companyId: string;
    title: string;
    description?: string;
    priority?: string;
  },
  fetchFn: FetchLike = globalThis.fetch,
): Promise<CompanyIssueSummary> {
  return requestJson<CompanyIssueSummary>(
    fetchFn,
    `${normalizeBaseUrl(baseUrl)}/api/orchestrator/issues`,
    {
      method: "POST",
      headers: authHeaders(apiKey),
      body: JSON.stringify(input),
    },
  );
}

export async function unblockIssue(
  baseUrl: string,
  apiKey: string,
  issueId: string,
  fetchFn: FetchLike = globalThis.fetch,
): Promise<{
  issue: CompanyIssueSummary | null;
  recovery?: {
    rejectedIntentCount?: number;
    releasedLeaseId?: string | null;
  };
}> {
  return requestJson(
    fetchFn,
    `${normalizeBaseUrl(baseUrl)}/api/orchestrator/issues/${encodeURIComponent(issueId)}/unblock`,
    {
      method: "POST",
      headers: authHeaders(apiKey),
      body: JSON.stringify({ payload: { source: "tui_issue_desk" } }),
    },
  );
}

export async function approveApproval(
  baseUrl: string,
  apiKey: string,
  approvalId: string,
  fetchFn: FetchLike = globalThis.fetch,
): Promise<PendingApprovalSummary> {
  return requestJson<PendingApprovalSummary>(
    fetchFn,
    `${normalizeBaseUrl(baseUrl)}/api/approvals/${encodeURIComponent(approvalId)}/approve`,
    {
      method: "POST",
      headers: authHeaders(apiKey),
      body: "{}",
    },
  );
}

export async function rejectApproval(
  baseUrl: string,
  apiKey: string,
  approvalId: string,
  fetchFn: FetchLike = globalThis.fetch,
): Promise<PendingApprovalSummary> {
  return requestJson<PendingApprovalSummary>(
    fetchFn,
    `${normalizeBaseUrl(baseUrl)}/api/approvals/${encodeURIComponent(approvalId)}/reject`,
    {
      method: "POST",
      headers: authHeaders(apiKey),
      body: "{}",
    },
  );
}

export async function invokeAgentHeartbeat(
  baseUrl: string,
  apiKey: string,
  agentId: string,
  fetchFn: FetchLike = globalThis.fetch,
): Promise<AgentMutationResult> {
  return requestJson<AgentMutationResult>(
    fetchFn,
    `${normalizeBaseUrl(baseUrl)}/api/agents/${encodeURIComponent(agentId)}/heartbeat/invoke`,
    {
      method: "POST",
      headers: authHeaders(apiKey),
      body: "{}",
    },
  );
}

export async function wakeAgent(
  baseUrl: string,
  apiKey: string,
  agentId: string,
  fetchFn: FetchLike = globalThis.fetch,
): Promise<AgentMutationResult> {
  return requestJson<AgentMutationResult>(
    fetchFn,
    `${normalizeBaseUrl(baseUrl)}/api/agents/${encodeURIComponent(agentId)}/wakeup`,
    {
      method: "POST",
      headers: authHeaders(apiKey),
      body: JSON.stringify({
        source: "on_demand",
        triggerDetail: "manual",
        reason: "tui_shortcut",
      }),
    },
  );
}
