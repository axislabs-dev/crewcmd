import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/db", () => ({
  db: {},
  withRetry: vi.fn((fn: () => unknown) => fn()),
}));

const mockRequireAuth = vi.fn().mockResolvedValue(null);
vi.mock("@/lib/require-auth", () => ({
  requireAuth: (...a: unknown[]) => mockRequireAuth(...a),
}));

const mockResolveAccessibleWorkspace = vi.fn();
vi.mock("@/lib/workspace", () => ({
  resolveAccessibleWorkspace: (...a: unknown[]) => mockResolveAccessibleWorkspace(...a),
}));

const mockSubscribeChatEvents = vi.fn((_listener: unknown) => vi.fn());
vi.mock("@/lib/chat-pubsub", () => ({
  subscribeChatEvents: (listener: unknown) => mockSubscribeChatEvents(listener),
}));

const mockCanAccessChatSession = vi.fn().mockResolvedValue(true);
vi.mock("@/lib/chat-session-access", () => ({
  canAccessChatSession: (...a: unknown[]) => mockCanAccessChatSession(...a),
}));

const mockLoadRealtimeEventsAfterCursor = vi.fn().mockResolvedValue([]);
const mockLoadRealtimeEventBySequence = vi.fn().mockResolvedValue(null);
const mockToClientRealtimeEvent = vi.fn((event: Record<string, unknown>) => ({
  id: event.id,
  sequence: String(event.sequence),
  type: event.type,
  payload: event.payload,
}));
vi.mock("@/lib/realtime-events", () => ({
  loadRealtimeEventsAfterCursor: (...a: unknown[]) => mockLoadRealtimeEventsAfterCursor(...a),
  loadRealtimeEventBySequence: (...a: unknown[]) => mockLoadRealtimeEventBySequence(...a),
  normalizeRealtimeCursor: (value: string | null | undefined) => value ? Number(value) : null,
  toClientRealtimeEvent: (event: Record<string, unknown>) => mockToClientRealtimeEvent(event),
}));

import { GET } from "./route";

function makeRequest(url: string, init?: RequestInit) {
  const request = new Request(`http://localhost${url}`, init);
  Object.defineProperty(request, "cookies", { value: { get: () => undefined } });
  return request as Parameters<typeof GET>[0];
}

describe("GET /api/chat/events", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue(null);
    mockResolveAccessibleWorkspace.mockResolvedValue({ id: "ws-1", companyId: "co-1" });
    mockCanAccessChatSession.mockResolvedValue(true);
    mockLoadRealtimeEventsAfterCursor.mockResolvedValue([]);
    mockLoadRealtimeEventBySequence.mockResolvedValue(null);
  });

  it("requires a company scope", async () => {
    const res = await GET(makeRequest("/api/chat/events"));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe("companyId required");
    expect(mockResolveAccessibleWorkspace).not.toHaveBeenCalled();
  });

  it("forbids streaming events outside an accessible company", async () => {
    mockResolveAccessibleWorkspace.mockResolvedValue(null);

    const res = await GET(makeRequest("/api/chat/events?companyId=co-2"));
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error).toBe("Forbidden");
    expect(mockSubscribeChatEvents).not.toHaveBeenCalled();
  });

  it("opens an event stream for accessible companies", async () => {
    const res = await GET(makeRequest("/api/chat/events?companyId=co-1"));

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/event-stream");
    expect(mockResolveAccessibleWorkspace).toHaveBeenCalledWith(expect.objectContaining({
      explicitCompanyId: "co-1",
      requireExplicitForBearer: true,
    }));
    expect(mockSubscribeChatEvents).toHaveBeenCalledTimes(1);

    await res.body?.cancel();
  });

  it("replays durable events after Last-Event-ID", async () => {
    mockLoadRealtimeEventsAfterCursor.mockResolvedValueOnce([
      {
        id: "evt-1",
        sequence: 42,
        type: "chat.message.created",
        companyId: "co-1",
        sessionId: null,
        payload: { message: { id: "msg-1" } },
      },
    ]);

    const res = await GET(makeRequest("/api/chat/events?companyId=co-1", {
      headers: { "Last-Event-ID": "41" },
    }));
    const reader = res.body!.getReader();
    const chunk = await reader.read();
    await reader.cancel();
    const text = new TextDecoder().decode(chunk.value);

    expect(mockLoadRealtimeEventsAfterCursor).toHaveBeenCalledWith({
      companyId: "co-1",
      lastEventId: 41,
    });
    expect(text).toContain("id: 42");
    expect(text).toContain("event: chat.message.created");
    expect(text).toContain('"sequence":"42"');
  });
});
