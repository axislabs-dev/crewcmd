import type { GatewayModel } from "@/lib/gateway-client";
import type {
  RuntimeConnectionRecord,
  RuntimeDiscoveredModel,
  RuntimeHealthResult,
  RuntimeProbeInput,
  RuntimeProbeResult,
  RuntimeProvider,
  RuntimeRunCreateInput,
  RuntimeRunCreateResult,
  RuntimeRunStatus,
} from "./types";

const DEFAULT_HERMES_MODEL = "hermes-agent";

export class HermesRuntimeProvider implements RuntimeProvider {
  readonly type = "hermes" as const;
  readonly displayName = "Hermes Agent API";

  async probe(input: RuntimeProbeInput): Promise<RuntimeProbeResult> {
    const rootUrl = normalizeHermesRootUrl(input.url);
    const token = input.token?.trim() || null;

    const health = await fetchHermesJson(rootUrl, token, "/health", { auth: false })
      .catch(() => fetchHermesJson(rootUrl, token, "/v1/health", { auth: false }));
    if (!isRecord(health) || health.status !== "ok") {
      return { ok: false, error: "Hermes health check failed", agents: [], models: [] };
    }

    const modelsResponse = await fetchHermesJson(rootUrl, token, "/v1/models", { auth: true });
    const models = normalizeHermesModels(modelsResponse);
    if (models.length === 0) {
      return { ok: false, error: "Hermes returned no models", agents: [], models: [] };
    }

    const capabilities = await fetchHermesJson(rootUrl, token, "/v1/capabilities", { auth: true })
      .catch(() => synthesizeHermesCapabilities(models[0]?.id ?? DEFAULT_HERMES_MODEL));
    const defaultModel = models[0];
    const displayName = input.name?.trim() || defaultModel.name || "Hermes Agent";

    return {
      ok: true,
      agents: [
        {
          id: defaultModel.id,
          name: displayName,
          emoji: "\u{1F916}",
          title: "Hermes Agent",
          description: "Hermes API server profile connected through CrewCmd.",
          model: defaultModel.id,
        },
      ],
      models,
      capabilities: isRecord(capabilities) ? capabilities : synthesizeHermesCapabilities(defaultModel.id),
      defaultAgentId: defaultModel.id,
    };
  }

  async discoverModels(runtime: RuntimeConnectionRecord): Promise<RuntimeDiscoveredModel[]> {
    const rootUrl = runtimeHttpRoot(runtime);
    const modelsResponse = await fetchHermesJson(rootUrl, runtime.authToken, "/v1/models", { auth: true });
    return normalizeHermesModels(modelsResponse).map((model) => ({
      runtimeId: runtime.id,
      provider: model.provider || "hermes",
      id: model.id,
      name: model.name || model.id,
    }));
  }

  async discoverCapabilities(runtime: RuntimeConnectionRecord): Promise<Record<string, unknown> | null> {
    const rootUrl = runtimeHttpRoot(runtime);
    return fetchHermesJson(rootUrl, runtime.authToken, "/v1/capabilities", { auth: true })
      .then((value) => (isRecord(value) ? value : null));
  }

  async discoverHealth(runtime: RuntimeConnectionRecord): Promise<RuntimeHealthResult> {
    const rootUrl = runtimeHttpRoot(runtime);
    const health = await fetchHermesJson(rootUrl, runtime.authToken, "/health/detailed", { auth: false })
      .catch(() => fetchHermesJson(rootUrl, runtime.authToken, "/v1/health/detailed", { auth: false }))
      .catch(() => fetchHermesJson(rootUrl, runtime.authToken, "/health", { auth: false }))
      .catch(() => fetchHermesJson(rootUrl, runtime.authToken, "/v1/health", { auth: false }));
    const details = isRecord(health) ? health : null;
    const status = normalizeString(details?.status) ?? "ok";

    return {
      ok: isHealthyStatus(status),
      status,
      details,
    };
  }

  async discoverSkills(runtime: RuntimeConnectionRecord): Promise<unknown[]> {
    return this.discoverList(runtime, "/v1/skills");
  }

  async discoverToolsets(runtime: RuntimeConnectionRecord): Promise<unknown[]> {
    return this.discoverList(runtime, "/v1/toolsets");
  }

  async createRun(
    runtime: RuntimeConnectionRecord,
    input: RuntimeRunCreateInput
  ): Promise<RuntimeRunCreateResult> {
    const rootUrl = runtimeHttpRoot(runtime);
    const response = await fetchHermesJson(rootUrl, runtime.authToken, "/v1/runs", {
      auth: true,
      method: "POST",
      headers: hermesSessionHeaders(input.sessionKey),
      body: hermesRunRequestBody(input),
    });
    if (!isRecord(response)) throw new Error("Hermes run response was not an object");
    const runId = normalizeString(response.run_id) ?? normalizeString(response.id);
    if (!runId) throw new Error("Hermes run response did not include run_id");

    return {
      runId,
      status: normalizeString(response.status) ?? "started",
      raw: response,
    };
  }

  async getRun(runtime: RuntimeConnectionRecord, runId: string): Promise<RuntimeRunStatus> {
    const normalizedRunId = normalizeString(runId);
    if (!normalizedRunId) throw new Error("runId is required");

    const rootUrl = runtimeHttpRoot(runtime);
    const response = await fetchHermesJson(
      rootUrl,
      runtime.authToken,
      `/v1/runs/${encodeURIComponent(normalizedRunId)}`,
      { auth: true }
    );
    if (!isRecord(response)) throw new Error("Hermes run status response was not an object");

    return {
      runId: normalizeString(response.run_id) ?? normalizeString(response.id) ?? normalizedRunId,
      status: normalizeString(response.status) ?? "unknown",
      sessionId: normalizeString(response.session_id),
      model: normalizeString(response.model),
      output: normalizeString(response.output),
      usage: isRecord(response.usage) ? response.usage : null,
      raw: response,
    };
  }

  private async discoverList(runtime: RuntimeConnectionRecord, path: string): Promise<unknown[]> {
    const rootUrl = runtimeHttpRoot(runtime);
    const response = await fetchHermesJson(rootUrl, runtime.authToken, path, { auth: true });
    if (Array.isArray(response)) return response;
    if (isRecord(response) && Array.isArray(response.data)) return response.data;
    if (isRecord(response) && Array.isArray(response.items)) return response.items;
    return [];
  }
}

export function normalizeHermesRootUrl(value: string): string {
  const raw = value.trim();
  if (!raw) throw new Error("Hermes API URL is required");
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
  const url = new URL(withProtocol);
  url.hash = "";
  url.search = "";
  url.pathname = url.pathname.replace(/\/+$/, "");
  if (url.pathname === "/v1") url.pathname = "";
  else if (url.pathname.endsWith("/v1")) url.pathname = url.pathname.slice(0, -3).replace(/\/+$/, "");
  return url.toString().replace(/\/+$/, "");
}

export function hermesApiUrl(rootUrl: string, path: string): string {
  const root = normalizeHermesRootUrl(rootUrl);
  return `${root}${path.startsWith("/") ? path : `/${path}`}`;
}

export function normalizeHermesModels(response: unknown): GatewayModel[] {
  const items = Array.isArray(response)
    ? response
    : isRecord(response) && Array.isArray(response.data)
      ? response.data
      : isRecord(response) && Array.isArray(response.models)
        ? response.models
        : [];

  return items
    .map((item) => {
      if (!isRecord(item)) return null;
      const id = normalizeString(item.id) ?? normalizeString(item.name);
      if (!id) return null;
      return {
        id,
        name: normalizeString(item.name) ?? id,
        provider: normalizeString(item.provider) ?? "hermes",
      };
    })
    .filter((model): model is GatewayModel => model !== null);
}

export async function fetchHermesJson(
  rootUrl: string,
  token: string | null | undefined,
  path: string,
  options: { auth: boolean; method?: string; headers?: Record<string, string>; body?: unknown }
): Promise<unknown> {
  const headers: Record<string, string> = { Accept: "application/json", ...(options.headers ?? {}) };
  if (options.auth && token) headers.Authorization = `Bearer ${token}`;
  if (options.body !== undefined) headers["Content-Type"] = "application/json";

  const response = await fetch(hermesApiUrl(rootUrl, path), {
    method: options.method ?? "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Hermes ${response.status}: ${body || response.statusText}`);
  }
  return response.json();
}

function runtimeHttpRoot(runtime: RuntimeConnectionRecord): string {
  const metadata = runtime.metadata && typeof runtime.metadata === "object" ? runtime.metadata : {};
  const metadataRoot = typeof metadata.apiRootUrl === "string" ? metadata.apiRootUrl : null;
  return normalizeHermesRootUrl(metadataRoot || runtime.httpUrl || runtime.gatewayUrl);
}

function synthesizeHermesCapabilities(model: string): Record<string, unknown> {
  return {
    object: "hermes.api_server.capabilities",
    platform: "hermes-agent",
    model,
    auth: { type: "bearer", required: true },
    features: {
      chat_completions: true,
      models: true,
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function isHealthyStatus(status: string): boolean {
  return ["ok", "healthy", "ready", "up"].includes(status.toLowerCase());
}

function hermesRunRequestBody(input: RuntimeRunCreateInput): Record<string, unknown> {
  const body: Record<string, unknown> = { input: input.input };
  const sessionId = normalizeString(input.sessionId);
  const instructions = normalizeString(input.instructions);
  const previousResponseId = normalizeString(input.previousResponseId);
  const model = normalizeString(input.model);

  if (sessionId) body.session_id = sessionId;
  if (instructions) body.instructions = instructions;
  if (previousResponseId) body.previous_response_id = previousResponseId;
  if (model) body.model = model;
  if (Array.isArray(input.conversationHistory)) body.conversation_history = input.conversationHistory;

  return body;
}

function hermesSessionHeaders(sessionKey: string | null | undefined): Record<string, string> {
  const normalized = normalizeString(sessionKey);
  if (!normalized) return {};
  if (normalized.length > 256) throw new Error("Hermes sessionKey must be 256 characters or fewer");
  if (/[\r\n\u0000]/.test(normalized)) throw new Error("Hermes sessionKey cannot contain control characters");
  return { "X-Hermes-Session-Key": normalized };
}
