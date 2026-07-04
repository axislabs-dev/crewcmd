import type { DiscoveredAgent, GatewayModel } from "@/lib/gateway-client";

export type SupportedRuntimeType = "openclaw" | "hermes";

export interface RuntimeConnectionRecord {
  id: string;
  runtimeType: string;
  name: string;
  gatewayUrl: string;
  httpUrl: string;
  authToken: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface RuntimeProbeInput {
  url: string;
  token?: string | null;
  name?: string | null;
}

export interface RuntimeProbeResult {
  ok: boolean;
  error?: string;
  agents: DiscoveredAgent[];
  models: GatewayModel[];
  capabilities?: Record<string, unknown>;
  defaultAgentId?: string;
}

export interface RuntimeDiscoveredModel {
  runtimeId: string;
  provider: string;
  id: string;
  name: string;
}

export interface RuntimeHealthResult {
  ok: boolean;
  status: string;
  details: Record<string, unknown> | null;
}

export interface RuntimeRunCreateInput {
  input: string;
  sessionId?: string | null;
  sessionKey?: string | null;
  instructions?: string | null;
  conversationHistory?: unknown[] | null;
  previousResponseId?: string | null;
  model?: string | null;
}

export interface RuntimeRunCreateResult {
  runId: string;
  status: string;
  raw: Record<string, unknown>;
}

export interface RuntimeRunStatus {
  runId: string;
  status: string;
  sessionId: string | null;
  model: string | null;
  output: string | null;
  usage: Record<string, unknown> | null;
  raw: Record<string, unknown>;
}

export interface RuntimeRunControlResult {
  runId: string;
  status: string;
  raw: Record<string, unknown>;
}

export interface RuntimeRunEventsInput {
  lastEventId?: string | null;
}

export interface RuntimeRunEventsResult {
  runId: string;
  contentType: string;
  stream: ReadableStream<Uint8Array>;
}

export interface RuntimeRunApprovalInput {
  decision: string;
  approvalId?: string | null;
  reason?: string | null;
  payload?: Record<string, unknown> | null;
}

export interface RuntimeSessionListInput {
  limit?: number | null;
  offset?: number | null;
  source?: string | null;
  includeChildren?: boolean | null;
}

export interface RuntimeSessionListResult {
  sessions: unknown[];
  raw: unknown;
}

export interface RuntimeSessionResult {
  sessionId: string;
  session: unknown;
  raw: unknown;
}

export interface RuntimeSessionMessagesResult {
  sessionId: string;
  messages: unknown[];
  raw: unknown;
}

export interface RuntimeJobListResult {
  jobs: unknown[];
  raw: unknown;
}

export interface RuntimeJobResult {
  jobId: string;
  job: unknown;
  raw: unknown;
}

export interface RuntimeSessionForkInput {
  title?: string | null;
}

export interface RuntimeSessionForkResult {
  sessionId: string;
  session: unknown;
  raw: unknown;
}

export interface RuntimeSessionChatInput {
  input: string;
  sessionKey?: string | null;
}

export interface RuntimeSessionChatResult {
  sessionId: string;
  output: string | null;
  raw: unknown;
}

export interface RuntimeProvider {
  readonly type: SupportedRuntimeType;
  readonly displayName: string;

  probe?(input: RuntimeProbeInput): Promise<RuntimeProbeResult>;
  discoverModels(runtime: RuntimeConnectionRecord): Promise<RuntimeDiscoveredModel[]>;
  discoverCapabilities?(runtime: RuntimeConnectionRecord): Promise<Record<string, unknown> | null>;
  discoverHealth?(runtime: RuntimeConnectionRecord): Promise<RuntimeHealthResult>;
  discoverSkills?(runtime: RuntimeConnectionRecord): Promise<unknown[]>;
  discoverToolsets?(runtime: RuntimeConnectionRecord): Promise<unknown[]>;
  createRun?(runtime: RuntimeConnectionRecord, input: RuntimeRunCreateInput): Promise<RuntimeRunCreateResult>;
  getRun?(runtime: RuntimeConnectionRecord, runId: string): Promise<RuntimeRunStatus>;
  getRunEvents?(
    runtime: RuntimeConnectionRecord,
    runId: string,
    input?: RuntimeRunEventsInput
  ): Promise<RuntimeRunEventsResult>;
  stopRun?(runtime: RuntimeConnectionRecord, runId: string): Promise<RuntimeRunControlResult>;
  approveRun?(
    runtime: RuntimeConnectionRecord,
    runId: string,
    input: RuntimeRunApprovalInput
  ): Promise<RuntimeRunControlResult>;
  listSessions?(
    runtime: RuntimeConnectionRecord,
    input?: RuntimeSessionListInput
  ): Promise<RuntimeSessionListResult>;
  getSession?(
    runtime: RuntimeConnectionRecord,
    sessionId: string
  ): Promise<RuntimeSessionResult>;
  getSessionMessages?(
    runtime: RuntimeConnectionRecord,
    sessionId: string
  ): Promise<RuntimeSessionMessagesResult>;
  listJobs?(runtime: RuntimeConnectionRecord): Promise<RuntimeJobListResult>;
  getJob?(runtime: RuntimeConnectionRecord, jobId: string): Promise<RuntimeJobResult>;
  forkSession?(
    runtime: RuntimeConnectionRecord,
    sessionId: string,
    input?: RuntimeSessionForkInput
  ): Promise<RuntimeSessionForkResult>;
  chatSession?(
    runtime: RuntimeConnectionRecord,
    sessionId: string,
    input: RuntimeSessionChatInput
  ): Promise<RuntimeSessionChatResult>;
}
