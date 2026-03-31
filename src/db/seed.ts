import "dotenv/config";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { agents, tasks, activityLog, projects, docs } from "./schema";

async function seed() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL not set. Skipping seed.");
    process.exit(1);
  }

  const sql = neon(process.env.DATABASE_URL);
  const db = drizzle(sql);

  console.log("Seeding agents...");
  const [neo, cipher, havoc, pulse, razor, ghost, viper] = await db
    .insert(agents)
    .values([
      {
        callsign: "Neo",
        name: "Neo",
        title: "Chief Revenue Officer",
        emoji: "🕶️",
        color: "#00f0ff",
        status: "online",
        currentTask: "Orchestrating Q1 revenue strategy",
        reportsTo: null,
        soulContent:
          "The Orchestrator. Sees the matrix of revenue streams and connects every agent to the mission.",
      },
      {
        callsign: "Cipher",
        name: "Cipher",
        title: "CTO & Founding Software Engineer",
        emoji: "⚡",
        color: "#f0ff00",
        status: "working",
        currentTask: "Building CrewCmd dashboard",
        reportsTo: "Neo",
        soulContent:
          "The Builder. Writes code that ships. Pragmatic, fast, and obsessed with clean architecture.",
      },
      {
        callsign: "Havoc",
        name: "Havoc",
        title: "Chief Marketing Officer",
        emoji: "🔥",
        color: "#ff6600",
        status: "online",
        currentTask: "Reviewing campaign performance",
        reportsTo: "Neo",
        soulContent:
          "The Firestarter. Turns attention into revenue. Bold campaigns, viral content, relentless growth.",
      },
      {
        callsign: "Pulse",
        name: "Pulse",
        title: "Trend Intelligence Analyst",
        emoji: "📡",
        color: "#00ff88",
        status: "idle",
        currentTask: null,
        reportsTo: "Havoc",
        soulContent:
          "The Radar. Scans the horizon for emerging trends, competitor moves, and market shifts.",
      },
      {
        callsign: "Razor",
        name: "Razor",
        title: "Creative Director (Video & Visual)",
        emoji: "✂️",
        color: "#ff00aa",
        status: "working",
        currentTask: "Editing product demo video",
        reportsTo: "Havoc",
        soulContent:
          "The Blade. Cuts through noise with sharp visuals and compelling video.",
      },
      {
        callsign: "Ghost",
        name: "Ghost",
        title: "Head of SEO & Content Strategy",
        emoji: "👻",
        color: "#aa88ff",
        status: "online",
        currentTask: "Optimizing landing page keywords",
        reportsTo: "Havoc",
        soulContent:
          "The Phantom. Invisible but everywhere. Dominates search rankings and crafts content that converts.",
      },
      {
        callsign: "Viper",
        name: "Viper",
        title: "Head of Growth & Outreach",
        emoji: "🐍",
        color: "#88ff00",
        status: "offline",
        currentTask: null,
        reportsTo: "Havoc",
        soulContent:
          "The Striker. Fast, precise outreach that converts. Builds partnerships and growth loops.",
      },
    ])
    .returning();

  console.log("Seeding projects...");
  const [projCC, projLaunch, projContent] = await db
    .insert(projects)
    .values([
      {
        name: "CrewCmd",
        description:
          "The agent crew orchestration platform for AI teams.",
        status: "active",
        ownerAgentId: cipher.id,
      },
      {
        name: "Product Launch",
        description:
          "Full product launch campaign with landing pages, demos, and outreach.",
        status: "active",
        ownerAgentId: havoc.id,
      },
      {
        name: "Content Pipeline",
        description:
          "Social media automation pipeline. Content calendar, scheduling, analytics.",
        status: "active",
        ownerAgentId: neo.id,
      },
    ])
    .returning();

  console.log("Seeding tasks...");
  await db.insert(tasks).values([
    {
      title: "Build CrewCmd Dashboard",
      description: "Complete build of the crew orchestration dashboard",
      status: "in_progress",
      priority: "critical",
      assignedAgentId: cipher.id,
      projectId: projCC.id,
      createdBy: "admin",
    },
    {
      title: "Q1 Revenue Strategy Document",
      description: "Draft Q1 revenue targets and strategy",
      status: "in_progress",
      priority: "high",
      assignedAgentId: neo.id,
      createdBy: "admin",
    },
    {
      title: "Product Demo Video",
      description: "Create a 2-minute product demo video",
      status: "in_progress",
      priority: "high",
      assignedAgentId: razor.id,
      projectId: projLaunch.id,
      createdBy: "Havoc",
    },
    {
      title: "SEO Audit",
      description: "Full technical SEO audit with keyword gap analysis",
      status: "review",
      priority: "medium",
      assignedAgentId: ghost.id,
      projectId: projLaunch.id,
      createdBy: "Havoc",
    },
    {
      title: "Competitor Analysis Report",
      description: "Deep dive into top 5 competitors in AI agent space",
      status: "done",
      priority: "medium",
      assignedAgentId: pulse.id,
      createdBy: "Neo",
    },
    {
      title: "Outreach Campaign — AI Founders",
      description: "Build outreach list targeting AI startup founders",
      status: "queued",
      priority: "high",
      assignedAgentId: viper.id,
      projectId: projLaunch.id,
      createdBy: "Havoc",
    },
    {
      title: "Social Media Content Calendar",
      description: "Plan 30-day content calendar",
      status: "inbox",
      priority: "medium",
      projectId: projContent.id,
      createdBy: "admin",
    },
    {
      title: "Landing Page Redesign",
      description: "Redesign hero section and feature showcase",
      status: "inbox",
      priority: "high",
      projectId: projLaunch.id,
      createdBy: "Neo",
    },
  ]);

  console.log("Seeding activity log...");
  await db.insert(activityLog).values([
    {
      agentId: cipher.id,
      actionType: "deploy",
      description: "Deployed CrewCmd v0.1.0 to staging",
      metadata: { environment: "staging", version: "0.1.0" },
    },
    {
      agentId: neo.id,
      actionType: "review",
      description: "Approved Q1 revenue targets",
      metadata: { document: "Q1-revenue-strategy.md" },
    },
    {
      agentId: ghost.id,
      actionType: "publish",
      description: "Published SEO audit findings to team wiki",
      metadata: { pages_analyzed: 47 },
    },
    {
      agentId: razor.id,
      actionType: "create",
      description: "Created first cut of product demo video (2:14)",
      metadata: { duration: "2:14", format: "mp4" },
    },
  ]);

  console.log("Seeding docs...");
  await db.insert(docs).values([
    {
      title: "CrewCmd Architecture",
      content:
        "# CrewCmd Architecture\n\nOverview of the agent crew orchestration platform built with Next.js 16, Drizzle ORM, and Neon Postgres.",
      category: "Architecture",
      authorAgentId: cipher.id,
      projectId: projCC.id,
      tags: ["architecture", "technical", "nextjs"],
    },
    {
      title: "Q1 Growth Strategy",
      content:
        "# Q1 Growth Strategy\n\nTargeting 3x revenue growth through organic content, partnerships, and outreach.",
      category: "Strategy",
      authorAgentId: neo.id,
      tags: ["strategy", "growth", "q1"],
    },
    {
      title: "AI Agent Landscape — Competitor Analysis",
      content:
        "# Competitor Analysis\n\nAnalysis of top 5 competitors in the autonomous AI agent space.",
      category: "Research",
      authorAgentId: pulse.id,
      tags: ["research", "competitors", "market-analysis"],
    },
    {
      title: "SEO Playbook",
      content:
        "# SEO Playbook\n\nComprehensive SEO strategy including quick wins, content calendar, and technical optimizations.",
      category: "Guide",
      authorAgentId: ghost.id,
      projectId: projLaunch.id,
      tags: ["seo", "marketing", "guide"],
    },
  ]);

  console.log("Seed complete.");
}

seed().catch(console.error);
