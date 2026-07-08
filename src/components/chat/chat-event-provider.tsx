"use client";

import { useEffect, useRef } from "react";
import { useCompany } from "@/components/company-context";
import { chatConversationStoreKey, useChatStore } from "@/lib/chat-store";
import { useActiveChatRunStore } from "@/lib/chat-active-run-store";

/**
 * Layout-level component that maintains an SSE connection to
 * /api/chat/events. Feeds incoming messages into the Zustand
 * chat store so they're available on any page.
 */
export function ChatEventProvider() {
  const { company } = useCompany();
  const addMessage = useChatStore((s) => s.addMessage);
  const lastEventAt = useChatStore((s) => s.lastEventAt);
  const lastEventId = useChatStore((s) => s.lastEventId);
  const setLastEventId = useChatStore((s) => s.setLastEventId);
  const lastEventAtRef = useRef(lastEventAt);
  const lastEventIdRef = useRef(lastEventId);

  // Keep ref in sync
  useEffect(() => {
    lastEventAtRef.current = lastEventAt;
  }, [lastEventAt]);

  useEffect(() => {
    const stored = window.localStorage.getItem("crewcmd.chat.lastEventId");
    if (stored && !lastEventIdRef.current) {
      lastEventIdRef.current = stored;
      setLastEventId(stored);
    }
  }, [setLastEventId]);

  useEffect(() => {
    lastEventIdRef.current = lastEventId;
    if (lastEventId) {
      window.localStorage.setItem("crewcmd.chat.lastEventId", lastEventId);
    }
  }, [lastEventId]);

  useEffect(() => {
    if (!company?.id) return;

    let eventSource: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let reconnecting = false;
    let disposed = false;

    function closeEventSource() {
      eventSource?.close();
      eventSource = null;
    }

    function scheduleReconnect(delayMs: number) {
      if (disposed || reconnectTimer) return;
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, delayMs);
    }

    function reconnectNow() {
      if (disposed || reconnecting) return;
      reconnecting = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      closeEventSource();
      connect();
      window.setTimeout(() => {
        reconnecting = false;
      }, 250);
    }

    function handleResume() {
      if (typeof document !== "undefined" && document.hidden) return;
      reconnectNow();
    }

    function connect() {
      if (disposed) return;

      const cursor = lastEventIdRef.current;
      const since = lastEventAtRef.current || new Date(Date.now() - 60_000).toISOString();
      const url = cursor
        ? `/api/chat/events?companyId=${encodeURIComponent(company!.id)}&lastEventId=${encodeURIComponent(cursor)}`
        : `/api/chat/events?companyId=${encodeURIComponent(company!.id)}&since=${encodeURIComponent(since)}`;
      eventSource = new EventSource(url);

      const handleEvent = (event: MessageEvent<string>) => {
        try {
          const raw = JSON.parse(event.data);
          const data = raw?.type === "chat.message.created"
            ? raw.payload?.message
            : raw?.type === "chat.progress.updated" || raw?.type === "chat.progress.completed"
              ? raw.payload?.progress
              : raw;
          const sequence = raw?.sequence ?? event.lastEventId;
          if (sequence) setLastEventId(String(sequence));

          if (data?.id && data?.role && data?.agentId) {
            const sessionKey = typeof data.sessionKey === "string" && data.sessionKey.trim()
              ? data.sessionKey.trim()
              : null;
            const channelId = typeof data.channelId === "string" && data.channelId.trim()
              ? data.channelId.trim()
              : null;
            const storeKey = chatConversationStoreKey(sessionKey ?? data.agentId, channelId);
            const message = {
              id: data.id,
              sessionId: data.sessionId,
              agentId: storeKey,
              role: data.role,
              content: data.content,
              metadata: data.metadata,
              createdAt: data.createdAt,
              interrupted: data.interrupted,
            };
            addMessage(message);
            return;
          }

          if (data?.type === "chat_progress" && data.agentId) {
            useActiveChatRunStore.getState().applyProgressEvent(data);
            window.dispatchEvent(new CustomEvent("crewcmd:chat-progress", { detail: data }));
          }
        } catch {
          // Ignore malformed events (pings, etc.)
        }
      };

      eventSource.onmessage = handleEvent;
      eventSource.addEventListener("chat.message.created", handleEvent);
      eventSource.addEventListener("chat.progress.updated", handleEvent);
      eventSource.addEventListener("chat.progress.completed", handleEvent);

      eventSource.onerror = () => {
        // Auto-reconnect after 5s
        closeEventSource();
        scheduleReconnect(5_000);
      };
    }

    connect();
    document.addEventListener("visibilitychange", handleResume);
    window.addEventListener("focus", handleResume);
    window.addEventListener("pageshow", handleResume);

    return () => {
      disposed = true;
      closeEventSource();
      if (reconnectTimer) clearTimeout(reconnectTimer);
      document.removeEventListener("visibilitychange", handleResume);
      window.removeEventListener("focus", handleResume);
      window.removeEventListener("pageshow", handleResume);
    };
  }, [company?.id, addMessage, setLastEventId]);

  return null;
}
