import { create } from "zustand";

/** Session row from the gateway API (GET /api/openclaw/sessions) */
export interface GatewaySessionRow {
  key: string;
  spawnedByKey?: string | null;
  spawnedBy?: string | null;
  kind: string;
  label: string | null;
  derivedTitle: string | null;
  lastMessagePreview: string | null;
  updatedAt: number | string | null;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  model?: string;
  modelProvider?: string;
  sessionId?: string;
}

/** Agent row from the gateway API */
export interface GatewayAgentRow {
  agentId: string;
  name?: string;
  emoji?: string;
  color?: string;
}

/** Normalised session entry used by the UI */
export interface SessionBrowserEntry {
  key: string;
  agentId: string;
  spawnedByKey: string | null;
  kind: string;
  title: string | null;
  lastMessagePreview: string | null;
  updatedAt: number | null;
  totalTokens?: number;
  model?: string;
}

interface SessionBrowserState {
  sessions: SessionBrowserEntry[];
  /** Agents from the gateway — used for emoji/colour lookups */
  agents: GatewayAgentRow[];
  isLoading: boolean;
  lastFetched: number | null;
  selectedSessionKey: string | null;
  error: string | null;

  fetchSessions: () => Promise<void>;
  selectSession: (key: string | null) => void;
  clearSelection: () => void;
  getAgentInfo: (agentId: string) => { emoji: string; name: string; color: string };
  /** Direct children of a session key (spawned by that parent) */
  getChildren: (parentKey: string) => SessionBrowserEntry[];
  /** Top-level sessions (no spawnedByKey or spawnedByKey not in list) with their children */
  getTree: () => Array<{ session: SessionBrowserEntry; children: SessionBrowserEntry[] }>;
}

let fetchAbort: AbortController | null = null;

export const useSessionBrowserStore = create<SessionBrowserState>((set, get) => ({
  sessions: [],
  agents: [],
  isLoading: false,
  lastFetched: null,
  selectedSessionKey: null,
  error: null,

  async fetchSessions() {
    set({ isLoading: true, error: null });
    // Cancel any in-flight request
    if (fetchAbort) fetchAbort.abort();
    fetchAbort = new AbortController();

    try {
      const res = await fetch("/api/openclaw/sessions", {
        signal: fetchAbort.signal,
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const json = await res.json() as {
        sessions: GatewaySessionRow[];
        agents: GatewayAgentRow[];
      };

      const sessions: SessionBrowserEntry[] = (json.sessions ?? []).map((s) => {
        const parsedUpdatedAt =
          typeof s.updatedAt === "number"
            ? s.updatedAt
            : s.updatedAt
              ? Math.floor(Date.parse(s.updatedAt) / 1000)
              : null;

        return {
          key: s.key,
          agentId: s.key.split(":")[0],
          spawnedByKey: s.spawnedByKey ?? s.spawnedBy ?? null,
          kind: s.kind,
          title: s.derivedTitle ?? s.label ?? null,
          lastMessagePreview: s.lastMessagePreview,
          updatedAt: parsedUpdatedAt !== null && Number.isFinite(parsedUpdatedAt)
            ? parsedUpdatedAt
            : null,
          totalTokens: s.totalTokens,
          model: s.model,
        };
      });

      set({
        sessions,
        agents: json.agents ?? [],
        isLoading: false,
        lastFetched: Date.now(),
        error: null,
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      set({
        isLoading: false,
        error: err instanceof Error ? err.message : "Failed to fetch sessions",
      });
    }
  },

  selectSession(key) {
    if (key === get().selectedSessionKey) return;
    set({ selectedSessionKey: key });
  },

  clearSelection() {
    set({ selectedSessionKey: null });
  },

  getAgentInfo(agentId) {
    const a = get().agents.find(
      (x) => x.agentId.toLowerCase() === agentId.toLowerCase()
    );
    return {
      emoji: a?.emoji ?? "💬",
      name: a?.name ?? agentId,
      color: a?.color ?? "#888",
    };
  },

  getChildren(parentKey) {
    return get().sessions.filter(
      (s) => s.spawnedByKey === parentKey
    );
  },

  getTree() {
    const { sessions } = get();
    const sessionKeys = new Set(sessions.map((s) => s.key));

    // Root sessions: no spawnedByKey, or parent not in the list
    const roots = sessions.filter(
      (s) => !s.spawnedByKey || !sessionKeys.has(s.spawnedByKey)
    );

    // Build a map of children for O(1) lookup
    const childrenMap = new Map<string, SessionBrowserEntry[]>();
    for (const s of sessions) {
      if (s.spawnedByKey) {
        const kids = childrenMap.get(s.spawnedByKey) ?? [];
        kids.push(s);
        childrenMap.set(s.spawnedByKey, kids);
      }
    }

    // Sort roots by updatedAt descending
    roots.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));

    return roots.map((r) => ({
      session: r,
      children: (childrenMap.get(r.key) ?? []).sort(
        (a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0)
      ),
    }));
  },
}));
