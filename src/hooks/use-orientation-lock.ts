"use client";

import { useEffect } from "react";

/**
 * Lock screen orientation while active (Screen Orientation API).
 * Prevents rotation from disrupting voice recording / streaming.
 * Falls back gracefully on unsupported browsers.
 */
export function useOrientationLock(active: boolean) {
  useEffect(() => {
    if (!active) return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const orientation = (screen as any).orientation as
      | { lock?: (type: string) => Promise<void>; unlock?: () => void; type?: string }
      | undefined;

    if (!orientation?.lock) return;

    const current = orientation.type || "portrait-primary";
    const lockType = current.startsWith("portrait") ? "portrait" : "landscape";

    let locked = false;
    orientation
      .lock(lockType)
      .then(() => {
        locked = true;
      })
      .catch(() => {
        // Orientation lock requires fullscreen on most browsers, or is
        // simply unsupported — non-critical, other resilience measures apply.
      });

    return () => {
      if (locked && orientation.unlock) {
        try {
          orientation.unlock();
        } catch {
          // Already unlocked or not supported
        }
      }
    };
  }, [active]);
}
