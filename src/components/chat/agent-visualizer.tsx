"use client";

import { useEffect, useRef } from "react";
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

type VisualStyleId =
  | "builtin:orbital-reactor"
  | "builtin:neural-constellation"
  | "builtin:hologram-waveform"
  | "builtin:command-core";

type Rgb = [number, number, number];

interface DrawFrame {
  state: AgentVisualState;
  isActive: boolean;
  isRecording: boolean;
  compact: boolean;
  immersive: boolean;
  visualVolume: number;
  motionLevel: number;
  accent: Rgb;
  listening: Rgb;
  speaking: Rgb;
  processing: Rgb;
  intensity: number;
  reducedMotion: boolean;
  time: number;
  width: number;
  height: number;
}

const INTENSITY_SCALE = {
  calm: 0.78,
  balanced: 1,
  vivid: 1.24,
};

const STYLE_LABEL: Record<VisualStyleId, string> = {
  "builtin:orbital-reactor": "Orbital Reactor",
  "builtin:neural-constellation": "Neural Constellation",
  "builtin:hologram-waveform": "Hologram Waveform",
  "builtin:command-core": "Command Core",
};

const clamp = (value: number, min = 0, max = 1) => Math.max(min, Math.min(max, value));

function parseRgb(value: string): Rgb {
  const channels = value
    .split(",")
    .map((channel) => Number.parseInt(channel.trim(), 10))
    .filter((channel) => Number.isFinite(channel));
  if (channels.length < 3) return [99, 183, 170];
  return [clamp(channels[0], 0, 255), clamp(channels[1], 0, 255), clamp(channels[2], 0, 255)] as Rgb;
}

function rgba(color: Rgb, alpha: number) {
  return `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${clamp(alpha)})`;
}

function mix(a: Rgb, b: Rgb, amount: number): Rgb {
  const t = clamp(amount);
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

function stateEnergy(frame: DrawFrame) {
  if (frame.state === "muted") return 0.04;
  if (!frame.isActive && frame.state === "idle") return 0.12;
  if (frame.state === "processing") return 0.44 + frame.motionLevel * 0.35;
  if (frame.state === "speaking") return 0.48 + frame.motionLevel * 0.48;
  if (frame.state === "listening") return 0.24 + frame.visualVolume * 0.68;
  return 0.18 + frame.motionLevel * 0.22;
}

function activeColor(frame: DrawFrame) {
  if (frame.state === "listening") return frame.listening;
  if (frame.state === "speaking") return frame.speaking;
  if (frame.state === "processing") return frame.processing;
  return frame.accent;
}

function setupCanvas(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D) {
  const rect = canvas.getBoundingClientRect();
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(1, Math.floor(rect.width * ratio));
  const height = Math.max(1, Math.floor(rect.height * ratio));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  return { width: rect.width, height: rect.height };
}

function clear(ctx: CanvasRenderingContext2D, width: number, height: number) {
  ctx.clearRect(0, 0, width, height);
}

function line(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  color: string,
  width: number,
) {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.stroke();
}

function circle(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  stroke: string,
  width: number,
  fill?: string,
) {
  ctx.beginPath();
  ctx.arc(x, y, Math.max(0, radius), 0, Math.PI * 2);
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  ctx.strokeStyle = stroke;
  ctx.lineWidth = width;
  ctx.stroke();
}

function arc(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  start: number,
  end: number,
  stroke: string,
  width: number,
) {
  ctx.beginPath();
  ctx.arc(x, y, Math.max(0, radius), start, end);
  ctx.strokeStyle = stroke;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.stroke();
  ctx.lineCap = "butt";
}

function glow(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, color: Rgb, alpha: number) {
  const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
  gradient.addColorStop(0, rgba(color, alpha));
  gradient.addColorStop(0.45, rgba(color, alpha * 0.34));
  gradient.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = gradient;
  ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
}

function drawBackground(ctx: CanvasRenderingContext2D, frame: DrawFrame, base: Rgb, grid = false) {
  const { width, height } = frame;
  const cx = width / 2;
  const cy = height / 2;
  const radius = Math.min(width, height) * (frame.immersive ? 0.47 : 0.48);
  const color = activeColor(frame);
  glow(ctx, cx, cy, radius * 1.12, mix(color, base, 0.62), frame.state === "muted" ? 0.035 : 0.08 + stateEnergy(frame) * 0.07);
  if (!grid || frame.compact) return;
  ctx.save();
  ctx.globalAlpha = frame.state === "muted" ? 0.12 : 0.18;
  ctx.strokeStyle = rgba(base, 0.2);
  ctx.lineWidth = 1;
  const gap = frame.immersive ? 28 : 22;
  for (let x = cx - radius; x <= cx + radius; x += gap) {
    line(ctx, x, cy - radius, x, cy + radius, rgba(base, 0.18), 1);
  }
  for (let y = cy - radius; y <= cy + radius; y += gap) {
    line(ctx, cx - radius, y, cx + radius, y, rgba(base, 0.18), 1);
  }
  ctx.restore();
}

function drawOrbitalReactor(ctx: CanvasRenderingContext2D, frame: DrawFrame) {
  const { width, height, time } = frame;
  const cx = width / 2;
  const cy = height / 2;
  const size = Math.min(width, height);
  const energy = stateEnergy(frame);
  const motion = frame.reducedMotion ? 0 : frame.motionLevel * frame.intensity;
  const accent = activeColor(frame);
  const graphite: Rgb = [38, 43, 48];
  const pearl: Rgb = [236, 241, 240];
  const r = size * (frame.immersive ? 0.36 : 0.34);

  drawBackground(ctx, frame, graphite, true);
  glow(ctx, cx, cy, r * 1.4, accent, frame.state === "muted" ? 0.04 : 0.13 + energy * 0.1);

  const rotation = time * (0.18 + motion * 0.55);
  for (let i = 0; i < 5; i += 1) {
    const radius = r * (0.48 + i * 0.16);
    const alpha = 0.11 + i * 0.035;
    circle(ctx, cx, cy, radius, rgba(i % 2 ? pearl : graphite, alpha), i === 3 ? 1.6 : 1);
  }

  for (let i = 0; i < 9; i += 1) {
    const offset = rotation + i * 0.72;
    const radius = r * (0.57 + (i % 3) * 0.18);
    const length = 0.22 + energy * 0.28 + (i % 2) * 0.08;
    const stroke = i % 3 === 0 ? accent : mix(accent, pearl, 0.42);
    arc(ctx, cx, cy, radius, offset, offset + length, rgba(stroke, 0.22 + energy * 0.48), 2.2 + energy * 2.2);
  }

  for (let i = 0; i < 24; i += 1) {
    const angle = rotation * 0.7 + (i / 24) * Math.PI * 2;
    const radius = r * (0.8 + (i % 4) * 0.045);
    const x = cx + Math.cos(angle) * radius;
    const y = cy + Math.sin(angle) * radius;
    const tick = 6 + (i % 3) * 4 + energy * 10;
    line(ctx, x, y, x + Math.cos(angle) * tick, y + Math.sin(angle) * tick, rgba(pearl, 0.16 + energy * 0.14), 1.2);
  }

  const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 0.34);
  core.addColorStop(0, rgba(mix(accent, pearl, 0.55), frame.state === "muted" ? 0.16 : 0.38));
  core.addColorStop(0.62, rgba(graphite, 0.42));
  core.addColorStop(1, rgba(graphite, 0.05));
  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.arc(cx, cy, r * (0.19 + energy * 0.035), 0, Math.PI * 2);
  ctx.fill();
  circle(ctx, cx, cy, r * (0.21 + energy * 0.03), rgba(pearl, 0.42), 1.7);
}

function drawNeuralConstellation(ctx: CanvasRenderingContext2D, frame: DrawFrame) {
  const { width, height, time } = frame;
  const cx = width / 2;
  const cy = height / 2;
  const size = Math.min(width, height);
  const energy = stateEnergy(frame);
  const motion = frame.reducedMotion ? 0 : frame.motionLevel * frame.intensity;
  const accent = activeColor(frame);
  const ink: Rgb = [20, 28, 38];
  const cool: Rgb = [84, 180, 194];
  const nodes = frame.compact ? 16 : frame.immersive ? 34 : 24;
  const spreadX = size * (frame.immersive ? 0.36 : 0.34);
  const spreadY = size * (frame.immersive ? 0.3 : 0.28);

  drawBackground(ctx, frame, ink, false);

  const points = Array.from({ length: nodes }, (_, i) => {
    const seed = i * 12.9898;
    const lane = i / nodes;
    const angle = lane * Math.PI * 2 + Math.sin(seed) * 0.52;
    const radius = 0.2 + ((i * 37) % 100) / 140;
    const drift = frame.state === "processing" ? -0.08 : 0.045;
    const pulse = Math.sin(time * (0.7 + motion) + i * 0.9) * drift;
    return {
      x: cx + Math.cos(angle) * spreadX * (radius + pulse),
      y: cy + Math.sin(angle * 1.17) * spreadY * (radius + pulse * 0.7),
      rank: (i * 7) % 11,
    };
  });

  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (let i = 0; i < points.length; i += 1) {
    for (let j = i + 1; j < points.length; j += 1) {
      const a = points[i];
      const b = points[j];
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      const distance = Math.hypot(dx, dy);
      const threshold = size * (frame.compact ? 0.19 : 0.16);
      if (distance > threshold) continue;
      const route = frame.state === "processing" ? Math.sin(time * 4 + i * 0.8 + j) * 0.5 + 0.5 : 0.25;
      const alpha = (1 - distance / threshold) * (0.15 + energy * 0.24 + route * 0.18);
      line(ctx, a.x, a.y, b.x, b.y, rgba(route > 0.7 ? accent : cool, alpha), 1 + route * 1.4);
    }
  }

  for (let i = 0; i < points.length; i += 1) {
    const point = points[i];
    const wave = Math.max(0, Math.sin(time * (2.2 + motion * 2.8) - point.rank * 0.75));
    const active = frame.state === "listening" ? wave : frame.state === "speaking" ? 1 - wave * 0.45 : frame.state === "processing" ? wave * 0.9 : 0.28;
    const radius = (frame.compact ? 2.1 : 3.1) + active * energy * (frame.immersive ? 5.8 : 3.8);
    glow(ctx, point.x, point.y, radius * 4.2, accent, active * 0.08);
    circle(ctx, point.x, point.y, radius, rgba(mix(accent, [232, 249, 246], 0.35), 0.42 + active * 0.36), 1, rgba(accent, 0.12 + active * 0.18));
  }
  ctx.restore();

  circle(ctx, cx, cy, size * 0.045, rgba(accent, 0.55), 1.5, rgba(accent, 0.18 + energy * 0.16));
}

function drawHologramWaveform(ctx: CanvasRenderingContext2D, frame: DrawFrame) {
  const { width, height, time } = frame;
  const cx = width / 2;
  const cy = height / 2;
  const size = Math.min(width, height);
  const energy = stateEnergy(frame);
  const motion = frame.reducedMotion ? 0 : frame.motionLevel * frame.intensity;
  const accent = activeColor(frame);
  const cyan: Rgb = [62, 205, 226];
  const violet: Rgb = [102, 116, 210];
  const pearl: Rgb = [240, 250, 255];
  const bandWidth = width * (frame.compact ? 0.86 : 0.72);
  const ribbonCount = frame.compact ? 3 : 5;

  drawBackground(ctx, frame, violet, false);
  glow(ctx, cx, cy, size * 0.36, cyan, frame.state === "muted" ? 0.04 : 0.14 + energy * 0.12);

  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (let layer = 0; layer < ribbonCount; layer += 1) {
    const depth = layer / Math.max(1, ribbonCount - 1);
    const y = cy + (layer - (ribbonCount - 1) / 2) * size * 0.052;
    const amplitude =
      frame.state === "muted"
        ? size * 0.008
        : size * (0.018 + energy * (frame.state === "speaking" ? 0.085 : 0.062)) * (1 - depth * 0.18);
    const phase = time * (1.3 + motion * 2.5 + depth) + depth * 4;
    const layerColor = mix(layer % 2 ? accent : cyan, violet, depth * 0.55);
    const left = cx - bandWidth / 2;
    const right = cx + bandWidth / 2;

    ctx.beginPath();
    for (let step = 0; step <= 96; step += 1) {
      const x = left + (step / 96) * bandWidth;
      const progress = step / 96;
      const envelope = Math.sin(progress * Math.PI);
      const carrier = Math.sin(progress * Math.PI * (4 + layer) + phase);
      const detail = Math.sin(progress * Math.PI * (11 + layer * 2) - phase * 0.74);
      const compression = frame.state === "processing" ? Math.sign(Math.sin(progress * Math.PI * 18 + time * 7)) * 0.38 : 1;
      const yy = y + (carrier * 0.74 + detail * 0.26) * amplitude * envelope * compression;
      if (step === 0) ctx.moveTo(x, yy);
      else ctx.lineTo(x, yy);
    }
    ctx.strokeStyle = rgba(layerColor, 0.26 + energy * 0.34);
    ctx.lineWidth = 1.8 + energy * 3.2 - depth;
    ctx.shadowColor = rgba(layerColor, 0.35);
    ctx.shadowBlur = 18 + energy * 18;
    ctx.stroke();

    ctx.shadowBlur = 0;
    line(ctx, left, y + size * 0.07, right, y + size * 0.07, rgba(pearl, 0.04 + (1 - depth) * 0.04), 1);
  }

  const scanX = cx - bandWidth / 2 + ((time * (0.16 + motion * 0.28)) % 1) * bandWidth;
  const scan = ctx.createLinearGradient(scanX - 18, cy, scanX + 18, cy);
  scan.addColorStop(0, rgba(cyan, 0));
  scan.addColorStop(0.48, rgba(pearl, frame.state === "processing" ? 0.38 : 0.18));
  scan.addColorStop(1, rgba(cyan, 0));
  ctx.fillStyle = scan;
  ctx.fillRect(scanX - 28, cy - size * 0.22, 56, size * 0.44);
  ctx.restore();
}

function drawCommandCore(ctx: CanvasRenderingContext2D, frame: DrawFrame) {
  const { width, height, time } = frame;
  const cx = width / 2;
  const cy = height / 2;
  const size = Math.min(width, height);
  const energy = stateEnergy(frame);
  const motion = frame.reducedMotion ? 0 : frame.motionLevel * frame.intensity;
  const accent = activeColor(frame);
  const amber: Rgb = [228, 174, 84];
  const steel: Rgb = [30, 38, 48];
  const chalk: Rgb = [235, 236, 228];
  const r = size * (frame.immersive ? 0.35 : 0.33);
  const sweep = time * (0.55 + motion * 1.8);

  drawBackground(ctx, frame, steel, true);

  for (let i = 0; i < 4; i += 1) {
    const radius = r * (0.48 + i * 0.16);
    circle(ctx, cx, cy, radius, rgba(i === 2 ? amber : chalk, 0.16 + i * 0.03), 1.2);
  }

  for (let i = 0; i < 28; i += 1) {
    const angle = (i / 28) * Math.PI * 2;
    const hot = frame.state === "listening"
      ? i / 28 < frame.visualVolume
      : frame.state === "processing"
        ? Math.sin(time * 8 + i * 0.6) > 0.35
        : frame.state === "speaking"
          ? Math.sin(angle - sweep) > 0.76
          : false;
    const inner = r * 0.82;
    const outer = r * (hot ? 1.02 : 0.94);
    const color = hot ? accent : chalk;
    line(
      ctx,
      cx + Math.cos(angle) * inner,
      cy + Math.sin(angle) * inner,
      cx + Math.cos(angle) * outer,
      cy + Math.sin(angle) * outer,
      rgba(color, hot ? 0.78 : 0.22),
      hot ? 2.7 : 1.2,
    );
  }

  for (let i = 0; i < 7; i += 1) {
    const angle = sweep * (i % 2 ? -0.55 : 0.8) + i * 0.92;
    const radius = r * (0.52 + (i % 3) * 0.15);
    arc(ctx, cx, cy, radius, angle, angle + 0.32 + energy * 0.38, rgba(i % 2 ? amber : accent, 0.32 + energy * 0.28), 1.8 + energy * 1.5);
  }

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(sweep);
  const beam = ctx.createLinearGradient(0, 0, r, 0);
  beam.addColorStop(0, rgba(accent, 0.34));
  beam.addColorStop(0.62, rgba(accent, 0.12));
  beam.addColorStop(1, rgba(accent, 0));
  ctx.fillStyle = beam;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.arc(0, 0, r, -0.11, 0.11);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  const coreRadius = r * (0.15 + energy * 0.025);
  circle(ctx, cx, cy, coreRadius * 1.6, rgba(chalk, 0.32), 1.2);
  circle(ctx, cx, cy, coreRadius, rgba(accent, 0.72), 1.8, rgba(accent, 0.16 + energy * 0.12));
}

const DRAWERS: Record<VisualStyleId, (ctx: CanvasRenderingContext2D, frame: DrawFrame) => void> = {
  "builtin:orbital-reactor": drawOrbitalReactor,
  "builtin:neural-constellation": drawNeuralConstellation,
  "builtin:hologram-waveform": drawHologramWaveform,
  "builtin:command-core": drawCommandCore,
};

function AgentIdentityCanvas({
  styleId,
  frame,
}: {
  styleId: VisualStyleId;
  frame: Omit<DrawFrame, "time" | "width" | "height" | "reducedMotion">;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const frameRef = useRef(frame);
  const styleRef = useRef(styleId);

  useEffect(() => {
    frameRef.current = frame;
    styleRef.current = styleId;
  }, [frame, styleId]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d", { alpha: true });
    if (!canvas || !ctx) return;

    let animationFrame = 0;
    let start = performance.now();
    let reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updateMotion = () => {
      reducedMotion = motionQuery.matches;
    };
    motionQuery.addEventListener?.("change", updateMotion);

    const resizeObserver = new ResizeObserver(() => {
      setupCanvas(canvas, ctx);
    });
    resizeObserver.observe(canvas);

    const draw = (now: number) => {
      const { width, height } = setupCanvas(canvas, ctx);
      const time = reducedMotion ? 0 : (now - start) / 1000;
      if (reducedMotion) start = now;
      clear(ctx, width, height);
      const nextFrame = {
        ...frameRef.current,
        reducedMotion,
        time,
        width,
        height,
      };
      DRAWERS[styleRef.current](ctx, nextFrame);
      animationFrame = window.requestAnimationFrame(draw);
    };

    animationFrame = window.requestAnimationFrame(draw);
    return () => {
      window.cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      motionQuery.removeEventListener?.("change", updateMotion);
    };
  }, []);

  return <canvas ref={canvasRef} aria-hidden="true" className="absolute inset-0 h-full w-full" />;
}

export function AgentVisualizer({
  state,
  isActive,
  isRecording,
  compact = false,
  immersive = false,
  visualVolume,
  motionLevel,
  activeRgb,
  listeningRgb,
  speakingRgb,
  processingRgb,
  onToggle,
  settings,
  interactive = true,
}: AgentVisualizerProps) {
  const visualSettings = normalizeAgentVisualSettings(settings);
  const styleId = visualSettings.styleId as VisualStyleId;
  const intensity = INTENSITY_SCALE[visualSettings.intensity ?? "balanced"];
  const sizeClass = immersive
    ? "h-[min(78vh,44rem)] w-[min(92vw,44rem)]"
    : compact
      ? "h-[8.5rem] w-[8.5rem] sm:h-[9.5rem] sm:w-[9.5rem]"
      : "h-[12rem] w-full max-w-[18rem]";
  const Wrapper = interactive ? "button" : "div";
  const accent = parseRgb(activeRgb);
  const frame = {
    state,
    isActive,
    isRecording,
    compact,
    immersive,
    visualVolume: clamp(visualVolume),
    motionLevel: clamp(motionLevel),
    accent,
    listening: parseRgb(listeningRgb),
    speaking: parseRgb(speakingRgb),
    processing: parseRgb(processingRgb),
    intensity,
  };

  return (
    <Wrapper
      {...(interactive ? { onClick: onToggle, type: "button" as const } : { role: "presentation" })}
      aria-label={`${STYLE_LABEL[styleId]} agent visualizer`}
      className={`relative flex max-w-full items-center justify-center overflow-visible rounded-full select-none outline-none transition-transform duration-300 hover:scale-[1.01] focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-primary)] ${sizeClass}`}
      style={{ "--tw-ring-color": rgba(accent, 0.5) } as CSSProperties}
    >
      <AgentIdentityCanvas styleId={styleId} frame={frame} />
    </Wrapper>
  );
}
