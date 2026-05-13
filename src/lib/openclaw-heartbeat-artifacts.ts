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
