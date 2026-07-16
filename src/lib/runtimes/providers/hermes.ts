import type { GatewayModel } from "@/lib/gateway-client";
import type {
  RuntimeConnectionRecord,
  RuntimeDiscoveredModel,
  RuntimeHealthResult,
  RuntimeJobActionResult,
  RuntimeJobListResult,
  RuntimeJobResult,
  RuntimeJobWriteInput,
  RuntimeProbeInput,
  RuntimeProbeResult,
  RuntimeProvider,
  RuntimeRunApprovalInput,
  RuntimeRunControlResult,
  RuntimeRunCreateInput,
  RuntimeRunCreateResult,
  RuntimeRunEventsInput,
  RuntimeRunEventsResult,
  RuntimeRunStatus,
  RuntimeSessionChatInput,
  RuntimeSessionChatResult,
  RuntimeSessionChatStreamResult,
  RuntimeSessionForkInput,
  RuntimeSessionForkResult,
  RuntimeSessionListInput,
  RuntimeSessionListResult,
  RuntimeSessionMessagesResult,
  RuntimeSessionResult,
} from "./types";
import { resolveRuntimeAuthTokenForUse } from "@/lib/runtime-token-crypto";

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

  async getRunEvents(
    runtime: RuntimeConnectionRecord,
    runId: string,
    input: RuntimeRunEventsInput = {}
  ): Promise<RuntimeRunEventsResult> {
    const normalizedRunId = normalizeString(runId);
    if (!normalizedRunId) throw new Error("runId is required");

    const lastEventId = normalizeString(input.lastEventId);
    const rootUrl = runtimeHttpRoot(runtime);
    const response = await fetchHermesResponse(
      rootUrl,
      runtime.authToken,
      `/v1/runs/${encodeURIComponent(normalizedRunId)}/events`,
      {
        auth: true,
        headers: {
          Accept: "text/event-stream",
          ...(lastEventId ? { "Last-Event-ID": lastEventId } : {}),
        },
      }
    );
    if (!response.body) throw new Error("Hermes run events response did not include a stream");

    return {
      runId: normalizedRunId,
      contentType: response.headers.get("Content-Type") || "text/event-stream",
      stream: response.body,
    };
  }

  async stopRun(runtime: RuntimeConnectionRecord, runId: string): Promise<RuntimeRunControlResult> {
    const normalizedRunId = normalizeString(runId);
    if (!normalizedRunId) throw new Error("runId is required");

    const rootUrl = runtimeHttpRoot(runtime);
    const response = await fetchHermesJson(
      rootUrl,
      runtime.authToken,
      `/v1/runs/${encodeURIComponent(normalizedRunId)}/stop`,
      { auth: true, method: "POST" }
    );
    return normalizeRunControlResponse(response, normalizedRunId, "stopping");
  }

  async approveRun(
    runtime: RuntimeConnectionRecord,
    runId: string,
    input: RuntimeRunApprovalInput
  ): Promise<RuntimeRunControlResult> {
    const normalizedRunId = normalizeString(runId);
    if (!normalizedRunId) throw new Error("runId is required");

    const rootUrl = runtimeHttpRoot(runtime);
    const response = await fetchHermesJson(
      rootUrl,
      runtime.authToken,
      `/v1/runs/${encodeURIComponent(normalizedRunId)}/approval`,
      { auth: true, method: "POST", body: hermesApprovalRequestBody(input) }
    );
    return normalizeRunControlResponse(response, normalizedRunId, "submitted");
  }

  async listSessions(
    runtime: RuntimeConnectionRecord,
    input: RuntimeSessionListInput = {}
  ): Promise<RuntimeSessionListResult> {
    const params = new URLSearchParams();
    if (typeof input.limit === "number" && Number.isFinite(input.limit)) params.set("limit", String(input.limit));
    if (typeof input.offset === "number" && Number.isFinite(input.offset)) params.set("offset", String(input.offset));
    const source = normalizeString(input.source);
    if (source) params.set("source", source);
    if (typeof input.includeChildren === "boolean") {
      params.set("include_children", input.includeChildren ? "true" : "false");
    }

    const rootUrl = runtimeHttpRoot(runtime);
    const path = `/api/sessions${params.size > 0 ? `?${params.toString()}` : ""}`;
    const response = await fetchHermesJson(rootUrl, runtime.authToken, path, { auth: true });

    return {
      sessions: normalizeResponseList(response, "sessions"),
      raw: response,
    };
  }

  async getSession(runtime: RuntimeConnectionRecord, sessionId: string): Promise<RuntimeSessionResult> {
    const normalizedSessionId = normalizeString(sessionId);
    if (!normalizedSessionId) throw new Error("sessionId is required");

    const rootUrl = runtimeHttpRoot(runtime);
    const response = await fetchHermesJson(
      rootUrl,
      runtime.authToken,
      `/api/sessions/${encodeURIComponent(normalizedSessionId)}`,
      { auth: true }
    );
    const session = isRecord(response) && response.session !== undefined ? response.session : response;

    return {
      sessionId: normalizeSessionId(session) ?? normalizedSessionId,
      session,
      raw: response,
    };
  }

  async getSessionMessages(
    runtime: RuntimeConnectionRecord,
    sessionId: string
  ): Promise<RuntimeSessionMessagesResult> {
    const normalizedSessionId = normalizeString(sessionId);
    if (!normalizedSessionId) throw new Error("sessionId is required");

    const rootUrl = runtimeHttpRoot(runtime);
    const response = await fetchHermesJson(
      rootUrl,
      runtime.authToken,
      `/api/sessions/${encodeURIComponent(normalizedSessionId)}/messages`,
      { auth: true }
    );

    return {
      sessionId: normalizedSessionId,
      messages: normalizeResponseList(response, "messages"),
      raw: response,
    };
  }

  async listJobs(runtime: RuntimeConnectionRecord): Promise<RuntimeJobListResult> {
    const rootUrl = runtimeHttpRoot(runtime);
    const response = await fetchHermesJson(rootUrl, runtime.authToken, "/api/jobs", { auth: true });

    return {
      jobs: normalizeResponseList(response, "jobs"),
      raw: response,
    };
  }

  async getJob(runtime: RuntimeConnectionRecord, jobId: string): Promise<RuntimeJobResult> {
    const normalizedJobId = normalizeString(jobId);
    if (!normalizedJobId) throw new Error("jobId is required");

    const rootUrl = runtimeHttpRoot(runtime);
    const response = await fetchHermesJson(
      rootUrl,
      runtime.authToken,
      `/api/jobs/${encodeURIComponent(normalizedJobId)}`,
      { auth: true }
    );
    return normalizeJobResult(response, normalizedJobId);
  }

  async createJob(runtime: RuntimeConnectionRecord, input: RuntimeJobWriteInput): Promise<RuntimeJobResult> {
    const rootUrl = runtimeHttpRoot(runtime);
    const response = await fetchHermesJson(rootUrl, runtime.authToken, "/api/jobs", {
      auth: true,
      method: "POST",
      body: input.body,
    });

    return normalizeJobResult(response);
  }

  async updateJob(
    runtime: RuntimeConnectionRecord,
    jobId: string,
    input: RuntimeJobWriteInput
  ): Promise<RuntimeJobResult> {
    const normalizedJobId = normalizeString(jobId);
    if (!normalizedJobId) throw new Error("jobId is required");

    const rootUrl = runtimeHttpRoot(runtime);
    const response = await fetchHermesJson(
      rootUrl,
      runtime.authToken,
      `/api/jobs/${encodeURIComponent(normalizedJobId)}`,
      { auth: true, method: "PATCH", body: input.body }
    );

    return normalizeJobResult(response, normalizedJobId);
  }

  async pauseJob(runtime: RuntimeConnectionRecord, jobId: string): Promise<RuntimeJobActionResult> {
    return this.postJobAction(runtime, jobId, "pause", "paused");
  }

  async resumeJob(runtime: RuntimeConnectionRecord, jobId: string): Promise<RuntimeJobActionResult> {
    return this.postJobAction(runtime, jobId, "resume", "resumed");
  }

  async runJobNow(runtime: RuntimeConnectionRecord, jobId: string): Promise<RuntimeJobActionResult> {
    return this.postJobAction(runtime, jobId, "run", "started");
  }

  async forkSession(
    runtime: RuntimeConnectionRecord,
    sessionId: string,
    input: RuntimeSessionForkInput = {}
  ): Promise<RuntimeSessionForkResult> {
    const normalizedSessionId = normalizeString(sessionId);
    if (!normalizedSessionId) throw new Error("sessionId is required");

    const rootUrl = runtimeHttpRoot(runtime);
    const response = await fetchHermesJson(
      rootUrl,
      runtime.authToken,
      `/api/sessions/${encodeURIComponent(normalizedSessionId)}/fork`,
      { auth: true, method: "POST", body: hermesSessionForkRequestBody(input) }
    );
    const session = isRecord(response) && response.session !== undefined ? response.session : response;

    return {
      sessionId: normalizeSessionId(session) ?? normalizedSessionId,
      session,
      raw: response,
    };
  }

  async chatSession(
    runtime: RuntimeConnectionRecord,
    sessionId: string,
    input: RuntimeSessionChatInput
  ): Promise<RuntimeSessionChatResult> {
    const normalizedSessionId = normalizeString(sessionId);
    if (!normalizedSessionId) throw new Error("sessionId is required");

    const rootUrl = runtimeHttpRoot(runtime);
    const response = await fetchHermesJson(
      rootUrl,
      runtime.authToken,
      `/api/sessions/${encodeURIComponent(normalizedSessionId)}/chat`,
      {
        auth: true,
        method: "POST",
        headers: hermesSessionHeaders(input.sessionKey),
        body: hermesSessionChatRequestBody(input),
      }
    );

    return {
      sessionId: normalizeSessionId(response) ?? normalizedSessionId,
      output: normalizeStringFromResponse(response, ["output", "message", "content", "text"]),
      raw: response,
    };
  }

  async streamSessionChat(
    runtime: RuntimeConnectionRecord,
    sessionId: string,
    input: RuntimeSessionChatInput
  ): Promise<RuntimeSessionChatStreamResult> {
    const normalizedSessionId = normalizeString(sessionId);
    if (!normalizedSessionId) throw new Error("sessionId is required");

    const rootUrl = runtimeHttpRoot(runtime);
    const response = await fetchHermesResponse(
      rootUrl,
      runtime.authToken,
      `/api/sessions/${encodeURIComponent(normalizedSessionId)}/chat/stream`,
      {
        auth: true,
        method: "POST",
        headers: { Accept: "text/event-stream", ...hermesSessionHeaders(input.sessionKey) },
        body: hermesSessionChatRequestBody(input),
      }
    );
    if (!response.body) throw new Error("Hermes session chat stream response did not include a stream");

    return {
      sessionId: normalizedSessionId,
      contentType: response.headers.get("Content-Type") || "text/event-stream",
      stream: response.body,
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

  private async postJobAction(
    runtime: RuntimeConnectionRecord,
    jobId: string,
    action: "pause" | "resume" | "run",
    fallbackStatus: string
  ): Promise<RuntimeJobActionResult> {
    const normalizedJobId = normalizeString(jobId);
    if (!normalizedJobId) throw new Error("jobId is required");

    const rootUrl = runtimeHttpRoot(runtime);
    const response = await fetchHermesJson(
      rootUrl,
      runtime.authToken,
      `/api/jobs/${encodeURIComponent(normalizedJobId)}/${action}`,
      { auth: true, method: "POST" }
    );

    return normalizeJobActionResult(response, normalizedJobId, fallbackStatus);
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
  const response = await fetchHermesResponse(rootUrl, token, path, options);
  return response.json();
}

async function fetchHermesResponse(
  rootUrl: string,
  token: string | null | undefined,
  path: string,
  options: { auth: boolean; method?: string; headers?: Record<string, string>; body?: unknown }
): Promise<Response> {
  const headers: Record<string, string> = { Accept: "application/json", ...(options.headers ?? {}) };
  const resolvedToken = resolveRuntimeAuthTokenForUse(token);
  if (options.auth && resolvedToken) headers.Authorization = `Bearer ${resolvedToken}`;
  if (options.body !== undefined) headers["Content-Type"] = "application/json";

  const init: RequestInit = { headers };
  if (options.method) init.method = options.method;
  if (options.body !== undefined) init.body = JSON.stringify(options.body);

  const response = await fetch(hermesApiUrl(rootUrl, path), init);
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Hermes ${response.status}: ${body || response.statusText}`);
  }
  return response;
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

function hermesApprovalRequestBody(input: RuntimeRunApprovalInput): Record<string, unknown> {
  const body: Record<string, unknown> = { decision: input.decision };
  const approvalId = normalizeString(input.approvalId);
  const reason = normalizeString(input.reason);

  if (approvalId) body.approval_id = approvalId;
  if (reason) body.reason = reason;
  if (input.payload && isRecord(input.payload)) body.payload = input.payload;

  return body;
}

function hermesSessionForkRequestBody(input: RuntimeSessionForkInput): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  const title = normalizeString(input.title);
  if (title) body.title = title;
  return body;
}

function hermesSessionChatRequestBody(input: RuntimeSessionChatInput): Record<string, unknown> {
  return { input: input.input };
}

function normalizeRunControlResponse(
  response: unknown,
  fallbackRunId: string,
  fallbackStatus: string
): RuntimeRunControlResult {
  if (!isRecord(response)) {
    return { runId: fallbackRunId, status: fallbackStatus, raw: {} };
  }

  return {
    runId: normalizeString(response.run_id) ?? normalizeString(response.id) ?? fallbackRunId,
    status: normalizeString(response.status) ?? fallbackStatus,
    raw: response,
  };
}

function normalizeResponseList(response: unknown, preferredKey: string): unknown[] {
  if (Array.isArray(response)) return response;
  if (!isRecord(response)) return [];
  const preferred = response[preferredKey];
  if (Array.isArray(preferred)) return preferred;
  if (Array.isArray(response.data)) return response.data;
  if (Array.isArray(response.items)) return response.items;
  return [];
}

function normalizeSessionId(session: unknown): string | null {
  if (!isRecord(session)) return null;
  return normalizeRecordId(session) ?? normalizeString(session.session_id);
}

function normalizeRecordId(value: unknown): string | null {
  if (!isRecord(value)) return null;
  return normalizeString(value.id);
}

function normalizeJobResult(response: unknown, fallbackJobId?: string): RuntimeJobResult {
  const job = isRecord(response) && response.job !== undefined ? response.job : response;
  const jobId = normalizeRecordId(job) ?? fallbackJobId;
  if (!jobId) throw new Error("Hermes job response did not include job id");

  return {
    jobId,
    job,
    raw: response,
  };
}

function normalizeJobActionResult(
  response: unknown,
  fallbackJobId: string,
  fallbackStatus: string
): RuntimeJobActionResult {
  if (!isRecord(response)) {
    return { jobId: fallbackJobId, status: fallbackStatus, runId: null, raw: response };
  }
  const job = response.job;

  return {
    jobId: normalizeRecordId(job) ?? normalizeString(response.job_id) ?? normalizeString(response.id) ?? fallbackJobId,
    status: normalizeString(response.status) ?? (isRecord(job) ? normalizeString(job.status) : null) ?? fallbackStatus,
    runId: normalizeString(response.run_id),
    raw: response,
  };
}

function normalizeStringFromResponse(response: unknown, keys: string[]): string | null {
  if (!isRecord(response)) return null;
  for (const key of keys) {
    const value = normalizeString(response[key]);
    if (value) return value;
  }
  return null;
}
