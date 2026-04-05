import { describe, it, expect, beforeEach } from "vitest";
import { useChatStore, type ChatStoreMessage } from "./chat-store";

function makeMsg(overrides: Partial<ChatStoreMessage> = {}): ChatStoreMessage {
  return {
    id: crypto.randomUUID(),
    agentId: "neo",
    role: "user",
    content: "hello",
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("chat-store", () => {
  beforeEach(() => {
    // Reset store between tests
    const { messagesByAgent, unreadByAgent } = useChatStore.getState();
    for (const key of Object.keys(messagesByAgent)) {
      useChatStore.getState().clearAgent(key);
    }
    for (const key of Object.keys(unreadByAgent)) {
      useChatStore.getState().markRead(key);
    }
  });

  describe("addMessage", () => {
    it("adds a message to the correct agent key", () => {
      const msg = makeMsg({ agentId: "Neo" });
      useChatStore.getState().addMessage(msg);

      const messages = useChatStore.getState().messagesByAgent["neo"];
      expect(messages).toHaveLength(1);
      expect(messages[0].id).toBe(msg.id);
    });

    it("lowercases agent ID for storage", () => {
      useChatStore.getState().addMessage(makeMsg({ agentId: "CIPHER" }));
      expect(useChatStore.getState().messagesByAgent["cipher"]).toHaveLength(1);
      expect(useChatStore.getState().messagesByAgent["CIPHER"]).toBeUndefined();
    });

    it("deduplicates by ID", () => {
      const msg = makeMsg();
      useChatStore.getState().addMessage(msg);
      useChatStore.getState().addMessage(msg); // same message again

      expect(useChatStore.getState().messagesByAgent["neo"]).toHaveLength(1);
    });

    it("increments unread count", () => {
      useChatStore.getState().addMessage(makeMsg());
      useChatStore.getState().addMessage(makeMsg());

      expect(useChatStore.getState().unreadByAgent["neo"]).toBe(2);
    });

    it("sorts messages by createdAt", () => {
      const early = makeMsg({ createdAt: "2026-01-01T00:00:00Z" });
      const late = makeMsg({ createdAt: "2026-01-02T00:00:00Z" });

      useChatStore.getState().addMessage(late);
      useChatStore.getState().addMessage(early);

      const messages = useChatStore.getState().messagesByAgent["neo"];
      expect(messages[0].id).toBe(early.id);
      expect(messages[1].id).toBe(late.id);
    });
  });

  describe("loadSession", () => {
    it("bulk-loads messages and deduplicates", () => {
      const existing = makeMsg({ id: "m1", createdAt: "2026-01-01T00:00:00Z" });
      useChatStore.getState().addMessage(existing);

      const batch = [
        { ...existing }, // duplicate
        makeMsg({ id: "m2", createdAt: "2026-01-02T00:00:00Z" }),
        makeMsg({ id: "m3", createdAt: "2026-01-03T00:00:00Z" }),
      ];

      useChatStore.getState().loadSession("neo", batch);

      const messages = useChatStore.getState().messagesByAgent["neo"];
      expect(messages).toHaveLength(3);
    });

    it("sorts merged messages chronologically", () => {
      useChatStore.getState().addMessage(
        makeMsg({ id: "m1", createdAt: "2026-01-03T00:00:00Z" })
      );

      useChatStore.getState().loadSession("neo", [
        makeMsg({ id: "m2", createdAt: "2026-01-01T00:00:00Z" }),
        makeMsg({ id: "m3", createdAt: "2026-01-02T00:00:00Z" }),
      ]);

      const ids = useChatStore.getState().messagesByAgent["neo"].map((m) => m.id);
      expect(ids).toEqual(["m2", "m3", "m1"]);
    });
  });

  describe("markRead", () => {
    it("resets unread counter to zero", () => {
      useChatStore.getState().addMessage(makeMsg());
      useChatStore.getState().addMessage(makeMsg());
      expect(useChatStore.getState().unreadByAgent["neo"]).toBe(2);

      useChatStore.getState().markRead("neo");
      expect(useChatStore.getState().unreadByAgent["neo"]).toBe(0);
    });

    it("handles case-insensitive agent ID", () => {
      useChatStore.getState().addMessage(makeMsg({ agentId: "Neo" }));
      useChatStore.getState().markRead("NEO");
      expect(useChatStore.getState().unreadByAgent["neo"]).toBe(0);
    });
  });

  describe("clearAgent", () => {
    it("removes all messages and resets unread", () => {
      useChatStore.getState().addMessage(makeMsg());
      useChatStore.getState().addMessage(makeMsg());

      useChatStore.getState().clearAgent("neo");

      expect(useChatStore.getState().messagesByAgent["neo"]).toEqual([]);
      expect(useChatStore.getState().unreadByAgent["neo"]).toBe(0);
    });

    it("does not affect other agents", () => {
      useChatStore.getState().addMessage(makeMsg({ agentId: "neo" }));
      useChatStore.getState().addMessage(makeMsg({ agentId: "cipher" }));

      useChatStore.getState().clearAgent("neo");

      expect(useChatStore.getState().messagesByAgent["neo"]).toEqual([]);
      expect(useChatStore.getState().messagesByAgent["cipher"]).toHaveLength(1);
    });
  });
});
