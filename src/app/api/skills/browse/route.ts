import { NextRequest, NextResponse } from "next/server";
import {
  resolveMarketplaceSkills,
  type MarketplaceSkill,
} from "@/lib/skill-providers/catalog";
import {
  fetchClawhubCatalog,
  fetchClawhubCatalogPage,
  getClawhubCatalogConfig,
} from "@/lib/skill-providers/clawhub";
import {
  listNativeClawhubSkills,
  resolveWorkspaceRuntime,
} from "@/lib/native-clawhub";
import { resolveAccessibleWorkspace } from "@/lib/workspace";

export const dynamic = "force-dynamic";

// ─── In-memory cache ─────────────────────────────────────────────────

interface BrowseSkillsResponse {
  skills: MarketplaceSkill[];
  nextCursor?: string | null;
}

const cachedSkills = new Map<
  string,
  { response: BrowseSkillsResponse; timestamp: number }
>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// ─── Route handler ───────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const provider = params.get("provider") || "all";
  const query = params.get("query") || undefined;
  const runtimeId = params.get("runtimeId") || undefined;
  const workspaceId = params.get("workspaceId") || undefined;
  const companyId =
    params.get("companyId") || params.get("company_id") || undefined;
  const limit = parseLimit(params.get("limit"));
  const cursor = params.get("cursor") || undefined;
  const sort = params.get("sort") || (!query ? "downloads" : undefined);
  const config = getClawhubCatalogConfig();
  const cacheKey = JSON.stringify({
    provider,
    query,
    limit,
    cursor,
    sort,
    runtimeId,
    workspaceId,
    companyId,
    clawhubEnabled: config.enabled,
    clawhubUrl: config.registryUrl,
  });
  const now = Date.now();

  const cached = cachedSkills.get(cacheKey);
  if (cached && now - cached.timestamp < CACHE_TTL_MS) {
    return NextResponse.json(cached.response);
  }

  const directClawhub =
    provider === "all" || provider === "clawhub"
      ? await fetchClawhubCatalogPage({ query, limit, cursor, sort, config })
      : null;
  const nativeClawhub = directClawhub
    ? null
    : await fetchNativeClawhubCatalog({
        request,
        provider,
        query,
        limit,
        runtimeId,
        workspaceId,
        companyId,
      });
  const filtered =
    cursor && directClawhub
      ? directClawhub.skills
      : await resolveMarketplaceSkills({
          provider,
          query,
          limit,
          fetchClawhub: async () =>
            directClawhub?.skills ??
            nativeClawhub ??
            fetchClawhubCatalog({ query, limit, sort, config }),
        });
  const response: BrowseSkillsResponse = {
    skills: filtered,
    nextCursor: directClawhub?.nextCursor ?? null,
  };

  cachedSkills.set(cacheKey, { response, timestamp: now });
  return NextResponse.json(response);
}

async function fetchNativeClawhubCatalog(params: {
  request: NextRequest;
  provider: string;
  query?: string;
  limit?: number;
  runtimeId?: string;
  workspaceId?: string;
  companyId?: string;
}): Promise<MarketplaceSkill[] | null> {
  if (params.provider !== "all" && params.provider !== "clawhub") return null;

  try {
    const workspace = await resolveAccessibleWorkspace({
      request: params.request,
      explicitWorkspaceId: params.workspaceId ?? null,
      explicitCompanyId: params.companyId ?? null,
    });
    if (!workspace) return null;

    const runtime = await resolveWorkspaceRuntime({
      runtimeId: params.runtimeId ?? null,
      workspace,
    });
    if (!runtime?.gatewayUrl) return null;

    const { skills } = await listNativeClawhubSkills({
      runtime,
      query: params.query,
      limit: params.limit,
    });
    return skills.length > 0 ? skills : null;
  } catch (error) {
    console.warn(
      "[api/skills/browse] Native ClawHub catalog unavailable:",
      error instanceof Error ? error.message : String(error),
    );
    return null;
  }
}

function parseLimit(value: string | null): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}
