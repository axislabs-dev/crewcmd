"use client";

import { createContext, useContext, useEffect, useState, useCallback } from "react";

interface CompanyData {
  id: string;
  name: string;
  logoUrl: string | null;
}

interface CompanyContextType {
  company: CompanyData | null;
  loading: boolean;
  refresh: () => void;
}

const CompanyContext = createContext<CompanyContextType>({
  company: null,
  loading: true,
  refresh: () => {},
});

export function CompanyProvider({ children }: { children: React.ReactNode }) {
  const [company, setCompany] = useState<CompanyData | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const cookie = document.cookie
        .split("; ")
        .find((c) => c.startsWith("active_company="));
      const companyId = cookie?.split("=")[1];
      if (!companyId) {
        setLoading(false);
        return;
      }

      const res = await fetch(`/api/companies/${companyId}`);
      if (res.ok) {
        const data = await res.json();
        setCompany({
          id: data.id,
          name: data.name,
          logoUrl: data.logoUrl,
        });
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Re-fetch when active_company cookie changes (company switcher)
  useEffect(() => {
    const interval = setInterval(() => {
      const cookie = document.cookie
        .split("; ")
        .find((c) => c.startsWith("active_company="));
      const id = cookie?.split("=")[1];
      if (id && id !== company?.id) {
        refresh();
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [company?.id, refresh]);

  return (
    <CompanyContext.Provider value={{ company, loading, refresh }}>
      {children}
    </CompanyContext.Provider>
  );
}

export function useCompany() {
  return useContext(CompanyContext);
}
