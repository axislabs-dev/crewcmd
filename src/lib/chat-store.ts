"use client";

import { create } from "zustand";

export interface ChatStoreMessage {
  id: string;
  sessionId?: string;
  agentId: string;
  role: "user" | "assistant" | "system";
  content: string;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
  interrupted?: boolean;
}

interface ChatStoreState {
  /** Messages keyed by agentId (lowercase callsign) */
  messagesByAgent: Record<string, ChatStoreMessage[]>;
  /** Unread counts per agentId */
  unreadByAgent: Record<string, number>;
  /** Timestamp of the last event received (ISO string) */
  lastEventAt: string | null;

  /** Add a single message (from SSE or local). Deduplicates by id. */
  addMessage: (msg: ChatStoreMessage) => void;
  /** Bulk-load messages for a session (e.g. initial fetch). Deduplicates. */
  loadSession: (agentId: string, messages: ChatStoreMessage[]) => void;
  /** Mark all messages for an agent as read (reset unread counter). */
  markRead: (agentId: string) => void;
  /** Clear messages for an agent (e.g. on session reset). */
  clearAgent: (agentId: string) => void;
}

export const useChatStore = create<ChatStoreState>((set) => ({
  messagesByAgent: {},
  unreadByAgent: {},
  lastEventAt: null,

  addMessage: (msg) =>
    set((state) => {
      const key = msg.agentId.toLowerCase();
      const existing = state.messagesByAgent[key] || [];

      // Deduplicate by id
      if (existing.some((m) => m.id === msg.id)) return state;

      const updated = [...existing, msg].sort((a, b) =>
        (a.createdAt || "").localeCompare(b.createdAt || "")
      );

      return {
        messagesByAgent: { ...state.messagesByAgent, [key]: updated },
        unreadByAgent: {
          ...state.unreadByAgent,
          [key]: (state.unreadByAgent[key] || 0) + 1,
        },
        lastEventAt: msg.createdAt || state.lastEventAt,
      };
    }),

  loadSession: (agentId, messages) =>
    set((state) => {
      const key = agentId.toLowerCase();
      const existingIds = new Set(
        (state.messagesByAgent[key] || []).map((m) => m.id)
      );

      // Merge, deduplicate, sort
      const merged = [
        ...(state.messagesByAgent[key] || []),
        ...messages.filter((m) => !existingIds.has(m.id)),
      ].sort((a, b) =>
        (a.createdAt || "").localeCompare(b.createdAt || "")
      );

      const lastMsg = merged[merged.length - 1];

      return {
        messagesByAgent: { ...state.messagesByAgent, [key]: merged },
        lastEventAt: lastMsg?.createdAt || state.lastEventAt,
      };
    }),

  markRead: (agentId) =>
    set((state) => ({
      unreadByAgent: { ...state.unreadByAgent, [agentId.toLowerCase()]: 0 },
    })),

  clearAgent: (agentId) =>
    set((state) => ({
      messagesByAgent: { ...state.messagesByAgent, [agentId.toLowerCase()]: [] },
      unreadByAgent: { ...state.unreadByAgent, [agentId.toLowerCase()]: 0 },
    })),
}));
