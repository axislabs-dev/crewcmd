import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { generateCrewCmdSkill } from "./crewcmd-skill-template";
import {
  CREWCMD_MANAGEMENT_CAPABILITY_CONTRACT,
  CREWCMD_MANAGEMENT_SKILL_METADATA,
} from "./skills/crewcmd-management";

function routeFileFor(endpointPath: string) {
  const segments = endpointPath
    .replace(/^\/api\//, "")
    .split("/")
    .map((segment) => segment.replace(/^\{(.+)\}$/, "[$1]"));

  return join(process.cwd(), "src", "app", "api", ...segments, "route.ts");
}

describe("crewcmd-management skill contract", () => {
  it("derives metadata capabilities from the reviewed contract matrix", () => {
    expect(CREWCMD_MANAGEMENT_SKILL_METADATA.capabilities).toEqual(
      CREWCMD_MANAGEMENT_CAPABILITY_CONTRACT.map((entry) => entry.capability)
    );
  });

  it("documents every metadata capability in the generated skill instructions", () => {
    const skill = generateCrewCmdSkill({
      baseUrl: "https://crewcmd.example.com",
      workspaceId: "workspace_123",
      companyId: "company_123",
    });

    for (const entry of CREWCMD_MANAGEMENT_CAPABILITY_CONTRACT) {
      expect(skill).toContain(`\`${entry.capability}\``);
      expect(skill).toContain(`\`${entry.method} ${entry.path}\``);
    }
  });

  it("keeps runtime scope and auth expectations explicit for agent users", () => {
    const companySkill = generateCrewCmdSkill({
      baseUrl: "https://crewcmd.example.com",
      workspaceId: "workspace_123",
      companyId: "company_123",
    });
    const personalSkill = generateCrewCmdSkill({
      baseUrl: "https://crewcmd.example.com",
      workspaceId: "workspace_123",
    });

    for (const skill of [companySkill, personalSkill]) {
      expect(skill).toContain("`workspaceId` is the preferred scope");
      expect(skill).toContain("`companyId` is only the company backing a company workspace");
      expect(skill).toContain("`runtimeId` identifies the CrewCmd runtime making the request");
      expect(skill).toContain("Authorization: Bearer $HEARTBEAT_SECRET");
      expect(skill).toContain("X-CrewCmd-Runtime-Id: $CREWCMD_RUNTIME_ID");
      expect(skill).toContain("Bearer auth does not grant cross-workspace access");
    }

    expect(companySkill).toContain("Company runtimes are scoped to the company workspace");
    expect(personalSkill).toContain("Personal runtimes are scoped to the owning user's personal workspace");
  });

  it("maps every contracted endpoint to an implemented route method", () => {
    for (const entry of CREWCMD_MANAGEMENT_CAPABILITY_CONTRACT) {
      const routeFile = routeFileFor(entry.path);
      expect(existsSync(routeFile), `${entry.capability} route is missing: ${routeFile}`).toBe(true);

      const source = readFileSync(routeFile, "utf8");
      expect(source, `${entry.capability} does not export ${entry.method} in ${routeFile}`).toMatch(
        new RegExp(`export\\s+async\\s+function\\s+${entry.method}\\b`)
      );
    }
  });

  it("does not advertise adjacent admin, routing, or marketplace endpoints as primary instructions", () => {
    const skill = generateCrewCmdSkill({
      baseUrl: "https://crewcmd.example.com",
      workspaceId: "workspace_123",
      companyId: "company_123",
    });

    expect(skill).not.toContain("/api/chat");
    expect(skill).not.toContain("/api/openclaw");
    expect(skill).not.toContain("/api/skills/import");
    expect(skill).not.toContain("/api/skills/browse");
    expect(skill).not.toContain("/api/org-chart");
    expect(skill).not.toContain("/api/agents/{callsign}/output/stream");
  });
});
