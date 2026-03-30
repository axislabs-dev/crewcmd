"use client";

import { useEffect, useState } from "react";

interface WaveformVisualizerProps {
  isActive: boolean;
  color?: string;
}

export function WaveformVisualizer({
  isActive,
  color = "var(--color-neo)",
}: WaveformVisualizerProps) {
  const [bars] = useState(() =>
    Array.from({ length: 24 }, (_, i) => ({
      id: i,
      delay: Math.random() * 0.5,
      speed: 0.3 + Math.random() * 0.4,
    }))
  );

  const [heights, setHeights] = useState<number[]>(bars.map(() => 4));

  useEffect(() => {
    if (!isActive) {
      setHeights(bars.map(() => 4));
      return;
    }

    const interval = setInterval(() => {
      setHeights(
        bars.map(() => {
          const base = 8 + Math.random() * 32;
          return base;
        })
      );
    }, 100);

    return () => clearInterval(interval);
  }, [isActive, bars]);

  return (
    <div className="flex items-center justify-center gap-[3px] h-10">
      {bars.map((bar, i) => (
        <div
          key={bar.id}
          className="w-[3px] rounded-full transition-all"
          style={{
            height: `${heights[i]}px`,
            backgroundColor: color,
            opacity: isActive ? 0.7 : 0.15,
            transitionDuration: `${bar.speed * 200}ms`,
            boxShadow: isActive
              ? `0 0 6px ${color}`
              : "none",
          }}
        />
      ))}
    </div>
  );
}
