import { describe, expect, it } from "vitest";
import { buildAgentReplyPayload, sendAgentReplyNotification } from "@/lib/mobile-push";

describe("mobile push", () => {
  it("builds a minimal agent reply deep-link payload", () => {
    const payload = buildAgentReplyPayload({
      userId: "user-1",
      companyId: "company-1",
      agentId: "neo",
      sessionId: "session-1",
      sessionKey: "neo:thread:parent-message-1",
      messageId: "message-1",
      body: "The agent finished the requested work and has details ready.",
    });

    expect(payload.title).toBe("neo responded");
    expect(payload.url).toBe("/chat?agent=neo&sessionKey=neo%3Athread%3Aparent-message-1&messageId=message-1");
    expect(payload.data).toMatchObject({
      kind: "agent_reply",
      agentId: "neo",
      sessionId: "session-1",
      sessionKey: "neo:thread:parent-message-1",
      messageId: "message-1",
      url: "/chat?agent=neo&sessionKey=neo%3Athread%3Aparent-message-1&messageId=message-1",
    });
  });

  it("skips delivery when server push is disabled", async () => {
    const previous = process.env.CREWCMD_PUSH_ENABLED;
    process.env.CREWCMD_PUSH_ENABLED = "false";

    await expect(sendAgentReplyNotification({
      userId: "user-1",
      companyId: "company-1",
      agentId: "neo",
      sessionId: "session-1",
      sessionKey: "neo",
      messageId: "message-1",
      body: "Done.",
    })).resolves.toEqual({ attempted: 0, sent: 0, skipped: true });

    if (previous === undefined) {
      delete process.env.CREWCMD_PUSH_ENABLED;
    } else {
      process.env.CREWCMD_PUSH_ENABLED = previous;
    }
  });
});
