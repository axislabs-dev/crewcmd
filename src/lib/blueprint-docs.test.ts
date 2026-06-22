import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BUILT_IN_BLUEPRINTS } from "./blueprints-data";

function readRepoFile(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("blueprint documentation", () => {
  it("documents the currently shipped built-in blueprints", () => {
    const teamStructure = readRepoFile("docs/concepts/team-structure.md");

    for (const blueprint of BUILT_IN_BLUEPRINTS) {
      expect(teamStructure).toContain(blueprint.name);
    }

    expect(teamStructure).not.toContain("Support Ops");
    expect(teamStructure).not.toContain("Full Company");
  });

  it("keeps the API reference and packaged skill reference aligned", () => {
    const apiReference = readRepoFile("docs/API.md");
    const skillReference = readRepoFile("skills/crewcmd/references/api-full.md");
    const deployDescription =
      "Deploy a blueprint into a workspace. The endpoint creates or updates the blueprint agents, org chart, and associated skills, and accepts optional agent customizations before launch.";

    expect(apiReference).toContain(deployDescription);
    expect(skillReference).toContain(deployDescription);
  });
});
