"use client";

import { create } from "zustand";

export type AppPageSurface = "chat" | "tasks" | "inbox" | "projects" | "other";

export type AppPageContext = {
  route: string;
  surface: AppPageSurface;
  entityIds?: {
    taskId?: string | null;
    inboxMessageId?: string | null;
    projectId?: string | null;
    chatSessionKey?: string | null;
  };
  visibleIds?: string[];
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
  const entityIds = context.entityIds ?? {};
  if (entityIds.taskId) parts.push(`Selected task ID: ${entityIds.taskId}`);
  if (entityIds.inboxMessageId) parts.push(`Selected inbox message ID: ${entityIds.inboxMessageId}`);
  if (entityIds.projectId) parts.push(`Selected project ID: ${entityIds.projectId}`);
  if (entityIds.chatSessionKey) parts.push(`Chat session key: ${entityIds.chatSessionKey}`);
  if (context.visibleIds?.length) {
    parts.push(`Visible IDs: ${context.visibleIds.slice(0, 20).join(", ")}`);
  }
  return `CrewCMD page context for this turn:\n${parts.join("\n")}`;
}
