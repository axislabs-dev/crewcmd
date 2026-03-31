'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';

/** UI complexity mode — simple hides technical details, pro shows everything */
type UIMode = 'simple' | 'pro';

/** Context value for the UI mode provider */
interface ModeContextValue {
  /** Current UI complexity mode */
  mode: UIMode;
  /** Set the UI complexity mode */
  setMode: (mode: UIMode) => void;
  /** Convenience flag — true when mode is 'pro' */
  isPro: boolean;
}

const STORAGE_KEY = 'crewcmd-ui-mode';

const ModeContext = createContext<ModeContextValue | null>(null);

/** Provider that manages Simple/Pro UI mode, persisted to localStorage */
export function ModeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = useState<UIMode>('simple');
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'pro' || stored === 'simple') {
      setModeState(stored);
    }
    setHydrated(true);
  }, []);

  const setMode = useCallback((next: UIMode) => {
    setModeState(next);
    localStorage.setItem(STORAGE_KEY, next);
  }, []);

  if (!hydrated) return null;

  return (
    <ModeContext.Provider value={{ mode, setMode, isPro: mode === 'pro' }}>
      {children}
    </ModeContext.Provider>
  );
}

/** Hook to access the current UI mode and toggle between Simple/Pro */
export function useUIMode(): ModeContextValue {
  const ctx = useContext(ModeContext);
  if (!ctx) {
    throw new Error('useUIMode must be used within a ModeProvider');
  }
  return ctx;
}
