import { NextRequest, NextResponse } from "next/server";
import {
  resolveMarketplaceSkills,
  type MarketplaceSkill,
} from "@/lib/skill-providers/catalog";
import { fetchClawhubCatalog, getClawhubCatalogConfig } from "@/lib/skill-providers/clawhub";

export const dynamic = "force-dynamic";

// ─── In-memory cache ─────────────────────────────────────────────────

const cachedSkills = new Map<string, { skills: MarketplaceSkill[]; timestamp: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// ─── Route handler ───────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const provider = params.get("provider") || "all";
  const query = params.get("query") || undefined;
  const limit = parseLimit(params.get("limit"));
  const config = getClawhubCatalogConfig();
  const cacheKey = JSON.stringify({ provider, query, limit, clawhubEnabled: config.enabled, clawhubUrl: config.registryUrl });
  const now = Date.now();

  const cached = cachedSkills.get(cacheKey);
  if (cached && now - cached.timestamp < CACHE_TTL_MS) {
    return NextResponse.json(cached.skills);
  }

  const filtered = await resolveMarketplaceSkills({
    provider,
    query,
    limit,
    fetchClawhub: () => fetchClawhubCatalog({ query, limit, config }),
  });

  cachedSkills.set(cacheKey, { skills: filtered, timestamp: now });
  return NextResponse.json(filtered);
}

function parseLimit(value: string | null): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}
