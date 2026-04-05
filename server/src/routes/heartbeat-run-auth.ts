import type { Request } from "express";
import {
  assertAuthenticated,
  assertAuthenticatedBoard,
  assertCompanyAccess,
} from "./authz.js";

export function assertHeartbeatRunStreamAccess(req: Request, companyId: string) {
  assertAuthenticated(req);
  assertCompanyAccess(req, companyId);
}

export function assertHeartbeatRunBoardAccess(req: Request, companyId: string) {
  assertAuthenticatedBoard(req);
  assertCompanyAccess(req, companyId);
}
