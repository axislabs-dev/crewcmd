'use client';

import { useUIMode } from './mode-provider';

/** Renders children only in Pro mode. In Simple mode, optionally shows a simplified alternative. */
export function ProOnly({ children, fallback }: { children: React.ReactNode; fallback?: React.ReactNode }) {
  const { isPro } = useUIMode();
  if (isPro) return <>{children}</>;
  return fallback ? <>{fallback}</> : null;
}

/** Renders children only in Simple mode. */
export function SimpleOnly({ children }: { children: React.ReactNode }) {
  const { mode } = useUIMode();
  return mode === 'simple' ? <>{children}</> : null;
}
