"use client";

import { createContext, useContext, useEffect, useState, useCallback } from "react";

interface CompanyData {
  id: string;
  name: string;
  logoUrl: string | null;
  settings: Record<string, unknown> | null;
}

export interface WorkspaceData {
  id: string;
  type: "personal" | "company";
  name: string;
  ownerUserId: string | null;
  companyId: string | null;
  companyName: string | null;
  companyLogoUrl: string | null;
  companySettings: Record<string, unknown> | null;
  memberRole: string | null;
}

interface WorkspaceContextType {
  workspace: WorkspaceData | null;
  company: CompanyData | null;
  loading: boolean;
  refresh: () => void;
}

const WorkspaceContext = createContext<WorkspaceContextType>({
  workspace: null,
  company: null,
  loading: true,
  refresh: () => {},
});

function getCookieValue(name: string) {
  if (typeof document === "undefined") return null;
  const cookie = document.cookie
    .split("; ")
    .find((entry) => entry.startsWith(`${name}=`));
  return cookie?.split("=")[1] ?? null;
}

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const [workspace, setWorkspace] = useState<WorkspaceData | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const activeWorkspaceId = getCookieValue("active_workspace");
      const activeCompanyId = getCookieValue("active_company");
      const res = await fetch("/api/workspaces");
      if (!res.ok) {
        setLoading(false);
        return;
      }

      const data = await res.json();
      const items = Array.isArray(data?.workspaces) ? data.workspaces : [];
      const selected =
        items.find((item: WorkspaceData) => item.id === activeWorkspaceId) ??
        items.find((item: WorkspaceData) => item.companyId === activeCompanyId) ??
        items.find((item: WorkspaceData) => item.type === "personal") ??
        items[0] ??
        null;

      if (!activeWorkspaceId && selected?.id) {
        document.cookie = `active_workspace=${selected.id};path=/;max-age=${60 * 60 * 24 * 365}`;
      }
      if (selected?.companyId) {
        document.cookie = `active_company=${selected.companyId};path=/;max-age=${60 * 60 * 24 * 365}`;
      } else if (selected) {
        document.cookie = "active_company=; path=/; max-age=0";
      }

      setWorkspace(selected);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const interval = setInterval(() => {
      const id = getCookieValue("active_workspace");
      if (id && id !== workspace?.id) {
        refresh();
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [workspace?.id, refresh]);

  const company = workspace?.type === "company" && workspace.companyId
    ? {
        id: workspace.companyId,
        name: workspace.companyName || workspace.name,
        logoUrl: workspace.companyLogoUrl || null,
        settings: workspace.companySettings || null,
      }
    : null;

  return (
    <WorkspaceContext.Provider value={{ workspace, company, loading, refresh }}>
      {children}
    </WorkspaceContext.Provider>
  );
}

export const CompanyProvider = WorkspaceProvider;

export function useWorkspace() {
  return useContext(WorkspaceContext);
}

export function useCompany() {
  return useContext(WorkspaceContext);
}
