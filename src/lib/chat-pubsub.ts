/**
 * In-memory pub/sub for committed realtime chat events.
 * Single-process only; durable replay comes from realtime_events.
 */

export interface ChatMessageEvent {
  type?: "message";
  id: string;
  sessionId: string;
  agentId: string;
  companyId: string;
  sessionKey?: string | null;
  channelId?: string | null;
  role: "user" | "assistant" | "system";
  content: string;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
  interrupted?: boolean;
}

export interface ChatProgressPubSubEvent {
  type: "chat_progress";
  id?: string;
  sessionId: string;
  agentId: string;
  companyId: string;
  sessionKey: string;
  channelId?: string | null;
  event?: string;
  at?: string;
  payload: Record<string, unknown>;
}

export type ChatPubSubEvent = ChatMessageEvent | ChatProgressPubSubEvent;

export interface RealtimeChatEventDescriptor {
  sequence: number;
  companyId: string | null;
  workspaceId?: string | null;
  channelId?: string | null;
  sessionId?: string | null;
}

type Listener = (event: RealtimeChatEventDescriptor) => void;

const listeners = new Set<Listener>();

export function subscribeChatEvents(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function publishRealtimeChatEvent(event: RealtimeChatEventDescriptor) {
  for (const listener of listeners) {
    try {
      listener(event);
    } catch {
      // Don't let one listener break others
    }
  }
}

/** @deprecated Use appendRealtimeChatMessageEvent. */
export function publishChatEvent(_event: ChatMessageEvent) {}

/** @deprecated Use appendRealtimeChatProgressEvent. */
export function publishChatProgressEvent(event: ChatProgressPubSubEvent) {
  if (typeof event.id === "string") {
    const sequence = Number(event.id);
    if (Number.isFinite(sequence)) {
      publishRealtimeChatEvent({
        sequence,
        companyId: event.companyId,
        channelId: event.channelId ?? null,
        sessionId: event.sessionId,
      });
    }
  }
}
