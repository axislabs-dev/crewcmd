export type CrewCmdRolePack =
  | "orchestrator"
  | "developer"
  | "reviewer"
  | "researcher"
  | "growth"
  | "ops";

export type CrewCmdOperatingMode = "imported-overlay" | "blueprint-owned";

export interface CrewCmdCuratedSkill {
  slug: string;
  name: string;
  description: string;
  source: "crewcmd-curated" | "community-fork";
  sourceUrl?: string;
  version?: string;
}

export interface CrewCmdOperatingLayerConfig {
  version: "0.1.1";
  mode: CrewCmdOperatingMode;
  rolePack: CrewCmdRolePack;
  modelProfile?: string;
  fallbackProfiles?: string[];
  overlayContent: string;
  mirroredFiles?: {
    identityRaw?: string;
    soulRaw?: string;
    agentsRaw?: string;
  };
  curatedSkills?: CrewCmdCuratedSkill[];
  humanAttention: {
    alwaysCreateInbox: true;
    triggers: Array<"blocker" | "question" | "review" | "decision">;
  };
  developerWorkflow?: {
    branchFrom: "main";
    branchPrefix: "codex/";
    requireAtomicCommits: true;
    requirePullRequest: true;
    requireTaskLinkage: true;
    reviewStatusRequiresPr: true;
  };
  governance: {
    mode: "scaffolded";
    auditRequired: true;
    approvalsDeferred: true;
  };
}

function rolePackLabel(rolePack: CrewCmdRolePack): string {
  switch (rolePack) {
    case "orchestrator":
      return "orchestrator";
    case "developer":
      return "developer";
    case "reviewer":
      return "reviewer";
    case "researcher":
      return "researcher";
    case "growth":
      return "growth";
    case "ops":
      return "ops";
  }
}

export function inferRolePack(input: {
  role?: string | null;
  title?: string | null;
  callsign?: string | null;
  promptTemplate?: string | null;
}): CrewCmdRolePack {
  const haystack = [
    input.role,
    input.title,
    input.callsign,
    input.promptTemplate,
  ]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join(" ")
    .toLowerCase();

  if (/(review|qa|sentinel|audit)/.test(haystack)) return "reviewer";
  if (/(research|analyst|intel|strategy)/.test(haystack)) return "researcher";
  if (/(growth|marketing|sales|content|social|seo|gtm)/.test(haystack)) return "growth";
  if (/(ops|devops|support|infra|dispatch|sre)/.test(haystack)) return "ops";
  if (/(lead|chief|director|manager|orchestr|neo|main)/.test(haystack)) return "orchestrator";
  return "developer";
}

export function isDeveloperWorkflowRole(rolePack: CrewCmdRolePack | null | undefined): boolean {
  return rolePack === "developer" || rolePack === "reviewer";
}

export function buildOperatingOverlay(params: {
  rolePack: CrewCmdRolePack;
  mode: CrewCmdOperatingMode;
  callsign?: string | null;
  workspaceId?: string | null;
}): string {
  const heading =
    params.mode === "blueprint-owned"
      ? "CrewCmd fully manages this agent's operating contract."
      : "CrewCmd overlays these workflow rules on top of the agent's existing identity and soul.";

  const sharedRules = [
    heading,
    "CrewCmd is the source of truth for tasks, comments, inbox, and delivery state.",
    "Read task comments before starting meaningful work and leave concise audit comments for pickup, progress, blockers, review context, and completion.",
    "Any blocker, question, review request, or decision request must create a human inbox item.",
    "Prefer updating an existing task and comment trail over creating duplicate work records.",
  ];

  const roleSpecific: Record<CrewCmdRolePack, string[]> = {
    orchestrator: [
      "Use CrewCmd to route work, detect blockers, and verify audit completeness across the workspace.",
      "Escalate any human decision, review request, or unresolved blocker into inbox immediately.",
    ],
    developer: [
      "Work from latest main, create a new codex/* branch, keep commits atomic, and open a PR for code changes.",
      "A task is not code-complete until the PR URL and PR status are linked back to the task.",
    ],
    reviewer: [
      "Treat review as a delivery gate. Document findings on the PR and summarize the outcome on the task.",
      "Do not move code tasks into review or done without an attached PR artifact.",
    ],
    researcher: [
      "Capture sources and evidence in task comments so findings are reproducible.",
      "Escalate missing context or human decisions through inbox instead of silently blocking.",
    ],
    growth: [
      "Use approved tools and connectors to produce concrete campaign, content, or outreach outcomes rather than generic notes.",
      "Record external actions and follow-up requirements in CrewCmd comments and inbox.",
    ],
    ops: [
      "Prefer safe, reversible operational actions and log incidents, mitigations, and follow-ups in CrewCmd.",
      "If manual approval is needed, create a human inbox item before proceeding.",
    ],
  };

  return [...sharedRules, "", `Role pack: ${rolePackLabel(params.rolePack)}`, ...roleSpecific[params.rolePack]].join("\n");
}

export function buildOperatingLayerConfig(params: {
  mode: CrewCmdOperatingMode;
  rolePack: CrewCmdRolePack;
  modelProfile?: string | null;
  fallbackProfiles?: string[];
  callsign?: string | null;
  workspaceId?: string | null;
  mirroredFiles?: CrewCmdOperatingLayerConfig["mirroredFiles"];
  curatedSkills?: CrewCmdCuratedSkill[];
  overlayContent?: string;
}): CrewCmdOperatingLayerConfig {
  return {
    version: "0.1.1",
    mode: params.mode,
    rolePack: params.rolePack,
    modelProfile: params.modelProfile ?? undefined,
    fallbackProfiles: params.fallbackProfiles,
    overlayContent:
      params.overlayContent ??
      buildOperatingOverlay({
        rolePack: params.rolePack,
        mode: params.mode,
        callsign: params.callsign,
        workspaceId: params.workspaceId,
      }),
    mirroredFiles: params.mirroredFiles,
    curatedSkills: params.curatedSkills,
    humanAttention: {
      alwaysCreateInbox: true,
      triggers: ["blocker", "question", "review", "decision"],
    },
    developerWorkflow: isDeveloperWorkflowRole(params.rolePack)
      ? {
          branchFrom: "main",
          branchPrefix: "codex/",
          requireAtomicCommits: true,
          requirePullRequest: true,
          requireTaskLinkage: true,
          reviewStatusRequiresPr: true,
        }
      : undefined,
    governance: {
      mode: "scaffolded",
      auditRequired: true,
      approvalsDeferred: true,
    },
  };
}

export function buildBlueprintOperatingLayer(params: {
  callsign: string;
  rolePack?: string | null;
  modelProfile?: string | null;
  fallbackProfiles?: string[];
  workspaceId?: string | null;
  curatedSkills?: CrewCmdCuratedSkill[];
  identityRaw?: string;
  soulRaw?: string;
  agentsRaw?: string;
}): CrewCmdOperatingLayerConfig {
  const rolePack =
    (params.rolePack as CrewCmdRolePack | undefined) ??
    inferRolePack({ callsign: params.callsign });
  return buildOperatingLayerConfig({
    mode: "blueprint-owned",
    rolePack,
    modelProfile: params.modelProfile,
    fallbackProfiles: params.fallbackProfiles,
    callsign: params.callsign,
    workspaceId: params.workspaceId,
    curatedSkills: params.curatedSkills,
    mirroredFiles: {
      identityRaw: params.identityRaw,
      soulRaw: params.soulRaw,
      agentsRaw: params.agentsRaw,
    },
  });
}
