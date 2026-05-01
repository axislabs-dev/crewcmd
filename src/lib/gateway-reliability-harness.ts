export type GatewayHarnessSpecId =
  | "connect"
  | "sessions.list"
  | "chat.send"
  | "chat.history"
  | "config.get"
  | "config.patch"
  | "skills.status";

export type GatewayHarnessRisk = "read" | "write";

export interface GatewayHarnessSpec {
  id: GatewayHarnessSpecId;
  method: string;
  risk: GatewayHarnessRisk;
  description: string;
}

export interface GatewayHarnessClient {
  connect?: () => Promise<unknown>;
  rpc: <T = unknown>(method: string, params: Record<string, unknown>) => Promise<T>;
  chatSend?: (params: { message: string; sessionKey: string }) => Promise<unknown>;
  chatHistory?: (params: { sessionKey: string; limit?: number }) => Promise<unknown>;
  configGet?: () => Promise<unknown>;
  configPatch?: (params: { patch: Record<string, unknown>; baseHash?: string; note?: string }) => Promise<unknown>;
}

export interface GatewayHarnessOptions {
  includeWriteSpecs?: boolean;
  sessionKey?: string;
  message?: string;
  specs?: GatewayHarnessSpecId[];
}

export interface GatewayHarnessResult {
  id: GatewayHarnessSpecId;
  ok: boolean;
  skipped: boolean;
  method: string;
  risk: GatewayHarnessRisk;
  error?: string;
}

export const DEFAULT_GATEWAY_HARNESS_SPECS: GatewayHarnessSpec[] = [
  {
    id: "connect",
    method: "connect",
    risk: "read",
    description: "Gateway accepts a client connection.",
  },
  {
    id: "sessions.list",
    method: "sessions.list",
    risk: "read",
    description: "Gateway can list chat sessions.",
  },
  {
    id: "chat.send",
    method: "chat.send",
    risk: "read",
    description: "Gateway accepts a chat send request.",
  },
  {
    id: "chat.history",
    method: "chat.history",
    risk: "read",
    description: "Gateway can return chat history for a session.",
  },
  {
    id: "config.get",
    method: "config.get",
    risk: "read",
    description: "Gateway can return a config snapshot.",
  },
  {
    id: "config.patch",
    method: "config.patch",
    risk: "write",
    description: "Gateway can validate or apply config patches.",
  },
  {
    id: "skills.status",
    method: "skills.status",
    risk: "read",
    description: "Gateway can report skill sync status.",
  },
];

const SPEC_BY_ID = new Map(DEFAULT_GATEWAY_HARNESS_SPECS.map((spec) => [spec.id, spec]));

export function listGatewayHarnessSpecs(options: Pick<GatewayHarnessOptions, "includeWriteSpecs"> = {}) {
  return DEFAULT_GATEWAY_HARNESS_SPECS.filter((spec) => {
    return options.includeWriteSpecs || spec.risk !== "write";
  });
}

export async function runGatewayReliabilityHarness(
  client: GatewayHarnessClient,
  options: GatewayHarnessOptions = {},
): Promise<GatewayHarnessResult[]> {
  const specs = resolveSpecs(options);
  const results: GatewayHarnessResult[] = [];
  const sessionKey = options.sessionKey || "crewcmd-harness";
  const message = options.message || "CrewCmd gateway harness probe.";

  for (const spec of specs) {
    if (spec.risk === "write" && !options.includeWriteSpecs) {
      results.push(toSkippedResult(spec));
      continue;
    }

    try {
      await runSpec(client, spec, { sessionKey, message });
      results.push({ id: spec.id, ok: true, skipped: false, method: spec.method, risk: spec.risk });
    } catch (error) {
      results.push({
        id: spec.id,
        ok: false,
        skipped: false,
        method: spec.method,
        risk: spec.risk,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return results;
}

function resolveSpecs(options: GatewayHarnessOptions) {
  const requested = options.specs?.length
    ? options.specs.map((id) => {
      const spec = SPEC_BY_ID.get(id);
      if (!spec) throw new Error(`Unknown gateway harness spec: ${id}`);
      return spec;
    })
    : DEFAULT_GATEWAY_HARNESS_SPECS;

  return requested.filter((spec) => options.includeWriteSpecs || spec.risk !== "write");
}

function toSkippedResult(spec: GatewayHarnessSpec): GatewayHarnessResult {
  return {
    id: spec.id,
    ok: true,
    skipped: true,
    method: spec.method,
    risk: spec.risk,
  };
}

async function runSpec(
  client: GatewayHarnessClient,
  spec: GatewayHarnessSpec,
  params: { sessionKey: string; message: string },
) {
  switch (spec.id) {
    case "connect":
      if (client.connect) {
        await client.connect();
        return;
      }
      await client.rpc("health.check", {});
      return;
    case "sessions.list":
      await client.rpc("sessions.list", {});
      return;
    case "chat.send":
      if (!client.chatSend) throw new Error("Gateway client does not expose chatSend");
      await client.chatSend({ message: params.message, sessionKey: params.sessionKey });
      return;
    case "chat.history":
      if (!client.chatHistory) throw new Error("Gateway client does not expose chatHistory");
      await client.chatHistory({ sessionKey: params.sessionKey, limit: 25 });
      return;
    case "config.get":
      if (client.configGet) {
        await client.configGet();
        return;
      }
      await client.rpc("config.get", {});
      return;
    case "config.patch":
      if (!client.configPatch) throw new Error("Gateway client does not expose configPatch");
      await client.configPatch({
        patch: {},
        note: "CrewCmd gateway harness validation",
      });
      return;
    case "skills.status":
      await client.rpc("skills.status", {});
      return;
  }
}
