"use client";

import { useEffect, useRef } from "react";
import { useCompany } from "@/components/company-context";
import { useChatStore } from "@/lib/chat-store";

/**
 * Layout-level component that maintains an SSE connection to
 * /api/chat/events. Feeds incoming messages into the Zustand
 * chat store so they're available on any page.
 */
export function ChatEventProvider() {
  const { company } = useCompany();
  const addMessage = useChatStore((s) => s.addMessage);
  const lastEventAt = useChatStore((s) => s.lastEventAt);
  const lastEventAtRef = useRef(lastEventAt);

  // Keep ref in sync
  useEffect(() => {
    lastEventAtRef.current = lastEventAt;
  }, [lastEventAt]);

  useEffect(() => {
    if (!company?.id) return;

    let eventSource: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;

    function connect() {
      if (disposed) return;

      const since = lastEventAtRef.current || new Date(Date.now() - 60_000).toISOString();
      const url = `/api/chat/events?companyId=${encodeURIComponent(company!.id)}&since=${encodeURIComponent(since)}`;
      eventSource = new EventSource(url);

      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === "message" && data.id && data.agentId) {
            addMessage({
              id: data.id,
              sessionId: data.sessionId,
              agentId: data.agentId,
              role: data.role,
              content: data.content,
              metadata: data.metadata,
              createdAt: data.createdAt,
              interrupted: data.interrupted,
            });
          }
        } catch {
          // Ignore malformed events (pings, etc.)
        }
      };

      eventSource.onerror = () => {
        // Auto-reconnect after 5s
        eventSource?.close();
        eventSource = null;
        if (!disposed) {
          reconnectTimer = setTimeout(connect, 5_000);
        }
      };
    }

    connect();

    return () => {
      disposed = true;
      eventSource?.close();
      if (reconnectTimer) clearTimeout(reconnectTimer);
    };
  }, [company?.id, addMessage]);

  return null;
}
