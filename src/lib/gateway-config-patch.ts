export type GatewayConfigPatchValidationCode =
  | "invalid_patch_request"
  | "invalid_config_patch"
  | "invalid_base_hash"
  | "invalid_patch_note";

export type GatewayConfigPatchErrorCode =
  | GatewayConfigPatchValidationCode
  | "config_patch_conflict"
  | "config_patch_failed";

export interface GatewayConfigPatchValidationError {
  code: GatewayConfigPatchValidationCode;
  message: string;
  field: "request" | "patch" | "baseHash" | "note";
}

export interface GatewayConfigPatchSummary {
  topLevelKeys: string[];
  changedPaths: string[];
  redactedPatch: Record<string, unknown>;
  redactedPathCount: number;
}

export interface NormalizedGatewayConfigPatchRequest {
  patch: Record<string, unknown>;
  baseHash?: string;
  note?: string;
  summary: GatewayConfigPatchSummary;
}

export type GatewayConfigPatchValidationResult =
  | {
      ok: true;
      value: NormalizedGatewayConfigPatchRequest;
    }
  | {
      ok: false;
      errors: GatewayConfigPatchValidationError[];
    };

export interface GatewayConfigPatchMappedError {
  status: number;
  code: GatewayConfigPatchErrorCode;
  message: string;
  details?: unknown;
}

const MAX_BASE_HASH_LENGTH = 256;
const MAX_NOTE_LENGTH = 500;
const MAX_SUMMARY_PATHS = 50;
const REDACTED = "[redacted]";
const SENSITIVE_KEY_PATTERN =
  /(^|[_-])(api[_-]?key|auth|bearer|credential|password|private[_-]?key|secret|token)([_-]|$)/i;

export function normalizeGatewayConfigPatchRequest(
  request: unknown
): GatewayConfigPatchValidationResult {
  if (!isRecord(request)) {
    return {
      ok: false,
      errors: [
        {
          code: "invalid_patch_request",
          message: "Config patch request must be an object.",
          field: "request",
        },
      ],
    };
  }

  const errors: GatewayConfigPatchValidationError[] = [];
  const patch = request.patch;

  if (!isRecord(patch)) {
    errors.push({
      code: "invalid_config_patch",
      message: "Config patch must be an object.",
      field: "patch",
    });
  } else if (Object.keys(patch).length === 0) {
    errors.push({
      code: "invalid_config_patch",
      message: "Config patch must include at least one top-level key.",
      field: "patch",
    });
  }

  const baseHashResult = normalizeOptionalString(request.baseHash, {
    field: "baseHash",
    code: "invalid_base_hash",
    label: "Base hash",
    maxLength: MAX_BASE_HASH_LENGTH,
  });
  if (!baseHashResult.ok) errors.push(baseHashResult.error);
  const baseHash = baseHashResult.ok ? baseHashResult.value : undefined;

  const noteResult = normalizeOptionalString(request.note, {
    field: "note",
    code: "invalid_patch_note",
    label: "Patch note",
    maxLength: MAX_NOTE_LENGTH,
  });
  if (!noteResult.ok) errors.push(noteResult.error);
  const note = noteResult.ok ? noteResult.value : undefined;

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    value: {
      patch: patch as Record<string, unknown>,
      ...(baseHash ? { baseHash } : {}),
      ...(note ? { note } : {}),
      summary: summarizeGatewayConfigPatch(patch as Record<string, unknown>),
    },
  };
}

export function summarizeGatewayConfigPatch(
  patch: Record<string, unknown>
): GatewayConfigPatchSummary {
  const changedPaths = collectChangedPaths(patch);
  const redactedPatch = redactPatchValue(patch, []) as Record<string, unknown>;

  return {
    topLevelKeys: Object.keys(patch).sort((a, b) => a.localeCompare(b)),
    changedPaths: changedPaths.slice(0, MAX_SUMMARY_PATHS),
    redactedPatch,
    redactedPathCount: countRedactedPaths(redactedPatch),
  };
}

export function mapGatewayConfigPatchConflict(details?: unknown): GatewayConfigPatchMappedError {
  return {
    status: 409,
    code: "config_patch_conflict",
    message: "Runtime config changed before this patch could be applied. Refresh and retry.",
    ...(details !== undefined ? { details } : {}),
  };
}

export function mapGatewayConfigPatchError(error: unknown): GatewayConfigPatchMappedError {
  const message = readErrorMessage(error);
  const lowerMessage = message.toLowerCase();
  const status = readErrorStatus(error);
  const code = readErrorCode(error);
  const details = readErrorDetails(error);

  if (status === 409 || code === "conflict" || lowerMessage.includes("base hash")) {
    return mapGatewayConfigPatchConflict(details ?? { message });
  }

  return {
    status: status && status >= 400 && status < 600 ? status : 502,
    code: "config_patch_failed",
    message: message || "Runtime config patch failed.",
    ...(details !== undefined ? { details } : {}),
  };
}

function normalizeOptionalString(
  value: unknown,
  options: {
    field: "baseHash" | "note";
    code: "invalid_base_hash" | "invalid_patch_note";
    label: string;
    maxLength: number;
  }
):
  | { ok: true; value?: string }
  | { ok: false; error: GatewayConfigPatchValidationError } {
  if (value === undefined || value === null) {
    return { ok: true };
  }

  if (typeof value !== "string") {
    return {
      ok: false,
      error: {
        code: options.code,
        message: `${options.label} must be a string when provided.`,
        field: options.field,
      },
    };
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return { ok: true };
  }

  if (trimmed.length > options.maxLength) {
    return {
      ok: false,
      error: {
        code: options.code,
        message: `${options.label} must be ${options.maxLength} characters or fewer.`,
        field: options.field,
      },
    };
  }

  return { ok: true, value: trimmed };
}

function collectChangedPaths(value: unknown, path: string[] = []): string[] {
  if (Array.isArray(value)) {
    if (value.length === 0) return [formatPath(path)];

    return value.flatMap((entry, index) => collectChangedPaths(entry, [...path, `[${index}]`]));
  }

  if (isRecord(value)) {
    const entries = Object.entries(value);
    if (entries.length === 0) return [formatPath(path)];

    return entries.flatMap(([key, entry]) => collectChangedPaths(entry, [...path, key]));
  }

  return [formatPath(path)];
}

function formatPath(path: string[]): string {
  if (path.length === 0) return "$";

  return path.reduce((result, part) => {
    if (part.startsWith("[")) return `${result}${part}`;
    return result ? `${result}.${part}` : part;
  }, "");
}

function redactPatchValue(value: unknown, path: string[]): unknown {
  if (path.some((part) => SENSITIVE_KEY_PATTERN.test(part))) {
    return REDACTED;
  }

  if (Array.isArray(value)) {
    return value.map((entry, index) => redactPatchValue(entry, [...path, `[${index}]`]));
  }

  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        redactPatchValue(entry, [...path, key]),
      ])
    );
  }

  return value;
}

function countRedactedPaths(value: unknown): number {
  if (value === REDACTED) return 1;
  if (Array.isArray(value)) {
    return value.reduce<number>((count, entry) => count + countRedactedPaths(entry), 0);
  }
  if (isRecord(value)) {
    return Object.values(value).reduce<number>(
      (count, entry) => count + countRedactedPaths(entry),
      0
    );
  }
  return 0;
}

function readErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (isRecord(error) && typeof error.message === "string") return error.message;
  if (typeof error === "string") return error;
  return "";
}

function readErrorStatus(error: unknown): number | undefined {
  if (!isRecord(error)) return undefined;
  const status = error.status ?? error.statusCode;
  return typeof status === "number" ? status : undefined;
}

function readErrorCode(error: unknown): string | undefined {
  if (!isRecord(error)) return undefined;
  return typeof error.code === "string" ? error.code.toLowerCase() : undefined;
}

function readErrorDetails(error: unknown): unknown {
  if (!isRecord(error)) return undefined;
  return error.details;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
