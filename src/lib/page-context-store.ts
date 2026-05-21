"use client";

import { create } from "zustand";

export type AppPageSurface = "chat" | "tasks" | "inbox" | "projects" | "other";

export type AppPageContext = {
  route: string;
  surface: AppPageSurface;
  title?: string | null;
  entityIds?: {
    taskId?: string | null;
    inboxMessageId?: string | null;
    projectId?: string | null;
    chatSessionKey?: string | null;
  };
  visibleIds?: string[];
  screenText?: string | null;
};

type PageContextStore = {
  context: AppPageContext | null;
  setContext: (context: AppPageContext) => void;
  clearContext: (surface?: AppPageSurface) => void;
};

export const usePageContextStore = create<PageContextStore>((set, get) => ({
  context: null,
  setContext: (context) => set({ context }),
  clearContext: (surface) => {
    if (surface && get().context?.surface !== surface) return;
    set({ context: null });
  },
}));

export function formatPageContextForPrompt(context: AppPageContext | null) {
  if (!context) return null;
  const parts = [
    `Current CrewCMD surface: ${context.surface}`,
    `Current route: ${context.route}`,
  ];
  if (context.title) parts.push(`Screen title: ${context.title}`);
  const entityIds = context.entityIds ?? {};
  if (entityIds.taskId) parts.push(`Selected task ID: ${entityIds.taskId}`);
  if (entityIds.inboxMessageId) parts.push(`Selected inbox message ID: ${entityIds.inboxMessageId}`);
  if (entityIds.projectId) parts.push(`Selected project ID: ${entityIds.projectId}`);
  if (entityIds.chatSessionKey) parts.push(`Chat session key: ${entityIds.chatSessionKey}`);
  if (context.visibleIds?.length) {
    parts.push(`Visible IDs: ${context.visibleIds.slice(0, 20).join(", ")}`);
  }
  if (context.screenText?.trim()) {
    parts.push(`Visible screen text:\n${context.screenText.trim()}`);
  }
  return `CrewCMD page context for this turn:\n${parts.join("\n")}`;
}

export function buildCurrentPageContextForRealtime(maxScreenTextChars = 1800): AppPageContext | null {
  const stored = usePageContextStore.getState().context;
  if (typeof window === "undefined" || typeof document === "undefined") return stored;

  const route = `${window.location.pathname}${window.location.search}`;
  const screenText = readVisibleScreenText(maxScreenTextChars);
  return {
    route: stored?.route ?? route,
    surface: stored?.surface ?? inferSurfaceFromPath(window.location.pathname),
    title: document.title || stored?.title || null,
    entityIds: stored?.entityIds,
    visibleIds: stored?.visibleIds,
    screenText,
  };
}

function inferSurfaceFromPath(pathname: string): AppPageSurface {
  if (pathname.startsWith("/chat")) return "chat";
  if (pathname.startsWith("/tasks")) return "tasks";
  if (pathname.startsWith("/inbox")) return "inbox";
  if (pathname.startsWith("/projects")) return "projects";
  return "other";
}

function readVisibleScreenText(maxChars: number) {
  const root = document.querySelector("main") ?? document.body;
  const text = root?.textContent?.replace(/\s+/g, " ").trim() ?? "";
  if (!text) return null;
  return text.length > maxChars ? `${text.slice(0, maxChars).trim()}...` : text;
}
