"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useWorkspace } from "@/components/company-context";

type SavedItemStatus = "in_progress" | "archived" | "completed";

type LaterItem = {
  id: string;
  sourceType: "chat_message" | "task" | "approval" | "doc" | "run";
  sourceId: string;
  status: SavedItemStatus;
  title?: string | null;
  note?: string | null;
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, unknown> | null;
  source?: {
    role?: "user" | "assistant" | "system";
    content?: string;
    createdAt?: string;
    agentId?: string;
    gatewaySessionKey?: string | null;
  } | null;
};

const tabs: Array<{ value: SavedItemStatus; label: string }> = [
  { value: "in_progress", label: "In progress" },
  { value: "archived", label: "Archived" },
  { value: "completed", label: "Completed" },
];

function compactDate(value?: string | null) {
  if (!value) return "";
  try {
    return new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  } catch {
    return "";
  }
}

function preview(item: LaterItem) {
  const text = item.source?.content ?? item.title ?? "";
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length > 220 ? `${normalized.slice(0, 217)}...` : normalized;
}

function sourceLabel(item: LaterItem) {
  if (item.sourceType === "chat_message") {
    const agent = metadataString(item, "agentCallsign")?.toUpperCase() ?? item.source?.agentId?.toUpperCase() ?? "CHAT";
    return item.source?.role === "user" ? `Chat / You / ${agent}` : `Chat / ${agent}`;
  }
  return item.sourceType.replace("_", " ");
}

function metadataString(item: LaterItem, key: string) {
  const value = item.metadata?.[key];
  return typeof value === "string" ? value : null;
}

function chatItemUrl(item: LaterItem) {
  if (item.sourceType !== "chat_message") return null;
  const query = new URLSearchParams();
  const agentId = metadataString(item, "agentCallsign") ?? item.source?.agentId ?? metadataString(item, "agentId");
  const sessionKey = metadataString(item, "sessionKey") ?? item.source?.gatewaySessionKey ?? metadataString(item, "gatewaySessionKey");
  if (agentId) query.set("agent", agentId.toLowerCase());
  if (sessionKey) query.set("sessionKey", sessionKey);
  query.set("messageId", item.sourceId);
  return `/chat?${query.toString()}`;
}

export default function LaterPage() {
  const router = useRouter();
  const { workspace, company } = useWorkspace();
  const [activeTab, setActiveTab] = useState<SavedItemStatus>("in_progress");
  const [items, setItems] = useState<LaterItem[]>([]);
  const [loading, setLoading] = useState(true);

  const scopeParams = useMemo(() => {
    const params = new URLSearchParams();
    if (company?.id) params.set("companyId", company.id);
    if (workspace?.id) params.set("workspaceId", workspace.id);
    params.set("status", activeTab);
    return params;
  }, [activeTab, company?.id, workspace?.id]);

  const loadItems = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/saved-items?${scopeParams.toString()}`);
      if (!res.ok) return;
      const data = await res.json() as { items?: LaterItem[] };
      setItems(data.items ?? []);
    } finally {
      setLoading(false);
    }
  }, [scopeParams]);

  useEffect(() => {
    void loadItems();
  }, [loadItems]);

  const updateStatus = async (item: LaterItem, status: SavedItemStatus) => {
    const res = await fetch(`/api/saved-items/${encodeURIComponent(item.id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (res.ok) setItems((prev) => prev.filter((candidate) => candidate.id !== item.id));
  };

  return (
    <div className="flex h-[calc(100dvh_-_var(--mobile-app-bar-height))] flex-col overflow-hidden bg-[var(--bg-primary)] lg:h-dvh">
      <header className="shrink-0 border-b border-[var(--border-subtle)] bg-[var(--bg-primary)]/95 px-4 py-4 backdrop-blur-xl sm:px-6">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-[var(--text-primary)]">Later</h1>
            <p className="mt-1 text-[12px] text-[var(--text-tertiary)]">{items.length} items</p>
          </div>
          <button
            type="button"
            onClick={() => void loadItems()}
            className="rounded-lg border border-[var(--border-medium)] bg-[var(--bg-surface)] px-3 py-1.5 text-[11px] font-medium text-[var(--text-secondary)] transition hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-primary)]"
          >
            Refresh
          </button>
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6">
        <div className="mx-auto max-w-5xl">
          <div className="mb-4 flex gap-1 border-b border-[var(--border-subtle)]">
            {tabs.map((tab) => (
              <button
                key={tab.value}
                type="button"
                onClick={() => setActiveTab(tab.value)}
                className={`border-b-2 px-3 py-2 text-[13px] font-medium transition ${
                  activeTab === tab.value
                    ? "border-[var(--accent)] text-[var(--text-primary)]"
                    : "border-transparent text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {loading ? (
            <div className="py-16 text-center text-[13px] text-[var(--text-tertiary)]">Loading...</div>
          ) : items.length === 0 ? (
            <div className="rounded-xl border border-dashed border-[var(--border-medium)] bg-[var(--bg-surface)] px-6 py-16 text-center text-[13px] text-[var(--text-tertiary)]">
              Nothing here.
            </div>
          ) : (
            <div className="divide-y divide-[var(--border-subtle)] overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
              {items.map((item) => (
                <article
                  key={item.id}
                  role={chatItemUrl(item) ? "button" : undefined}
                  tabIndex={chatItemUrl(item) ? 0 : undefined}
                  onClick={() => {
                    const url = chatItemUrl(item);
                    if (url) router.push(url);
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" && event.key !== " ") return;
                    const url = chatItemUrl(item);
                    if (!url) return;
                    event.preventDefault();
                    router.push(url);
                  }}
                  className={`flex gap-4 px-4 py-4 transition hover:bg-[var(--bg-surface-hover)] sm:px-5 ${
                    chatItemUrl(item) ? "cursor-pointer" : ""
                  }`}
                >
                  <div className="mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[var(--border-medium)] bg-[var(--bg-primary)] text-[11px] font-semibold text-[var(--text-tertiary)]">
                    {item.source?.role === "user" ? "YOU" : "AI"}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-[var(--text-tertiary)]">
                      <span className="font-semibold uppercase tracking-wide text-[var(--text-secondary)]">{sourceLabel(item)}</span>
                      <span>{compactDate(item.source?.createdAt ?? item.createdAt)}</span>
                    </div>
                    <p className="mt-1 text-[13px] leading-relaxed text-[var(--text-primary)]">{preview(item)}</p>
                    {item.note ? <p className="mt-2 text-[12px] text-[var(--text-tertiary)]">{item.note}</p> : null}
                  </div>
                  <div className="flex shrink-0 items-start gap-2">
                    {item.status !== "completed" && (
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          void updateStatus(item, "completed");
                        }}
                        className="rounded-lg border border-[var(--border-medium)] px-2.5 py-1.5 text-[11px] font-medium text-[var(--text-secondary)] transition hover:border-[var(--accent)]/40 hover:text-[var(--accent)]"
                      >
                        Complete
                      </button>
                    )}
                    {item.status !== "archived" && (
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          void updateStatus(item, "archived");
                        }}
                        className="rounded-lg border border-[var(--border-medium)] px-2.5 py-1.5 text-[11px] font-medium text-[var(--text-tertiary)] transition hover:text-[var(--text-secondary)]"
                      >
                        Archive
                      </button>
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
