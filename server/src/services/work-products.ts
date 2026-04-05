import { basename } from "node:path";
import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import type { Db } from "@papierklammer/db";
import { activityLog, heartbeatRuns, issueComments, issueWorkProducts } from "@papierklammer/db";
import type { IssueWorkProduct } from "@papierklammer/shared";

type IssueWorkProductRow = typeof issueWorkProducts.$inferSelect;
type WorkProductIssueRef = {
  id: string;
  companyId?: string | null;
  projectId?: string | null;
};
type DerivedCommentSource = {
  commentId: string;
  companyId: string;
  issueId: string;
  projectId: string | null;
  body: string;
  createdAt: Date;
  runId: string | null;
  runStatus: string | null;
  runFinishedAt: Date | null;
};

function toIssueWorkProduct(row: IssueWorkProductRow): IssueWorkProduct {
  return {
    id: row.id,
    companyId: row.companyId,
    projectId: row.projectId ?? null,
    issueId: row.issueId,
    executionWorkspaceId: row.executionWorkspaceId ?? null,
    runtimeServiceId: row.runtimeServiceId ?? null,
    type: row.type as IssueWorkProduct["type"],
    provider: row.provider,
    externalId: row.externalId ?? null,
    title: row.title,
    url: row.url ?? null,
    status: row.status,
    reviewState: row.reviewState as IssueWorkProduct["reviewState"],
    isPrimary: row.isPrimary,
    healthStatus: row.healthStatus as IssueWorkProduct["healthStatus"],
    summary: row.summary ?? null,
    metadata: (row.metadata as Record<string, unknown> | null) ?? null,
    createdByRunId: row.createdByRunId ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function normalizeKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function normalizeText(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function readBodyMatch(body: string, pattern: RegExp) {
  const match = pattern.exec(body);
  const value = match?.[1];
  return typeof value === "string" ? normalizeText(value) : null;
}

function extractLabeledCommentFields(body: string) {
  const fields = new Map<string, { label: string; value: string }>();
  const linePattern =
    /^\s*[-*]\s*([^:\n`[]+?)(?:\s*:)?\s*(?:`([^`]+)`|\[([^\]]+)\]\(([^)]+)\)|(.+))\s*$/gm;
  let match: RegExpExecArray | null;

  while ((match = linePattern.exec(body)) !== null) {
    const label = normalizeText(match[1]);
    const value = normalizeText(match[2] ?? match[4] ?? match[5] ?? match[3] ?? null);
    if (!label || !value) continue;
    const key = normalizeKey(label);
    if (!key || fields.has(key)) continue;
    fields.set(key, { label, value });
  }

  return fields;
}

function firstField(
  fields: Map<string, { label: string; value: string }>,
  keys: readonly string[],
) {
  for (const key of keys) {
    const entry = fields.get(key);
    if (entry?.value) return entry.value;
  }
  return null;
}

function inferArtifactTitle(label: string | null, source: string) {
  if (label) {
    const normalized = normalizeKey(label);
    if (normalized && !["artifact", "artifactpath", "output", "outputpath", "report", "reportpath"].includes(normalized)) {
      return label;
    }
  }

  const normalizedSource = source.replace(/[?#].*$/, "").replace(/\/+$/, "");
  const fileName = basename(normalizedSource);
  return fileName && fileName !== "." ? fileName : "Artifact output";
}

function buildArtifactSignatures(product: Pick<IssueWorkProduct, "type" | "url" | "title" | "metadata">) {
  const metadata = product.metadata ?? {};
  const pathValue = typeof metadata["path"] === "string" ? metadata["path"].trim() : "";
  const sha256Value = typeof metadata["sha256"] === "string" ? metadata["sha256"].trim() : "";
  const urlValue = product.url?.trim() ?? "";
  const titleValue = product.title.trim();
  const signatures = new Set<string>();

  if (pathValue) {
    signatures.add([product.type, "path", pathValue.toLowerCase()].join("|"));
    if (titleValue) {
      signatures.add([product.type, "title+path", titleValue.toLowerCase(), pathValue.toLowerCase()].join("|"));
    }
  }

  if (urlValue) {
    signatures.add([product.type, "url", urlValue.toLowerCase()].join("|"));
    if (titleValue) {
      signatures.add([product.type, "title+url", titleValue.toLowerCase(), urlValue.toLowerCase()].join("|"));
    }
  }

  if (sha256Value) {
    signatures.add([product.type, "sha256", sha256Value.toLowerCase()].join("|"));
  }

  if (titleValue && signatures.size === 0) {
    signatures.add([product.type, "title", titleValue.toLowerCase()].join("|"));
  }

  return [...signatures];
}

export function deriveIssueWorkProductsFromComments(commentSources: DerivedCommentSource[]): IssueWorkProduct[] {
  const derived = commentSources
    .filter((source) => source.runId && source.runStatus === "succeeded")
    .map<IssueWorkProduct | null>((source) => {
      const fields = extractLabeledCommentFields(source.body);
      const artifactPath =
        firstField(fields, ["artifactpath", "artifact", "outputpath", "outputartifact", "reportpath", "report"])
        ?? readBodyMatch(source.body, /\bartifact path\b\s*[:=]?\s*`?([^\n`]+?)`?(?:$|\n)/im);

      if (!artifactPath) return null;

      const sha256 =
        firstField(fields, ["sha256", "artifactsha256"])
        ?? readBodyMatch(source.body, /\bsha256\b\s*[:=]?\s*`?([a-f0-9]{16,})`?/i);
      const workspace =
        firstField(fields, ["workspaceroot", "workspace", "root"])
        ?? readBodyMatch(source.body, /\bworkspace(?: root)?\b\s*[:=]?\s*`?([^\n`]+?)`?(?:$|\n)/im);
      const command =
        firstField(fields, ["command"])
        ?? readBodyMatch(source.body, /\bcommand\b\s*[:=]?\s*`?([^\n`]+?)`?(?:$|\n)/im);
      const result =
        firstField(fields, ["result", "status"])
        ?? readBodyMatch(source.body, /\bresult\b\s*[:=]?\s*`?([^\n`]+?)`?(?:$|\n)/im);
      const tasksValue =
        firstField(fields, ["tasks", "taskcount"])
        ?? readBodyMatch(source.body, /\btasks?\b\s*[:=]?\s*`?(\d+)`?/i);
      const tasks = tasksValue && /^\d+$/.test(tasksValue) ? Number.parseInt(tasksValue, 10) : null;
      const url = /^https?:\/\//i.test(artifactPath) ? artifactPath : null;
      const title = inferArtifactTitle(fields.get("artifactpath")?.label ?? fields.get("artifact")?.label ?? null, artifactPath);
      const metadataEntries = Object.entries({
        path: artifactPath,
        workspace,
        sha256,
        command,
        ...(tasks != null ? { tasks } : {}),
        sourceCommentId: source.commentId,
        derivedFrom: "issue_comment",
      }).filter(([, value]) => value != null && value !== "");

      return {
        id: `derived-comment-${source.commentId}`,
        companyId: source.companyId,
        projectId: source.projectId,
        issueId: source.issueId,
        executionWorkspaceId: null,
        runtimeServiceId: null,
        type: "artifact",
        provider: "paperclip",
        externalId: null,
        title,
        url,
        status: "ready_for_review",
        reviewState: "needs_board_review",
        isPrimary: false,
        healthStatus: "healthy",
        summary: [result, artifactPath].filter(Boolean).join(" · "),
        metadata: metadataEntries.length > 0 ? Object.fromEntries(metadataEntries) : null,
        createdByRunId: source.runId,
        createdAt: source.runFinishedAt ?? source.createdAt,
        updatedAt: source.createdAt,
      };
    })
    .filter((product): product is IssueWorkProduct => product !== null);

  if (derived.length > 0) {
    derived[0] = { ...derived[0], isPrimary: true };
  }

  return derived;
}

export function workProductService(db: Db) {
  return {
    listForIssue: async (issue: string | WorkProductIssueRef) => {
      const issueId = typeof issue === "string" ? issue : issue.id;
      const issueCompanyId = typeof issue === "string" ? null : normalizeText(issue.companyId);
      const issueProjectId = typeof issue === "string" ? null : issue.projectId ?? null;

      const rows = await db
        .select()
        .from(issueWorkProducts)
        .where(eq(issueWorkProducts.issueId, issueId))
        .orderBy(desc(issueWorkProducts.isPrimary), desc(issueWorkProducts.updatedAt));
      const persisted = rows.map(toIssueWorkProduct);

      const commentConditions = [eq(issueComments.issueId, issueId)];
      if (issueCompanyId) {
        commentConditions.push(eq(issueComments.companyId, issueCompanyId));
      }

      const commentRows = await db
        .select({
          id: issueComments.id,
          companyId: issueComments.companyId,
          body: issueComments.body,
          createdAt: issueComments.createdAt,
        })
        .from(issueComments)
        .where(and(...commentConditions))
        .orderBy(desc(issueComments.createdAt), desc(issueComments.id));

      if (commentRows.length === 0) {
        return persisted;
      }

      const activityConditions = [
        eq(activityLog.entityType, "issue"),
        eq(activityLog.entityId, issueId),
        eq(activityLog.action, "issue.comment_added"),
        isNotNull(activityLog.runId),
      ];
      if (issueCompanyId) {
        activityConditions.push(eq(activityLog.companyId, issueCompanyId));
      }

      const activityRows = await db
        .select({
          runId: activityLog.runId,
          details: activityLog.details,
          createdAt: activityLog.createdAt,
        })
        .from(activityLog)
        .where(and(...activityConditions))
        .orderBy(desc(activityLog.createdAt));

      const runIdByCommentId = new Map<string, string>();
      for (const row of activityRows) {
        const commentId =
          row.details && typeof row.details["commentId"] === "string"
            ? normalizeText(row.details["commentId"])
            : null;
        const runId = normalizeText(row.runId);
        if (!commentId || !runId || runIdByCommentId.has(commentId)) continue;
        runIdByCommentId.set(commentId, runId);
      }

      const runIds = [...new Set([...runIdByCommentId.values()])];
      const runStatusById = new Map<string, { status: string | null; finishedAt: Date | null }>();
      if (runIds.length > 0) {
        const runs = await db
          .select({
            id: heartbeatRuns.id,
            status: heartbeatRuns.status,
            finishedAt: heartbeatRuns.finishedAt,
          })
          .from(heartbeatRuns)
          .where(inArray(heartbeatRuns.id, runIds));

        for (const run of runs) {
          runStatusById.set(run.id, {
            status: normalizeText(run.status),
            finishedAt: run.finishedAt ?? null,
          });
        }
      }

      const derived = deriveIssueWorkProductsFromComments(
        commentRows.map((comment) => {
          const runId = runIdByCommentId.get(comment.id) ?? null;
          const run = runId ? runStatusById.get(runId) ?? null : null;
          return {
            commentId: comment.id,
            companyId: issueCompanyId ?? comment.companyId,
            issueId,
            projectId: issueProjectId,
            body: comment.body,
            createdAt: comment.createdAt,
            runId,
            runStatus: run?.status ?? null,
            runFinishedAt: run?.finishedAt ?? null,
          };
        }),
      );

      const persistedSignatures = new Set(
        persisted.filter((product) => product.type === "artifact").flatMap(buildArtifactSignatures),
      );
      const mergedDerived = derived
        .filter((product) => !buildArtifactSignatures(product).some((signature) => persistedSignatures.has(signature)))
        .map((product) => ({ ...product, isPrimary: persisted.some((entry) => entry.isPrimary) ? false : product.isPrimary }));

      return [...persisted, ...mergedDerived];
    },

    getById: async (id: string) => {
      const row = await db
        .select()
        .from(issueWorkProducts)
        .where(eq(issueWorkProducts.id, id))
        .then((rows) => rows[0] ?? null);
      return row ? toIssueWorkProduct(row) : null;
    },

    createForIssue: async (issueId: string, companyId: string, data: Omit<typeof issueWorkProducts.$inferInsert, "issueId" | "companyId">) => {
      const row = await db.transaction(async (tx) => {
        if (data.isPrimary) {
          await tx
            .update(issueWorkProducts)
            .set({ isPrimary: false, updatedAt: new Date() })
            .where(
              and(
                eq(issueWorkProducts.companyId, companyId),
                eq(issueWorkProducts.issueId, issueId),
                eq(issueWorkProducts.type, data.type),
              ),
            );
        }
        return await tx
          .insert(issueWorkProducts)
          .values({
            ...data,
            companyId,
            issueId,
          })
          .returning()
          .then((rows) => rows[0] ?? null);
      });
      return row ? toIssueWorkProduct(row) : null;
    },

    update: async (id: string, patch: Partial<typeof issueWorkProducts.$inferInsert>) => {
      const row = await db.transaction(async (tx) => {
        const existing = await tx
          .select()
          .from(issueWorkProducts)
          .where(eq(issueWorkProducts.id, id))
          .then((rows) => rows[0] ?? null);
        if (!existing) return null;

        if (patch.isPrimary === true) {
          await tx
            .update(issueWorkProducts)
            .set({ isPrimary: false, updatedAt: new Date() })
            .where(
              and(
                eq(issueWorkProducts.companyId, existing.companyId),
                eq(issueWorkProducts.issueId, existing.issueId),
                eq(issueWorkProducts.type, existing.type),
              ),
            );
        }

        return await tx
          .update(issueWorkProducts)
          .set({ ...patch, updatedAt: new Date() })
          .where(eq(issueWorkProducts.id, id))
          .returning()
          .then((rows) => rows[0] ?? null);
      });
      return row ? toIssueWorkProduct(row) : null;
    },

    remove: async (id: string) => {
      const row = await db
        .delete(issueWorkProducts)
        .where(eq(issueWorkProducts.id, id))
        .returning()
        .then((rows) => rows[0] ?? null);
      return row ? toIssueWorkProduct(row) : null;
    },
  };
}

export { toIssueWorkProduct };
