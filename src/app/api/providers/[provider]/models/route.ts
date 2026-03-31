import { NextRequest, NextResponse } from "next/server";
import { db, withRetry } from "@/db";
import * as schema from "@/db/schema";
import { eq, and } from "drizzle-orm";

export const dynamic = "force-dynamic";

// ─── In-memory cache (1 hour TTL) ──────────────────────────────────

interface CacheEntry {
  models: { id: string; name: string }[];
  fetchedAt: number;
}

const modelCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

function getCached(provider: string, companyId: string): CacheEntry | null {
  const key = `${provider}:${companyId}`;
  const entry = modelCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.fetchedAt > CACHE_TTL_MS) {
    modelCache.delete(key);
    return null;
  }
  return entry;
}

function setCache(provider: string, companyId: string, models: { id: string; name: string }[]) {
  const key = `${provider}:${companyId}`;
  modelCache.set(key, { models, fetchedAt: Date.now() });
}

// ─── Provider-specific model fetchers ──────────────────────────────

const VALID_PROVIDERS = ["anthropic", "openai", "google", "openrouter"] as const;
type Provider = (typeof VALID_PROVIDERS)[number];

async function fetchAnthropicModels(apiKey: string): Promise<{ id: string; name: string }[]> {
  const res = await fetch("https://api.anthropic.com/v1/models", {
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
  });
  if (!res.ok) throw new Error(`Anthropic API error: ${res.status}`);
  const data = await res.json();
  const models = (data.data ?? []) as { id: string; display_name?: string }[];
  return models.map((m) => ({ id: m.id, name: m.display_name ?? m.id }));
}

async function fetchOpenAIModels(apiKey: string): Promise<{ id: string; name: string }[]> {
  const res = await fetch("https://api.openai.com/v1/models", {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) throw new Error(`OpenAI API error: ${res.status}`);
  const data = await res.json();
  const models = (data.data ?? []) as { id: string }[];
  // Filter to chat-relevant models, exclude internal/system models
  return models
    .filter((m) => !m.id.includes(":") && !m.id.startsWith("ft:"))
    .map((m) => ({ id: m.id, name: m.id }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

async function fetchGoogleModels(apiKey: string): Promise<{ id: string; name: string }[]> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`
  );
  if (!res.ok) throw new Error(`Google API error: ${res.status}`);
  const data = await res.json();
  const models = (data.models ?? []) as { name: string; displayName?: string }[];
  return models.map((m) => {
    // name is like "models/gemini-2.5-pro" — extract the model id
    const id = m.name.replace("models/", "");
    return { id, name: m.displayName ?? id };
  });
}

async function fetchOpenRouterModels(apiKey: string): Promise<{ id: string; name: string }[]> {
  const res = await fetch("https://openrouter.ai/api/v1/models", {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) throw new Error(`OpenRouter API error: ${res.status}`);
  const data = await res.json();
  const models = (data.data ?? []) as { id: string; name?: string }[];
  return models.map((m) => ({ id: m.id, name: m.name ?? m.id }));
}

const fetchers: Record<Provider, (apiKey: string) => Promise<{ id: string; name: string }[]>> = {
  anthropic: fetchAnthropicModels,
  openai: fetchOpenAIModels,
  google: fetchGoogleModels,
  openrouter: fetchOpenRouterModels,
};

// ─── Route handler ─────────────────────────────────────────────────

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string }> }
) {
  const { provider } = await params;

  if (!VALID_PROVIDERS.includes(provider as Provider)) {
    return NextResponse.json(
      { error: `Invalid provider: ${provider}. Valid: ${VALID_PROVIDERS.join(", ")}` },
      { status: 400 }
    );
  }

  // Get companyId from query param
  const companyId = request.nextUrl.searchParams.get("companyId");
  if (!companyId) {
    return NextResponse.json({ error: "companyId query parameter is required" }, { status: 400 });
  }

  // Check cache first
  const cached = getCached(provider, companyId);
  if (cached) {
    return NextResponse.json({ models: cached.models, cached: true });
  }

  if (!db) {
    return NextResponse.json({ error: "Database not available" }, { status: 503 });
  }

  try {
    // Look up the company's API key for this provider
    const [providerKey] = await withRetry(() =>
      db!
        .select()
        .from(schema.companyProviderKeys)
        .where(
          and(
            eq(schema.companyProviderKeys.companyId, companyId),
            eq(schema.companyProviderKeys.provider, provider)
          )
        )
        .limit(1)
    );

    if (!providerKey) {
      return NextResponse.json(
        { error: `No API key configured for ${provider}. Add one in Settings > Provider Keys.` },
        { status: 404 }
      );
    }

    // Fetch models from provider API
    const fetcher = fetchers[provider as Provider];
    const models = await fetcher(providerKey.apiKey);

    // Cache the result
    setCache(provider, companyId, models);

    return NextResponse.json({ models, cached: false });
  } catch (err) {
    console.error(`[api/providers/${provider}/models] Error:`, err);
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
