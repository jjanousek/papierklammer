import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));

export const repoRoot = path.resolve(scriptsDir, "..");

export function resolveRequestedBaseUrl(explicitUrl) {
  const port = process.env.PORT?.trim() || "3100";
  return (
    explicitUrl?.trim() ||
    process.env.PAPIERKLAMMER_TUI_URL?.trim() ||
    process.env.PAPIERKLAMMER_API_URL?.trim() ||
    `http://127.0.0.1:${port}`
  ).replace(/\/+$/, "");
}

async function fetchJson(url, apiKey = "") {
  const headers = {
    accept: "application/json",
  };
  if (apiKey) {
    headers.authorization = `Bearer ${apiKey}`;
  }

  const response = await fetch(url, {
    headers,
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.json();
}

export async function waitForHealth(baseUrl, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;

  while (Date.now() < deadline) {
    try {
      return await fetchJson(`${baseUrl}/api/health`);
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  const reason =
    lastError instanceof Error ? lastError.message : "timed out waiting for health";
  throw new Error(`Failed to reach ${baseUrl}/api/health: ${reason}`);
}

export async function listCompanies(baseUrl, apiKey = "") {
  const response = await fetchJson(`${baseUrl}/api/companies`, apiKey);
  if (!Array.isArray(response)) {
    throw new Error("Expected /api/companies to return an array");
  }
  return response;
}

export async function resolveLaunchConfig({
  url,
  apiKey,
  companyId,
  waitTimeoutMs = 30_000,
} = {}) {
  const baseUrl = resolveRequestedBaseUrl(url);
  const health = await waitForHealth(baseUrl, waitTimeoutMs);

  const resolvedApiKey =
    apiKey?.trim() ||
    process.env.PAPIERKLAMMER_TUI_API_KEY?.trim() ||
    process.env.PAPIERKLAMMER_API_KEY?.trim() ||
    "";

  if (health.deploymentMode !== "local_trusted" && !resolvedApiKey) {
    throw new Error(
      "Authenticated deployments require PAPIERKLAMMER_API_KEY or --api-key for the TUI.",
    );
  }

  let resolvedCompanyId =
    companyId?.trim() || process.env.PAPIERKLAMMER_TUI_COMPANY_ID?.trim() || "";
  const companies = await listCompanies(baseUrl, resolvedApiKey);

  if (!resolvedCompanyId) {
    if (companies.length === 0) {
      throw new Error(
        "No companies found. Create a company first, then launch the orchestrator TUI.",
      );
    }
    if (companies.length === 1) {
      resolvedCompanyId = String(companies[0]?.id ?? "");
    }
  }

  return {
    baseUrl,
    apiKey: resolvedApiKey,
    companyId: resolvedCompanyId,
    health,
    companies,
  };
}

export function shellEscape(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

export function appleScriptString(value) {
  return `"${String(value)
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')}"`;
}
