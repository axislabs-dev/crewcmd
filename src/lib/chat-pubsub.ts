/**
 * In-memory pub/sub for chat session events.
 * Single-process only (PGlite). Used by /api/chat to notify
 * /api/chat/events SSE connections when messages or live progress change.
 */

export interface ChatMessageEvent {
  type?: "message";
  id: string;
  sessionId: string;
  agentId: string;
  companyId: string;
  sessionKey?: string | null;
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
  event?: string;
  at?: string;
  payload: Record<string, unknown>;
}

export type ChatPubSubEvent = ChatMessageEvent | ChatProgressPubSubEvent;

type Listener = (event: ChatPubSubEvent) => void;

const listeners = new Set<Listener>();

export function subscribeChatEvents(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function publishChatEvent(event: ChatMessageEvent) {
  publishChatPubSubEvent(event);
}

export function publishChatProgressEvent(event: ChatProgressPubSubEvent) {
  publishChatPubSubEvent(event);
}

function publishChatPubSubEvent(event: ChatPubSubEvent) {
  for (const listener of listeners) {
    try {
      listener(event);
    } catch {
      // Don't let one listener break others
    }
  }
}
