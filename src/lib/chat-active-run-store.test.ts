import { beforeEach, describe, expect, it } from "vitest";
import { useActiveChatRunStore } from "./chat-active-run-store";

describe("chat-active-run-store", () => {
  beforeEach(() => {
    useActiveChatRunStore.getState().reset();
  });

  it("tracks a run from start through gateway acknowledgement", () => {
    useActiveChatRunStore.getState().beginRun({
      sessionKey: "main",
      at: "2026-05-01T00:00:00.000Z",
    });

    expect(useActiveChatRunStore.getState()).toMatchObject({
      sessionKey: "main",
      runId: null,
      isSending: true,
      lastEventAt: "2026-05-01T00:00:00.000Z",
      terminalStatus: "starting",
    });

    const accepted = useActiveChatRunStore.getState().acknowledgeRun({
      sessionKey: "main",
      runId: "run-1",
      at: "2026-05-01T00:00:01.000Z",
    });

    expect(accepted).toBe(true);
    expect(useActiveChatRunStore.getState()).toMatchObject({
      sessionKey: "main",
      runId: "run-1",
      isSending: true,
      lastEventAt: "2026-05-01T00:00:01.000Z",
      terminalStatus: "running",
    });
  });

  it("tracks optional tool and subagent progress details", () => {
    useActiveChatRunStore.getState().beginRun({
      sessionKey: "main",
      at: "2026-05-01T00:00:00.000Z",
    });
    useActiveChatRunStore.getState().acknowledgeRun({
      sessionKey: "main",
      runId: "run-1",
      at: "2026-05-01T00:00:01.000Z",
    });

    const accepted = useActiveChatRunStore.getState().applyProgressEvent({
      type: "chat_progress",
      event: "heartbeat",
      at: "2026-05-01T00:00:02.000Z",
      sessionKey: "main",
      runId: "run-1",
      activeTool: { name: "sessions_send", status: "running" },
      activeSubagent: "writer",
    });

    expect(accepted).toBe(true);
    expect(useActiveChatRunStore.getState()).toMatchObject({
      activeTool: { name: "sessions_send", status: "running" },
      activeSubagent: { name: "writer", status: null },
      terminalStatus: "running",
    });
  });

  it("ignores stale progress events for another run", () => {
    useActiveChatRunStore.getState().beginRun({ sessionKey: "main" });
    useActiveChatRunStore.getState().acknowledgeRun({ sessionKey: "main", runId: "run-new" });

    const accepted = useActiveChatRunStore.getState().applyProgressEvent({
      type: "chat_progress",
      event: "run_completed",
      at: "2026-05-01T00:00:03.000Z",
      sessionKey: "main",
      runId: "run-old",
    });

    expect(accepted).toBe(false);
    expect(useActiveChatRunStore.getState()).toMatchObject({
      runId: "run-new",
      isSending: true,
      terminalStatus: "running",
    });
  });

  it("ignores older progress events without a run id", () => {
    useActiveChatRunStore.getState().beginRun({
      sessionKey: "main",
      at: "2026-05-01T00:00:10.000Z",
    });

    const accepted = useActiveChatRunStore.getState().applyProgressEvent({
      type: "chat_progress",
      event: "gateway_send_started",
      at: "2026-05-01T00:00:09.000Z",
      sessionKey: "main",
    });

    expect(accepted).toBe(false);
    expect(useActiveChatRunStore.getState()).toMatchObject({
      lastEventAt: "2026-05-01T00:00:10.000Z",
      terminalStatus: "starting",
    });
  });

  it("clears active progress on terminal events", () => {
    useActiveChatRunStore.getState().beginRun({
      sessionKey: "main",
      at: "2026-05-01T00:00:00.000Z",
    });
    useActiveChatRunStore.getState().acknowledgeRun({
      sessionKey: "main",
      runId: "run-1",
      at: "2026-05-01T00:00:01.000Z",
    });
    useActiveChatRunStore.getState().applyProgressEvent({
      type: "chat_progress",
      event: "heartbeat",
      at: "2026-05-01T00:00:02.000Z",
      sessionKey: "main",
      runId: "run-1",
      activeTool: "shell",
      activeSubagent: "writer",
    });

    const accepted = useActiveChatRunStore.getState().applyProgressEvent({
      type: "chat_progress",
      event: "run_completed",
      at: "2026-05-01T00:00:04.000Z",
      sessionKey: "main",
      runId: "run-1",
    });

    expect(accepted).toBe(true);
    expect(useActiveChatRunStore.getState()).toMatchObject({
      isSending: false,
      activeTool: null,
      activeSubagent: null,
      terminalStatus: "completed",
      lastEventAt: "2026-05-01T00:00:04.000Z",
    });
  });
});
