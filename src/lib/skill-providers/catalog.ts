import { EVERCONTENT_SKILL_TEMPLATE } from "@/lib/skills/evercontent";

export interface MarketplaceSkill {
  name: string;
  slug: string;
  description: string;
  source: string;
  version: string;
  sourceUrl: string;
  content?: string;
  metadata?: Record<string, unknown>;
}

export const FALLBACK_SKILLS: MarketplaceSkill[] = [
  EVERCONTENT_SKILL_TEMPLATE,
  {
    name: "Weather",
    slug: "weather",
    description:
      "Get current weather conditions and forecasts for any location worldwide.",
    source: "clawhub",
    version: "1.2.0",
    sourceUrl: "https://clawhub.com/skills/weather",
  },
  {
    name: "GitHub",
    slug: "github",
    description:
      "Interact with GitHub repositories: create issues, review PRs, manage branches, and trigger workflows.",
    source: "clawhub",
    version: "2.1.3",
    sourceUrl: "https://clawhub.com/skills/github",
  },
  {
    name: "Slack",
    slug: "slack",
    description:
      "Send messages, read channels, manage threads, and respond to Slack events.",
    source: "clawhub",
    version: "1.4.0",
    sourceUrl: "https://clawhub.com/skills/slack",
  },
  {
    name: "Summarize",
    slug: "summarize",
    description:
      "Summarize long documents, articles, or conversations into concise bullet points.",
    source: "clawhub",
    version: "1.0.2",
    sourceUrl: "https://clawhub.com/skills/summarize",
  },
  {
    name: "XURL",
    slug: "xurl",
    description:
      "Read tweets, post updates, and monitor Twitter/X timelines and mentions.",
    source: "clawhub",
    version: "0.9.1",
    sourceUrl: "https://clawhub.com/skills/xurl",
  },
  {
    name: "Himalaya",
    slug: "himalaya",
    description:
      "Read, send, and manage email across IMAP/SMTP providers via the Himalaya CLI.",
    source: "clawhub",
    version: "1.1.0",
    sourceUrl: "https://clawhub.com/skills/himalaya",
  },
  {
    name: "OpenHue",
    slug: "openhue",
    description:
      "Control Philips Hue smart lights: scenes, colors, brightness, and schedules.",
    source: "clawhub",
    version: "0.8.0",
    sourceUrl: "https://clawhub.com/skills/openhue",
  },
  {
    name: "BlogWatcher",
    slug: "blogwatcher",
    description:
      "Monitor RSS feeds and blogs for new posts, summarize content, and notify on updates.",
    source: "clawhub",
    version: "1.0.0",
    sourceUrl: "https://clawhub.com/skills/blogwatcher",
  },
];

export function filterMarketplaceSkills(
  skills: MarketplaceSkill[],
  query?: string,
  limit?: number,
): MarketplaceSkill[] {
  const normalizedQuery = query?.trim().toLowerCase();
  const filtered = normalizedQuery
    ? skills.filter((skill) =>
        [skill.name, skill.slug, skill.description, skill.source]
          .join(" ")
          .toLowerCase()
          .includes(normalizedQuery),
      )
    : skills;

  return typeof limit === "number" && limit > 0
    ? filtered.slice(0, limit)
    : filtered;
}

export function mergeMarketplaceSkills(
  primary: MarketplaceSkill[],
  fallback: MarketplaceSkill[],
): MarketplaceSkill[] {
  const seen = new Set<string>();
  const merged: MarketplaceSkill[] = [];

  for (const skill of [...primary, ...fallback]) {
    const key = `${skill.source}:${skill.slug}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(skill);
  }

  return merged;
}

export async function resolveMarketplaceSkills(params: {
  provider?: string;
  query?: string;
  limit?: number;
  fetchClawhub?: () => Promise<MarketplaceSkill[] | null>;
}): Promise<MarketplaceSkill[]> {
  const provider = params.provider || "all";
  const remote =
    provider === "all" || provider === "clawhub"
      ? await params.fetchClawhub?.()
      : null;
  const skills =
    remote && remote.length > 0
      ? mergeMarketplaceSkills(remote, FALLBACK_SKILLS)
      : FALLBACK_SKILLS;
  const providerSkills =
    provider === "all"
      ? skills
      : skills.filter((skill) => skill.source === provider);

  return filterMarketplaceSkills(providerSkills, params.query, params.limit);
}
