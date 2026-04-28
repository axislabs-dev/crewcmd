import { describe, expect, it } from "vitest";
import { parsePlainTextLinks } from "./linkify-text";

describe("parsePlainTextLinks", () => {
  it("extracts plain https URLs from message text", () => {
    expect(parsePlainTextLinks("Review https://github.com/axislabs-dev/crewcmd/pull/235 now")).toEqual([
      { kind: "text", value: "Review " },
      { kind: "url", value: "https://github.com/axislabs-dev/crewcmd/pull/235" },
      { kind: "text", value: " now" },
    ]);
  });

  it("keeps trailing sentence punctuation outside the URL", () => {
    expect(parsePlainTextLinks("Merge at https://example.com/pr/1.")).toEqual([
      { kind: "text", value: "Merge at " },
      { kind: "url", value: "https://example.com/pr/1" },
      { kind: "text", value: "." },
    ]);
  });
});
