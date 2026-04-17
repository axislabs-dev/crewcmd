import type { ServiceSkillHandler } from "@/lib/service-skills";

const EVERCONTENT_BASE_URL = "https://app.evercontent.io";

interface EverContentConfig {
  defaultProjectId?: string;
  allowedProjectIds?: string[];
  canPublish?: boolean;
  __resolvedSecret?: string;
}

function asConfig(config: Record<string, unknown>): EverContentConfig {
  return {
    defaultProjectId: typeof config.defaultProjectId === "string" ? config.defaultProjectId : undefined,
    allowedProjectIds: Array.isArray(config.allowedProjectIds)
      ? config.allowedProjectIds.filter((value): value is string => typeof value === "string")
      : undefined,
    canPublish: config.canPublish === true,
    __resolvedSecret: typeof config.__resolvedSecret === "string" ? config.__resolvedSecret : undefined,
  };
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${field} is required`);
  }
  return value.trim();
}

function resolveProjectId(input: Record<string, unknown> | undefined, config: EverContentConfig): string {
  const projectId = typeof input?.projectId === "string" ? input.projectId : config.defaultProjectId;
  if (!projectId) {
    throw new Error("projectId is required");
  }

  if (config.allowedProjectIds?.length && !config.allowedProjectIds.includes(projectId)) {
    throw new Error(`projectId ${projectId} is outside the allowed project scope`);
  }

  return projectId;
}

async function request(
  config: EverContentConfig,
  path: string,
  init?: RequestInit
): Promise<unknown> {
  if (!config.__resolvedSecret) throw new Error("EverContent config.secretRef could not be resolved");

  const response = await fetch(new URL(path, EVERCONTENT_BASE_URL).toString(), {
    ...init,
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${config.__resolvedSecret}`,
      ...(init?.headers || {}),
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`EverContent request failed (${response.status}): ${body || response.statusText}`);
  }

  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return response.json();
  }

  return response.text();
}

export const evercontentServiceSkillHandler: ServiceSkillHandler = {
  async invoke(action, input, context) {
    const config = asConfig(context.config);

    switch (action) {
      case "projects.list": {
        return request(config, "/api/v1/projects");
      }

      case "posts.list": {
        const projectId = resolveProjectId(input, config);
        return request(config, `/api/v1/posts?projectId=${encodeURIComponent(projectId)}`);
      }

      case "posts.get": {
        const postId = requireString(input?.postId, "postId");
        return request(config, `/api/v1/posts/${encodeURIComponent(postId)}`);
      }

      case "posts.create": {
        const projectId = resolveProjectId(input, config);
        const title = requireString(input?.title, "title");
        const content = typeof input?.content === "string"
          ? input.content
          : typeof input?.contentMarkdown === "string"
            ? input.contentMarkdown
            : "";

        if (!content.trim()) {
          throw new Error("content is required");
        }

        const payload = {
          projectId,
          title,
          content,
          excerpt: typeof input?.excerpt === "string"
            ? input.excerpt
            : typeof input?.brief === "string"
              ? input.brief
              : "",
          slug: typeof input?.slug === "string" ? input.slug : undefined,
          featuredImageUrl: typeof input?.featuredImageUrl === "string" ? input.featuredImageUrl : undefined,
          seoMeta: typeof input?.seoMeta === "object" && input?.seoMeta !== null ? input.seoMeta : undefined,
          status: "draft",
          topicId: typeof input?.topicId === "string" ? input.topicId : undefined,
        };

        return request(config, "/api/v1/posts", {
          method: "POST",
          body: JSON.stringify(payload),
        });
      }

      case "posts.publish": {
        if (!config.canPublish) {
          throw new Error("Publishing is disabled for this EverContent skill assignment");
        }

        const postId = requireString(input?.postId, "postId");
        return request(config, `/api/v1/posts/${encodeURIComponent(postId)}/publish`, {
          method: "POST",
          body: JSON.stringify({}),
        });
      }

      default:
        throw new Error(`Unsupported EverContent action: ${action}`);
    }
  },
};
