import { describe, expect, it } from "vitest";
import { selectRecoveredAssistantText } from "./chat-recovery";

describe("selectRecoveredAssistantText", () => {
  it("recovers the assistant message after the current user turn", () => {
    const recovered = selectRecoveredAssistantText({
      messages: [
        { role: "user", content: "old question" },
        { role: "assistant", content: "old answer" },
        { role: "user", content: "new question" },
        { role: "assistant", content: "new answer" },
      ],
      currentUserContents: ["new question"],
      previousAssistantContents: ["old answer"],
    });

    expect(recovered).toBe("new answer");
  });

  it("does not recover the latest assistant when the current user turn is missing", () => {
    const recovered = selectRecoveredAssistantText({
      messages: [
        { role: "user", content: "old question" },
        { role: "assistant", content: "old answer" },
      ],
      currentUserContents: ["new question"],
      previousAssistantContents: ["old answer"],
    });

    expect(recovered).toBe("");
  });

  it("matches delegated outbound user content as the current turn", () => {
    const delegatedMessage = [
      "CrewCmd delegation request.",
      "",
      "Human message:",
      "Ask Cipher for status",
    ].join("\n");

    const recovered = selectRecoveredAssistantText({
      messages: [
        { role: "user", content: delegatedMessage },
        { role: "assistant", content: "Cipher is on track." },
      ],
      currentUserContents: ["Ask Cipher for status", delegatedMessage],
    });

    expect(recovered).toBe("Cipher is on track.");
  });

  it("does not recover an assistant response already present in prior history", () => {
    const recovered = selectRecoveredAssistantText({
      messages: [
        { role: "user", content: "old question" },
        { role: "assistant", content: "same answer" },
        { role: "user", content: "new question" },
        { role: "assistant", content: "same answer" },
      ],
      currentUserContents: ["new question"],
      previousAssistantContents: ["same answer"],
    });

    expect(recovered).toBe("");
  });
});
