import { useMemo } from "react";
import type { Agent, IssueComment, IssueWorkProduct } from "@papierklammer/shared";
import { Link } from "@/lib/router";
import type { RunForIssue } from "../api/activity";
import type { LiveRunForIssue } from "../api/heartbeats";
import { formatDateTime } from "../lib/utils";
import { type TranscriptEntry } from "../adapters";
import { Identity } from "./Identity";
import { StatusBadge } from "./StatusBadge";
import { useLiveRunTranscripts } from "./transcript/useLiveRunTranscripts";

const TERMINAL_RUN_STATUSES = new Set(["succeeded", "failed", "cancelled", "timed_out"]);

function formatLabel(value: string | null | undefined) {
  if (!value) return "Unknown";
  return value.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function readTextValue(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function compactPreview(text: string, maxLength = 280) {
  const normalized = text
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

function extractStructuredErrorText(value: unknown): string | null {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const text = extractStructuredErrorText(item);
      if (text) return text;
    }
    return null;
  }

  const record = asRecord(value);
  if (!record) return null;

  for (const key of ["summary", "message", "detail", "details", "reason", "error"] as const) {
    const text = extractStructuredErrorText(record[key]);
    if (text) return text;
  }

  return null;
}

export function extractRunReviewText(resultJson: Record<string, unknown> | null | undefined) {
  if (!resultJson || typeof resultJson !== "object" || Array.isArray(resultJson)) {
    return null;
  }

  for (const key of ["summary", "result", "message"] as const) {
    const value = readTextValue(resultJson, key);
    if (value) return compactPreview(value);
  }

  const errorText = extractStructuredErrorText(resultJson.error);
  if (errorText) return compactPreview(errorText);

  for (const key of ["stdout", "stderr"] as const) {
    const value = readTextValue(resultJson, key);
    if (value) return compactPreview(value);
  }

  return null;
}

function stripMarkdownToText(value: string) {
  return value
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, "$1")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^>\s?/gm, "")
    .replace(/^[-*+]\s+/gm, "")
    .replace(/^\d+\.\s+/gm, "")
    .replace(/\r\n/g, "\n");
}

function extractCommentReviewText(body: string) {
  const plainText = stripMarkdownToText(body)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
  return plainText ? compactPreview(plainText) : null;
}

function extractCommentLinks(body: string) {
  const results: Array<{ label: string; href: string }> = [];
  const seen = new Set<string>();
  const regex = /\[([^\]]+)\]\(([^)]+)\)/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(body)) !== null) {
    const label = match[1]?.trim() ?? "";
    const href = match[2]?.trim() ?? "";
    if (!label || !href) continue;
    if (!(href.startsWith("/") || href.startsWith("http://") || href.startsWith("https://"))) continue;
    if (href.startsWith("/tmp/")) continue;
    const dedupeKey = `${label}|${href}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    results.push({ label, href });
    if (results.length >= 4) break;
  }

  return results;
}

function metadataValueText(value: unknown) {
  if (typeof value === "string" && value.trim().length > 0) return compactPreview(value.trim(), 120);
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return null;
}

function metadataLabel(key: string) {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function describeWorkProductMetadata(product: IssueWorkProduct) {
  const details: Array<{ label: string; value: string }> = [];
  const seen = new Set<string>();
  const push = (label: string, value: string | null) => {
    if (!value) return;
    const dedupeKey = `${label}|${value}`;
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);
    details.push({ label, value });
  };

  push("External ID", product.externalId);
  if (product.healthStatus !== "unknown") {
    push("Health", formatLabel(product.healthStatus));
  }

  const metadata = product.metadata ?? {};
  const preferredKeys = [
    "branchName",
    "branch",
    "baseRef",
    "commitSha",
    "commit",
    "artifactCount",
    "fileCount",
    "fileName",
    "path",
    "repoUrl",
    "repoRef",
  ] as const;

  for (const key of preferredKeys) {
    push(metadataLabel(key), metadataValueText(metadata[key]));
    if (details.length >= 4) return details;
  }

  for (const [key, value] of Object.entries(metadata)) {
    if (preferredKeys.includes(key as (typeof preferredKeys)[number])) continue;
    if (["title", "summary", "status", "provider", "url"].includes(key)) continue;
    push(metadataLabel(key), metadataValueText(value));
    if (details.length >= 4) break;
  }

  return details;
}

function describeWorkProduct(product: IssueWorkProduct) {
  return product.summary?.trim() || product.url || null;
}

function extractTranscriptReviewText(entries: TranscriptEntry[] | undefined) {
  if (!entries || entries.length === 0) return null;

  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    const text =
      entry.kind === "assistant" ||
      entry.kind === "thinking" ||
      entry.kind === "result" ||
      entry.kind === "stderr" ||
      entry.kind === "stdout"
        ? entry.text
        : entry.kind === "tool_result"
          ? entry.content
          : null;
    if (typeof text === "string" && text.trim().length > 0) {
      return compactPreview(text);
    }
  }

  return null;
}

export function IssueReviewSurfaces({
  companyId,
  workProducts,
  runs,
  agentMap,
  comments = [],
}: {
  companyId: string;
  workProducts: IssueWorkProduct[];
  runs: RunForIssue[];
  agentMap: Map<string, Agent>;
  comments?: Array<Pick<IssueComment, "id" | "body" | "createdAt"> & { runId?: string | null }>;
}) {
  const completedRuns = useMemo(
    () =>
      [...runs]
        .filter((run) => TERMINAL_RUN_STATUSES.has(run.status))
        .sort(
          (a, b) =>
            new Date(b.finishedAt ?? b.startedAt ?? b.createdAt).getTime()
            - new Date(a.finishedAt ?? a.startedAt ?? a.createdAt).getTime(),
        ),
    [runs],
  );

  const orderedWorkProducts = useMemo(
    () =>
      [...workProducts].sort((a, b) => {
        if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      }),
    [workProducts],
  );

  const runById = useMemo(() => new Map(completedRuns.map((run) => [run.runId, run])), [completedRuns]);
  const commentSummaryByRun = useMemo(() => {
    const summaries = new Map<string, { preview: string; links: Array<{ label: string; href: string }> }>();
    const sortedComments = [...comments]
      .filter((comment) => typeof comment.runId === "string" && comment.runId.length > 0)
      .sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );

    for (const comment of sortedComments) {
      const runId = comment.runId ?? null;
      if (!runId || summaries.has(runId)) continue;
      const preview = extractCommentReviewText(comment.body);
      if (!preview) continue;
      summaries.set(runId, {
        preview,
        links: extractCommentLinks(comment.body),
      });
    }

    return summaries;
  }, [comments]);
  const transcriptRuns = useMemo<LiveRunForIssue[]>(
    () =>
      completedRuns.slice(0, 3).map((run) => ({
        id: run.runId,
        status: run.status,
        invocationSource: run.invocationSource,
        triggerDetail: null,
        startedAt: run.startedAt,
        finishedAt: run.finishedAt,
        createdAt: run.createdAt,
        agentId: run.agentId,
        agentName: agentMap.get(run.agentId)?.name ?? run.agentId.slice(0, 8),
        adapterType: agentMap.get(run.agentId)?.adapterType ?? "process",
        issueId: null,
      })),
    [agentMap, completedRuns],
  );
  const { transcriptByRun } = useLiveRunTranscripts({ runs: transcriptRuns, companyId });

  if (orderedWorkProducts.length === 0 && completedRuns.length === 0) return null;

  return (
    <section className="space-y-3">
      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-medium text-muted-foreground">Review surfaces</h3>
        <p className="text-xs text-muted-foreground">
          Concrete outputs and completed run results linked to this issue.
        </p>
      </div>

      {orderedWorkProducts.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
            Work products
          </div>
          <div className="space-y-2">
            {orderedWorkProducts.map((product) => {
              const createdByRun = product.createdByRunId ? runById.get(product.createdByRunId) ?? null : null;
              const summary = describeWorkProduct(product);
              const metadata = describeWorkProductMetadata(product);

              return (
                <article key={product.id} className="rounded-lg border border-border p-3">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium text-foreground">{product.title}</span>
                        {product.isPrimary && (
                          <span className="inline-flex border border-cyan-500/30 bg-cyan-500/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.16em] text-cyan-700 dark:text-cyan-300">
                            Primary
                          </span>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                        <span className="inline-flex border border-border px-2 py-0.5 uppercase tracking-[0.14em]">
                          {formatLabel(product.type)}
                        </span>
                        <span className="inline-flex border border-border px-2 py-0.5 uppercase tracking-[0.14em]">
                          {formatLabel(product.status)}
                        </span>
                        {product.reviewState !== "none" && (
                          <span className="inline-flex border border-border px-2 py-0.5 uppercase tracking-[0.14em]">
                            {formatLabel(product.reviewState)}
                          </span>
                        )}
                      </div>
                      {summary && (
                        <p className="whitespace-pre-wrap break-words text-sm text-foreground/90">{summary}</p>
                      )}
                      {metadata.length > 0 && (
                        <dl className="grid gap-x-3 gap-y-1 text-[11px] text-muted-foreground sm:grid-cols-2">
                          {metadata.map((entry) => (
                            <div key={`${product.id}:${entry.label}`} className="break-all">
                              <dt className="inline">{entry.label}: </dt>
                              <dd className="inline text-foreground/90">{entry.value}</dd>
                            </div>
                          ))}
                        </dl>
                      )}
                      <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
                        <span>{formatLabel(product.provider)}</span>
                        <span>{formatDateTime(product.updatedAt)}</span>
                        {createdByRun ? (
                          <Link
                            to={`/agents/${createdByRun.agentId}/runs/${createdByRun.runId}`}
                            className="font-mono text-foreground hover:underline"
                          >
                            run {createdByRun.runId.slice(0, 8)}
                          </Link>
                        ) : null}
                      </div>
                    </div>

                    <div className="shrink-0">
                      {product.url ? (
                        <a
                          href={product.url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex border border-border bg-background/80 px-2.5 py-1 text-[11px] font-medium hover:opacity-80"
                        >
                          Open work product
                        </a>
                      ) : createdByRun ? (
                        <Link
                          to={`/agents/${createdByRun.agentId}/runs/${createdByRun.runId}`}
                          className="inline-flex border border-border bg-background/80 px-2.5 py-1 text-[11px] font-medium hover:opacity-80"
                        >
                          Open source run
                        </Link>
                      ) : null}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      )}

      {completedRuns.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
            Completed runs
          </div>
          <div className="space-y-2">
            {completedRuns.map((run) => {
              const commentSummary = commentSummaryByRun.get(run.runId) ?? null;
              const preview = extractRunReviewText(run.resultJson)
                ?? extractTranscriptReviewText(transcriptByRun.get(run.runId))
                ?? commentSummary?.preview;
              const agentName = agentMap.get(run.agentId)?.name ?? run.agentId.slice(0, 8);

              return (
                <article key={run.runId} className="rounded-lg border border-border p-3">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <Identity name={agentName} size="sm" />
                        <StatusBadge status={run.status} />
                        <span className="text-[11px] text-muted-foreground">
                          {formatDateTime(run.finishedAt ?? run.startedAt ?? run.createdAt)}
                        </span>
                      </div>
                      {preview ? (
                        <p className="whitespace-pre-wrap break-words text-sm text-foreground/90">{preview}</p>
                      ) : (
                        <p className="text-sm text-muted-foreground">
                          Transcript, logs, and workspace operations remain available on the run detail page.
                        </p>
                      )}
                      {commentSummary && commentSummary.links.length > 0 && (
                        <div className="flex flex-wrap items-center gap-2 text-[11px]">
                          <span className="text-muted-foreground">Related outputs:</span>
                          {commentSummary.links.map((entry) => (
                            entry.href.startsWith("/") ? (
                              <Link
                                key={`${run.runId}:${entry.href}`}
                                to={entry.href}
                                className="inline-flex border border-border bg-background/80 px-2 py-0.5 font-medium hover:opacity-80"
                              >
                                {entry.label}
                              </Link>
                            ) : (
                              <a
                                key={`${run.runId}:${entry.href}`}
                                href={entry.href}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex border border-border bg-background/80 px-2 py-0.5 font-medium hover:opacity-80"
                              >
                                {entry.label}
                              </a>
                            )
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="shrink-0">
                      <Link
                        to={`/agents/${run.agentId}/runs/${run.runId}`}
                        className="inline-flex border border-border bg-background/80 px-2.5 py-1 text-[11px] font-medium hover:opacity-80"
                      >
                        Inspect run
                      </Link>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
