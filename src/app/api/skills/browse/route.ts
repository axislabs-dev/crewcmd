import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

interface MarketplaceSkill {
  name: string;
  slug: string;
  description: string;
  source: string;
  version: string;
  sourceUrl: string;
}

const MARKETPLACE_SKILLS: MarketplaceSkill[] = [
  // ClawHub skills
  {
    name: "Weather",
    slug: "weather",
    description: "Get current weather conditions and forecasts for any location worldwide.",
    source: "clawhub",
    version: "1.2.0",
    sourceUrl: "https://clawhub.com/skills/weather",
  },
  {
    name: "GitHub",
    slug: "github",
    description: "Interact with GitHub repositories: create issues, review PRs, manage branches, and trigger workflows.",
    source: "clawhub",
    version: "2.1.3",
    sourceUrl: "https://clawhub.com/skills/github",
  },
  {
    name: "Slack",
    slug: "slack",
    description: "Send messages, read channels, manage threads, and respond to Slack events.",
    source: "clawhub",
    version: "1.4.0",
    sourceUrl: "https://clawhub.com/skills/slack",
  },
  {
    name: "Summarize",
    slug: "summarize",
    description: "Summarize long documents, articles, or conversations into concise bullet points.",
    source: "clawhub",
    version: "1.0.2",
    sourceUrl: "https://clawhub.com/skills/summarize",
  },
  {
    name: "XURL",
    slug: "xurl",
    description: "Read tweets, post updates, and monitor Twitter/X timelines and mentions.",
    source: "clawhub",
    version: "0.9.1",
    sourceUrl: "https://clawhub.com/skills/xurl",
  },
  {
    name: "Himalaya",
    slug: "himalaya",
    description: "Read, send, and manage email across IMAP/SMTP providers via the Himalaya CLI.",
    source: "clawhub",
    version: "1.1.0",
    sourceUrl: "https://clawhub.com/skills/himalaya",
  },
  {
    name: "OpenHue",
    slug: "openhue",
    description: "Control Philips Hue smart lights: scenes, colors, brightness, and schedules.",
    source: "clawhub",
    version: "0.8.0",
    sourceUrl: "https://clawhub.com/skills/openhue",
  },
  {
    name: "BlogWatcher",
    slug: "blogwatcher",
    description: "Monitor RSS feeds and blogs for new posts, summarize content, and notify on updates.",
    source: "clawhub",
    version: "1.0.0",
    sourceUrl: "https://clawhub.com/skills/blogwatcher",
  },

  // skills.sh skills
  {
    name: "Web Search",
    slug: "web-search",
    description: "Search the web using multiple engines and return structured results with snippets.",
    source: "skills_sh",
    version: "2.0.1",
    sourceUrl: "https://skills.sh/web-search",
  },
  {
    name: "Code Review",
    slug: "code-review",
    description: "Analyze code diffs for bugs, style issues, security vulnerabilities, and performance concerns.",
    source: "skills_sh",
    version: "1.3.0",
    sourceUrl: "https://skills.sh/code-review",
  },
  {
    name: "Deploy",
    slug: "deploy",
    description: "Deploy applications to Vercel, Fly.io, Railway, or any Docker-compatible platform.",
    source: "skills_sh",
    version: "1.1.2",
    sourceUrl: "https://skills.sh/deploy",
  },
  {
    name: "Testing",
    slug: "testing",
    description: "Generate and run test suites for JavaScript, TypeScript, Python, and Go projects.",
    source: "skills_sh",
    version: "1.5.0",
    sourceUrl: "https://skills.sh/testing",
  },
  {
    name: "Docs Writer",
    slug: "docs-writer",
    description: "Generate documentation from code: READMEs, API docs, changelogs, and architecture guides.",
    source: "skills_sh",
    version: "1.0.4",
    sourceUrl: "https://skills.sh/docs-writer",
  },

  // GitHub community skills
  {
    name: "SQL Query",
    slug: "sql-query",
    description: "Execute SQL queries against PostgreSQL, MySQL, and SQLite databases safely.",
    source: "github",
    version: "0.7.2",
    sourceUrl: "https://github.com/community-skills/sql-query",
  },
  {
    name: "Image Gen",
    slug: "image-gen",
    description: "Generate images using DALL-E, Stable Diffusion, or Midjourney APIs.",
    source: "github",
    version: "1.2.0",
    sourceUrl: "https://github.com/community-skills/image-gen",
  },
  {
    name: "PDF Parser",
    slug: "pdf-parser",
    description: "Extract text, tables, and metadata from PDF documents for analysis.",
    source: "github",
    version: "0.5.1",
    sourceUrl: "https://github.com/community-skills/pdf-parser",
  },
  {
    name: "Calendar",
    slug: "calendar",
    description: "Manage Google Calendar events: create, update, query, and send invites.",
    source: "github",
    version: "1.0.0",
    sourceUrl: "https://github.com/community-skills/calendar",
  },
  {
    name: "Notion Sync",
    slug: "notion-sync",
    description: "Read and write Notion pages, databases, and blocks for knowledge management.",
    source: "github",
    version: "0.9.0",
    sourceUrl: "https://github.com/community-skills/notion-sync",
  },
];

export async function GET() {
  return NextResponse.json(MARKETPLACE_SKILLS);
}
