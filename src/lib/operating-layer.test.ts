import { describe, expect, it } from "vitest";
import { BUILT_IN_BLUEPRINTS } from "./blueprints-data";
import { buildOperatingOverlay } from "./operating-layer";

describe("CrewCmd agent responsiveness contract", () => {
  it("adds quick acknowledgement guidance to operating overlays", () => {
    const overlay = buildOperatingOverlay({
      rolePack: "developer",
      mode: "imported-overlay",
    });

    expect(overlay).toContain("acknowledge the user quickly");
    expect(overlay).toContain("main conversation remains responsive");
  });

  it("includes responsiveness guidance in built-in blueprint AGENTS.md content", () => {
    const generatedAgentsFiles = BUILT_IN_BLUEPRINTS.flatMap((blueprint) =>
      blueprint.template.agents.map((agent) => agent.agentsContent ?? "")
    );

    expect(generatedAgentsFiles.length).toBeGreaterThan(0);
    expect(generatedAgentsFiles.every((content) => content.includes("## Responsiveness"))).toBe(true);
    expect(
      generatedAgentsFiles.every((content) => content.includes("acknowledge the user quickly"))
    ).toBe(true);
  });
});
