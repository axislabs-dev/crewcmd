import React from "react";
import {
  AbsoluteFill,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  spring,
  Sequence,
  Easing,
  Img,
  staticFile,
} from "remotion";

// ── Palette ─────────────────────────────────────────────────────
const BG = "#0a0a0f";
const ACCENT = "#00f0ff";
const TEXT = "#f0f0f5";
const TEXT_DIM = "#888899";
const CARD_BG = "rgba(255,255,255,0.04)";
const CARD_BORDER = "rgba(0, 240, 255, 0.2)";
const GREEN = "#00ff88";

// ── Helpers ─────────────────────────────────────────────────────
const useFadeSlide = (delay = 0, distance = 25) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame - delay, [0, 20], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const y = interpolate(frame - delay, [0, 20], [distance, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.ease),
  });
  return { opacity, transform: `translateY(${y}px)` };
};

const Glow: React.FC<{ size?: number; opacity?: number }> = ({
  size = 400,
  opacity = 0.12,
}) => (
  <div
    style={{
      position: "absolute",
      width: size,
      height: size,
      borderRadius: "50%",
      background: `radial-gradient(circle, rgba(0,240,255,${opacity}) 0%, transparent 70%)`,
      filter: "blur(80px)",
    }}
  />
);

// ═══════════════════════════════════════════════════════════════
// SLIDE 1 — HOOK (0–4s, 120 frames)
// "Your team of 3 operates like 30."
// ═══════════════════════════════════════════════════════════════
const HookScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const numberScale = spring({ frame, fps, config: { damping: 12, stiffness: 80 } });
  const lineStyle = useFadeSlide(20);
  const subStyle = useFadeSlide(40);

  return (
    <AbsoluteFill
      style={{
        background: BG,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Glow size={500} opacity={0.15} />

      <div
        style={{
          transform: `scale(${numberScale})`,
          fontSize: 72,
          fontWeight: 800,
          fontFamily: "system-ui, -apple-system, sans-serif",
          color: TEXT,
          letterSpacing: -2,
          textAlign: "center",
          lineHeight: 1.1,
        }}
      >
        Your team of <span style={{ color: ACCENT }}>3</span>
        <br />
        operates like <span style={{ color: ACCENT }}>30</span>.
      </div>

      <div
        style={{
          ...lineStyle,
          fontSize: 18,
          color: TEXT_DIM,
          fontFamily: "system-ui, -apple-system, sans-serif",
          marginTop: 24,
        }}
      >
        Where humans and <span style={{ color: "#ff8800", fontWeight: 600 }}>OpenClaw</span> agents work as one team.
      </div>

      <div
        style={{
          ...subStyle,
          fontSize: 22,
          color: TEXT,
          fontFamily: "system-ui, -apple-system, sans-serif",
          marginTop: 12,
          fontWeight: 600,
        }}
      >
        Crew<span style={{ color: ACCENT, fontWeight: 800 }}>Cmd</span>
      </div>
    </AbsoluteFill>
  );
};

// ═══════════════════════════════════════════════════════════════
// SLIDE 2 — MANAGE PROJECTS (4–8s, 120 frames)
// "One board for everything."
// ═══════════════════════════════════════════════════════════════
const ProjectsScene: React.FC = () => {
  const frame = useCurrentFrame();

  const tasks = [
    { title: "Ship landing page", assignee: "Forge", badge: "AGENT", color: "#ff8800" },
    { title: "Review PR #42", assignee: "Sentinel", badge: "AGENT", color: "#ff00aa" },
    { title: "Approve roadmap", assignee: "You", badge: "HUMAN", color: ACCENT },
    { title: "Deploy to staging", assignee: "Blitz", badge: "AGENT", color: GREEN },
    { title: "Write investor update", assignee: "You", badge: "HUMAN", color: ACCENT },
  ];

  const headingStyle = useFadeSlide(0);
  const subStyle = useFadeSlide(10);

  return (
    <AbsoluteFill
      style={{
        background: BG,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: 50,
      }}
    >
      <Glow size={350} opacity={0.08} />

      <div style={{ ...headingStyle, fontSize: 40, fontWeight: 800, color: TEXT, fontFamily: "system-ui, -apple-system, sans-serif", letterSpacing: -1 }}>
        One board for everything.
      </div>
      <div style={{ ...subStyle, fontSize: 19, color: TEXT_DIM, fontFamily: "system-ui, -apple-system, sans-serif", marginTop: 10 }}>
        Humans and agents. Same tasks. Same workflow.
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 32, width: 560 }}>
        {tasks.map((t, i) => {
          const delay = 18 + i * 8;
          const opacity = interpolate(frame - delay, [0, 14], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          });
          const slideX = interpolate(frame - delay, [0, 14], [-20, 0], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.out(Easing.ease),
          });

          return (
            <div
              key={t.title}
              style={{
                opacity,
                transform: `translateX(${slideX}px)`,
                display: "flex",
                alignItems: "center",
                gap: 12,
                background: CARD_BG,
                border: `1px solid ${CARD_BORDER}`,
                borderRadius: 8,
                padding: "11px 16px",
              }}
            >
              <div style={{ width: 7, height: 7, borderRadius: "50%", background: t.color, flexShrink: 0 }} />
              <div style={{ flex: 1, fontSize: 17, color: TEXT, fontFamily: "system-ui, -apple-system, sans-serif", fontWeight: 500 }}>
                {t.title}
              </div>
              <div style={{ fontSize: 13, color: t.color, fontFamily: "ui-monospace, SFMono-Regular, monospace", fontWeight: 600 }}>
                {t.assignee}
              </div>
              <div
                style={{
                  fontSize: 10,
                  color: t.badge === "HUMAN" ? ACCENT : GREEN,
                  background: t.badge === "HUMAN" ? `${ACCENT}15` : `${GREEN}15`,
                  padding: "2px 8px",
                  borderRadius: 10,
                  fontFamily: "system-ui, -apple-system, sans-serif",
                  fontWeight: 700,
                  letterSpacing: 0.8,
                }}
              >
                {t.badge}
              </div>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

// ═══════════════════════════════════════════════════════════════
// SLIDE 3 — BUILD YOUR TEAM (8–13s, 150 frames)
// "Deploy a full AI team in minutes."
// ═══════════════════════════════════════════════════════════════
const TeamScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const headingStyle = useFadeSlide(0);
  const subStyle = useFadeSlide(10);

  // Zoom into the screenshot for readability
  const imgScale = spring({ frame: frame - 25, fps, config: { damping: 14, stiffness: 70 } });
  const imgOpacity = interpolate(frame - 25, [0, 15], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        background: BG,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: 40,
      }}
    >
      <Glow size={400} opacity={0.1} />

      <div style={{ ...headingStyle, fontSize: 40, fontWeight: 800, color: TEXT, fontFamily: "system-ui, -apple-system, sans-serif", letterSpacing: -1 }}>
        Quickly deploy a team of agents.
      </div>
      <div style={{ ...subStyle, fontSize: 19, color: TEXT_DIM, fontFamily: "system-ui, -apple-system, sans-serif", marginTop: 10 }}>
        Connect your <span style={{ color: "#ff8800", fontWeight: 600 }}>OpenClaw</span> runtime. Org chart, roles, hierarchy.
      </div>

      <div
        style={{
          opacity: imgOpacity,
          transform: `scale(${imgScale})`,
          marginTop: 28,
          borderRadius: 12,
          overflow: "hidden",
          border: `1px solid ${CARD_BORDER}`,
          boxShadow: "0 0 60px rgba(0, 240, 255, 0.08)",
          width: 750,
          height: 340,
          position: "relative",
        }}
      >
        {/* Crop into the interesting part of the org chart */}
        <Img
          src={staticFile("team-org-chart.png")}
          style={{
            width: "120%",
            position: "absolute",
            top: "-5%",
            left: "-10%",
          }}
        />
      </div>
    </AbsoluteFill>
  );
};

// ═══════════════════════════════════════════════════════════════
// SLIDE 4 — SKILLS (13–17s, 120 frames)
// "Give your agents superpowers."
// ═══════════════════════════════════════════════════════════════
const SkillsScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const skills = [
    { name: "Code Review", icon: "🔍", desc: "Auto-review PRs" },
    { name: "Web Scraping", icon: "🌐", desc: "Extract structured data" },
    { name: "Social Media", icon: "📱", desc: "Schedule & post" },
    { name: "Data Analysis", icon: "📊", desc: "Reports & insights" },
    { name: "Email", icon: "✉️", desc: "Draft & respond" },
    { name: "DevOps", icon: "🚀", desc: "Deploy & monitor" },
  ];

  const headingStyle = useFadeSlide(0);
  const subStyle = useFadeSlide(10);

  return (
    <AbsoluteFill
      style={{
        background: BG,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: 50,
      }}
    >
      <Glow size={350} opacity={0.08} />

      <div style={{ ...headingStyle, fontSize: 40, fontWeight: 800, color: TEXT, fontFamily: "system-ui, -apple-system, sans-serif", letterSpacing: -1 }}>
        Give your agents superpowers.
      </div>
      <div style={{ ...subStyle, fontSize: 19, color: TEXT_DIM, fontFamily: "system-ui, -apple-system, sans-serif", marginTop: 10 }}>
        Install skills from the marketplace. Or build your own.
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 14, justifyContent: "center", marginTop: 36, maxWidth: 680 }}>
        {skills.map((s, i) => {
          const delay = 18 + i * 6;
          const cardScale = spring({ frame: frame - delay, fps, config: { damping: 12, stiffness: 100 } });
          const cardOpacity = interpolate(frame - delay, [0, 10], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          });

          return (
            <div
              key={s.name}
              style={{
                opacity: cardOpacity,
                transform: `scale(${cardScale})`,
                background: CARD_BG,
                border: `1px solid ${CARD_BORDER}`,
                borderRadius: 10,
                padding: "16px 20px",
                width: 190,
                textAlign: "center",
              }}
            >
              <div style={{ fontSize: 28, marginBottom: 6 }}>{s.icon}</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: TEXT, fontFamily: "system-ui, -apple-system, sans-serif" }}>
                {s.name}
              </div>
              <div style={{ fontSize: 12, color: TEXT_DIM, fontFamily: "system-ui, -apple-system, sans-serif", marginTop: 2 }}>
                {s.desc}
              </div>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

// ═══════════════════════════════════════════════════════════════
// SLIDE 5 — HANDS-FREE CHAT (17–22s, 150 frames)
// "Talk, don't type. From anywhere."
// ═══════════════════════════════════════════════════════════════
const ChatScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const headingStyle = useFadeSlide(0);
  const subStyle = useFadeSlide(10);

  const phoneScale = spring({ frame: frame - 20, fps, config: { damping: 14, stiffness: 70 } });
  const phoneOpacity = interpolate(frame - 20, [0, 15], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        background: BG,
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 60,
        padding: 60,
      }}
    >
      <Glow size={400} opacity={0.1} />

      {/* Left: text */}
      <div style={{ display: "flex", flexDirection: "column", maxWidth: 400 }}>
        <div style={{ ...headingStyle, fontSize: 40, fontWeight: 800, color: TEXT, fontFamily: "system-ui, -apple-system, sans-serif", letterSpacing: -1, textAlign: "left" }}>
          Talk, don't type.
        </div>
        <div style={{ ...subStyle, fontSize: 19, color: TEXT_DIM, fontFamily: "system-ui, -apple-system, sans-serif", marginTop: 10, textAlign: "left" }}>
          Hands-free voice chat with your agents. From your desk or on the go.
        </div>
      </div>

      {/* Right: phone mockup with screenshot */}
      <div
        style={{
          opacity: phoneOpacity,
          transform: `scale(${phoneScale})`,
          width: 220,
          height: 440,
          borderRadius: 28,
          border: "3px solid rgba(255,255,255,0.15)",
          overflow: "hidden",
          background: "#111",
          boxShadow: "0 0 80px rgba(0, 240, 255, 0.1)",
          position: "relative",
          flexShrink: 0,
        }}
      >
        {/* Notch */}
        <div
          style={{
            position: "absolute",
            top: 0,
            left: "50%",
            transform: "translateX(-50%)",
            width: 80,
            height: 22,
            background: "#000",
            borderRadius: "0 0 14px 14px",
            zIndex: 2,
          }}
        />
        <Img
          src={staticFile("mobile-chat.png")}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
          }}
        />
      </div>
    </AbsoluteFill>
  );
};

// ═══════════════════════════════════════════════════════════════
// SLIDE 6 — SELF-HOSTED (22–26s, 120 frames)
// "Your data. Your rules."
// ═══════════════════════════════════════════════════════════════
const SelfHostedScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const headingStyle = useFadeSlide(0);
  const subStyle = useFadeSlide(12);
  const cmdStyle = useFadeSlide(24);

  const checks = [
    "Open source",
    "Self-hosted",
    "No vendor lock-in",
    "Zero config",
  ];

  return (
    <AbsoluteFill
      style={{
        background: BG,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: 60,
      }}
    >
      <Glow size={400} opacity={0.12} />

      <div style={{ fontSize: 40, marginBottom: 16 }}>🔒</div>

      <div style={{ ...headingStyle, fontSize: 42, fontWeight: 800, color: TEXT, fontFamily: "system-ui, -apple-system, sans-serif", letterSpacing: -1 }}>
        Your data. Your rules.
      </div>

      <div style={{ display: "flex", gap: 24, marginTop: 28 }}>
        {checks.map((c, i) => {
          const delay = 15 + i * 7;
          const opacity = interpolate(frame - delay, [0, 12], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          });

          return (
            <div key={c} style={{ opacity, display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ color: GREEN, fontSize: 16 }}>✓</span>
              <span style={{ color: TEXT, fontSize: 16, fontFamily: "system-ui, -apple-system, sans-serif", fontWeight: 500 }}>{c}</span>
            </div>
          );
        })}
      </div>

      <div
        style={{
          ...cmdStyle,
          marginTop: 28,
          background: "rgba(0, 240, 255, 0.08)",
          border: `1px solid ${CARD_BORDER}`,
          borderRadius: 8,
          padding: "12px 24px",
          fontFamily: "ui-monospace, SFMono-Regular, monospace",
          fontSize: 18,
          color: ACCENT,
        }}
      >
        git clone github.com/axislabs-dev/crewcmd
      </div>
    </AbsoluteFill>
  );
};

// ═══════════════════════════════════════════════════════════════
// SLIDE 7 — LOGO CLOSE (26–30s, 120 frames)
// ═══════════════════════════════════════════════════════════════
const CloseScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const logoScale = spring({ frame, fps, config: { damping: 10, stiffness: 60 } });
  const tagStyle = useFadeSlide(20);
  const glowPulse = interpolate(frame, [0, 90], [0.1, 0.25], { extrapolateRight: "clamp" });

  return (
    <AbsoluteFill
      style={{
        background: BG,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Glow size={500} opacity={glowPulse} />

      <div
        style={{
          transform: `scale(${logoScale})`,
          fontSize: 72,
          fontWeight: 800,
          fontFamily: "system-ui, -apple-system, sans-serif",
          color: TEXT,
          letterSpacing: -3,
        }}
      >
        Crew<span style={{ color: ACCENT }}>Cmd</span>
      </div>

      <div
        style={{
          ...tagStyle,
          fontSize: 20,
          color: TEXT_DIM,
          fontFamily: "system-ui, -apple-system, sans-serif",
          marginTop: 16,
        }}
      >
        Open source. Self-hosted. Your team, your rules.
      </div>
    </AbsoluteFill>
  );
};

// ═══════════════════════════════════════════════════════════════
// Main — 30s = 900 frames at 30fps
// ═══════════════════════════════════════════════════════════════
export const CrewCmdIntro: React.FC = () => {
  return (
    <AbsoluteFill style={{ background: BG }}>
      {/* Slide 1: Hook — 0-4s */}
      <Sequence from={0} durationInFrames={120}>
        <HookScene />
      </Sequence>

      {/* Slide 2: Projects — 4-8s */}
      <Sequence from={120} durationInFrames={120}>
        <ProjectsScene />
      </Sequence>

      {/* Slide 3: Team — 8-13s */}
      <Sequence from={240} durationInFrames={150}>
        <TeamScene />
      </Sequence>

      {/* Slide 4: Skills — 13-17s */}
      <Sequence from={390} durationInFrames={120}>
        <SkillsScene />
      </Sequence>

      {/* Slide 5: Chat — 17-22s */}
      <Sequence from={510} durationInFrames={150}>
        <ChatScene />
      </Sequence>

      {/* Slide 6: Self-hosted — 22-26s */}
      <Sequence from={660} durationInFrames={120}>
        <SelfHostedScene />
      </Sequence>

      {/* Slide 7: Logo close — 26-30s */}
      <Sequence from={780} durationInFrames={120}>
        <CloseScene />
      </Sequence>
    </AbsoluteFill>
  );
};
