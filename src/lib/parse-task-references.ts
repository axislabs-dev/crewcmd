/**
 * Parse task references from agent chat responses.
 *
 * Detects natural-language task operations and JSON API response blocks
 * so the chat UI can render inline task cards.
 */

export interface TaskReference {
  type: "created" | "updated" | "referenced";
  taskId?: string;
  shortId?: number;
  title?: string;
  status?: string;
}

const UUID_RE = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

/**
 * Natural-language patterns emitted by agents after calling the task API.
 * Order matters — first match wins for a given substring.
 */
const PATTERNS: Array<{
  regex: RegExp;
  extract: (m: RegExpMatchArray) => TaskReference;
}> = [
  // "Created task: <title>" / "Task created: <title>" with optional TSK-NNN or UUID
  {
    regex: new RegExp(
      `(?:Created task|Task created)[:\\s]+(?:(?:TSK-(\\d+)|\\b(${UUID_RE})\\b)[\\s\\-–—]*)?["\u201c]?([^"\\n\u201d]+)["\u201d]?`,
      "i",
    ),
    extract: (m) => ({
      type: "created",
      shortId: m[1] ? Number(m[1]) : undefined,
      taskId: m[2] || undefined,
      title: m[3]?.trim(),
    }),
  },

  // "Updated task TSK-NNN" or "Updated task <uuid>"
  {
    regex: new RegExp(
      `Updated task[:\\s]+(?:TSK-(\\d+)|(${UUID_RE}))(?:[\\s\\-–—]+["\u201c]?([^"\\n\u201d]+)["\u201d]?)?`,
      "i",
    ),
    extract: (m) => ({
      type: "updated",
      shortId: m[1] ? Number(m[1]) : undefined,
      taskId: m[2] || undefined,
      title: m[3]?.trim(),
    }),
  },

  // "Task TSK-NNN is now <status>"
  {
    regex: /Task\s+TSK-(\d+)\s+is\s+now\s+[""]?(\w[\w_ ]*)[""]?/i,
    extract: (m) => ({
      type: "updated",
      shortId: Number(m[1]),
      status: m[2]?.trim().replace(/\s+/g, "_").toLowerCase(),
    }),
  },

  // "Task <uuid> is now <status>"
  {
    regex: new RegExp(
      `Task\\s+(${UUID_RE})\\s+is\\s+now\\s+["\u201c]?(\\w[\\w_ ]*)["\u201d]?`,
      "i",
    ),
    extract: (m) => ({
      type: "updated",
      taskId: m[1],
      status: m[2]?.trim().replace(/\s+/g, "_").toLowerCase(),
    }),
  },

  // Bare TSK-NNN reference (fallback)
  {
    regex: /\bTSK-(\d+)\b/,
    extract: (m) => ({
      type: "referenced",
      shortId: Number(m[1]),
    }),
  },
];

/**
 * Try to extract task data from JSON code blocks or inline JSON objects
 * that look like API responses: { "id": "...", "title": "...", "status": "..." }
 */
function extractJsonTaskReferences(text: string): TaskReference[] {
  const results: TaskReference[] = [];
  const seenIds = new Set<string>();

  // Match fenced code blocks (```json ... ``` or ``` ... ```)
  const codeBlockRegex = /```(?:json)?\s*\n?([\s\S]*?)```/g;
  let cbMatch;
  while ((cbMatch = codeBlockRegex.exec(text)) !== null) {
    const parsed = tryParseTaskJson(cbMatch[1].trim());
    for (const ref of parsed) {
      const key = ref.taskId || ref.title || "";
      if (key && !seenIds.has(key)) {
        seenIds.add(key);
        results.push(ref);
      }
    }
  }

  // Match bare inline JSON objects with task-like keys
  const inlineRegex = /\{[^{}]*"(?:id|title|status)"[^{}]*\}/g;
  let inMatch;
  while ((inMatch = inlineRegex.exec(text)) !== null) {
    const parsed = tryParseTaskJson(inMatch[0]);
    for (const ref of parsed) {
      const key = ref.taskId || ref.title || "";
      if (key && !seenIds.has(key)) {
        seenIds.add(key);
        results.push(ref);
      }
    }
  }

  return results;
}

function tryParseTaskJson(raw: string): TaskReference[] {
  try {
    const obj = JSON.parse(raw);
    if (Array.isArray(obj)) {
      return obj.flatMap((item) => (isTaskLikeObject(item) ? [toTaskReference(item)] : []));
    }
    // Unwrap { data: { ... } } wrapper from API responses
    const target = isTaskLikeObject(obj) ? obj : isTaskLikeObject(obj?.data) ? obj.data : null;
    if (target) return [toTaskReference(target)];
  } catch {
    // Not valid JSON — ignore
  }
  return [];
}

function isTaskLikeObject(obj: unknown): obj is Record<string, unknown> {
  if (!obj || typeof obj !== "object") return false;
  const o = obj as Record<string, unknown>;
  // Must have at least an id or title to qualify
  return (typeof o.id === "string" || typeof o.title === "string") &&
    (typeof o.status === "string" || typeof o.title === "string");
}

function toTaskReference(obj: Record<string, unknown>): TaskReference {
  const hasStatusChange = typeof obj.status === "string";
  return {
    type: obj.shortId || obj.id ? (hasStatusChange ? "updated" : "referenced") : "created",
    taskId: typeof obj.id === "string" ? obj.id : undefined,
    shortId: typeof obj.shortId === "number" ? obj.shortId : undefined,
    title: typeof obj.title === "string" ? obj.title : undefined,
    status: typeof obj.status === "string" ? obj.status : undefined,
  };
}

/**
 * Parse all task references from an agent's chat response.
 * Returns deduplicated references in order of appearance.
 */
export function parseTaskReferences(text: string): TaskReference[] {
  const results: TaskReference[] = [];
  const seenKeys = new Set<string>();

  function addUnique(ref: TaskReference) {
    // Deduplicate by taskId or shortId or title
    const key = ref.taskId || (ref.shortId ? `TSK-${ref.shortId}` : "") || ref.title || "";
    if (!key || seenKeys.has(key)) return;
    seenKeys.add(key);
    results.push(ref);
  }

  // 1. Natural-language patterns
  for (const { regex, extract } of PATTERNS) {
    const globalRegex = new RegExp(regex.source, regex.flags.includes("g") ? regex.flags : regex.flags + "g");
    let m;
    while ((m = globalRegex.exec(text)) !== null) {
      addUnique(extract(m));
    }
  }

  // 2. JSON blocks / inline JSON
  for (const ref of extractJsonTaskReferences(text)) {
    addUnique(ref);
  }

  return results;
}
