import { describe, expect, it } from "vitest";
import {
  getInitialSkillConfig,
  getSecretRefName,
  getSkillConfigFields,
  parseStringList,
  setSecretRefName,
  stringifyStringList,
  validateSkillConfig,
} from "./skill-config-form";

const schema = {
  type: "object",
  properties: {
    baseUrl: { type: "string", title: "Base URL" },
    secretRef: {
      type: "object",
      title: "Secret reference",
      properties: {
        name: { type: "string", title: "Secret name" },
      },
      required: ["name"],
    },
    defaultScope: {
      type: "string",
      title: "Default scope",
      enum: ["v1", "customer", "project"],
    },
    allowedProjectIds: {
      type: "array",
      title: "Allowed project IDs",
      items: { type: "string" },
    },
    canPublish: {
      type: "boolean",
      title: "Allow publish",
      default: false,
    },
  },
  required: ["baseUrl", "secretRef"],
} as const;

describe("skill-config-form helpers", () => {
  it("maps schema fields into typed form fields", () => {
    expect(getSkillConfigFields(schema)).toMatchObject([
      { key: "baseUrl", kind: "string", required: true },
      { key: "secretRef", kind: "secret-ref", required: true },
      { key: "defaultScope", kind: "enum", required: false },
      { key: "allowedProjectIds", kind: "string-array", required: false },
      { key: "canPublish", kind: "boolean", required: false, defaultValue: false },
    ]);
  });

  it("hydrates defaults for new configs", () => {
    expect(getInitialSkillConfig(schema, {})).toMatchObject({ canPublish: false });
  });

  it("validates required and typed values", () => {
    expect(validateSkillConfig(schema, {})).toEqual({ ok: false, error: "Base URL is required." });
    expect(validateSkillConfig(schema, { baseUrl: "https://app.evercontent.com" })).toEqual({ ok: false, error: "Secret reference is required." });
    expect(validateSkillConfig(schema, {
      baseUrl: "https://app.evercontent.com",
      secretRef: { name: "evercontent-api-key" },
      allowedProjectIds: "project_123",
    } as unknown as Record<string, unknown>)).toEqual({ ok: false, error: "Allowed project IDs must be a list of strings." });
  });

  it("parses and stringifies string lists", () => {
    expect(parseStringList(" project_1\n\nproject_2 ")).toEqual(["project_1", "project_2"]);
    expect(stringifyStringList(["project_1", "project_2"])).toBe("project_1\nproject_2");
  });

  it("reads and writes secret refs", () => {
    const next = setSecretRefName({}, "secretRef", "evercontent-api-key");
    expect(getSecretRefName(next.secretRef)).toBe("evercontent-api-key");
    expect(next).toEqual({ secretRef: { name: "evercontent-api-key" } });
    expect(setSecretRefName(next, "secretRef", "")).toEqual({});
  });
});
