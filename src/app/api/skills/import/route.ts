import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db, withRetry } from "@/db";
import * as schema from "@/db/schema";
import {
  canInstallNativeSkill,
  resolveWorkspaceRuntime,
  withGateway,
} from "@/lib/native-clawhub";
import { normalizeClawhubEntry } from "@/lib/skill-providers/clawhub";
import { resolveAccessibleWorkspace } from "@/lib/workspace";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (!db) {
    return NextResponse.json(
      { error: "Database not available" },
      { status: 503 },
    );
  }

  try {
    const body = await request.json();
    const {
      provider,
      runtimeId,
      source,
      query,
      companyId,
      workspaceId,
      name,
      slug,
      description,
      version,
      sourceUrl,
      content,
      metadata,
      force,
    } = body;

    const effectiveProvider = provider || source;
    if (!effectiveProvider) {
      return NextResponse.json(
        { error: "source is required" },
        { status: 400 },
      );
    }

    const workspace = await resolveAccessibleWorkspace({
      request,
      explicitWorkspaceId: workspaceId ?? null,
      explicitCompanyId: companyId ?? null,
    });
    const resolvedCompanyId = workspace?.companyId ?? companyId ?? null;

    if (!workspace) {
      return NextResponse.json(
        { error: "workspaceId or companyId is required" },
        { status: 400 },
      );
    }

    if (
      metadata !== undefined &&
      (!metadata || typeof metadata !== "object" || Array.isArray(metadata))
    ) {
      return NextResponse.json(
        { error: "metadata must be an object when provided" },
        { status: 400 },
      );
    }

    if (
      effectiveProvider === "clawhub" &&
      typeof slug === "string" &&
      slug.trim()
    ) {
      const native = await installNativeClawhubSkill({
        request,
        workspace,
        runtimeId: typeof runtimeId === "string" ? runtimeId : null,
        slug: slug.trim(),
        version: typeof version === "string" ? version : undefined,
        force: Boolean(force),
        fallback: { name, description, sourceUrl, metadata },
      });
      if (native) return native;
    }

    const skillName = name || query || "Imported Skill";
    const skillSlug =
      slug ||
      skillName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "");

    const [created] = await withRetry(() =>
      db!
        .insert(schema.skills)
        .values({
          workspaceId: workspace.id,
          name: skillName,
          slug: skillSlug,
          description: description || null,
          source: effectiveProvider,
          sourceUrl: sourceUrl || null,
          version: version || null,
          content: content || null,
          companyId: resolvedCompanyId,
          metadata: metadata || {},
          installed: true,
        })
        .returning(),
    );

    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    console.error("[api/skills/import] POST Error:", err);
    return NextResponse.json(
      { error: "Failed to import skill" },
      { status: 500 },
    );
  }
}

function normalizeInstallVersion(version: unknown): string | undefined {
  if (typeof version !== "string") return undefined;
  const trimmed = version.trim();
  if (!trimmed || trimmed === "0.0.0" || trimmed === "v0.0.0") {
    return undefined;
  }
  return trimmed.replace(/^v(?=\d)/i, "");
}

function isVersionNotFoundError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /version not found/i.test(error.message);
}

function isSkillAlreadyExistsError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /skill already exists at /i.test(error.message);
}

function extractExistingSkillPath(error: unknown): string | undefined {
  if (!(error instanceof Error)) return undefined;
  const match = error.message.match(
    /skill already exists at (.+?)(?:\. Re-run|$)/i,
  );
  return match?.[1]?.trim() || undefined;
}

async function installNativeClawhubSkill(params: {
  request: NextRequest;
  workspace: NonNullable<
    Awaited<ReturnType<typeof resolveAccessibleWorkspace>>
  >;
  runtimeId: string | null;
  slug: string;
  version?: string;
  force: boolean;
  fallback: {
    name?: string;
    description?: string;
    sourceUrl?: string;
    metadata?: Record<string, unknown>;
  };
}): Promise<NextResponse | null> {
  if (!(await canInstallNativeSkill(params.request, params.workspace))) {
    return NextResponse.json(
      { error: "Not authorized to install native ClawHub skills" },
      { status: 403 },
    );
  }

  const runtime = await resolveWorkspaceRuntime({
    runtimeId: params.runtimeId,
    workspace: params.workspace,
  });
  if (!runtime?.gatewayUrl) {
    return NextResponse.json(
      { error: "No OpenClaw gateway runtime is available for this workspace" },
      { status: 409 },
    );
  }

  const result = await withGateway(runtime, async (client) => {
    const detail = await client
      .skillsDetail({
        slug: params.slug,
        ...(normalizeInstallVersion(params.version)
          ? { version: normalizeInstallVersion(params.version) }
          : {}),
      })
      .catch(() => null);
    const normalizedDetail =
      detail && typeof detail === "object"
        ? normalizeClawhubEntry(detail)
        : null;
    const requestedVersion = normalizeInstallVersion(params.version);
    const detailVersion = normalizeInstallVersion(normalizedDetail?.version);
    const installVersion = requestedVersion ?? detailVersion;
    const baseInstallParams = {
      source: "clawhub" as const,
      slug: params.slug,
      ...(params.force ? { force: true } : {}),
    };

    try {
      const install = await client.skillsInstall({
        ...baseInstallParams,
        ...(installVersion ? { version: installVersion } : {}),
      });
      return { detail, install };
    } catch (error) {
      if (isSkillAlreadyExistsError(error)) {
        return {
          detail,
          install: {
            ok: true,
            installed: true,
            slug: params.slug,
            version: installVersion,
            path: extractExistingSkillPath(error),
          },
        };
      }
      if (!installVersion || !isVersionNotFoundError(error)) throw error;
      const install = await client.skillsInstall(baseInstallParams);
      return { detail, install };
    }
  });

  const normalized =
    result.detail && typeof result.detail === "object"
      ? normalizeClawhubEntry(result.detail)
      : null;
  const skillName = normalized?.name || params.fallback.name || params.slug;
  const skillVersion =
    result.install.version || normalized?.version || params.version || null;
  const providerMetadata = {
    ...(normalized?.metadata || {}),
    ...(params.fallback.metadata || {}),
    provider: {
      ...(normalized?.metadata?.provider &&
      typeof normalized.metadata.provider === "object"
        ? (normalized.metadata.provider as Record<string, unknown>)
        : {}),
      ...(params.fallback.metadata?.provider &&
      typeof params.fallback.metadata.provider === "object"
        ? (params.fallback.metadata.provider as Record<string, unknown>)
        : {}),
      id: "clawhub",
      skillId: result.install.slug || params.slug,
      version: skillVersion ?? undefined,
      installedAt: new Date().toISOString(),
    },
    native: {
      runtimeId: runtime.id,
      gatewayUrl: runtime.gatewayUrl,
      installPath: result.install.path,
      installStatus:
        (result.install.installed ?? result.install.ok ?? true)
          ? "installed"
          : "unknown",
      warnings: [
        ...(typeof result.install.warning === "string"
          ? [result.install.warning]
          : []),
        ...(Array.isArray(result.install.warnings)
          ? result.install.warnings.filter(
              (item): item is string => typeof item === "string",
            )
          : []),
      ],
    },
    update: {
      ...(normalized?.metadata?.update &&
      typeof normalized.metadata.update === "object"
        ? (normalized.metadata.update as Record<string, unknown>)
        : {}),
      status: "current",
      currentVersion: skillVersion ?? undefined,
      checkedAt: new Date().toISOString(),
    },
  };

  const [existing] = await withRetry(() =>
    db!
      .select()
      .from(schema.skills)
      .where(
        and(
          eq(schema.skills.workspaceId, params.workspace.id),
          eq(schema.skills.slug, params.slug),
        ),
      )
      .limit(1),
  );

  if (existing) {
    const [updated] = await withRetry(() =>
      db!
        .update(schema.skills)
        .set({
          name: skillName,
          description:
            normalized?.description ||
            params.fallback.description ||
            existing.description,
          source: "clawhub",
          sourceUrl:
            normalized?.sourceUrl ||
            params.fallback.sourceUrl ||
            existing.sourceUrl,
          sourceRef: result.install.path || existing.sourceRef,
          version: skillVersion,
          metadata: providerMetadata,
          installed: true,
          updatedAt: new Date(),
        })
        .where(eq(schema.skills.id, existing.id))
        .returning(),
    );
    return NextResponse.json(updated, { status: 200 });
  }

  const [created] = await withRetry(() =>
    db!
      .insert(schema.skills)
      .values({
        workspaceId: params.workspace.id,
        companyId: params.workspace.companyId,
        name: skillName,
        slug: params.slug,
        description:
          normalized?.description || params.fallback.description || null,
        source: "clawhub",
        sourceUrl: normalized?.sourceUrl || params.fallback.sourceUrl || null,
        sourceRef: result.install.path || null,
        version: skillVersion,
        content: null,
        metadata: providerMetadata,
        installed: true,
      })
      .returning(),
  );

  return NextResponse.json(created, { status: 201 });
}
