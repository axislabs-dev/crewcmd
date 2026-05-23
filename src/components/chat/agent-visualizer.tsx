"use client";

import type { CSSProperties } from "react";
import {
  normalizeAgentVisualSettings,
  type AgentVisualSettings,
} from "@/lib/agent-visual-settings";

export type AgentVisualState = "listening" | "processing" | "speaking" | "muted" | "idle";

interface AgentVisualizerProps {
  state: AgentVisualState;
  isActive: boolean;
  isRecording: boolean;
  compact?: boolean;
  immersive?: boolean;
  visualVolume: number;
  motionLevel: number;
  haloSize: number;
  orbScale: number;
  glowStrength: number;
  activeRgb: string;
  listeningRgb: string;
  speakingRgb: string;
  processingRgb: string;
  listeningColor: string;
  speakingColor: string;
  onToggle?: () => void;
  settings?: AgentVisualSettings | null;
  interactive?: boolean;
}

const INTENSITY_SCALE = {
  calm: 0.72,
  balanced: 1,
  vivid: 1.28,
};

export function AgentVisualizer({
  state,
  isActive,
  isRecording,
  compact = false,
  immersive = false,
  visualVolume,
  motionLevel,
  haloSize,
  orbScale,
  glowStrength,
  activeRgb,
  listeningRgb,
  speakingRgb,
  processingRgb,
  listeningColor,
  speakingColor,
  onToggle,
  settings,
  interactive = true,
}: AgentVisualizerProps) {
  const visualSettings = normalizeAgentVisualSettings(settings);
  const styleId = visualSettings.styleId;
  const isOrbitalStyle = styleId === "builtin:orbital-reactor";
  const intensityScale = INTENSITY_SCALE[visualSettings.intensity ?? "balanced"];
  const visualVars = {
    "--voice-accent-rgb": activeRgb,
    "--voice-volume": `${visualVolume}`,
    "--voice-motion": `${motionLevel}`,
    "--voice-intensity": `${intensityScale}`,
  } as CSSProperties;
  const sizeClass = immersive
    ? "voice-agent-reactor-immersive h-[23rem] w-[23rem] sm:h-[28rem] sm:w-[28rem] lg:h-[36rem] lg:w-[36rem]"
    : compact
      ? "h-[7.5rem] w-[7.5rem] sm:h-[8.5rem] sm:w-[8.5rem]"
      : "h-[10rem] w-[10rem] sm:h-[12rem] sm:w-[12rem]";
  const coreClass = immersive
    ? "h-56 w-56 sm:h-72 sm:w-72"
    : compact
      ? "h-16 w-16 sm:h-20 sm:w-20"
      : "h-20 w-20 sm:h-24 sm:w-24";

  const Wrapper = interactive ? "button" : "div";

  return (
    <Wrapper
      {...(interactive ? { onClick: onToggle, type: "button" as const } : { role: "presentation" })}
      className={`voice-agent-reactor relative flex max-w-full items-center justify-center rounded-full select-none transition-transform duration-300 hover:scale-[1.01] ${sizeClass}`}
      style={visualVars}
    >
      <div className={`voice-agent-visual-layer ${compact ? "voice-agent-visual-layer-compact" : ""}`}>
        {styleId === "builtin:neural-constellation" ? (
          <NeuralConstellation compact={compact} immersive={immersive} />
        ) : styleId === "builtin:hologram-waveform" ? (
          <HologramWaveform compact={compact} immersive={immersive} />
        ) : styleId === "builtin:command-core" ? (
          <CommandCore compact={compact} immersive={immersive} />
        ) : (
          <OrbitalReactor compact={compact} immersive={immersive} particleCount={immersive ? 36 : compact ? 18 : 0} />
        )}
      </div>

      <div
        className={`absolute rounded-full blur-3xl transition-all duration-500 ${immersive ? "inset-[2%]" : "inset-[8%]"}`}
        style={{
          background:
            state === "speaking"
              ? `radial-gradient(circle, rgba(${speakingRgb},${0.24 + motionLevel * 0.24}) 0%, transparent 68%)`
              : state === "processing"
                ? `radial-gradient(circle, rgba(${processingRgb},0.18) 0%, transparent 68%)`
                : `radial-gradient(circle, rgba(${activeRgb}, ${glowStrength}) 0%, transparent 68%)`,
        }}
      />

      {isOrbitalStyle ? (
        <OrbitalSharedRings compact={compact} immersive={immersive} />
      ) : null}

      <div
        className={`absolute rounded-full transition-all duration-500 ${isActive ? "opacity-100" : "opacity-0"}`}
        style={{
          width: `${haloSize}px`,
          height: `${haloSize}px`,
          background:
            state === "listening"
              ? `radial-gradient(circle, rgba(${listeningRgb}, ${0.1 + visualVolume * 0.1}) 0%, transparent 70%)`
              : state === "speaking"
                ? `radial-gradient(circle, rgba(${speakingRgb}, ${0.14 + motionLevel * 0.22}) 0%, transparent 70%)`
                : state === "processing"
                  ? `radial-gradient(circle, rgba(${processingRgb}, 0.08) 0%, transparent 70%)`
                  : "none",
        }}
      />

      {isOrbitalStyle ? (
        <div
          className={`voice-agent-core relative flex items-center justify-center rounded-full border transition-all duration-300 ${coreClass} cursor-pointer`}
          style={
            state === "listening"
              ? {
                  borderColor: `rgba(${listeningRgb}, ${0.46 + visualVolume * 0.12})`,
                  background: `radial-gradient(circle, rgba(${listeningRgb}, 0.24), var(--voice-shell-bg-strong) 72%)`,
                  boxShadow: `0 0 ${22 + visualVolume * 18}px rgba(${listeningRgb}, ${0.18 + visualVolume * 0.16})`,
                  transform: `scale(${orbScale})`,
                }
              : state === "speaking"
                ? {
                    borderColor: `rgba(${speakingRgb}, 0.55)`,
                    background: `radial-gradient(circle, rgba(${speakingRgb},0.24), var(--voice-shell-bg-strong) 72%)`,
                    boxShadow:
                      `0 0 ${34 + motionLevel * 24}px rgba(${speakingRgb}, ${0.25 + motionLevel * 0.1}), 0 0 ${64 + motionLevel * 42}px rgba(${speakingRgb}, ${0.1 + motionLevel * 0.08})`,
                    transform: `scale(${orbScale})`,
                  }
                : state === "processing"
                  ? {
                      borderColor: `rgba(${processingRgb}, 0.45)`,
                      background: `radial-gradient(circle, rgba(${processingRgb},0.2), var(--voice-shell-bg-strong) 72%)`,
                      boxShadow: `0 0 20px rgba(${processingRgb}, 0.15)`,
                    }
                  : {
                      background: "radial-gradient(circle, color-mix(in srgb, var(--voice-shell-highlight) 90%, transparent), var(--voice-shell-bg-strong) 72%)",
                    }
          }
        >
          {immersive || compact ? (
            <div className="voice-agent-orbital-core">
              <div className="voice-agent-core-grid" />
              <div className="voice-agent-core-lattice" />
              <div className="voice-agent-core-pulse" />
              <div className="voice-agent-core-highlight" />
            </div>
          ) : (
            <StateIcon
              state={state}
              compact={compact}
              isRecording={isRecording}
              listeningColor={listeningColor}
              speakingColor={speakingColor}
              listeningRgb={listeningRgb}
              processingRgb={processingRgb}
            />
          )}
        </div>
      ) : null}
    </Wrapper>
  );
}

function OrbitalReactor({ compact, immersive, particleCount }: { compact: boolean; immersive: boolean; particleCount: number }) {
  const usesOrbitalVisual = immersive || compact;
  if (!usesOrbitalVisual) return null;
  return (
    <>
      <div className="voice-agent-aura voice-agent-aura-outer" />
      <div className="voice-agent-aura voice-agent-aura-inner" />
      <div className="voice-agent-orbit-shell" />
      <div className="voice-agent-orbit-shell voice-agent-orbit-shell-reverse" />
      <div className="voice-agent-spectrum" />
      <div className="voice-agent-spectrum voice-agent-spectrum-inner" />
      <div className="voice-agent-particle-cloud">
        {Array.from({ length: particleCount }).map((_, i) => (
          <span
            key={i}
            className="voice-agent-particle"
            style={
              {
                "--particle-angle": `${(360 / particleCount) * i}deg`,
                "--particle-delay": `${(i % 12) * 0.18}s`,
                "--particle-duration": `${6 + (i % 5) * 0.7}s`,
                "--particle-radius": `${47 + (i % 7) * 1.5}%`,
              } as CSSProperties
            }
          />
        ))}
      </div>
    </>
  );
}

function OrbitalSharedRings({ compact, immersive }: { compact: boolean; immersive: boolean }) {
  const usesOrbitalVisual = immersive || compact;
  return (
    <>
      <div className={`voice-agent-ring voice-agent-ring-outer ${usesOrbitalVisual ? "voice-agent-ring-immersive" : ""}`} />
      <div className={`voice-agent-ring voice-agent-ring-middle ${usesOrbitalVisual ? "voice-agent-ring-immersive" : ""}`} />
      <div className={`voice-agent-ring voice-agent-ring-inner ${usesOrbitalVisual ? "voice-agent-ring-immersive" : ""}`} />
      <div className={`voice-agent-grid ${usesOrbitalVisual ? "voice-agent-grid-immersive" : ""}`} />
    </>
  );
}

function NeuralConstellation({ compact, immersive }: { compact: boolean; immersive: boolean }) {
  const nodeCount = immersive ? 28 : compact ? 14 : 20;
  return (
    <div className="voice-visual-neural" aria-hidden="true">
      <div className="voice-visual-neural-field" />
      <div className="voice-visual-neural-links" />
      {immersive ? <div className="voice-visual-neural-links voice-visual-neural-links-back" /> : null}
      {Array.from({ length: nodeCount }).map((_, i) => (
        <span
          key={i}
          className="voice-visual-neural-node"
          style={
            {
              "--node-angle": `${(360 / nodeCount) * i + (i % 3) * 11}deg`,
              "--node-radius": `${compact ? 32 + (i % 5) * 4.5 : 31 + (i % 8) * 5}%`,
              "--node-size": `${compact ? 4 + (i % 3) : 5 + (i % 4)}px`,
              "--node-delay": `${(i % 9) * 0.16}s`,
            } as CSSProperties
          }
        />
      ))}
    </div>
  );
}

function HologramWaveform({ compact, immersive }: { compact: boolean; immersive: boolean }) {
  const ribbons = immersive ? 5 : compact ? 3 : 4;
  return (
    <div className="voice-visual-hologram" aria-hidden="true">
      <div className="voice-visual-hologram-scan" />
      {Array.from({ length: ribbons }).map((_, i) => (
        <span
          key={i}
          className="voice-visual-hologram-ribbon"
          style={
            {
              "--ribbon-index": `${i}`,
              "--ribbon-offset": `${(i - (ribbons - 1) / 2) * (compact ? 8 : 13)}px`,
              "--ribbon-delay": `${i * 0.11}s`,
            } as CSSProperties
          }
        />
      ))}
      <div className="voice-visual-hologram-reflection" />
    </div>
  );
}

function CommandCore({ compact, immersive }: { compact: boolean; immersive: boolean }) {
  const tickCount = immersive ? 16 : compact ? 8 : 12;
  return (
    <div className="voice-visual-command" aria-hidden="true">
      <div className="voice-visual-command-grid" />
      <div className="voice-visual-command-ring voice-visual-command-ring-outer" />
      <div className="voice-visual-command-ring voice-visual-command-ring-mid" />
      <div className="voice-visual-command-ring voice-visual-command-ring-inner" />
      <div className="voice-visual-command-scan" />
      {Array.from({ length: tickCount }).map((_, i) => (
        <span
          key={i}
          className="voice-visual-command-tick"
          style={
            {
              "--tick-angle": `${(360 / tickCount) * i}deg`,
              "--tick-delay": `${(i % 8) * 0.08}s`,
            } as CSSProperties
          }
        />
      ))}
    </div>
  );
}

function StateIcon({
  state,
  compact,
  isRecording,
  listeningColor,
  speakingColor,
  listeningRgb,
  processingRgb,
}: {
  state: AgentVisualState;
  compact: boolean;
  isRecording: boolean;
  listeningColor: string;
  speakingColor: string;
  listeningRgb: string;
  processingRgb: string;
}) {
  const iconClass = compact ? "h-7 w-7" : "h-10 w-10 sm:h-12 sm:w-12";
  if (state === "idle") {
    return (
      <svg className={`${iconClass} text-[var(--text-tertiary)]`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M5.636 5.636a9 9 0 1 0 12.728 0M12 3v9" />
      </svg>
    );
  }
  if (state === "muted") {
    return (
      <svg className={`${iconClass} text-[var(--text-tertiary)]`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 9.75V4.5a3 3 0 0 0-5.68-1.35M9 9.75v3a3 3 0 0 0 5.12 2.12M18 10.5v2.25a6 6 0 0 1-9.65 4.76M6 10.5v2.25c0 .9.2 1.75.56 2.51M12 18.75v3.75m-3.75 0h7.5M3 3l18 18" />
      </svg>
    );
  }
  if (state === "listening") {
    return (
      <>
        <svg className={iconClass} fill="none" viewBox="0 0 24 24" stroke={listeningColor} strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 0 0 6-6v-1.5m-6 7.5a6 6 0 0 1-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 0 1-3-3V4.5a3 3 0 1 1 6 0v8.25a3 3 0 0 1-3 3Z" />
        </svg>
        {isRecording && <span className="absolute inset-0 rounded-full border animate-ping" style={{ borderColor: `rgba(${listeningRgb}, 0.45)` }} />}
      </>
    );
  }
  if (state === "processing") {
    return (
      <div className="flex items-center gap-1.5">
        <span className="h-2 w-2 rounded-full animate-pulse" style={{ backgroundColor: `rgba(${processingRgb}, 0.68)` }} />
        <span className="h-2 w-2 rounded-full animate-pulse" style={{ backgroundColor: `rgba(${processingRgb}, 0.68)`, animationDelay: "0.15s" }} />
        <span className="h-2 w-2 rounded-full animate-pulse" style={{ backgroundColor: `rgba(${processingRgb}, 0.68)`, animationDelay: "0.3s" }} />
      </div>
    );
  }
  return (
    <svg className={iconClass} fill="none" viewBox="0 0 24 24" stroke={speakingColor} strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.114 5.636a9 9 0 0 1 0 12.728M16.463 8.288a5.25 5.25 0 0 1 0 7.424M6.75 8.25l4.72-4.72a.75.75 0 0 1 1.28.53v15.88a.75.75 0 0 1-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.009 9.009 0 0 1 2.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75Z" />
    </svg>
  );
}
