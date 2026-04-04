import { useMemo } from "react";
import type { Agent, IssueWorkProduct } from "@papierklammer/shared";
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

function compactPreview(text: string, maxLength = 280) {
  const normalized = text
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

export function extractRunReviewText(resultJson: Record<string, unknown> | null | undefined) {
  if (!resultJson || typeof resultJson !== "object" || Array.isArray(resultJson)) {
    return null;
  }

  for (const key of ["summary", "result", "message", "stdout", "stderr"] as const) {
    const value = readTextValue(resultJson, key);
    if (value) return compactPreview(value);
  }

  return null;
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
}: {
  companyId: string;
  workProducts: IssueWorkProduct[];
  runs: RunForIssue[];
  agentMap: Map<string, Agent>;
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
              const preview = extractRunReviewText(run.resultJson)
                ?? extractTranscriptReviewText(transcriptByRun.get(run.runId));
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
