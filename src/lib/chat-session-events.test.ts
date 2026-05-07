import { describe, expect, it } from "vitest";
import {
  buildChatExecutionSnapshot,
  isPersistedChatProgressEvent,
  type PersistedChatProgressEvent,
} from "./chat-session-events";

function progress(event: string, extra: Partial<PersistedChatProgressEvent> = {}): PersistedChatProgressEvent {
  return {
    type: "chat_progress",
    event,
    at: new Date().toISOString(),
    sessionKey: "neo:run-1",
    ...extra,
  };
}

describe("chat-session-events", () => {
  it("accepts only persisted chat progress payloads", () => {
    expect(isPersistedChatProgressEvent(progress("tool_started"))).toBe(true);
    expect(isPersistedChatProgressEvent({ type: "message", content: "hello" })).toBe(false);
    expect(isPersistedChatProgressEvent(null)).toBe(false);
    expect(isPersistedChatProgressEvent([])).toBe(false);
  });

  it("rehydrates active tool/run progress from the latest non-terminal event", () => {
    const snapshot = buildChatExecutionSnapshot([
      progress("run_started"),
      progress("tool_started", { activeTool: { name: "web_search", status: "running" } }),
    ]);

    expect(snapshot.progress?.event).toBe("tool_started");
    expect(snapshot.progress?.activeTool).toEqual({ name: "web_search", status: "running" });
    expect(snapshot.events).toHaveLength(2);
  });

  it("does not show an active progress panel after terminal events", () => {
    const snapshot = buildChatExecutionSnapshot([
      progress("run_started"),
      progress("tool_started"),
      progress("run_completed"),
    ]);

    expect(snapshot.progress).toBeNull();
    expect(snapshot.events.map((event) => event.event)).toEqual([
      "run_started",
      "tool_started",
      "run_completed",
    ]);
  });

  it("keeps only the latest 40 replay events for bounded cross-client hydration", () => {
    const events = Array.from({ length: 45 }, (_, index) => progress(`tool_updated_${index}`));
    const snapshot = buildChatExecutionSnapshot(events);

    expect(snapshot.events).toHaveLength(40);
    expect(snapshot.events[0].event).toBe("tool_updated_5");
    expect(snapshot.progress?.event).toBe("tool_updated_44");
  });
});
