import { describe, expect, it } from "vitest";
import { getTableColumns } from "drizzle-orm";
import {
  dispatchIntents,
  executionLeases,
  executionEnvelopes,
  controlPlaneEvents,
  heartbeatRuns,
  issues,
  issueDependencies,
} from "./schema/index.js";

describe("dispatch_intents schema", () => {
  it("has all required columns with correct types", () => {
    const columns = getTableColumns(dispatchIntents);
    const columnNames = Object.keys(columns);

    // Verify all expected columns exist
    const expectedColumns = [
      "id",
      "companyId",
      "issueId",
      "projectId",
      "goalId",
      "workspaceId",
      "targetAgentId",
      "intentType",
      "priority",
      "status",
      "dedupeKey",
      "sourceEventId",
      "notBefore",
      "resolvedAt",
      "createdAt",
      "updatedAt",
    ];

    for (const col of expectedColumns) {
      expect(columnNames, `missing column: ${col}`).toContain(col);
    }

    // Verify column count matches exactly
    expect(columnNames).toHaveLength(expectedColumns.length);

    // Verify key column properties
    expect(columns.id.notNull).toBe(true);
    expect(columns.companyId.notNull).toBe(true);
    expect(columns.issueId.notNull).toBe(true);
    expect(columns.projectId.notNull).toBe(true);
    expect(columns.targetAgentId.notNull).toBe(true);
    expect(columns.intentType.notNull).toBe(true);
    expect(columns.priority.notNull).toBe(true);
    expect(columns.status.notNull).toBe(true);
    expect(columns.createdAt.notNull).toBe(true);
    expect(columns.updatedAt.notNull).toBe(true);

    // Optional columns should not be marked notNull
    expect(columns.goalId.notNull).toBe(false);
    expect(columns.workspaceId.notNull).toBe(false);
    expect(columns.dedupeKey.notNull).toBe(false);
    expect(columns.sourceEventId.notNull).toBe(false);
    expect(columns.notBefore.notNull).toBe(false);
    expect(columns.resolvedAt.notNull).toBe(false);
  });

  it("has correct default values", () => {
    const columns = getTableColumns(dispatchIntents);
    expect(columns.priority.hasDefault).toBe(true);
    expect(columns.status.hasDefault).toBe(true);
    expect(columns.createdAt.hasDefault).toBe(true);
    expect(columns.updatedAt.hasDefault).toBe(true);
    expect(columns.id.hasDefault).toBe(true);
  });
});

describe("execution_leases schema", () => {
  it("has all required columns with correct types", () => {
    const columns = getTableColumns(executionLeases);
    const columnNames = Object.keys(columns);

    const expectedColumns = [
      "id",
      "leaseType",
      "issueId",
      "agentId",
      "runId",
      "state",
      "ttlSeconds",
      "companyId",
      "grantedAt",
      "renewedAt",
      "expiresAt",
      "releasedAt",
      "releaseReason",
      "createdAt",
      "updatedAt",
    ];

    for (const col of expectedColumns) {
      expect(columnNames, `missing column: ${col}`).toContain(col);
    }

    expect(columnNames).toHaveLength(expectedColumns.length);

    // Verify key column properties
    expect(columns.id.notNull).toBe(true);
    expect(columns.leaseType.notNull).toBe(true);
    expect(columns.agentId.notNull).toBe(true);
    expect(columns.state.notNull).toBe(true);
    expect(columns.companyId.notNull).toBe(true);
    expect(columns.grantedAt.notNull).toBe(true);
    expect(columns.expiresAt.notNull).toBe(true);
    expect(columns.createdAt.notNull).toBe(true);
    expect(columns.updatedAt.notNull).toBe(true);

    // Optional columns
    expect(columns.issueId.notNull).toBe(false);
    expect(columns.runId.notNull).toBe(false);
    expect(columns.ttlSeconds.notNull).toBe(false);
    expect(columns.renewedAt.notNull).toBe(false);
    expect(columns.releasedAt.notNull).toBe(false);
    expect(columns.releaseReason.notNull).toBe(false);
  });

  it("has correct default values", () => {
    const columns = getTableColumns(executionLeases);
    expect(columns.state.hasDefault).toBe(true);
    expect(columns.grantedAt.hasDefault).toBe(true);
    expect(columns.createdAt.hasDefault).toBe(true);
    expect(columns.updatedAt.hasDefault).toBe(true);
    expect(columns.id.hasDefault).toBe(true);
  });
});

describe("execution_envelopes schema", () => {
  it("has all required columns with correct types", () => {
    const columns = getTableColumns(executionEnvelopes);
    const columnNames = Object.keys(columns);

    const expectedColumns = [
      "id",
      "runId",
      "companyId",
      "agentId",
      "issueId",
      "projectId",
      "goalId",
      "workspaceId",
      "wakeReason",
      "runKind",
      "executionPolicyVersion",
      "workspaceBindingMode",
      "createdAt",
    ];

    for (const col of expectedColumns) {
      expect(columnNames, `missing column: ${col}`).toContain(col);
    }

    expect(columnNames).toHaveLength(expectedColumns.length);

    // Verify key column properties
    expect(columns.id.notNull).toBe(true);
    expect(columns.runId.notNull).toBe(true);
    expect(columns.companyId.notNull).toBe(true);
    expect(columns.agentId.notNull).toBe(true);
    expect(columns.issueId.notNull).toBe(true);
    expect(columns.wakeReason.notNull).toBe(true);
    expect(columns.runKind.notNull).toBe(true);
    expect(columns.executionPolicyVersion.notNull).toBe(true);
    expect(columns.workspaceBindingMode.notNull).toBe(true);
    expect(columns.createdAt.notNull).toBe(true);

    // Optional columns
    expect(columns.projectId.notNull).toBe(false);
    expect(columns.goalId.notNull).toBe(false);
    expect(columns.workspaceId.notNull).toBe(false);
  });

  it("has correct default values", () => {
    const columns = getTableColumns(executionEnvelopes);
    expect(columns.executionPolicyVersion.hasDefault).toBe(true);
    expect(columns.createdAt.hasDefault).toBe(true);
    expect(columns.id.hasDefault).toBe(true);
  });
});

describe("control_plane_events schema", () => {
  it("has all required columns with correct types", () => {
    const columns = getTableColumns(controlPlaneEvents);
    const columnNames = Object.keys(columns);

    const expectedColumns = [
      "id",
      "companyId",
      "entityType",
      "entityId",
      "eventType",
      "payload",
      "createdAt",
    ];

    for (const col of expectedColumns) {
      expect(columnNames, `missing column: ${col}`).toContain(col);
    }

    expect(columnNames).toHaveLength(expectedColumns.length);

    // Verify key column properties
    expect(columns.id.notNull).toBe(true);
    expect(columns.companyId.notNull).toBe(true);
    expect(columns.entityType.notNull).toBe(true);
    expect(columns.entityId.notNull).toBe(true);
    expect(columns.eventType.notNull).toBe(true);
    expect(columns.createdAt.notNull).toBe(true);

    // Optional columns
    expect(columns.payload.notNull).toBe(false);
  });

  it("has correct default values", () => {
    const columns = getTableColumns(controlPlaneEvents);
    expect(columns.createdAt.hasDefault).toBe(true);
    // bigserial auto-increments, so hasDefault is true
    expect(columns.id.hasDefault).toBe(true);
  });

  it("uses bigserial for id (append-only table)", () => {
    const columns = getTableColumns(controlPlaneEvents);
    // bigserial columns in mode: "number" report columnType as "PgBigSerial53"
    expect(columns.id.columnType).toContain("BigSerial");
  });
});

describe("heartbeat_runs new columns", () => {
  it("has intentId column (nullable uuid)", () => {
    const columns = getTableColumns(heartbeatRuns);
    expect(Object.keys(columns)).toContain("intentId");
    expect(columns.intentId.notNull).toBe(false);
    expect(columns.intentId.columnType).toContain("PgUUID");
  });

  it("has envelopeId column (nullable uuid)", () => {
    const columns = getTableColumns(heartbeatRuns);
    expect(Object.keys(columns)).toContain("envelopeId");
    expect(columns.envelopeId.notNull).toBe(false);
    expect(columns.envelopeId.columnType).toContain("PgUUID");
  });
});

describe("issues new columns", () => {
  it("has executionLeaseId column (nullable uuid)", () => {
    const columns = getTableColumns(issues);
    expect(Object.keys(columns)).toContain("executionLeaseId");
    expect(columns.executionLeaseId.notNull).toBe(false);
    expect(columns.executionLeaseId.columnType).toContain("PgUUID");
  });

  it("has pickupFailCount column (integer, not null, default 0)", () => {
    const columns = getTableColumns(issues);
    expect(Object.keys(columns)).toContain("pickupFailCount");
    expect(columns.pickupFailCount.notNull).toBe(true);
    expect(columns.pickupFailCount.hasDefault).toBe(true);
    expect(columns.pickupFailCount.columnType).toContain("PgInteger");
  });

  it("has lastPickupFailureAt column (nullable timestamptz)", () => {
    const columns = getTableColumns(issues);
    expect(Object.keys(columns)).toContain("lastPickupFailureAt");
    expect(columns.lastPickupFailureAt.notNull).toBe(false);
    expect(columns.lastPickupFailureAt.columnType).toContain("PgTimestamp");
  });

  it("has lastReconciledAt column (nullable timestamptz)", () => {
    const columns = getTableColumns(issues);
    expect(Object.keys(columns)).toContain("lastReconciledAt");
    expect(columns.lastReconciledAt.notNull).toBe(false);
    expect(columns.lastReconciledAt.columnType).toContain("PgTimestamp");
  });
});

describe("issue_dependencies schema", () => {
  it("has all required columns", () => {
    const columns = getTableColumns(issueDependencies);
    const columnNames = Object.keys(columns);

    const expectedColumns = [
      "issueId",
      "dependsOnIssueId",
      "companyId",
      "createdAt",
    ];

    for (const col of expectedColumns) {
      expect(columnNames, `missing column: ${col}`).toContain(col);
    }

    expect(columnNames).toHaveLength(expectedColumns.length);
  });

  it("has correct column properties", () => {
    const columns = getTableColumns(issueDependencies);

    // All columns except createdAt should be notNull
    expect(columns.issueId.notNull).toBe(true);
    expect(columns.dependsOnIssueId.notNull).toBe(true);
    expect(columns.companyId.notNull).toBe(true);
    expect(columns.createdAt.notNull).toBe(true);
  });

  it("has correct column types", () => {
    const columns = getTableColumns(issueDependencies);

    expect(columns.issueId.columnType).toContain("PgUUID");
    expect(columns.dependsOnIssueId.columnType).toContain("PgUUID");
    expect(columns.companyId.columnType).toContain("PgUUID");
    expect(columns.createdAt.columnType).toContain("PgTimestamp");
  });

  it("has default value for createdAt", () => {
    const columns = getTableColumns(issueDependencies);
    expect(columns.createdAt.hasDefault).toBe(true);
  });
});
