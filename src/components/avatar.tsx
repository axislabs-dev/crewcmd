"use client";

import { memo } from "react";

interface AvatarProps {
  src?: string | null;
  alt: string;
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  className?: string;
}

const sizeMap: Record<string, string> = {
  xs: "w-5 h-5 text-[8px]",
  sm: "w-8 h-8 text-xs",
  md: "w-10 h-10 text-sm",
  lg: "w-14 h-14 text-xl",
  xl: "w-20 h-20 text-3xl",
};

const badgeSizeMap: Record<string, string> = {
  xs: "w-3 h-3 text-[6px]",
  sm: "w-4 h-4 text-[7px]",
  md: "w-5 h-5 text-[8px]",
  lg: "w-6 h-6 text-[9px]",
  xl: "w-8 h-8 text-xs",
};

function getInitials(name: string): string {
  return name
    .split(/[\s_-]+/)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .slice(0, 2)
    .join("");
}

/**
 * Avatar component that renders either:
 * 1. An image if `src` is provided
 * 2. A fallback circle with initials from `alt`
 *
 * Used for both agents and users throughout the app.
 */
export const Avatar = memo(function Avatar({
  src,
  alt,
  size = "sm",
  className = "",
}: AvatarProps) {
  const containerClass = `${sizeMap[size]} ${className}`;

  if (src) {
    return (
      <div
        className={`relative shrink-0 overflow-hidden rounded-full border border-[var(--border-medium)] bg-[var(--bg-surface)] ${containerClass}`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={alt}
          className="h-full w-full object-cover"
          onError={(e) => {
            // On image error, replace with initials fallback
            const target = e.currentTarget;
            target.style.display = "none";
            const fallback = target.parentElement;
            if (fallback) {
              fallback.innerHTML = getInitials(alt);
              fallback.classList.add(
                "flex",
                "items-center",
                "justify-center",
                "font-mono",
                "font-bold",
                "text-[var(--text-secondary)]",
                "select-none",
              );
            }
          }}
        />
      </div>
    );
  }

  return (
    <div
      className={`flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-[var(--bg-surface-hover)] font-mono font-bold text-[var(--text-tertiary)] select-none ${containerClass}`}
    >
      {getInitials(alt)}
    </div>
  );
});

/**
 * AgentAvatar renders an agent avatar using avatarUrl if available,
 * otherwise the emoji on a colored background.
 */
export const AgentAvatar = memo(function AgentAvatar({
  agent,
  size = "sm",
  className = "",
}: {
  agent: { avatarUrl?: string | null; emoji: string; color: string; callsign: string; name: string };
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  className?: string;
}) {
  const containerSize = sizeMap[size];

  if (agent.avatarUrl) {
    return (
      <div
        className={`relative shrink-0 overflow-hidden rounded-full border border-[var(--border-medium)] bg-[var(--bg-surface)] ${containerSize} ${className}`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={agent.avatarUrl}
          alt={`${agent.callsign} avatar`}
          className="h-full w-full object-cover"
          onError={(e) => {
            const target = e.currentTarget;
            target.style.display = "none";
            const fallback = target.parentElement;
            if (fallback) {
              fallback.innerHTML = agent.emoji;
              fallback.classList.add(
                "flex",
                "items-center",
                "justify-center",
              );
            }
          }}
        />
      </div>
    );
  }

  return (
    <div
      className={`flex shrink-0 items-center justify-center overflow-hidden rounded-lg ${containerSize} ${className}`}
      style={{ backgroundColor: agent.color + "18" }}
    >
      {agent.emoji}
    </div>
  );
});
