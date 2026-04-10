interface JsonSchemaProperty {
  type?: string;
  title?: string;
  description?: string;
  default?: unknown;
  enum?: readonly string[];
  items?: { type?: string };
  properties?: Record<string, JsonSchemaProperty>;
  required?: readonly string[];
}

export interface SkillConfigSchema {
  type?: string;
  additionalProperties?: boolean;
  properties?: Record<string, JsonSchemaProperty>;
  required?: readonly string[];
}

export type SkillConfigFieldKind = "string" | "boolean" | "string-array" | "enum" | "secret-ref" | "unsupported";

export interface SkillConfigField {
  key: string;
  kind: SkillConfigFieldKind;
  title: string;
  description?: string;
  required: boolean;
  defaultValue?: unknown;
  options?: readonly string[];
}

export function getSkillConfigSchema(metadata: unknown): SkillConfigSchema | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const schema = (metadata as Record<string, unknown>).configSchema;
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return null;
  return schema as SkillConfigSchema;
}

export function getSkillConfigFields(schema: SkillConfigSchema | null | undefined): SkillConfigField[] {
  if (!schema?.properties) return [];

  const required = new Set(schema.required ?? []);

  return Object.entries(schema.properties).map(([key, property]) => {
    let kind: SkillConfigFieldKind = "unsupported";

    if (property.type === "string" && Array.isArray(property.enum) && property.enum.length > 0) {
      kind = "enum";
    } else if (property.type === "string") {
      kind = "string";
    } else if (property.type === "boolean") {
      kind = "boolean";
    } else if (property.type === "array" && property.items?.type === "string") {
      kind = "string-array";
    } else if (
      property.type === "object"
      && property.properties?.name?.type === "string"
      && Array.isArray(property.required)
      && property.required.includes("name")
    ) {
      kind = "secret-ref";
    }

    return {
      key,
      kind,
      title: property.title ?? key,
      description: property.description,
      required: required.has(key),
      defaultValue: property.default,
      options: property.enum,
    };
  });
}

export function getInitialSkillConfig(schema: SkillConfigSchema | null | undefined, currentConfig: Record<string, unknown> = {}) {
  const fields = getSkillConfigFields(schema);
  const next: Record<string, unknown> = { ...currentConfig };

  for (const field of fields) {
    if (next[field.key] !== undefined) continue;
    if (field.defaultValue !== undefined) {
      next[field.key] = field.defaultValue;
    }
  }

  return next;
}

export function validateSkillConfig(schema: SkillConfigSchema | null | undefined, config: Record<string, unknown>) {
  const fields = getSkillConfigFields(schema);

  for (const field of fields) {
    const value = config[field.key];
    const missing = value === undefined
      || value === null
      || (typeof value === "string" && value.trim().length === 0)
      || (field.kind === "string-array" && Array.isArray(value) && value.length === 0)
      || (field.kind === "secret-ref" && getSecretRefName(value).length === 0);

    if (field.required && missing) {
      return { ok: false as const, error: `${field.title} is required.` };
    }

    if (value === undefined || value === null || value === "") continue;

    if (field.kind === "string-array" && !Array.isArray(value)) {
      return { ok: false as const, error: `${field.title} must be a list of strings.` };
    }

    if (field.kind === "string-array" && Array.isArray(value) && value.some((item) => typeof item !== "string")) {
      return { ok: false as const, error: `${field.title} must be a list of strings.` };
    }

    if (field.kind === "boolean" && typeof value !== "boolean") {
      return { ok: false as const, error: `${field.title} must be true or false.` };
    }

    if (field.kind === "enum" && typeof value === "string" && field.options && !field.options.includes(value)) {
      return { ok: false as const, error: `${field.title} must be one of: ${field.options.join(", ")}.` };
    }
  }

  return { ok: true as const };
}

export function parseStringList(value: string): string[] {
  return value
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function stringifyStringList(value: unknown): string {
  if (!Array.isArray(value)) return "";
  return value.filter((item): item is string => typeof item === "string").join("\n");
}

export function getSecretRefName(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";

  const directName = (value as { name?: unknown }).name;
  if (typeof directName === "string" && directName.trim().length > 0) {
    return directName.trim();
  }

  const nestedName = (value as { secretRef?: { name?: unknown } }).secretRef?.name;
  return typeof nestedName === "string" ? nestedName.trim() : "";
}

export function setSecretRefName(config: Record<string, unknown>, fieldKey: string, name: string) {
  const next = { ...config };
  const trimmed = name.trim();

  if (!trimmed) {
    delete next[fieldKey];
    return next;
  }

  next[fieldKey] = { name: trimmed };
  return next;
}
