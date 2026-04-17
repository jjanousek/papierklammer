import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { AdapterEnvironmentTestResult } from "@papierklammer/shared";
import { useLocation, useNavigate, useParams } from "@/lib/router";
import { useDialog } from "../context/DialogContext";
import { useCompany } from "../context/CompanyContext";
import { useToast } from "../context/ToastContext";
import { companiesApi } from "../api/companies";
import { goalsApi } from "../api/goals";
import { agentsApi } from "../api/agents";
import { issuesApi } from "../api/issues";
import { projectsApi } from "../api/projects";
import { queryKeys } from "../lib/queryKeys";
import { Dialog, DialogPortal } from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { cn } from "../lib/utils";
import {
  extractModelName,
  extractProviderIdWithFallback
} from "../lib/model-utils";
import { getUIAdapter } from "../adapters";
import { defaultCreateValues } from "./agent-config-defaults";
import { parseOnboardingGoalInput } from "../lib/onboarding-goal";
import {
  buildOnboardingIssuePayload,
  buildOnboardingProjectPayload,
  selectDefaultCompanyGoalId
} from "../lib/onboarding-launch";
import {
  DEFAULT_CODEX_LOCAL_BYPASS_APPROVALS_AND_SANDBOX,
  DEFAULT_CODEX_LOCAL_MODEL
} from "@papierklammer/adapter-codex-local";
import { DEFAULT_CURSOR_LOCAL_MODEL } from "@papierklammer/adapter-cursor-local";
import { DEFAULT_GEMINI_LOCAL_MODEL } from "@papierklammer/adapter-gemini-local";
import { resolveRouteOnboardingEntry } from "../lib/onboarding-route";
import { AsciiArtAnimation } from "./AsciiArtAnimation";
import { OpenCodeLogoIcon } from "./OpenCodeLogoIcon";
import {
  Building2,
  Bot,
  Code,
  Gem,
  ListTodo,
  Rocket,
  ArrowLeft,
  ArrowRight,
  Terminal,
  Sparkles,
  MousePointer2,
  Check,
  Loader2,
  ChevronDown,
  X
} from "lucide-react";
import { HermesIcon } from "./HermesIcon";

type Step = 1 | 2 | 3 | 4;
type AdapterType =
  | "claude_local"
  | "codex_local"
  | "gemini_local"
  | "hermes_local"
  | "opencode_local"
  | "pi_local"
  | "cursor"
  | "http"
  | "openclaw_gateway";

const DEFAULT_TASK_DESCRIPTION = `You are the CEO. You set the direction for the company.

- hire a founding engineer
- write a hiring plan
- break the roadmap into concrete tasks and start delegating work`;

const CURATED_CODEX_MODEL_IDS = [
  "gpt-5.4",
  DEFAULT_CODEX_LOCAL_MODEL,
  "gpt-5.3-codex-spark",
  "gpt-5-mini",
  "codex-mini-latest"
] as const;

export function OnboardingWizard() {
  const {
    onboardingOpen,
    onboardingOptions,
    dismissedRouteOnboardingPath,
    dismissRouteOnboarding,
    clearDismissedRouteOnboarding,
    closeOnboarding,
  } = useDialog();
  const { companies, setSelectedCompanyId, loading: companiesLoading } = useCompany();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const { companyPrefix } = useParams<{ companyPrefix?: string }>();
  const { pushToast } = useToast();
  const routeCompanyPrefix =
    companyPrefix ??
    (() => {
      const segments = location.pathname.split("/").filter(Boolean);
      if (segments.length !== 2) return undefined;
      return segments[1]?.toLowerCase() === "onboarding"
        ? segments[0]
        : undefined;
    })();

  const routeOnboardingEntry =
    routeCompanyPrefix && companiesLoading
      ? null
      : resolveRouteOnboardingEntry({
          pathname: location.pathname,
          companyPrefix: routeCompanyPrefix,
          companies,
        });
  const routeOnboardingOptions =
    routeOnboardingEntry?.kind === "company"
      ? { initialStep: 1 as const, companyId: routeOnboardingEntry.companyId }
      : routeOnboardingEntry?.kind === "global"
        ? { initialStep: 1 as const }
        : null;
  const routeBlocksOnboarding =
    routeOnboardingEntry?.kind === "invalid_company_prefix";
  const routeOnboardingOpen =
    routeOnboardingOptions !== null &&
    dismissedRouteOnboardingPath !== location.pathname;
  const effectiveOnboardingOpen =
    !routeBlocksOnboarding &&
    (onboardingOpen || routeOnboardingOpen);
  const effectiveOnboardingOptions =
    routeBlocksOnboarding
      ? {}
      : routeOnboardingOptions
        ?? (onboardingOpen ? onboardingOptions : {});

  const existingCompanyId = effectiveOnboardingOptions.companyId;
  const isNewCompanyFlow = !existingCompanyId;
  const initialStep: Step =
    existingCompanyId
      ? 1
      : effectiveOnboardingOptions.initialStep ?? 1;
  const existingCompany = companies.find((company) => company.id === existingCompanyId) ?? null;

  const [step, setStep] = useState<Step>(initialStep);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modelOpen, setModelOpen] = useState(false);
  const [modelSearch, setModelSearch] = useState("");

  // Agent step
  const [agentName, setAgentName] = useState("CEO");
  const [adapterType, setAdapterType] = useState<AdapterType>("claude_local");
  const [model, setModel] = useState("");
  const [command, setCommand] = useState("");
  const [args, setArgs] = useState("");
  const [url, setUrl] = useState("");
  const [adapterEnvResult, setAdapterEnvResult] =
    useState<AdapterEnvironmentTestResult | null>(null);
  const [adapterEnvError, setAdapterEnvError] = useState<string | null>(null);
  const [adapterEnvLoading, setAdapterEnvLoading] = useState(false);
  const [forceUnsetAnthropicApiKey, setForceUnsetAnthropicApiKey] =
    useState(false);
  const [unsetAnthropicLoading, setUnsetAnthropicLoading] = useState(false);
  const [showMoreAdapters, setShowMoreAdapters] = useState(false);
  const [draftingCompany, setDraftingCompany] = useState(false);
  const [draftingTask, setDraftingTask] = useState(false);

  // Company step
  const [companyName, setCompanyName] = useState("");
  const [companyGoal, setCompanyGoal] = useState("");

  // Task step
  const [taskTitle, setTaskTitle] = useState(
    "Hire your first engineer and create a hiring plan"
  );
  const [taskDescription, setTaskDescription] = useState(
    DEFAULT_TASK_DESCRIPTION
  );

  // Auto-grow textarea for task description
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const autoResizeTextarea = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = el.scrollHeight + "px";
  }, []);

  // Created entity IDs — pre-populate from existing company when skipping step 1
  const [createdCompanyId, setCreatedCompanyId] = useState<string | null>(
    existingCompanyId ?? null
  );
  const [createdCompanyPrefix, setCreatedCompanyPrefix] = useState<
    string | null
  >(null);
  const [createdCompanyGoalId, setCreatedCompanyGoalId] = useState<string | null>(
    null
  );
  const [createdAgentId, setCreatedAgentId] = useState<string | null>(null);
  const [createdProjectId, setCreatedProjectId] = useState<string | null>(null);
  const [createdIssueId, setCreatedIssueId] = useState<string | null>(null);
  const [createdIssueRef, setCreatedIssueRef] = useState<string | null>(null);
  const maxAccessibleStep = useMemo<Step>(() => {
    if (!isNewCompanyFlow) {
      if (!createdAgentId) return 1;
      if (!taskTitle.trim()) return 2;
      return 3;
    }
    if (!createdCompanyId || !createdAgentId) return 2;
    if (!taskTitle.trim()) return 3;
    return 4;
  }, [createdAgentId, createdCompanyId, isNewCompanyFlow, taskTitle]);

  useEffect(() => {
    if (
      dismissedRouteOnboardingPath &&
      location.pathname !== dismissedRouteOnboardingPath
    ) {
      clearDismissedRouteOnboarding();
    }
  }, [
    clearDismissedRouteOnboarding,
    dismissedRouteOnboardingPath,
    location.pathname,
  ]);

  useEffect(() => {
    if (!routeBlocksOnboarding || !onboardingOpen) return;
    closeOnboarding();
  }, [closeOnboarding, onboardingOpen, routeBlocksOnboarding]);

  // Sync step and company when onboarding opens with options.
  // Keep this independent from company-list refreshes so Step 1 completion
  // doesn't get reset after creating a company.
  useEffect(() => {
    if (!effectiveOnboardingOpen) return;
    const cId = effectiveOnboardingOptions.companyId ?? null;
    setStep(initialStep);
    setCreatedCompanyId(cId);
    setCreatedCompanyPrefix(null);
    setCreatedCompanyGoalId(null);
    setCreatedProjectId(null);
    setCreatedAgentId(null);
    setCreatedIssueId(null);
    setCreatedIssueRef(null);
  }, [
    effectiveOnboardingOpen,
    effectiveOnboardingOptions.companyId,
    initialStep
  ]);

  // Backfill issue prefix for an existing company once companies are loaded.
  useEffect(() => {
    if (!effectiveOnboardingOpen || !createdCompanyId || createdCompanyPrefix) return;
    const company = companies.find((c) => c.id === createdCompanyId);
    if (company) setCreatedCompanyPrefix(company.issuePrefix);
  }, [effectiveOnboardingOpen, createdCompanyId, createdCompanyPrefix, companies]);

  useEffect(() => {
    if (!existingCompany?.name || companyName.trim().length > 0) return;
    setCompanyName(existingCompany.name);
  }, [companyName, existingCompany?.name]);

  const isAgentStep = step === 1;
  const isCompanyStep = isNewCompanyFlow && step === 2;
  const isTaskStep = isNewCompanyFlow ? step === 3 : step === 2;
  const isLaunchStep = isNewCompanyFlow ? step === 4 : step === 3;

  // Resize textarea when the task step is shown or description changes
  useEffect(() => {
    if (isTaskStep) autoResizeTextarea();
  }, [isTaskStep, taskDescription, autoResizeTextarea]);

  useEffect(() => {
    if (step > maxAccessibleStep) {
      setStep(maxAccessibleStep);
    }
  }, [step, maxAccessibleStep]);

  const {
    data: adapterModels,
    error: adapterModelsError,
    isLoading: adapterModelsLoading,
    isFetching: adapterModelsFetching
  } = useQuery({
    queryKey: createdCompanyId
      ? queryKeys.agents.adapterModels(createdCompanyId, adapterType)
      : ["agents", "none", "adapter-models", adapterType],
    queryFn: () => agentsApi.adapterModels(createdCompanyId!, adapterType),
    enabled: Boolean(createdCompanyId) && effectiveOnboardingOpen && step === 1
  });
  const isLocalAdapter =
    adapterType === "claude_local" ||
    adapterType === "codex_local" ||
    adapterType === "gemini_local" ||
    adapterType === "hermes_local" ||
    adapterType === "opencode_local" ||
    adapterType === "pi_local" ||
    adapterType === "cursor";
  const effectiveAdapterCommand =
    command.trim() ||
    (adapterType === "codex_local"
      ? "codex"
      : adapterType === "gemini_local"
        ? "gemini"
      : adapterType === "hermes_local"
        ? "hermes"
      : adapterType === "pi_local"
      ? "pi"
      : adapterType === "cursor"
      ? "agent"
      : adapterType === "opencode_local"
      ? "opencode"
      : "claude");

  useEffect(() => {
    if (step !== 1) return;
    setAdapterEnvResult(null);
    setAdapterEnvError(null);
  }, [step, adapterType, model, command, args, url]);

  const onboardingAdapterModels = useMemo(() => {
    let models = adapterModels ?? [];
    if (adapterType === "codex_local") {
      const curated = CURATED_CODEX_MODEL_IDS.map((id) => ({ id, label: id === "codex-mini-latest" ? "Codex Mini" : id }));
      if (models.length === 0) return curated;
      const curatedIds = new Set<string>(CURATED_CODEX_MODEL_IDS);
      const curatedMap = new Map(curated.map((entry) => [entry.id, entry]));
      const filtered = models.filter((entry) => curatedIds.has(entry.id));
      return filtered.length > 0
        ? CURATED_CODEX_MODEL_IDS.map((id) => filtered.find((entry) => entry.id === id) ?? curatedMap.get(id)!).filter(Boolean)
        : curated;
    }
    return models;
  }, [adapterModels, adapterType]);
  const selectedModel = onboardingAdapterModels.find((m) => m.id === model);
  const hasAnthropicApiKeyOverrideCheck =
    adapterEnvResult?.checks.some(
      (check) =>
        check.code === "claude_anthropic_api_key_overrides_subscription"
    ) ?? false;
  const shouldSuggestUnsetAnthropicApiKey =
    adapterType === "claude_local" &&
    adapterEnvResult?.status === "fail" &&
    hasAnthropicApiKeyOverrideCheck;
  const filteredModels = useMemo(() => {
    const query = modelSearch.trim().toLowerCase();
    return onboardingAdapterModels.filter((entry) => {
      if (!query) return true;
      const provider = extractProviderIdWithFallback(entry.id, "");
      return (
        entry.id.toLowerCase().includes(query) ||
        entry.label.toLowerCase().includes(query) ||
        provider.toLowerCase().includes(query)
      );
    });
  }, [modelSearch, onboardingAdapterModels]);
  const groupedModels = useMemo(() => {
    if (adapterType !== "opencode_local") {
      return [
        {
          provider: "models",
          entries: [...filteredModels].sort((a, b) => a.id.localeCompare(b.id))
        }
      ];
    }
    const groups = new Map<string, Array<{ id: string; label: string }>>();
    for (const entry of filteredModels) {
      const provider = extractProviderIdWithFallback(entry.id);
      const bucket = groups.get(provider) ?? [];
      bucket.push(entry);
      groups.set(provider, bucket);
    }
    return Array.from(groups.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([provider, entries]) => ({
        provider,
        entries: [...entries].sort((a, b) => a.id.localeCompare(b.id))
      }));
  }, [filteredModels, adapterType]);

  function reset() {
    setStep(1);
    setLoading(false);
    setError(null);
    setModelOpen(false);
    setModelSearch("");
    setShowMoreAdapters(false);
    setCompanyName("");
    setCompanyGoal("");
    setAgentName("CEO");
    setAdapterType("claude_local");
    setModel("");
    setCommand("");
    setArgs("");
    setUrl("");
    setAdapterEnvResult(null);
    setAdapterEnvError(null);
    setAdapterEnvLoading(false);
    setForceUnsetAnthropicApiKey(false);
    setUnsetAnthropicLoading(false);
    setTaskTitle("Hire your first engineer and create a hiring plan");
    setTaskDescription(DEFAULT_TASK_DESCRIPTION);
    setCreatedCompanyId(null);
    setCreatedCompanyPrefix(null);
    setCreatedCompanyGoalId(null);
    setCreatedAgentId(null);
    setCreatedProjectId(null);
    setCreatedIssueId(null);
    setCreatedIssueRef(null);
    setDraftingCompany(false);
    setDraftingTask(false);
  }

  function handleClose() {
    reset();
    if (routeOnboardingOpen) {
      dismissRouteOnboarding(location.pathname);
      return;
    }
    closeOnboarding();
  }

  function buildAdapterConfig(): Record<string, unknown> {
    const adapter = getUIAdapter(adapterType);
    const config = adapter.buildAdapterConfig({
      ...defaultCreateValues,
      adapterType,
      model:
        adapterType === "codex_local"
          ? model || DEFAULT_CODEX_LOCAL_MODEL
          : adapterType === "gemini_local"
            ? model || DEFAULT_GEMINI_LOCAL_MODEL
          : adapterType === "cursor"
          ? model || DEFAULT_CURSOR_LOCAL_MODEL
          : model,
      command,
      args,
      url,
      dangerouslySkipPermissions:
        adapterType === "claude_local" || adapterType === "opencode_local",
      dangerouslyBypassSandbox:
        adapterType === "codex_local"
          ? DEFAULT_CODEX_LOCAL_BYPASS_APPROVALS_AND_SANDBOX
          : defaultCreateValues.dangerouslyBypassSandbox
    });
    if (adapterType === "claude_local" && forceUnsetAnthropicApiKey) {
      const env =
        typeof config.env === "object" &&
        config.env !== null &&
        !Array.isArray(config.env)
          ? { ...(config.env as Record<string, unknown>) }
          : {};
      env.ANTHROPIC_API_KEY = { type: "plain", value: "" };
      config.env = env;
    }
    return config;
  }

  async function runAdapterEnvironmentTest(
    adapterConfigOverride?: Record<string, unknown>
  ): Promise<AdapterEnvironmentTestResult | null> {
    if (!createdCompanyId) {
      setAdapterEnvError(
        "Create or select a company before testing adapter environment."
      );
      return null;
    }
    setAdapterEnvLoading(true);
    setAdapterEnvError(null);
    try {
      const result = await agentsApi.testEnvironment(
        createdCompanyId,
        adapterType,
        {
          adapterConfig: adapterConfigOverride ?? buildAdapterConfig()
        }
      );
      setAdapterEnvResult(result);
      return result;
    } catch (err) {
      setAdapterEnvError(
        err instanceof Error ? err.message : "Adapter environment test failed"
      );
      return null;
    } finally {
      setAdapterEnvLoading(false);
    }
  }

  async function createAgentForCompany(companyId: string) {
    if (adapterType === "opencode_local") {
      const selectedModelId = model.trim();
      if (!selectedModelId) {
        setError(
          "OpenCode requires an explicit model in provider/model format."
        );
        return null;
      }
      if (adapterModelsError) {
        setError(
          adapterModelsError instanceof Error
            ? adapterModelsError.message
            : "Failed to load OpenCode models."
        );
        return null;
      }
      if (adapterModelsLoading || adapterModelsFetching) {
        setError(
          "OpenCode models are still loading. Please wait and try again."
        );
        return null;
      }
      const discoveredModels = onboardingAdapterModels;
      if (!discoveredModels.some((entry) => entry.id === selectedModelId)) {
        setError(
          discoveredModels.length === 0
            ? "No OpenCode models discovered. Run `opencode models` and authenticate providers."
            : `Configured OpenCode model is unavailable: ${selectedModelId}`
        );
        return null;
      }
    }

    if (isLocalAdapter) {
      const result = adapterEnvResult ?? (await runAdapterEnvironmentTest());
      if (!result) return null;
      if (result.status === "fail") {
        setError("Adapter environment check failed. Fix the errors and retry.");
        return null;
      }
    }

    const agent = await agentsApi.create(companyId, {
      name: agentName.trim(),
      role: "ceo",
      adapterType,
      adapterConfig: buildAdapterConfig(),
      runtimeConfig: {
        heartbeat: {
          enabled: true,
          intervalSec: 3600,
          wakeOnDemand: true,
          cooldownSec: 10,
          maxConcurrentRuns: 1
        }
      }
    });
    setCreatedAgentId(agent.id);
    queryClient.invalidateQueries({
      queryKey: queryKeys.agents.list(companyId)
    });
    return agent;
  }

  async function handleStep1Next() {
    setError(null);
    if (isNewCompanyFlow) {
      setStep(2);
      return;
    }
    try {
      setLoading(true);
      setError(null);
      const nextAgent = await createAgentForCompany(createdCompanyId!);
      if (!nextAgent) return;
      setStep(2);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create agent");
    } finally {
      setLoading(false);
    }
  }

  async function handleStep2Next() {
    if (!isNewCompanyFlow) {
      if (!createdCompanyId || !createdAgentId) return;
      setError(null);
      setStep(3);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      let companyId = createdCompanyId;
      let companyPrefix = createdCompanyPrefix;
      if (!companyId) {
        const company = await companiesApi.create({ name: companyName.trim() });
        companyId = company.id;
        companyPrefix = company.issuePrefix;
        setCreatedCompanyId(company.id);
        setCreatedCompanyPrefix(company.issuePrefix);
        setSelectedCompanyId(company.id);
        queryClient.setQueryData(queryKeys.companies.all, (current: typeof companies | undefined) => {
          const existingCompanies = current ?? [];
          return [company, ...existingCompanies.filter((entry) => entry.id !== company.id)];
        });
        queryClient.invalidateQueries({ queryKey: queryKeys.companies.all });
      }

      if (companyGoal.trim() && !createdCompanyGoalId) {
        const parsedGoal = parseOnboardingGoalInput(companyGoal);
        const goal = await goalsApi.create(companyId, {
          title: parsedGoal.title,
          ...(parsedGoal.description
            ? { description: parsedGoal.description }
            : {}),
          level: "company",
          status: "active"
        });
        setCreatedCompanyGoalId(goal.id);
        queryClient.invalidateQueries({
          queryKey: queryKeys.goals.list(companyId)
        });
      } else if (!companyGoal.trim()) {
        setCreatedCompanyGoalId(null);
      }

      const agent = createdAgentId ? { id: createdAgentId } : await createAgentForCompany(companyId);
      if (!agent) return;

      setCreatedCompanyPrefix(companyPrefix ?? null);
      setStep(3);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create company");
    } finally {
      setLoading(false);
    }
  }

  async function handleUnsetAnthropicApiKey() {
    if (!createdCompanyId || unsetAnthropicLoading) return;
    setUnsetAnthropicLoading(true);
    setError(null);
    setAdapterEnvError(null);
    setForceUnsetAnthropicApiKey(true);

    const configWithUnset = (() => {
      const config = buildAdapterConfig();
      const env =
        typeof config.env === "object" &&
        config.env !== null &&
        !Array.isArray(config.env)
          ? { ...(config.env as Record<string, unknown>) }
          : {};
      env.ANTHROPIC_API_KEY = { type: "plain", value: "" };
      config.env = env;
      return config;
    })();

    try {
      if (createdAgentId) {
        await agentsApi.update(
          createdAgentId,
          { adapterConfig: configWithUnset },
          createdCompanyId
        );
        queryClient.invalidateQueries({
          queryKey: queryKeys.agents.list(createdCompanyId)
        });
      }

      const result = await runAdapterEnvironmentTest(configWithUnset);
      if (result?.status === "fail") {
        setError(
          "Retried with ANTHROPIC_API_KEY unset in adapter config, but the environment test is still failing."
        );
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to unset ANTHROPIC_API_KEY and retry."
      );
    } finally {
      setUnsetAnthropicLoading(false);
    }
  }

  async function handleStep3Next() {
    if (isNewCompanyFlow) {
      if (!createdCompanyId || !createdAgentId) return;
      setError(null);
      setStep(4);
      return;
    }
    if (!createdCompanyId || !createdAgentId) return;
    setError(null);
    setStep(3);
  }

  function asOptionalDraftField(value: string) {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  async function handleDraftCompany() {
    setDraftingCompany(true);
    setError(null);
    try {
      const draft = await companiesApi.onboardingDraft({
        kind: "company",
        companyName: asOptionalDraftField(companyName),
        companyGoal: asOptionalDraftField(companyGoal),
        agentName: asOptionalDraftField(agentName),
        adapterType
      });
      if (draft.companyName) setCompanyName(draft.companyName);
      if (draft.companyGoal) setCompanyGoal(draft.companyGoal);
      pushToast({
        title: draft.source === "openai" ? "Company draft generated" : "Company draft suggested",
        tone: "success"
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to draft company");
    } finally {
      setDraftingCompany(false);
    }
  }

  async function handleDraftTask() {
    setDraftingTask(true);
    setError(null);
    try {
      const draft = await companiesApi.onboardingDraft({
        kind: "task",
        companyName: asOptionalDraftField(companyName),
        companyGoal: asOptionalDraftField(companyGoal),
        agentName: asOptionalDraftField(agentName),
        adapterType,
        taskTitle: asOptionalDraftField(taskTitle),
        taskDescription: asOptionalDraftField(taskDescription)
      });
      if (draft.taskTitle) setTaskTitle(draft.taskTitle);
      if (draft.taskDescription) setTaskDescription(draft.taskDescription);
      pushToast({
        title: draft.source === "openai" ? "Starter task drafted" : "Starter task suggested",
        tone: "success"
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to draft starter task");
    } finally {
      setDraftingTask(false);
    }
  }

  async function handleLaunch() {
    if (!createdCompanyId || !createdAgentId) return;
    setLoading(true);
    setError(null);
    try {
      let goalId = createdCompanyGoalId;
      if (!goalId) {
        const goals = await goalsApi.list(createdCompanyId);
        goalId = selectDefaultCompanyGoalId(goals);
        setCreatedCompanyGoalId(goalId);
      }

      let projectId = createdProjectId;
      if (!projectId) {
        const project = await projectsApi.create(
          createdCompanyId,
          buildOnboardingProjectPayload(goalId)
        );
        projectId = project.id;
        setCreatedProjectId(projectId);
        queryClient.invalidateQueries({
          queryKey: queryKeys.projects.list(createdCompanyId)
        });
      }

      let issueRef = createdIssueRef;
      let issueId = createdIssueId;
      if (!issueRef) {
        const issue = await issuesApi.create(
          createdCompanyId,
          buildOnboardingIssuePayload({
            title: taskTitle,
            description: taskDescription,
            assigneeAgentId: createdAgentId,
            projectId,
            goalId
          })
        );
        issueId = issue.id;
        setCreatedIssueId(issue.id);
        issueRef = issue.identifier ?? issue.id;
        setCreatedIssueRef(issueRef);
        queryClient.invalidateQueries({
          queryKey: queryKeys.issues.list(createdCompanyId)
        });
      }

      if (!issueId) {
        throw new Error("Failed to resolve the starter issue for launch.");
      }

      const wakeResult = await agentsApi.wakeup(
        createdAgentId,
        {
          source: "assignment",
          triggerDetail: "manual",
          reason: "onboarding_launch",
          payload: {
            issueId,
            issueRef,
            mutation: "create",
          },
          idempotencyKey: `onboarding-launch:${issueId}`,
        },
        createdCompanyId
      );

      if ("status" in wakeResult && wakeResult.status === "skipped") {
        throw new Error(
          "Starter task was created, but the CEO wakeup was skipped. Retry launch to start the company loop."
        );
      }

      queryClient.invalidateQueries({
        queryKey: queryKeys.issues.activeRun(issueId)
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.issues.liveRuns(issueId)
      });

      setSelectedCompanyId(createdCompanyId);
      reset();
      closeOnboarding();
      navigate(
        createdCompanyPrefix
          ? `/${createdCompanyPrefix}/issues/${issueRef}`
          : `/issues/${issueRef}`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create task");
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      if (isAgentStep && agentName.trim()) handleStep1Next();
      else if (isCompanyStep && companyName.trim()) handleStep2Next();
      else if (isTaskStep && taskTitle.trim()) {
        if (isNewCompanyFlow) handleStep3Next();
        else handleStep2Next();
      } else if (isLaunchStep) handleLaunch();
    }
  }

  if (!effectiveOnboardingOpen) return null;
  const companyContextLabel = existingCompany?.issuePrefix
    ? `${existingCompany.name} (${existingCompany.issuePrefix})`
    : existingCompany?.name ?? "this company";
  const shellEyebrow = isNewCompanyFlow
    ? "New company onboarding"
    : "Add-agent onboarding";
  const shellSequence = isNewCompanyFlow
    ? "Agent → Company → Task → Launch"
    : "Agent → Task → Launch";
  const shellTitle = isNewCompanyFlow
    ? "Choose the agent first"
    : `Add an agent to ${existingCompany?.name ?? "this company"}`;
  const shellDescription = isNewCompanyFlow
    ? "Agent comes first so the company setup and the starter task attach to the right CEO. After this, you will name the company, define the first task, and launch the issue."
    : `This flow stays inside ${companyContextLabel}. You are adding a teammate to an existing company, not creating a new one. After the agent step, you will define the starter task and launch it in the same company.`;
  const visibleSteps = isNewCompanyFlow
    ? [
        {
          step: 1 as Step,
          label: "Agent",
          icon: Bot,
          detail: "Choose the CEO adapter and model first."
        },
        {
          step: 2 as Step,
          label: "Company",
          icon: Building2,
          detail: "Name the company and optional mission."
        },
        {
          step: 3 as Step,
          label: "Task",
          icon: ListTodo,
          detail: "Define the first task for the CEO."
        },
        {
          step: 4 as Step,
          label: "Launch",
          icon: Rocket,
          detail: "Create the issue and wake the agent."
        }
      ]
    : [
        {
          step: 1 as Step,
          label: "Agent",
          icon: Bot,
          detail: `Choose the teammate to add to ${companyContextLabel}.`
        },
        {
          step: 2 as Step,
          label: "Task",
          icon: ListTodo,
          detail: "Describe the starter task for the new agent."
        },
        {
          step: 3 as Step,
          label: "Launch",
          icon: Rocket,
          detail: `Open the starter issue in ${companyContextLabel}.`
        }
      ];

  return (
    <Dialog
      open={effectiveOnboardingOpen}
      onOpenChange={(open) => {
        if (!open) {
          handleClose();
        }
      }}
    >
      <DialogPortal>
        {/* Plain div instead of DialogOverlay — Radix's overlay wraps in
            RemoveScroll which blocks wheel events on our custom (non-DialogContent)
            scroll container. A plain div preserves the background without scroll-locking. */}
        <div className="fixed inset-0 z-50 bg-background" />
        <div className="fixed inset-0 z-50 flex" onKeyDown={handleKeyDown}>
          {/* Close button */}
          <button
            onClick={handleClose}
            className="absolute right-4 top-4 z-10 inline-flex items-center gap-2 border border-border/80 bg-background/95 px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            <X className="h-5 w-5" />
            <span>{isNewCompanyFlow ? "Cancel" : "Close"}</span>
          </button>

          {/* Left half — form */}
          <div
            className={cn(
              "w-full flex flex-col overflow-y-auto transition-[width] duration-500 ease-in-out",
              step === 1 ? "md:w-1/2" : "md:w-full"
            )}
          >
            <div className="w-full max-w-md mx-auto my-auto px-8 py-12 shrink-0">
              <div className="mb-6 space-y-3 border border-border bg-muted/20 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="bg-foreground px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-background">
                    {shellEyebrow}
                  </span>
                  {!isNewCompanyFlow && existingCompany?.issuePrefix ? (
                    <span className="border border-border px-2 py-0.5 text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                      {existingCompany.issuePrefix}
                    </span>
                  ) : null}
                  <span className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                    {shellSequence}
                  </span>
                </div>
                <div className="space-y-1">
                  <h2 className="text-lg font-semibold tracking-tight">
                    {shellTitle}
                  </h2>
                  <p className="text-sm leading-6 text-muted-foreground">
                    {shellDescription}
                  </p>
                </div>
              </div>

              {/* Progress tabs */}
              <div className="flex items-center gap-0 mb-8 border-b border-border">
                {visibleSteps.map(({ step: s, label, icon: Icon }) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => {
                      if (s <= maxAccessibleStep) {
                        setStep(s);
                      }
                    }}
                    disabled={loading || s > maxAccessibleStep}
                    className={cn(
                      "flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 -mb-px cursor-pointer",
                      s === step
                        ? "border-foreground text-foreground"
                        : "border-transparent text-muted-foreground hover:text-foreground/70 hover:border-border",
                      s > maxAccessibleStep &&
                        "cursor-not-allowed opacity-40 hover:text-muted-foreground hover:border-transparent"
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {label}
                  </button>
                ))}
              </div>

              {/* Step content */}
              {isAgentStep && (
                <div className="space-y-5">
                  <div className="flex items-center gap-3 mb-1">
                    <div className="bg-muted/50 p-2">
                      <Bot className="h-5 w-5 text-muted-foreground" />
                    </div>
                    <div>
                      <h3 className="font-medium">
                        {isNewCompanyFlow
                          ? "Choose the first agent"
                          : "Choose the agent to add"}
                      </h3>
                      <p className="text-xs text-muted-foreground">
                        {isNewCompanyFlow
                          ? "Agent comes first. We will use this choice when we create the company, unlock the task, and open the first issue."
                          : `This creates a new teammate inside ${companyContextLabel}. No new company will be created, and the task step unlocks next.`}
                      </p>
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">
                      Agent name
                    </label>
                    <input
                      className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/50"
                      placeholder="CEO"
                      value={agentName}
                      onChange={(e) => setAgentName(e.target.value)}
                      autoFocus
                    />
                  </div>

                  {/* Adapter type radio cards */}
                  <div>
                    <label className="text-xs text-muted-foreground mb-2 block">
                      Adapter type
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      {[
                        {
                          value: "claude_local" as const,
                          label: "Claude Code",
                          icon: Sparkles,
                          desc: "Local Claude agent",
                          recommended: true
                        },
                        {
                          value: "codex_local" as const,
                          label: "Codex",
                          icon: Code,
                          desc: "Local Codex agent",
                          recommended: true
                        }
                      ].map((opt) => (
                        <button
                          key={opt.value}
                          className={cn(
                            "flex flex-col items-center gap-1.5 rounded-md border p-3 text-xs relative",
                            adapterType === opt.value
                              ? "border-foreground bg-accent"
                              : "border-border hover:opacity-80"
                          )}
                          onClick={() => {
                            const nextType = opt.value as AdapterType;
                            setAdapterType(nextType);
                            if (nextType === "codex_local" && !model) {
                              setModel(DEFAULT_CODEX_LOCAL_MODEL);
                            }
                            if (nextType !== "codex_local") {
                              setModel("");
                            }
                          }}
                        >
                          {opt.recommended && (
                            <span className="absolute -top-1.5 right-1.5 bg-green-500 text-white text-[9px] font-semibold px-1.5 py-0.5 leading-none">
                              Recommended
                            </span>
                          )}
                          <opt.icon className="h-4 w-4" />
                          <span className="font-medium">{opt.label}</span>
                          <span className="text-muted-foreground text-[10px]">
                            {opt.desc}
                          </span>
                        </button>
                      ))}
                    </div>

                    <button
                      className="flex items-center gap-1.5 mt-3 text-xs text-muted-foreground hover:text-foreground"
                      onClick={() => setShowMoreAdapters((v) => !v)}
                    >
                      <ChevronDown
                        className={cn(
                          "h-3 w-3 transition-transform",
                          showMoreAdapters ? "rotate-0" : "-rotate-90"
                        )}
                      />
                      More Agent Adapter Types
                    </button>

                    {showMoreAdapters && (
                      <div className="grid grid-cols-2 gap-2 mt-2">
                        {[
                          {
                            value: "gemini_local" as const,
                            label: "Gemini CLI",
                            icon: Gem,
                            desc: "Local Gemini agent"
                          },
                          {
                            value: "opencode_local" as const,
                            label: "OpenCode",
                            icon: OpenCodeLogoIcon,
                            desc: "Local multi-provider agent"
                          },
                          {
                            value: "pi_local" as const,
                            label: "Pi",
                            icon: Terminal,
                            desc: "Local Pi agent"
                          },
                          {
                            value: "cursor" as const,
                            label: "Cursor",
                            icon: MousePointer2,
                            desc: "Local Cursor agent"
                          },
                          {
                            value: "hermes_local" as const,
                            label: "Hermes Agent",
                            icon: HermesIcon,
                            desc: "Local multi-provider agent"
                          },
                          {
                            value: "openclaw_gateway" as const,
                            label: "OpenClaw Gateway",
                            icon: Bot,
                            desc: "Invoke OpenClaw via gateway protocol",
                            comingSoon: true,
                            disabledLabel: "Configure OpenClaw within the App"
                          }
                        ].map((opt) => (
                          <button
                            key={opt.value}
                            disabled={!!opt.comingSoon}
                            className={cn(
                              "flex flex-col items-center gap-1.5 rounded-md border p-3 text-xs relative",
                              opt.comingSoon
                                ? "border-border opacity-40 cursor-not-allowed"
                                : adapterType === opt.value
                                ? "border-foreground bg-accent"
                                : "border-border hover:opacity-80"
                            )}
                            onClick={() => {
                              if (opt.comingSoon) return;
                              const nextType = opt.value as AdapterType;
                              setAdapterType(nextType);
                              if (nextType === "gemini_local" && !model) {
                                setModel(DEFAULT_GEMINI_LOCAL_MODEL);
                                return;
                              }
                              if (nextType === "cursor" && !model) {
                                setModel(DEFAULT_CURSOR_LOCAL_MODEL);
                                return;
                              }
                              if (nextType === "opencode_local") {
                                if (!model.includes("/")) {
                                  setModel("");
                                }
                                return;
                              }
                              setModel("");
                            }}
                          >
                            <opt.icon className="h-4 w-4" />
                            <span className="font-medium">{opt.label}</span>
                            <span className="text-muted-foreground text-[10px]">
                              {opt.comingSoon
                                ? (opt as { disabledLabel?: string })
                                    .disabledLabel ?? "Coming soon"
                                : opt.desc}
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Conditional adapter fields */}
                  {(adapterType === "claude_local" ||
                    adapterType === "codex_local" ||
                    adapterType === "gemini_local" ||
                    adapterType === "hermes_local" ||
                    adapterType === "opencode_local" ||
                    adapterType === "pi_local" ||
                    adapterType === "cursor") && (
                    <div className="space-y-3">
                      <div>
                        <label className="text-xs text-muted-foreground mb-1 block">
                          Model
                        </label>
                        <Popover
                          open={modelOpen}
                          onOpenChange={(next) => {
                            setModelOpen(next);
                            if (!next) setModelSearch("");
                          }}
                        >
                          <PopoverTrigger asChild>
                            <button className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-sm hover:opacity-80 w-full justify-between">
                              <span
                                className={cn(
                                  !model && "text-muted-foreground"
                                )}
                              >
                                {selectedModel
                                  ? selectedModel.label
                                  : model ||
                                    (adapterType === "opencode_local"
                                      ? "Select model (required)"
                                      : "Default")}
                              </span>
                              <ChevronDown className="h-3 w-3 text-muted-foreground" />
                            </button>
                          </PopoverTrigger>
                          <PopoverContent
                            className="w-[var(--radix-popover-trigger-width)] p-1"
                            align="start"
                          >
                            <input
                              className="w-full px-2 py-1.5 text-xs bg-transparent outline-none border-b border-border mb-1 placeholder:text-muted-foreground/50"
                              placeholder="Search models..."
                              value={modelSearch}
                              onChange={(e) => setModelSearch(e.target.value)}
                              autoFocus
                            />
                            {adapterType !== "opencode_local" && (
                              <button
                                className={cn(
                                  "flex items-center gap-2 w-full px-2 py-1.5 text-sm rounded hover:opacity-80",
                                  !model && "bg-accent"
                                )}
                                onClick={() => {
                                  setModel("");
                                  setModelOpen(false);
                                }}
                              >
                                Default
                              </button>
                            )}
                            <div className="max-h-[240px] overflow-y-auto">
                              {groupedModels.map((group) => (
                                <div
                                  key={group.provider}
                                  className="mb-1 last:mb-0"
                                >
                                  {adapterType === "opencode_local" && (
                                    <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                                      {group.provider} ({group.entries.length})
                                    </div>
                                  )}
                                  {group.entries.map((m) => (
                                    <button
                                      key={m.id}
                                      className={cn(
                                        "flex items-center w-full px-2 py-1.5 text-sm rounded hover:opacity-80",
                                        m.id === model && "bg-accent"
                                      )}
                                      onClick={() => {
                                        setModel(m.id);
                                        setModelOpen(false);
                                      }}
                                    >
                                      <span
                                        className="block w-full text-left truncate"
                                        title={m.id}
                                      >
                                        {adapterType === "opencode_local"
                                          ? extractModelName(m.id)
                                          : m.label}
                                      </span>
                                    </button>
                                  ))}
                                </div>
                              ))}
                            </div>
                            {filteredModels.length === 0 && (
                              <p className="px-2 py-1.5 text-xs text-muted-foreground">
                                No models discovered.
                              </p>
                            )}
                          </PopoverContent>
                        </Popover>
                      </div>
                    </div>
                  )}

                  {isLocalAdapter && (
                      <div className="space-y-2 rounded-md border border-border p-3">
                        <div className="flex items-center justify-between gap-2">
                        <div>
                          <p className="text-xs font-medium">
                            Adapter environment check
                          </p>
                          <p className="text-[11px] text-muted-foreground">
                            Runs a live probe that asks the adapter CLI to
                            respond with hello.
                          </p>
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 px-2.5 text-xs"
                          disabled={adapterEnvLoading || (isNewCompanyFlow && !createdCompanyId)}
                          onClick={() => void runAdapterEnvironmentTest()}
                        >
                          {adapterEnvLoading ? "Testing..." : isNewCompanyFlow && !createdCompanyId ? "Create company first" : "Test now"}
                        </Button>
                      </div>

                      {isNewCompanyFlow && !createdCompanyId && (
                        <div className="rounded-md border border-border/70 bg-muted/20 px-2.5 py-2 text-[11px] text-muted-foreground">
                          We run the live adapter check after the company is created on the next step.
                        </div>
                      )}

                      {adapterEnvError && (
                        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-2.5 py-2 text-[11px] text-destructive">
                          {adapterEnvError}
                        </div>
                      )}

                      {adapterEnvResult &&
                      adapterEnvResult.status === "pass" ? (
                        <div className="flex items-center gap-2 rounded-md border border-green-300 dark:border-green-500/40 bg-green-50 dark:bg-green-500/10 px-3 py-2 text-xs text-green-700 dark:text-green-300 animate-in fade-in slide-in-from-bottom-1 duration-300">
                          <Check className="h-3.5 w-3.5 shrink-0" />
                          <span className="font-medium">Passed</span>
                        </div>
                      ) : adapterEnvResult ? (
                        <AdapterEnvironmentResult result={adapterEnvResult} />
                      ) : null}

                      {shouldSuggestUnsetAnthropicApiKey && (
                        <div className="rounded-md border border-amber-300/60 bg-amber-50/40 px-2.5 py-2 space-y-2">
                          <p className="text-[11px] text-amber-900/90 leading-relaxed">
                            Claude failed while{" "}
                            <span className="font-mono">ANTHROPIC_API_KEY</span>{" "}
                            is set. You can clear it in this CEO adapter config
                            and retry the probe.
                          </p>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 px-2.5 text-xs"
                            disabled={
                              adapterEnvLoading || unsetAnthropicLoading
                            }
                            onClick={() => void handleUnsetAnthropicApiKey()}
                          >
                            {unsetAnthropicLoading
                              ? "Retrying..."
                              : "Unset ANTHROPIC_API_KEY"}
                          </Button>
                        </div>
                      )}

                      {adapterEnvResult && adapterEnvResult.status === "fail" && (
                        <div className="rounded-md border border-border/70 bg-muted/20 px-2.5 py-2 text-[11px] space-y-1.5">
                          <p className="font-medium">Manual debug</p>
                          <p className="text-muted-foreground font-mono break-all">
                            {adapterType === "cursor"
                              ? `${effectiveAdapterCommand} -p --mode ask --output-format json \"Respond with hello.\"`
                              : adapterType === "codex_local"
                              ? `${effectiveAdapterCommand} exec --json -`
                              : adapterType === "gemini_local"
                                ? `${effectiveAdapterCommand} --output-format json "Respond with hello."`
                              : adapterType === "opencode_local"
                                ? `${effectiveAdapterCommand} run --format json "Respond with hello."`
                              : `${effectiveAdapterCommand} --print - --output-format stream-json --verbose`}
                          </p>
                          <p className="text-muted-foreground">
                            Prompt:{" "}
                            <span className="font-mono">Respond with hello.</span>
                          </p>
                          {adapterType === "cursor" ||
                          adapterType === "codex_local" ||
                          adapterType === "gemini_local" ||
                          adapterType === "opencode_local" ? (
                            <p className="text-muted-foreground">
                              If auth fails, set{" "}
                              <span className="font-mono">
                                {adapterType === "cursor"
                                  ? "CURSOR_API_KEY"
                                  : adapterType === "gemini_local"
                                    ? "GEMINI_API_KEY"
                                    : "OPENAI_API_KEY"}
                              </span>{" "}
                              in env or run{" "}
                              <span className="font-mono">
                                {adapterType === "cursor"
                                  ? "agent login"
                                  : adapterType === "codex_local"
                                    ? "codex login"
                                    : adapterType === "gemini_local"
                                      ? "gemini auth"
                                      : "opencode auth login"}
                              </span>
                              .
                            </p>
                          ) : (
                            <p className="text-muted-foreground">
                              If login is required, run{" "}
                              <span className="font-mono">claude login</span>{" "}
                              and retry.
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {(adapterType === "http" ||
                    adapterType === "openclaw_gateway") && (
                    <div>
                      <label className="text-xs text-muted-foreground mb-1 block">
                        {adapterType === "openclaw_gateway"
                          ? "Gateway URL"
                          : "Webhook URL"}
                      </label>
                      <input
                        className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm font-mono outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/50"
                        placeholder={
                          adapterType === "openclaw_gateway"
                            ? "ws://127.0.0.1:18789"
                            : "https://..."
                        }
                        value={url}
                        onChange={(e) => setUrl(e.target.value)}
                      />
                    </div>
                  )}
                </div>
              )}

              {isCompanyStep && (
                <div className="space-y-5">
                  <div className="flex items-center gap-3 mb-1">
                    <div className="bg-muted/50 p-2">
                      <Building2 className="h-5 w-5 text-muted-foreground" />
                    </div>
                    <div>
                      <h3 className="font-medium">Name your company</h3>
                      <p className="text-xs text-muted-foreground">
                        This unlocks the task step. Your agent choice above becomes the CEO for this new company.
                      </p>
                    </div>
                  </div>
                  <div className="flex justify-end">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={draftingCompany || loading}
                      onClick={() => void handleDraftCompany()}
                    >
                      {draftingCompany ? "Drafting..." : "Draft with AI"}
                    </Button>
                  </div>
                  <div className="mt-3 group">
                    <label
                      className={cn(
                        "text-xs mb-1 block",
                        companyName.trim()
                          ? "text-foreground"
                          : "text-muted-foreground group-focus-within:text-foreground"
                      )}
                    >
                      Company name
                    </label>
                    <input
                      className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/50"
                      placeholder="Acme Corp"
                      value={companyName}
                      onChange={(e) => setCompanyName(e.target.value)}
                      autoFocus
                    />
                  </div>
                  <div className="group">
                    <label
                      className={cn(
                        "text-xs mb-1 block",
                        companyGoal.trim()
                          ? "text-foreground"
                          : "text-muted-foreground group-focus-within:text-foreground"
                      )}
                    >
                      Mission / goal (optional)
                    </label>
                    <textarea
                      className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/50 resize-none min-h-[120px]"
                      placeholder="What is this company trying to achieve?"
                      value={companyGoal}
                      onChange={(e) => setCompanyGoal(e.target.value)}
                    />
                  </div>
                </div>
              )}

              {isTaskStep && (
                <div className="space-y-5">
                  <div className="flex items-center gap-3 mb-1">
                    <div className="bg-muted/50 p-2">
                      <ListTodo className="h-5 w-5 text-muted-foreground" />
                    </div>
                    <div>
                      <h3 className="font-medium">Give it something to do</h3>
                      <p className="text-xs text-muted-foreground">
                        {isNewCompanyFlow
                          ? "Now that the CEO and company are set, define one focused starter task for the first issue."
                          : `The new agent will be added to ${companyContextLabel}. Give them one clear starter task before launch.`}
                      </p>
                    </div>
                  </div>
                  <div className="flex justify-end">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={draftingTask || loading}
                      onClick={() => void handleDraftTask()}
                    >
                      {draftingTask ? "Drafting..." : "Draft with AI"}
                    </Button>
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">
                      Task title
                    </label>
                    <input
                      className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/50"
                      placeholder="e.g. Research competitor pricing"
                      value={taskTitle}
                      onChange={(e) => setTaskTitle(e.target.value)}
                      autoFocus
                    />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">
                      Description (optional)
                    </label>
                    <textarea
                      ref={textareaRef}
                      className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/50 resize-none min-h-[120px] max-h-[300px] overflow-y-auto"
                      placeholder="Add more detail about what the agent should do..."
                      value={taskDescription}
                      onChange={(e) => setTaskDescription(e.target.value)}
                    />
                  </div>
                </div>
              )}

              {isLaunchStep && (
                <div className="space-y-5">
                  <div className="flex items-center gap-3 mb-1">
                    <div className="bg-muted/50 p-2">
                      <Rocket className="h-5 w-5 text-muted-foreground" />
                    </div>
                    <div>
                      <h3 className="font-medium">Ready to launch</h3>
                      <p className="text-xs text-muted-foreground">
                        {isNewCompanyFlow
                          ? "Everything is aligned. Launching now will create the starter issue, wake the CEO, and open the issue."
                          : `Everything stays scoped to ${companyContextLabel}. Launching now will create the starter issue, wake the new agent, and open the issue.`}
                      </p>
                    </div>
                  </div>
                  <div className="border border-border divide-y divide-border">
                    <div className="flex items-center gap-3 px-3 py-2.5">
                      <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">
                          {companyName || existingCompany?.name || "Company"}
                        </p>
                        <p className="text-xs text-muted-foreground">Company</p>
                      </div>
                      <Check className="h-4 w-4 text-green-500 shrink-0" />
                    </div>
                    <div className="flex items-center gap-3 px-3 py-2.5">
                      <Bot className="h-4 w-4 text-muted-foreground shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">
                          {agentName}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {getUIAdapter(adapterType).label}
                        </p>
                      </div>
                      <Check className="h-4 w-4 text-green-500 shrink-0" />
                    </div>
                    <div className="flex items-center gap-3 px-3 py-2.5">
                      <ListTodo className="h-4 w-4 text-muted-foreground shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">
                          {taskTitle}
                        </p>
                        <p className="text-xs text-muted-foreground">Task</p>
                      </div>
                      <Check className="h-4 w-4 text-green-500 shrink-0" />
                    </div>
                  </div>
                </div>
              )}

              {/* Error */}
              {error && (
                <div className="mt-3">
                  <p className="text-xs text-destructive">{error}</p>
                </div>
              )}

              {/* Footer navigation */}
              <div className="flex items-center justify-between mt-8">
                <div>
                  {step > 1 && step > initialStep && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setStep((step - 1) as Step)}
                      disabled={loading}
                    >
                      <ArrowLeft className="h-3.5 w-3.5 mr-1" />
                      Back
                    </Button>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {step === 1 && (
                    <Button
                      size="sm"
                      disabled={!agentName.trim() || loading}
                      onClick={handleStep1Next}
                    >
                      {loading ? (
                        <span className="text-[10px] text-[var(--fg-dim)]">loading...</span>
                      ) : (
                        <ArrowRight className="h-3.5 w-3.5 mr-1" />
                      )}
                      {loading ? "Creating..." : "Next"}
                    </Button>
                  )}
                  {isCompanyStep && (
                    <Button
                      size="sm"
                      disabled={
                        !companyName.trim() ||
                        loading ||
                        adapterEnvLoading ||
                        (isLocalAdapter && adapterEnvResult?.status === "fail")
                      }
                      onClick={handleStep2Next}
                    >
                      {loading ? (
                        <span className="text-[10px] text-[var(--fg-dim)]">loading...</span>
                      ) : (
                        <ArrowRight className="h-3.5 w-3.5 mr-1" />
                      )}
                      {loading ? "Creating..." : "Next"}
                    </Button>
                  )}
                  {isTaskStep && (
                    <Button
                      size="sm"
                      disabled={!taskTitle.trim() || loading}
                      onClick={isNewCompanyFlow ? handleStep3Next : handleStep2Next}
                    >
                      {loading ? (
                        <span className="text-[10px] text-[var(--fg-dim)]">loading...</span>
                      ) : (
                        <ArrowRight className="h-3.5 w-3.5 mr-1" />
                      )}
                      {loading ? "Creating..." : "Next"}
                    </Button>
                  )}
                  {isLaunchStep && (
                    <Button size="sm" disabled={loading} onClick={handleLaunch}>
                      {loading ? (
                        <span className="text-[10px] text-[var(--fg-dim)]">loading...</span>
                      ) : (
                        <ArrowRight className="h-3.5 w-3.5 mr-1" />
                      )}
                      {loading ? "Creating..." : "Create & Open Issue"}
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Right half — ASCII art (hidden on mobile) */}
          <div
            className={cn(
              "hidden md:block overflow-hidden bg-[#1d1d1d] text-white transition-[width,opacity] duration-500 ease-in-out",
              step === 1 ? "w-1/2 opacity-100" : "w-0 opacity-0"
            )}
          >
            <div className="flex h-full flex-col justify-between px-8 py-12">
              <div className="space-y-6">
                <div className="space-y-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-white/70">
                    {shellEyebrow}
                  </p>
                  <h2 className="text-3xl font-semibold leading-tight">
                    {shellTitle}
                  </h2>
                  <p className="max-w-md text-sm leading-6 text-white/70">
                    {shellDescription}
                  </p>
                </div>

                <div className="border border-white/15 bg-white/5">
                  {visibleSteps.map(({ step: s, label, detail }) => (
                    <div
                      key={s}
                      className={cn(
                        "flex items-start gap-3 border-b border-white/10 px-4 py-3 last:border-b-0",
                        s === step ? "bg-white/10" : ""
                      )}
                    >
                      <div
                        className={cn(
                          "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center border text-[11px] font-semibold",
                          s <= maxAccessibleStep
                            ? "border-white/40 text-white"
                            : "border-white/20 text-white/45"
                        )}
                      >
                        {s}
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-white">{label}</p>
                        <p className="text-xs leading-5 text-white/65">
                          {detail}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="min-h-0 overflow-hidden border border-white/10 bg-black/25">
                <AsciiArtAnimation />
              </div>
            </div>
          </div>
        </div>
      </DialogPortal>
    </Dialog>
  );
}

function AdapterEnvironmentResult({
  result
}: {
  result: AdapterEnvironmentTestResult;
}) {
  const statusLabel =
    result.status === "pass"
      ? "Passed"
      : result.status === "warn"
      ? "Warnings"
      : "Failed";
  const statusClass =
    result.status === "pass"
      ? "text-green-700 dark:text-green-300 border-green-300 dark:border-green-500/40 bg-green-50 dark:bg-green-500/10"
      : result.status === "warn"
      ? "text-amber-700 dark:text-amber-300 border-amber-300 dark:border-amber-500/40 bg-amber-50 dark:bg-amber-500/10"
      : "text-red-700 dark:text-red-300 border-red-300 dark:border-red-500/40 bg-red-50 dark:bg-red-500/10";

  return (
    <div className={`rounded-md border px-2.5 py-2 text-[11px] ${statusClass}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium">{statusLabel}</span>
        <span className="opacity-80">
          {new Date(result.testedAt).toLocaleTimeString()}
        </span>
      </div>
      <div className="mt-1.5 space-y-1">
        {result.checks.map((check, idx) => (
          <div
            key={`${check.code}-${idx}`}
            className="leading-relaxed break-words"
          >
            <span className="font-medium uppercase tracking-wide opacity-80">
              {check.level}
            </span>
            <span className="mx-1 opacity-60">·</span>
            <span>{check.message}</span>
            {check.detail && (
              <span className="block opacity-75 break-all">
                ({check.detail})
              </span>
            )}
            {check.hint && (
              <span className="block opacity-90 break-words">
                Hint: {check.hint}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
