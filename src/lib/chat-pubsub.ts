/**
 * In-memory pub/sub for chat message events.
 * Single-process only (PGlite). Used by /api/chat to notify
 * /api/chat/events SSE connections when new messages are persisted.
 */

export interface ChatMessageEvent {
  id: string;
  sessionId: string;
  agentId: string;
  companyId: string;
  role: "user" | "assistant" | "system";
  content: string;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
  interrupted?: boolean;
}

type Listener = (event: ChatMessageEvent) => void;

const listeners = new Set<Listener>();

export function subscribeChatEvents(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function publishChatEvent(event: ChatMessageEvent) {
  for (const listener of listeners) {
    try {
      listener(event);
    } catch {
      // Don't let one listener break others
    }
  }
}
