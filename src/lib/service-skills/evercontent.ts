import type { ServiceSkillHandler } from "@/lib/service-skills";

const EVERCONTENT_BASE_URL = "https://app.evercontent.io";

interface EverContentConfig {
  defaultCustomerId?: string;
  defaultProjectId?: string;
  allowedCustomerIds?: string[];
  allowedProjectIds?: string[];
  canPublish?: boolean;
  __resolvedSecret?: string;
}

function asConfig(config: Record<string, unknown>): EverContentConfig {
  return {
    defaultCustomerId: typeof config.defaultCustomerId === "string" ? config.defaultCustomerId : undefined,
    defaultProjectId: typeof config.defaultProjectId === "string" ? config.defaultProjectId : undefined,
    allowedCustomerIds: Array.isArray(config.allowedCustomerIds)
      ? config.allowedCustomerIds.filter((value): value is string => typeof value === "string")
      : undefined,
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

function resolveCustomerId(input: Record<string, unknown> | undefined, config: EverContentConfig): string {
  const customerId = typeof input?.customerId === "string" ? input.customerId : config.defaultCustomerId;
  if (!customerId) {
    throw new Error("customerId is required");
  }

  if (config.allowedCustomerIds?.length && !config.allowedCustomerIds.includes(customerId)) {
    throw new Error(`customerId ${customerId} is outside the allowed customer scope`);
  }

  return customerId;
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
      "x-api-key": config.__resolvedSecret,
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
        const customerId = typeof input?.customerId === "string" || config.defaultCustomerId
          ? resolveCustomerId(input, config)
          : null;

        if (customerId) {
          return request(config, `/api/customer/projects?customerId=${encodeURIComponent(customerId)}`);
        }

        return request(config, "/api/projects");
      }

      case "posts.list": {
        const projectId = resolveProjectId(input, config);
        return request(config, `/api/projects/${encodeURIComponent(projectId)}/posts`);
      }

      case "posts.get": {
        const projectId = resolveProjectId(input, config);
        const postId = requireString(input?.postId, "postId");
        return request(config, `/api/projects/${encodeURIComponent(projectId)}/posts/${encodeURIComponent(postId)}`);
      }

      case "posts.create": {
        const projectId = resolveProjectId(input, config);
        const title = requireString(input?.title, "title");
        const payload = {
          title,
          brief: typeof input?.brief === "string" ? input.brief : "",
          contentMarkdown: typeof input?.contentMarkdown === "string" ? input.contentMarkdown : "",
          keywords: Array.isArray(input?.keywords) ? input.keywords.filter((value): value is string => typeof value === "string") : [],
        };

        return request(config, `/api/projects/${encodeURIComponent(projectId)}/posts`, {
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
