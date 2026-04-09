import type { CompanyStatus, PauseReason } from "../constants.js";

export interface Company {
  id: string;
  name: string;
  description: string | null;
  status: CompanyStatus;
  pauseReason: PauseReason | null;
  pausedAt: Date | null;
  issuePrefix: string;
  issueCounter: number;
  budgetMonthlyCents: number;
  spentMonthlyCents: number;
  requireBoardApprovalForNewAgents: boolean;
  brandColor: string | null;
  logoAssetId: string | null;
  logoUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CompanyOnboardingDraftRequest {
  kind: "company" | "task";
  companyName?: string | null;
  companyGoal?: string | null;
  agentName?: string | null;
  adapterType?: string | null;
  taskTitle?: string | null;
  taskDescription?: string | null;
}

export interface CompanyOnboardingDraftResponse {
  source: "openai" | "fallback";
  companyName: string | null;
  companyGoal: string | null;
  taskTitle: string | null;
  taskDescription: string | null;
}
