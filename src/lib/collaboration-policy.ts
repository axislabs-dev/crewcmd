export const SCOPE_TYPES = {
  PRIVATE_USER: "private:user",
  DM: "dm",
  CHANNEL: "channel",
  PROJECT: "project",
  TEAM: "team",
  ORG: "org",
} as const;

export type ScopeType = (typeof SCOPE_TYPES)[keyof typeof SCOPE_TYPES];

export const SHARED_SCOPE_TYPES = [
  SCOPE_TYPES.DM,
  SCOPE_TYPES.CHANNEL,
  SCOPE_TYPES.PROJECT,
  SCOPE_TYPES.TEAM,
  SCOPE_TYPES.ORG,
] as const satisfies readonly ScopeType[];

export const RUNTIME_CLASSES = {
  PERSONAL: "personal",
  SHARED: "shared",
} as const;

export type RuntimeClass = (typeof RUNTIME_CLASSES)[keyof typeof RUNTIME_CLASSES];

export const SCOPE_ROLES = {
  OWNER: "owner",
  ADMIN: "admin",
  MEMBER: "member",
  GUEST: "guest",
} as const;

export type ScopeRole = (typeof SCOPE_ROLES)[keyof typeof SCOPE_ROLES];

export type ActorType = "user" | "agent" | "system";

export type Actor = {
  id: string;
  type: ActorType;
  userId?: string;
  roles?: readonly ScopeRole[];
  scopeIds?: readonly string[];
};

export type Scope = {
  id: string;
  type: ScopeType;
  ownerUserId?: string;
  memberIds?: readonly string[];
  agentIds?: readonly string[];
};

export type Resource = {
  id: string;
  type: string;
  scope?: Scope | null;
  scopeId?: string | null;
  scopeType?: ScopeType | null;
  ownerUserId?: string | null;
};

export type RuntimeBindingTarget = {
  id: string;
  class: RuntimeClass;
  ownerUserId?: string | null;
};

export type AgentPrincipal = {
  id: string;
  ownerUserId?: string | null;
};

export type PermissionDecisionCode =
  | "allowed"
  | "missing_scope"
  | "ambiguous_scope"
  | "actor_not_in_scope"
  | "agent_not_in_scope"
  | "runtime_class_scope_mismatch"
  | "runtime_owner_mismatch"
  | "insufficient_role";

export type PermissionDecision = {
  allowed: boolean;
  code: PermissionDecisionCode;
  reason: string;
  scope?: Scope;
};

export class PolicyViolation extends Error {
  readonly decision: PermissionDecision;

  constructor(decision: PermissionDecision) {
    super(decision.reason);
    this.name = "PolicyViolation";
    this.decision = decision;
  }
}

const ALLOWED: PermissionDecision = {
  allowed: true,
  code: "allowed",
  reason: "Permission granted.",
};

function allow(scope?: Scope): PermissionDecision {
  return { ...ALLOWED, scope };
}

function deny(code: Exclude<PermissionDecisionCode, "allowed">, reason: string, scope?: Scope): PermissionDecision {
  return { allowed: false, code, reason, scope };
}

function isSharedScope(scope: Scope): boolean {
  return scope.type !== SCOPE_TYPES.PRIVATE_USER;
}

function resolveResourceScope(resource: Resource): PermissionDecision {
  if (resource.scope) {
    if (
      (resource.scopeId && resource.scopeId !== resource.scope.id) ||
      (resource.scopeType && resource.scopeType !== resource.scope.type)
    ) {
      return deny("ambiguous_scope", "Resource has conflicting scope identifiers.");
    }

    return allow(resource.scope);
  }

  if (resource.scopeId || resource.scopeType) {
    return deny("ambiguous_scope", "Resource scope must be resolved before policy evaluation.");
  }

  return deny("missing_scope", "Resource is missing a scope; defaulting to restricted.");
}

function actorId(actor: Actor): string | undefined {
  return actor.userId ?? actor.id;
}

function actorHasRole(actor: Actor, roles: readonly ScopeRole[]): boolean {
  return actor.roles?.some((role) => roles.includes(role)) ?? false;
}

function actorIsInScope(actor: Actor, scope: Scope): boolean {
  if (actor.type === "system") return true;
  if (actor.scopeIds?.includes(scope.id)) return true;

  const id = actorId(actor);
  if (!id) return false;

  if (scope.ownerUserId === id) return true;
  if (scope.memberIds?.includes(id)) return true;
  if (actor.type === "agent" && scope.agentIds?.includes(actor.id)) return true;

  return false;
}

function requireActorInScope(actor: Actor, scope: Scope): PermissionDecision {
  if (actorIsInScope(actor, scope)) return allow(scope);

  return deny("actor_not_in_scope", "Actor is not a member of the requested scope.", scope);
}

function requireRole(actor: Actor, scope: Scope, roles: readonly ScopeRole[]): PermissionDecision {
  const membership = requireActorInScope(actor, scope);
  if (!membership.allowed) return membership;

  if (actor.type === "system" || scope.ownerUserId === actorId(actor) || actorHasRole(actor, roles)) {
    return allow(scope);
  }

  return deny("insufficient_role", "Actor does not have a role allowed for this operation.", scope);
}

export function canReadResource(actor: Actor, resource: Resource): PermissionDecision {
  const resolved = resolveResourceScope(resource);
  if (!resolved.allowed || !resolved.scope) return resolved;

  return requireActorInScope(actor, resolved.scope);
}

export function canCreateResource(actor: Actor, scope: Scope): PermissionDecision {
  return requireActorInScope(actor, scope);
}

export function canUpdateResource(actor: Actor, resource: Resource): PermissionDecision {
  const resolved = resolveResourceScope(resource);
  if (!resolved.allowed || !resolved.scope) return resolved;

  return requireRole(actor, resolved.scope, [SCOPE_ROLES.OWNER, SCOPE_ROLES.ADMIN, SCOPE_ROLES.MEMBER]);
}

export function canDeleteResource(actor: Actor, resource: Resource): PermissionDecision {
  const resolved = resolveResourceScope(resource);
  if (!resolved.allowed || !resolved.scope) return resolved;

  return requireRole(actor, resolved.scope, [SCOPE_ROLES.OWNER, SCOPE_ROLES.ADMIN]);
}

export function canPostToChannel(actor: Actor, scope: Scope): PermissionDecision {
  if (scope.type !== SCOPE_TYPES.CHANNEL) {
    return deny("ambiguous_scope", "Posting requires an explicit channel scope.", scope);
  }

  return requireActorInScope(actor, scope);
}

export function canInviteChannelMember(actor: Actor, scope: Scope): PermissionDecision {
  if (scope.type !== SCOPE_TYPES.CHANNEL) {
    return deny("ambiguous_scope", "Invites require an explicit channel scope.", scope);
  }

  return requireRole(actor, scope, [SCOPE_ROLES.OWNER, SCOPE_ROLES.ADMIN]);
}

export function canMentionAgent(actor: Actor, agent: AgentPrincipal, scope: Scope): PermissionDecision {
  const membership = requireActorInScope(actor, scope);
  if (!membership.allowed) return membership;

  if (scope.agentIds?.includes(agent.id)) return allow(scope);

  return deny("agent_not_in_scope", "Agent is not allowed in the requested scope.", scope);
}

export function canBindRuntime(runtime: RuntimeBindingTarget, scope: Scope): PermissionDecision {
  if (runtime.class === RUNTIME_CLASSES.PERSONAL) {
    if (isSharedScope(scope)) {
      return deny(
        "runtime_class_scope_mismatch",
        "Personal runtimes cannot be bound to shared collaborative scopes.",
        scope,
      );
    }

    if (!runtime.ownerUserId || runtime.ownerUserId !== scope.ownerUserId) {
      return deny("runtime_owner_mismatch", "Personal runtime owner must match private user scope owner.", scope);
    }

    return allow(scope);
  }

  if (scope.type === SCOPE_TYPES.PRIVATE_USER) {
    return deny("runtime_class_scope_mismatch", "Shared runtimes cannot be bound to private user scopes.", scope);
  }

  return allow(scope);
}

export function canPromoteResource(actor: Actor, resource: Resource, targetScope: Scope): PermissionDecision {
  const source = canReadResource(actor, resource);
  if (!source.allowed) return source;

  return requireRole(actor, targetScope, [SCOPE_ROLES.OWNER, SCOPE_ROLES.ADMIN]);
}

export function assertRuntimeAllowedForScope(runtime: RuntimeBindingTarget, scope: Scope): asserts runtime is RuntimeBindingTarget {
  const decision = canBindRuntime(runtime, scope);
  if (!decision.allowed) throw new PolicyViolation(decision);
}

export function assertAgentAllowedInScope(agent: AgentPrincipal, scope: Scope): asserts agent is AgentPrincipal {
  if (!scope.agentIds?.includes(agent.id)) {
    throw new PolicyViolation(deny("agent_not_in_scope", "Agent is not allowed in the requested scope.", scope));
  }
}
