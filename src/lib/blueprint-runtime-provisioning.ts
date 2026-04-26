import { dirname, posix as pathPosix } from "node:path";
import type { BlueprintAgentTemplate } from "@/db/schema";
import { GatewayClient, resolveDeviceIdentity } from "./gateway-client";
import type { RuntimeCapabilitySnapshot } from "./runtime-capabilities";
import { resolveBlueprintAgentModelSelection } from "./model-profiles";

interface RuntimeRecord {
  id: string;
  gatewayUrl: string;
  httpUrl: string;
  authToken: string | null;
  metadata: Record<string, unknown> | null;
}

export interface ProvisionedBlueprintAgent {
  callsign: string;
  runtimeRef: string;
  workspacePath: string | null;
}

export type BlueprintRuntimeConfigPatch = Record<string, unknown> & {
  agents: {
    list: Array<Record<string, unknown>>;
  };
  acp: {
    enabled: boolean;
    defaultAgent?: string;
    allowedAgents: string[];
  };
};

export async function provisionBlueprintAgentsToRuntime(params: {
  runtime: RuntimeRecord;
  agentTemplates: BlueprintAgentTemplate[];
  runtimeCapabilities: RuntimeCapabilitySnapshot | null;
}): Promise<{ agents: ProvisionedBlueprintAgent[] }> {
  const deviceKeyPem =
    typeof params.runtime.metadata?.devicePrivateKeyPem === "string"
      ? params.runtime.metadata.devicePrivateKeyPem
      : undefined;
  const client = new GatewayClient(
    params.runtime.gatewayUrl,
    params.runtime.authToken || null,
    resolveDeviceIdentity(deviceKeyPem),
    15000
  );

  try {
    await client.connect();
    const snapshot = await client.configGet();
    const patch = buildBlueprintRuntimeConfigPatch({
      config: snapshot.config,
      agentTemplates: params.agentTemplates,
      runtimeCapabilities: params.runtimeCapabilities,
    });

    await client.configPatch({
      patch,
      baseHash: snapshot.hash,
      note: "CrewCmd provisioned blueprint agents on the primary runtime",
    });

    for (const tmpl of params.agentTemplates) {
      const runtimeRef = buildRuntimeRef(tmpl.callsign);
      await syncBlueprintFiles(client, runtimeRef, tmpl);
    }

    return {
      agents: patch.agents.list.map((entry) => ({
        callsign: params.agentTemplates.find((tmpl) => buildRuntimeRef(tmpl.callsign) === entry.id)?.callsign.toUpperCase() ?? String(entry.id).toUpperCase(),
        runtimeRef: String(entry.id),
        workspacePath: typeof entry.workspace === "string" ? entry.workspace : null,
      })),
    };
  } finally {
    client.close();
  }
}

export function buildBlueprintRuntimeConfigPatch(params: {
  config: Record<string, unknown>;
  agentTemplates: BlueprintAgentTemplate[];
  runtimeCapabilities: RuntimeCapabilitySnapshot | null;
}): BlueprintRuntimeConfigPatch {
  const existingAgents = readAgentList(params.config);
  const workspaceRoot = inferWorkspaceRoot(params.config, existingAgents);
  const agentRoot = inferAgentRoot(existingAgents);

  if (!workspaceRoot || !agentRoot) {
    throw new Error("Primary runtime config does not expose agent workspace roots");
  }

  const patchEntries = params.agentTemplates.map((tmpl) => {
    const runtimeRef = buildRuntimeRef(tmpl.callsign);
    const resolvedModel = resolveBlueprintAgentModelSelection(
      tmpl,
      params.runtimeCapabilities
    );
    const workspacePath = pathPosix.join(workspaceRoot, "agents", runtimeRef);
    const agentDir = pathPosix.join(agentRoot, runtimeRef, "agent");

    return {
      id: runtimeRef,
      name: runtimeRef,
      workspace: workspacePath,
      agentDir,
      model: resolvedModel.primaryModel
        ? {
            primary: resolvedModel.primaryModel,
            ...(resolvedModel.fallbackModels.length > 0
              ? { fallbacks: resolvedModel.fallbackModels }
              : {}),
          }
        : undefined,
      skills: dedupeSkills(tmpl.skills ?? []),
    };
  });

  const acp = readAcpConfig(params.config);
  const blueprintAgentIds = patchEntries.map((entry) => String(entry.id));

  return {
    agents: {
      list: patchEntries,
    },
    acp: {
      enabled: acp.enabled || blueprintAgentIds.length > 0,
      ...(acp.defaultAgent ? { defaultAgent: acp.defaultAgent } : {}),
      allowedAgents: mergeUnique(acp.allowedAgents, blueprintAgentIds),
    },
  };
}

function syncBlueprintFiles(
  client: GatewayClient,
  runtimeRef: string,
  tmpl: BlueprintAgentTemplate
): Promise<unknown[]> {
  const files = [
    ["IDENTITY.md", tmpl.identityContent],
    ["SOUL.md", tmpl.soulContent],
    ["AGENTS.md", tmpl.agentsContent],
    ["USER.md", tmpl.userContent],
    ["TOOLS.md", tmpl.toolsContent],
    ["HEARTBEAT.md", tmpl.heartbeatContent],
    ["BOOTSTRAP.md", tmpl.bootstrapContent],
  ].filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].trim().length > 0);

  return Promise.all(
    files.map(([name, content]) => client.setAgentFile(runtimeRef, name, content))
  );
}

function buildRuntimeRef(callsign: string): string {
  return callsign.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "-");
}

function dedupeSkills(skills: string[]): string[] {
  return Array.from(
    new Set(
      skills
        .map((value) => value.trim().replace(/^\/+/, ""))
        .filter((value) => value.length > 0)
    )
  );
}

function readAgentList(config: Record<string, unknown>): Array<Record<string, unknown>> {
  const agentsConfig = isPlainObject(config.agents) ? config.agents : null;
  const list = agentsConfig?.list;
  if (!Array.isArray(list)) return [];
  return list.filter(isPlainObject);
}

function readAcpConfig(config: Record<string, unknown>): {
  enabled: boolean;
  defaultAgent?: string;
  allowedAgents: string[];
} {
  const acp = isPlainObject(config.acp) ? config.acp : null;
  const defaultAgent = typeof acp?.defaultAgent === "string" && acp.defaultAgent.trim()
    ? acp.defaultAgent.trim()
    : undefined;

  return {
    enabled: acp?.enabled === true,
    ...(defaultAgent ? { defaultAgent } : {}),
    allowedAgents: Array.isArray(acp?.allowedAgents)
      ? acp.allowedAgents
          .filter((value): value is string => typeof value === "string")
          .map((value) => value.trim())
          .filter(Boolean)
      : [],
  };
}

function mergeUnique(existing: string[], next: string[]): string[] {
  return Array.from(new Set([...existing, ...next].map((value) => value.trim()).filter(Boolean)));
}

function inferWorkspaceRoot(
  config: Record<string, unknown>,
  existingAgents: Array<Record<string, unknown>>
): string | null {
  const agentsConfig = isPlainObject(config.agents) ? config.agents : null;
  const defaults = isPlainObject(agentsConfig?.defaults) ? agentsConfig.defaults : null;
  if (typeof defaults?.workspace === "string" && defaults.workspace.trim()) {
    return defaults.workspace.trim();
  }

  for (const entry of existingAgents) {
    const workspace = typeof entry.workspace === "string" ? entry.workspace.trim() : "";
    if (!workspace) continue;
    const parent = dirname(workspace);
    if (parent.endsWith("/agents")) {
      return dirname(parent);
    }
    return dirname(workspace);
  }

  return null;
}

function inferAgentRoot(existingAgents: Array<Record<string, unknown>>): string | null {
  for (const entry of existingAgents) {
    const agentDir = typeof entry.agentDir === "string" ? entry.agentDir.trim() : "";
    if (!agentDir) continue;
    const parent = dirname(agentDir);
    return dirname(parent);
  }

  return null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
