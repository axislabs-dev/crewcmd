import { db, withRetry } from "@/db";
import { gatewaySessions } from "@/db/schema";
import { getGatewayClient, holdClient, releaseClient } from "./gateway-chat-pool";

let eventBridge: EventBridge | null = null;
let fallbackRefreshTimer: ReturnType<typeof setInterval> | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

const DEBOUNCE_MS = 2_000;
const REFRESH_INTERVAL_MS = 60_000;
const RECONNECT_DELAY_MS = 5_000;
const UPSERT_CHUNK_SIZE = 100;

type GatewaySessionRecord = Record<string, unknown>;

type EventBridgeStatus = {
  connected: boolean;
  lastRefresh: string | null;
  eventCount: number;
};

function extractAgentFromKey(key: string): string {
  return key.split(":")[0] || key;
}

function mapSessionToValue(session: GatewaySessionRecord) {
  return {
    key: session.key as string,
    agentId: extractAgentFromKey(session.key as string),
    spawnedByKey: (session.spawnedBy as string) || null,
    kind: (session.kind as string) || "session",
    label: (session.label as string) || null,
    title: (session.derivedTitle as string) || null,
    lastMessagePreview: (session.lastMessagePreview as string) || null,
    updatedAt: session.updatedAt ? new Date(session.updatedAt as string) : null,
    tokenUsage: {
      input: session.inputTokens as number | undefined,
      output: session.outputTokens as number | undefined,
      total: session.totalTokens as number | undefined,
    },
    model: (session.model as string) || null,
    modelProvider: (session.modelProvider as string) || null,
    sessionId: (session.sessionId as string) || null,
  };
}

class EventBridge {
  private client: Awaited<ReturnType<typeof getGatewayClient>> | null = null;
  private connected = false;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private refreshInFlight: Promise<void> | null = null;
  private lastRefreshAt: Date | null = null;
  private eventCount = 0;
  private listenersAttached = false;

  async start() {
    if (this.connected && this.client) return;
    await this.connect();
  }

  getStatus(): EventBridgeStatus {
    return {
      connected: this.connected,
      lastRefresh: this.lastRefreshAt?.toISOString() ?? null,
      eventCount: this.eventCount,
    };
  }

  async refreshNow() {
    await this.refreshSessions();
  }

  private async connect() {
    try {
      const client = await getGatewayClient();
      holdClient(client);

      this.detachListeners();
      this.client = client;
      this.attachListeners();
      this.connected = true;

      console.log("[event-bridge] Connected to gateway");
    } catch (error) {
      this.connected = false;
      console.error("[event-bridge] Failed to connect:", error);
      this.scheduleReconnect();
    }
  }

  private attachListeners() {
    if (!this.client || this.listenersAttached) return;

    this.client.on("*", this.onGatewayEvent);
    this.client.on("chat", this.onChatEvent);
    this.client.on("agent", this.onAgentEvent);
    this.listenersAttached = true;
  }

  private detachListeners() {
    if (!this.client || !this.listenersAttached) return;

    this.client.off("*", this.onGatewayEvent);
    this.client.off("chat", this.onChatEvent);
    this.client.off("agent", this.onAgentEvent);
    releaseClient(this.client);
    this.listenersAttached = false;
  }

  private scheduleReconnect() {
    if (reconnectTimer) return;

    reconnectTimer = setTimeout(async () => {
      reconnectTimer = null;
      await this.connect();
    }, RECONNECT_DELAY_MS);
  }

  private onGatewayEvent = (payload: unknown) => {
    this.eventCount += 1;

    const eventName =
      typeof payload === "object" && payload !== null && "event" in payload
        ? String((payload as Record<string, unknown>).event)
        : "unknown";

    console.log(`[event-bridge] event: ${eventName}`);
  };

  private onChatEvent = (payload: unknown) => {
    const event = payload as Record<string, unknown>;
    const state = event.state as string | undefined;
    const sessionKey = event.sessionKey as string | undefined;

    if (!sessionKey || state === "delta") return;

    this.scheduleDebouncedRefresh();
  };

  private onAgentEvent = (payload: unknown) => {
    const event = payload as Record<string, unknown>;
    const stream = event.stream as string | undefined;
    const data = event.data as Record<string, unknown> | undefined;
    const phase = data?.phase as string | undefined;

    if (stream === "lifecycle" && (phase === "start" || phase === "end" || phase === "error")) {
      this.scheduleDebouncedRefresh();
    }
  };

  private scheduleDebouncedRefresh() {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => {
      void this.refreshSessions();
    }, DEBOUNCE_MS);
  }

  private async refreshSessions() {
    if (this.refreshInFlight) {
      await this.refreshInFlight;
      return;
    }

    this.refreshInFlight = this.doRefreshSessions().finally(() => {
      this.refreshInFlight = null;
    });

    await this.refreshInFlight;
  }

  private async doRefreshSessions() {
    if (!db) return;

    try {
      if (!this.client || !this.client.isConnected) {
        this.connected = false;
        await this.connect();
      }

      if (!this.client || !this.client.isConnected) {
        return;
      }

      const result = await this.client.rpc<Record<string, unknown>>("sessions.list", {});
      const sessions = ((result.sessions as GatewaySessionRecord[] | undefined) ?? []).filter(
        (session) => typeof session.key === "string" && session.key.length > 0,
      );

      for (let index = 0; index < sessions.length; index += UPSERT_CHUNK_SIZE) {
        const chunk = sessions.slice(index, index + UPSERT_CHUNK_SIZE);

        for (const session of chunk) {
          const value = mapSessionToValue(session);

          await withRetry(() =>
            db!
              .insert(gatewaySessions)
              .values(value)
              .onConflictDoUpdate({
                target: gatewaySessions.key,
                set: {
                  agentId: value.agentId,
                  spawnedByKey: value.spawnedByKey,
                  kind: value.kind,
                  label: value.label,
                  title: value.title,
                  lastMessagePreview: value.lastMessagePreview,
                  updatedAt: value.updatedAt,
                  tokenUsage: value.tokenUsage,
                  model: value.model,
                  modelProvider: value.modelProvider,
                  sessionId: value.sessionId,
                },
              })
          );
        }
      }

      this.connected = true;
      this.lastRefreshAt = new Date();
    } catch (error) {
      this.connected = false;
      console.error("[event-bridge] Session refresh error:", error);
      this.scheduleReconnect();
    }
  }
}

export async function startEventBridge() {
  if (!eventBridge) {
    eventBridge = new EventBridge();
  }

  await eventBridge.start();

  if (!fallbackRefreshTimer) {
    fallbackRefreshTimer = setInterval(() => {
      void eventBridge?.refreshNow();
    }, REFRESH_INTERVAL_MS);
  }

  return eventBridge;
}

export function getEventBridgeStatus(): EventBridgeStatus {
  return eventBridge?.getStatus() ?? {
    connected: false,
    lastRefresh: null,
    eventCount: 0,
  };
}

export { eventBridge };
