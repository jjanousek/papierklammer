import { describe, expect, it } from "vitest";
import { HttpError } from "../errors.js";
import {
  assertHeartbeatRunBoardAccess,
  assertHeartbeatRunStreamAccess,
} from "../routes/heartbeat-run-auth.js";

const COMPANY_ID = "00000000-0000-0000-0000-000000000001";
const OTHER_COMPANY_ID = "00000000-0000-0000-0000-000000000002";
const sameCompanyBoard = {
  type: "board" as const,
  userId: "board-user",
  companyIds: [COMPANY_ID],
  source: "session" as const,
  isInstanceAdmin: false,
};
const wrongCompanyBoard = {
  type: "board" as const,
  userId: "board-user",
  companyIds: [OTHER_COMPANY_ID],
  source: "session" as const,
  isInstanceAdmin: false,
};
const sameCompanyAgent = {
  type: "agent" as const,
  agentId: "00000000-0000-0000-0000-000000000020",
  companyId: COMPANY_ID,
  source: "agent_key" as const,
};
const wrongCompanyAgent = {
  type: "agent" as const,
  agentId: "00000000-0000-0000-0000-000000000020",
  companyId: OTHER_COMPANY_ID,
  source: "agent_key" as const,
};
const unauthenticatedActor = {
  type: "none" as const,
  source: "none" as const,
};

function makeRequest(actor: typeof sameCompanyBoard | typeof wrongCompanyBoard | typeof sameCompanyAgent | typeof wrongCompanyAgent | typeof unauthenticatedActor) {
  return { actor } as any;
}

function expectAuthorized(action: () => void) {
  expect(action).not.toThrow();
}

function expectHttpError(action: () => void, status: number, message?: string) {
  try {
    action();
    throw new Error(`Expected HttpError(${status})`);
  } catch (error) {
    expect(error).toBeInstanceOf(HttpError);
    expect((error as HttpError).status).toBe(status);
    if (message) {
      expect((error as HttpError).message).toBe(message);
    }
  }
}

describe("heartbeat run route company isolation", () => {
  it("allows same-company board access to run-log detail endpoints", () => {
    expectAuthorized(() => assertHeartbeatRunStreamAccess(makeRequest(sameCompanyBoard), COMPANY_ID));
  });

  it("allows same-company agent access to run-log streaming endpoints", () => {
    expectAuthorized(() => assertHeartbeatRunStreamAccess(makeRequest(sameCompanyAgent), COMPANY_ID));
  });

  it("allows same-company board access to run detail endpoints", () => {
    expectAuthorized(() => assertHeartbeatRunBoardAccess(makeRequest(sameCompanyBoard), COMPANY_ID));
  });

  it("rejects unauthenticated access to run-log detail endpoints", () => {
    expectHttpError(
      () => assertHeartbeatRunStreamAccess(makeRequest(unauthenticatedActor), COMPANY_ID),
      401,
      "Unauthorized",
    );
  });

  it("rejects unauthenticated access to run event detail endpoints", () => {
    expectHttpError(
      () => assertHeartbeatRunStreamAccess(makeRequest(unauthenticatedActor), COMPANY_ID),
      401,
      "Unauthorized",
    );
  });

  it("rejects unauthenticated access to run detail endpoints", () => {
    expectHttpError(
      () => assertHeartbeatRunBoardAccess(makeRequest(unauthenticatedActor), COMPANY_ID),
      401,
      "Unauthorized",
    );
  });

  it("rejects wrong-company agent access to run-log detail endpoints", () => {
    expectHttpError(
      () => assertHeartbeatRunStreamAccess(makeRequest(wrongCompanyAgent), COMPANY_ID),
      403,
      "Agent key cannot access another company",
    );
  });

  it("rejects wrong-company agent access to run event detail endpoints", () => {
    expectHttpError(
      () => assertHeartbeatRunStreamAccess(makeRequest(wrongCompanyAgent), COMPANY_ID),
      403,
      "Agent key cannot access another company",
    );
  });

  it("rejects same-company agent access to run detail endpoints", () => {
    expectHttpError(
      () => assertHeartbeatRunBoardAccess(makeRequest(sameCompanyAgent), COMPANY_ID),
      403,
      "Board access required",
    );
  });

  it("allows same-company agent access to run event detail endpoints", () => {
    expectAuthorized(() => assertHeartbeatRunStreamAccess(makeRequest(sameCompanyAgent), COMPANY_ID));
  });

  it("rejects same-company agent access to run workspace-operation fan-out", () => {
    expectHttpError(
      () => assertHeartbeatRunBoardAccess(makeRequest(sameCompanyAgent), COMPANY_ID),
      403,
      "Board access required",
    );
  });

  it("allows same-company board access to run workspace-operation fan-out", () => {
    expectAuthorized(() => assertHeartbeatRunBoardAccess(makeRequest(sameCompanyBoard), COMPANY_ID));
  });

  it("rejects unauthenticated access to run workspace-operation fan-out", () => {
    expectHttpError(
      () => assertHeartbeatRunBoardAccess(makeRequest(unauthenticatedActor), COMPANY_ID),
      401,
      "Unauthorized",
    );
  });

  it("rejects wrong-company board access to run workspace-operation fan-out", () => {
    expectHttpError(
      () => assertHeartbeatRunBoardAccess(makeRequest(wrongCompanyBoard), COMPANY_ID),
      403,
      "User does not have access to this company",
    );
  });

  it("allows same-company board access to workspace-operation log endpoints", () => {
    expectAuthorized(() => assertHeartbeatRunBoardAccess(makeRequest(sameCompanyBoard), COMPANY_ID));
  });

  it("rejects unauthenticated access to workspace-operation log endpoints", () => {
    expectHttpError(
      () => assertHeartbeatRunBoardAccess(makeRequest(unauthenticatedActor), COMPANY_ID),
      401,
      "Unauthorized",
    );
  });

  it("rejects same-company agent access to workspace-operation log endpoints", () => {
    expectHttpError(
      () => assertHeartbeatRunBoardAccess(makeRequest(sameCompanyAgent), COMPANY_ID),
      403,
      "Board access required",
    );
  });

  it("rejects wrong-company board access to workspace-operation log endpoints", () => {
    expectHttpError(
      () => assertHeartbeatRunBoardAccess(makeRequest(wrongCompanyBoard), COMPANY_ID),
      403,
      "User does not have access to this company",
    );
  });

  it("allows same-company board access to run cancellation", () => {
    expectAuthorized(() => assertHeartbeatRunBoardAccess(makeRequest(sameCompanyBoard), COMPANY_ID));
  });

  it("rejects agent access to board-scoped run cancellation", () => {
    expectHttpError(
      () => assertHeartbeatRunBoardAccess(makeRequest(sameCompanyAgent), COMPANY_ID),
      403,
      "Board access required",
    );
  });

  it("rejects wrong-company board access before mutating a run", () => {
    expectHttpError(
      () => assertHeartbeatRunBoardAccess(makeRequest(wrongCompanyBoard), COMPANY_ID),
      403,
      "User does not have access to this company",
    );
  });
});
