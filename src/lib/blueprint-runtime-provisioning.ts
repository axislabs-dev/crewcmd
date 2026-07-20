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
    const directReports = buildDirectReportRuntimeRefs(params.agentTemplates);
    const patch = buildBlueprintRuntimeConfigPatch({
      config: snapshot.config,
      agentTemplates: params.agentTemplates,
      runtimeCapabilities: params.runtimeCapabilities,
    });

    try {
      await client.configPatch({
        patch,
        baseHash: snapshot.hash,
        note: "CrewCmd provisioned blueprint agents on the primary runtime",
        restartDelayMs: 5000,
      });
    } catch (err) {
      if (!isGatewayRestartError(err)) throw err;
      await reconnectAfterGatewayRestart(client);
    }

    for (const tmpl of params.agentTemplates) {
      const runtimeRef = buildRuntimeRef(tmpl.callsign);
      await syncBlueprintFiles(client, runtimeRef, tmpl, directReports.get(runtimeRef) ?? []);
    }

    const blueprintRefs = new Set(
      params.agentTemplates.map((tmpl) => buildRuntimeRef(tmpl.callsign))
    );

    return {
      agents: patch.agents.list
        .filter((entry) => blueprintRefs.has(String(entry.id)))
        .map((entry) => ({
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
  const directReports = buildDirectReportRuntimeRefs(params.agentTemplates);

  if (!workspaceRoot) {
    throw new Error("Primary runtime config does not expose an agent workspace root");
  }

  const blueprintEntries = params.agentTemplates.map((tmpl) => {
    const runtimeRef = buildRuntimeRef(tmpl.callsign);
    const directReportRefs = directReports.get(runtimeRef) ?? [];
    const resolvedModel = resolveBlueprintAgentModelSelection(
      tmpl,
      params.runtimeCapabilities
    );
    const workspacePath = pathPosix.join(workspaceRoot, "agents", runtimeRef);
    const agentDir = agentRoot
      ? pathPosix.join(agentRoot, runtimeRef, "agent")
      : null;

    return {
      id: runtimeRef,
      name: runtimeRef,
      workspace: workspacePath,
      ...(agentRoot ? { agentDir } : {}),
      model: resolvedModel.primaryModel
        ? {
            primary: resolvedModel.primaryModel,
            ...(resolvedModel.fallbackModels.length > 0
              ? { fallbacks: resolvedModel.fallbackModels }
              : {}),
          }
        : undefined,
      skills: dedupeSkills(tmpl.skills ?? []),
      ...(directReportRefs.length > 0
        ? {
            subagents: {
              allowAgents: directReportRefs,
            },
          }
        : {}),
    };
  });

  const acp = readAcpConfig(params.config);
  const blueprintAgentIds = blueprintEntries.map((entry) => String(entry.id));

  return {
    agents: {
      list: mergeAgentEntries(existingAgents, blueprintEntries),
    },
    acp: {
      enabled: acp.enabled || blueprintAgentIds.length > 0,
      ...(acp.defaultAgent ? { defaultAgent: acp.defaultAgent } : {}),
      allowedAgents: mergeUnique(acp.allowedAgents, blueprintAgentIds),
    },
  };
}

function mergeAgentEntries(
  existingAgents: Array<Record<string, unknown>>,
  blueprintEntries: Array<Record<string, unknown>>
): Array<Record<string, unknown>> {
  const merged = new Map<string, Record<string, unknown>>();

  for (const entry of existingAgents) {
    const id = readAgentId(entry);
    if (!id) continue;
    merged.set(id, entry);
  }

  for (const entry of blueprintEntries) {
    const id = readAgentId(entry);
    if (!id) continue;
    merged.set(id, entry);
  }

  return Array.from(merged.values());
}

async function syncBlueprintFiles(
  client: GatewayClient,
  runtimeRef: string,
  tmpl: BlueprintAgentTemplate,
  directReportRefs: string[]
): Promise<void> {
  const files = [
    ["IDENTITY.md", tmpl.identityContent],
    ["SOUL.md", tmpl.soulContent],
    ["AGENTS.md", appendDirectReportsToAgentsContent(tmpl.agentsContent, directReportRefs)],
    ["USER.md", tmpl.userContent],
    ["TOOLS.md", tmpl.toolsContent],
    ["HEARTBEAT.md", tmpl.heartbeatContent],
    ["BOOTSTRAP.md", tmpl.bootstrapContent],
  ].filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].trim().length > 0);

  for (const [name, content] of files) {
    await setAgentFileWithRestartRetry(client, runtimeRef, name, content);
  }
}

async function setAgentFileWithRestartRetry(
  client: GatewayClient,
  runtimeRef: string,
  name: string,
  content: string
) {
  try {
    await ensureGatewayConnected(client);
    await client.setAgentFile(runtimeRef, name, content);
  } catch (err) {
    if (!isGatewayRestartError(err) && !isGatewayDisconnectedError(err)) throw err;
    await reconnectAfterGatewayRestart(client);
    await client.setAgentFile(runtimeRef, name, content);
  }
}

async function ensureGatewayConnected(client: GatewayClient) {
  if (client.isConnected) return;
  await reconnectAfterGatewayRestart(client);
}

async function reconnectAfterGatewayRestart(client: GatewayClient) {
  client.close();
  let lastError: unknown;
  for (let attempt = 0; attempt < 8; attempt++) {
    await sleep(attempt === 0 ? 1500 : 1000);
    try {
      await client.connect();
      return;
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`Failed to reconnect to gateway: ${String(lastError)}`);
}

function isGatewayRestartError(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  return /Connection closed \(1012\):.*service restart/i.test(message);
}

function isGatewayDisconnectedError(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  return /Not connected to gateway/i.test(message);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildRuntimeRef(callsign: string): string {
  return callsign.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "-");
}

function buildDirectReportRuntimeRefs(
  agentTemplates: BlueprintAgentTemplate[]
): Map<string, string[]> {
  const byCallsign = new Map(
    agentTemplates.map((tmpl) => [
      tmpl.callsign.trim().toUpperCase(),
      buildRuntimeRef(tmpl.callsign),
    ])
  );
  const directReports = new Map<string, string[]>();

  for (const tmpl of agentTemplates) {
    if (!tmpl.reportsTo) continue;
    const managerRef = byCallsign.get(tmpl.reportsTo.trim().toUpperCase());
    if (!managerRef) continue;
    const children = directReports.get(managerRef) ?? [];
    children.push(buildRuntimeRef(tmpl.callsign));
    directReports.set(managerRef, children);
  }

  return new Map(
    Array.from(directReports.entries()).map(([managerRef, children]) => [
      managerRef,
      mergeUnique([], children),
    ])
  );
}

function appendDirectReportsToAgentsContent(
  content: string | undefined,
  directReportRefs: string[]
): string | undefined {
  if (directReportRefs.length === 0) return content;

  const section = [
    "## Direct Reports",
    "",
    "You may delegate work to these OpenClaw subagents with `sessions_spawn`:",
    ...directReportRefs.map((ref) => `- ${ref}`),
  ].join("\n");

  if (!content?.trim()) return section;
  return `${content.trimEnd()}\n\n${section}`;
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

function readAgentId(entry: Record<string, unknown>): string | null {
  const id = typeof entry.id === "string" ? entry.id.trim() : "";
  return id || null;
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
