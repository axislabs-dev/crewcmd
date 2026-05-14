export type ChatArtifactRole = "user" | "assistant" | "system";

const DEFAULT_HEARTBEAT_PROMPT_PREFIX = "read heartbeat.md if it exists";

function normalizeContent(content: string) {
  return content.trim().replace(/\r\n/g, "\n");
}

function firstMeaningfulLine(content: string) {
  return normalizeContent(content)
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean) ?? "";
}

function isPlainToolCallArtifact(content: string) {
  const compact = content.toLowerCase().replace(/\s+/g, " ");
  return compact === "no_reply" || /^call [a-z][a-z0-9_-]*(?:\s|$)/.test(compact);
}

function isStructuredToolResultArtifact(content: string) {
  const trimmed = normalizeContent(content);
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return false;

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return false;

    const record = parsed as Record<string, unknown>;
    if (typeof record.tool === "string" && ("status" in record || "error" in record || "result" in record)) {
      return true;
    }
    if (Array.isArray(record.results) && (record.corpus === "memory" || record.source === "memory")) {
      return true;
    }
    if (Array.isArray(record.results) && record.results.some((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return false;
      const result = item as Record<string, unknown>;
      return typeof result.snippet === "string" || typeof result.path === "string" || typeof result.citation === "string";
    })) {
      return true;
    }
  } catch {
    return false;
  }

  return false;
}

export function isOpenClawHeartbeatArtifact(params: {
  role?: ChatArtifactRole | string | null;
  content?: string | null;
}) {
  const role = params.role;
  const content = normalizeContent(params.content ?? "");
  if (!content) return false;

  const compact = content.toLowerCase().replace(/\s+/g, " ");

  if (compact === "heartbeat_ok") return true;

  if (role === "user") {
    return (
      compact === "[openclaw heartbeat poll]" ||
      (compact.startsWith(DEFAULT_HEARTBEAT_PROMPT_PREFIX) && compact.includes("heartbeat_ok"))
    );
  }

  if (role !== "assistant") return false;

  if (isPlainToolCallArtifact(content) || isStructuredToolResultArtifact(content)) {
    return true;
  }

  if (compact === "call read") return true;

  const heading = firstMeaningfulLine(content).replace(/^#+\s*/, "").toLowerCase();
  return heading === "heartbeat.md";
}

export function isOpenClawHeartbeatAck(params: {
  role?: ChatArtifactRole | string | null;
  content?: string | null;
}) {
  return normalizeContent(params.content ?? "").toLowerCase().replace(/\s+/g, " ") === "heartbeat_ok";
}
