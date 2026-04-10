import { mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawn } from "node:child_process";

type JsonRecord = Record<string, unknown>;

const DEFAULT_CREWCMD_URL = process.env.CREWCMD_URL || "https://localhost:3000";
const DEFAULT_AXISLABS_COMPANY_ID = process.env.AXISLABS_COMPANY_ID || process.env.CREWCMD_COMPANY_ID || "00000000-0000-0000-0000-000000000001";
const QUEUE_DIR = resolve(homedir(), ".openclaw", "workspace", ".crewcmd-trace-queue");
const LOG_PATH = resolve(QUEUE_DIR, "worker.log");

export interface TraceEnvelope {
  toolName: string;
  agentId: string;
  companyId: string;
  sessionKey?: string;
  openclawSessionId?: string;
  taskId?: string;
  spawnedAt: string;
  requestContent: string;
  responseContent?: string;
  metadata: JsonRecord;
}

function asRecord(value: unknown): JsonRecord | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function pickFirstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    const normalized = asString(value);
    if (normalized) return normalized;
  }
  return undefined;
}

function stringifyContent(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim() || undefined;
  if (value == null) return undefined;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function extractTraceEnvelope(payload: unknown, now = new Date()): TraceEnvelope | null {
  const root = asRecord(payload);
  if (!root) return null;

  const toolName = pickFirstString(root.toolName, root.tool_name, root.name, root.toolCallName, asRecord(root.toolCall)?.name, asRecord(root.tool_call)?.name);
  if (!toolName || !["sessions_spawn", "sessions_send"].includes(toolName)) return null;

  const input = asRecord(root.input) ?? asRecord(root.arguments) ?? asRecord(root.args) ?? asRecord(asRecord(root.toolCall)?.arguments) ?? asRecord(asRecord(root.tool_call)?.arguments) ?? {};
  const result = asRecord(root.result) ?? asRecord(root.output) ?? asRecord(root.response) ?? {};
  const session = asRecord(result.session) ?? asRecord(root.session) ?? {};
  const child = asRecord(result.childSession) ?? asRecord(result.sessionInfo) ?? {};
  const metadata = {
    source: "hook:subagent-trace",
    openclawSessionKey: pickFirstString(result.sessionKey, result.session_key, session.sessionKey, session.session_key, child.sessionKey, root.sessionKey),
    openclawSessionId: pickFirstString(result.sessionId, result.session_id, session.id, child.id, root.sessionId),
    taskId: pickFirstString(input.taskId, input.task_id, asRecord(input.metadata)?.taskId, asRecord(result.metadata)?.taskId),
    spawnedAt: pickFirstString(result.spawnedAt, result.startedAt, root.createdAt) ?? now.toISOString(),
    toolName,
  } satisfies JsonRecord;

  const agentId = pickFirstString(input.agentId, input.agent_id, result.agentId, session.agentId, child.agentId, asRecord(input.metadata)?.agentId) ?? "unknown";
  const companyId = pickFirstString(input.companyId, input.company_id, asRecord(input.metadata)?.companyId, asRecord(result.metadata)?.companyId) ?? DEFAULT_AXISLABS_COMPANY_ID;
  const requestContent = pickFirstString(input.task, input.prompt, input.message, input.content, asRecord(input.metadata)?.task, asRecord(input.metadata)?.prompt) ?? "(no dispatch prompt provided)";
  const responseContent = stringifyContent(result.result ?? result.message ?? result.content ?? result.output ?? root.finalOutput ?? root.final_output);

  return {
    toolName,
    agentId: agentId.toLowerCase(),
    companyId,
    sessionKey: asString(metadata.openclawSessionKey),
    openclawSessionId: asString(metadata.openclawSessionId),
    taskId: asString(metadata.taskId),
    spawnedAt: asString(metadata.spawnedAt) ?? now.toISOString(),
    requestContent,
    responseContent,
    metadata,
  };
}

function ensureQueueDir() {
  mkdirSync(QUEUE_DIR, { recursive: true });
}

export function enqueueTrace(envelope: TraceEnvelope): string {
  ensureQueueDir();
  const basename = `${Date.now()}-${Math.random().toString(36).slice(2)}.json`;
  const tmpPath = join(QUEUE_DIR, `${basename}.tmp`);
  const finalPath = join(QUEUE_DIR, basename);
  writeFileSync(tmpPath, JSON.stringify(envelope, null, 2), "utf8");
  renameSync(tmpPath, finalPath);
  return finalPath;
}

export function spawnTraceWorker(queuePath: string) {
  ensureQueueDir();
  const workerCode = `
    import { appendFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
    const queueDir = ${JSON.stringify(QUEUE_DIR)};
    const logPath = ${JSON.stringify(LOG_PATH)};
    const baseUrl = ${JSON.stringify(DEFAULT_CREWCMD_URL)};
    const token = process.env.HEARTBEAT_SECRET;
    const headers = { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) };
    const files = process.argv.slice(1).flatMap((entry) => entry === '--drain' ? readdirSync(queueDir).filter((name) => name.endsWith('.json')).map((name) => queueDir + '/' + name) : [entry]);
    const log = (message) => { try { appendFileSync(logPath, '[' + new Date().toISOString() + '] ' + message + '\n'); } catch {} };
    const postMessage = async (payload, role, content) => {
      if (!content) return;
      const res = await fetch(baseUrl + '/api/chat/messages', { method: 'POST', headers, body: JSON.stringify({ agentId: payload.agentId, companyId: payload.companyId, role, content, metadata: payload.metadata }) });
      if (!res.ok) throw new Error('POST /api/chat/messages -> ' + res.status);
    };
    for (const file of files) {
      try {
        const payload = JSON.parse(readFileSync(file, 'utf8'));
        await postMessage(payload, 'user', payload.requestContent);
        await postMessage(payload, 'assistant', payload.responseContent);
        rmSync(file, { force: true });
      } catch (error) {
        log((error instanceof Error ? error.message : String(error)) + ' :: ' + file);
      }
    }
  `;

  const child = spawn(process.execPath, ["--input-type=module", "--eval", workerCode, queuePath, "--drain"], {
    detached: true,
    stdio: "ignore",
    cwd: dirname(queuePath),
    env: process.env,
  });
  child.unref();
}

export default function subagentTraceHook(payload: unknown) {
  try {
    const envelope = extractTraceEnvelope(payload);
    if (!envelope) return undefined;
    const queuePath = enqueueTrace(envelope);
    spawnTraceWorker(queuePath);
  } catch (error) {
    try {
      ensureQueueDir();
      writeFileSync(LOG_PATH, `[${new Date().toISOString()}] ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`, { flag: "a" });
    } catch {}
  }
  return undefined;
}

export function readQueuedTraceFiles(): string[] {
  ensureQueueDir();
  return readdirSync(QUEUE_DIR).filter((name) => name.endsWith('.json')).map((name) => join(QUEUE_DIR, name));
}

export function clearQueue() {
  for (const file of readQueuedTraceFiles()) rmSync(file, { force: true });
  rmSync(LOG_PATH, { force: true });
}
