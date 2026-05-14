export const SCOPE_TYPES = {
  PRIVATE_USER: "private:user",
  DM: "dm",
  CHANNEL: "channel",
  PROJECT: "project",
  TEAM: "team",
  ORG: "org",
} as const;

export type ScopeType = (typeof SCOPE_TYPES)[keyof typeof SCOPE_TYPES];

export const COLLABORATION_SURFACE_TYPES = {
  CHAT: "chat",
  DIRECT_MESSAGE: "direct_message",
  CHANNEL: "channel",
  THREAD: "thread",
  PROJECT_ROOM: "project_room",
} as const;

export type CollaborationSurfaceType =
  (typeof COLLABORATION_SURFACE_TYPES)[keyof typeof COLLABORATION_SURFACE_TYPES];

export const RUNTIME_CLASSES = {
  PERSONAL: "personal",
  SHARED: "shared",
} as const;

export type RuntimeClass = (typeof RUNTIME_CLASSES)[keyof typeof RUNTIME_CLASSES];

export const AGENT_VISIBILITY = {
  PERSONAL: "personal",
  TEAM: "team",
  ORG: "org",
} as const;

export type AgentVisibility = (typeof AGENT_VISIBILITY)[keyof typeof AGENT_VISIBILITY];

export const COMPANY_ROLES = {
  OWNER: "owner",
  ADMIN: "admin",
  MEMBER: "member",
  VIEWER: "viewer",
} as const;

export type CompanyRole = (typeof COMPANY_ROLES)[keyof typeof COMPANY_ROLES];

export const CHANNEL_ROLES = {
  OWNER: "owner",
  ADMIN: "admin",
  MEMBER: "member",
  CONTRIBUTOR: "contributor",
  VIEWER: "viewer",
  GUEST: "guest",
} as const;

export type ChannelRole = (typeof CHANNEL_ROLES)[keyof typeof CHANNEL_ROLES];

export const PROJECT_ROLES = {
  OWNER: "owner",
  MANAGER: "manager",
  MEMBER: "member",
  VIEWER: "viewer",
  GUEST: "guest",
} as const;

export type ProjectRole = (typeof PROJECT_ROLES)[keyof typeof PROJECT_ROLES];

export const AGENT_CAPABILITIES = {
  VIEW: "agent.view",
  INVOKE: "agent.invoke",
  CONFIGURE: "agent.configure",
  MANAGE_MEMBERSHIP: "agent.manage_membership",
  VIEW_LOGS: "agent.view_logs",
  MANAGE_BUDGET: "agent.manage_budget",
  RETIRE: "agent.retire",
} as const;

export type AgentCapability = (typeof AGENT_CAPABILITIES)[keyof typeof AGENT_CAPABILITIES];

export const RUNTIME_CAPABILITIES = {
  VIEW_STATUS: "runtime.view_status",
  INVOKE_THROUGH_AGENT: "runtime.invoke_through_agent",
  ATTACH_TO_SCOPE: "runtime.attach_to_scope",
  CONFIGURE_CREDENTIALS: "runtime.configure_credentials",
  EXPORT_LOGS: "runtime.export_logs",
} as const;

export type RuntimeCapability = (typeof RUNTIME_CAPABILITIES)[keyof typeof RUNTIME_CAPABILITIES];

// Back-compat alias used by early policy call sites. New shared scopes should prefer
// ChannelRole / ProjectRole / CompanyRole depending on the scoped surface.
export const SCOPE_ROLES = {
  OWNER: "owner",
  ADMIN: "admin",
  MEMBER: "member",
  CONTRIBUTOR: "contributor",
  VIEWER: "viewer",
  GUEST: "guest",
} as const;

export type ScopeRole = (typeof SCOPE_ROLES)[keyof typeof SCOPE_ROLES];
export type ScopeMembershipRole = ScopeRole | CompanyRole | ChannelRole | ProjectRole;

export type ActorType = "user" | "agent" | "system";

export type Actor = {
  id: string;
  type: ActorType;
  userId?: string;
  roles?: readonly ScopeRole[];
  scopeIds?: readonly string[];
  companyRoles?: Readonly<Record<string, CompanyRole>>;
  channelRoles?: Readonly<Record<string, ChannelRole>>;
  projectRoles?: Readonly<Record<string, ProjectRole>>;
};

export type Scope = {
  id: string;
  type: ScopeType;
  surface?: CollaborationSurfaceType;
  companyId?: string | null;
  ownerUserId?: string | null;
  memberIds?: readonly string[];
  agentIds?: readonly string[];
  rolesByUserId?: Readonly<Record<string, ScopeMembershipRole>>;
  rolesByAgentId?: Readonly<Record<string, ScopeMembershipRole>>;
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
  ownerCompanyId?: string | null;
};

export type AgentPrincipal = {
  id: string;
  visibility?: AgentVisibility;
  ownerUserId?: string | null;
  ownerCompanyId?: string | null;
  capabilitiesByUserId?: Readonly<Record<string, readonly AgentCapability[]>>;
};

export type PermissionDecisionCode =
  | "allowed"
  | "missing_scope"
  | "ambiguous_scope"
  | "actor_not_in_scope"
  | "agent_not_visible"
  | "agent_not_in_scope"
  | "runtime_class_scope_mismatch"
  | "runtime_owner_mismatch"
  | "runtime_company_mismatch"
  | "insufficient_role"
  | "insufficient_capability";

export type PermissionDecision = {
  allowed: boolean;
  code: PermissionDecisionCode;
  reason: string;
  scope?: Scope;
};

export type RoleMatrix = {
  readonly canRead: readonly string[];
  readonly canPost: readonly string[];
  readonly canInviteHumans: readonly string[];
  readonly canInviteAgents: readonly string[];
  readonly canConfigure: readonly string[];
  readonly canManageResources: readonly string[];
  readonly canArchiveDelete: readonly string[];
};

export const COMPANY_ROLE_MATRIX = {
  manageSettings: [COMPANY_ROLES.OWNER, COMPANY_ROLES.ADMIN],
  manageSharedRuntimes: [COMPANY_ROLES.OWNER, COMPANY_ROLES.ADMIN],
  manageOrgAgents: [COMPANY_ROLES.OWNER, COMPANY_ROLES.ADMIN],
  invokeOrgAgents: [COMPANY_ROLES.OWNER, COMPANY_ROLES.ADMIN, COMPANY_ROLES.MEMBER],
  readOrgResources: [COMPANY_ROLES.OWNER, COMPANY_ROLES.ADMIN, COMPANY_ROLES.MEMBER, COMPANY_ROLES.VIEWER],
} as const;

export const CHANNEL_ROLE_MATRIX: RoleMatrix = {
  canRead: ["owner", "admin", "member", "contributor", "viewer", "guest"],
  canPost: ["owner", "admin", "member", "contributor"],
  canInviteHumans: ["owner", "admin"],
  canInviteAgents: ["owner", "admin"],
  canConfigure: ["owner", "admin"],
  canManageResources: ["owner", "admin", "member"],
  canArchiveDelete: ["owner"],
};

export const PROJECT_ROLE_MATRIX = {
  canRead: ["owner", "manager", "member", "viewer", "guest"],
  canPost: ["owner", "manager", "member"],
  canConfigure: ["owner", "manager"],
  canManageResources: ["owner", "manager", "member"],
  canArchiveDelete: ["owner"],
} as const;

export const AGENT_CAPABILITY_MATRIX = {
  personalOwner: Object.values(AGENT_CAPABILITIES),
  teamOrgAdmin: Object.values(AGENT_CAPABILITIES),
  teamOrgMember: [AGENT_CAPABILITIES.VIEW, AGENT_CAPABILITIES.INVOKE],
  teamOrgViewer: [AGENT_CAPABILITIES.VIEW],
} as const;

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

function actorScopeRole(actor: Actor, scope: Scope): ScopeMembershipRole | undefined {
  const id = actorId(actor);
  if (!id) return undefined;
  if (actor.type === "agent") return scope.rolesByAgentId?.[actor.id] ?? actor.roles?.[0];
  return scope.rolesByUserId?.[id] ?? actor.roles?.[0];
}

function actorHasRole(actor: Actor, scope: Scope, roles: readonly string[]): boolean {
  const role = actorScopeRole(actor, scope);
  if (role && roles.includes(role)) return true;
  return actor.roles?.some((candidate) => roles.includes(candidate)) ?? false;
}

function companyRole(actor: Actor, companyId: string | null | undefined): CompanyRole | undefined {
  if (!companyId) return undefined;
  return actor.companyRoles?.[companyId];
}

function actorIsCompanyAdmin(actor: Actor, companyId: string | null | undefined): boolean {
  const role = companyRole(actor, companyId);
  return role === COMPANY_ROLES.OWNER || role === COMPANY_ROLES.ADMIN;
}

function actorIsInScope(actor: Actor, scope: Scope): boolean {
  if (actor.type === "system") return true;
  if (actor.scopeIds?.includes(scope.id)) return true;

  const id = actorId(actor);
  if (!id) return false;

  if (scope.ownerUserId === id) return true;
  if (scope.memberIds?.includes(id)) return true;
  if (scope.rolesByUserId?.[id]) return true;
  if (actor.type === "agent" && scope.agentIds?.includes(actor.id)) return true;
  if (actor.type === "agent" && scope.rolesByAgentId?.[actor.id]) return true;

  if (scope.type === SCOPE_TYPES.ORG) return !!companyRole(actor, scope.id) || !!companyRole(actor, scope.companyId);

  return false;
}

function requireActorInScope(actor: Actor, scope: Scope): PermissionDecision {
  if (actorIsInScope(actor, scope)) return allow(scope);

  return deny("actor_not_in_scope", "Actor is not a member of the requested scope.", scope);
}

function requireRole(actor: Actor, scope: Scope, roles: readonly string[]): PermissionDecision {
  const membership = requireActorInScope(actor, scope);
  if (!membership.allowed) return membership;

  if (actor.type === "system" || scope.ownerUserId === actorId(actor) || actorHasRole(actor, scope, roles)) {
    return allow(scope);
  }

  return deny("insufficient_role", "Actor does not have a role allowed for this operation.", scope);
}

function explicitCapabilities(actor: Actor, agent: AgentPrincipal): readonly AgentCapability[] {
  const id = actorId(actor);
  if (!id) return [];
  return agent.capabilitiesByUserId?.[id] ?? [];
}

function canUseAgentCapability(actor: Actor, agent: AgentPrincipal, capability: AgentCapability, scope?: Scope): PermissionDecision {
  if (actor.type === "system") return allow(scope);
  const id = actorId(actor);
  if (!id) return deny("actor_not_in_scope", "Anonymous actors cannot use agent capabilities.", scope);

  if (agent.ownerUserId === id) return allow(scope);
  if (explicitCapabilities(actor, agent).includes(capability)) return allow(scope);

  if (agent.visibility === AGENT_VISIBILITY.PERSONAL) {
    return deny("agent_not_visible", "Personal agents are visible only to their owner.", scope);
  }

  const role = companyRole(actor, agent.ownerCompanyId ?? scope?.companyId);
  if (!role) return deny("agent_not_visible", "Actor is not in the agent company scope.", scope);

  if (role === COMPANY_ROLES.OWNER || role === COMPANY_ROLES.ADMIN) return allow(scope);

  if (capability === AGENT_CAPABILITIES.VIEW) return allow(scope);
  if (capability === AGENT_CAPABILITIES.INVOKE && role === COMPANY_ROLES.MEMBER) return allow(scope);

  return deny("insufficient_capability", "Actor does not have the requested agent capability.", scope);
}

export function canReadResource(actor: Actor, resource: Resource): PermissionDecision {
  const resolved = resolveResourceScope(resource);
  if (!resolved.allowed || !resolved.scope) return resolved;

  return requireActorInScope(actor, resolved.scope);
}

export const canViewResource = canReadResource;

export function canCreateResource(actor: Actor, scope: Scope): PermissionDecision {
  return requireActorInScope(actor, scope);
}

export function canUpdateResource(actor: Actor, resource: Resource): PermissionDecision {
  const resolved = resolveResourceScope(resource);
  if (!resolved.allowed || !resolved.scope) return resolved;

  return requireRole(actor, resolved.scope, ["owner", "admin", "manager", "member"]);
}

export function canDeleteResource(actor: Actor, resource: Resource): PermissionDecision {
  const resolved = resolveResourceScope(resource);
  if (!resolved.allowed || !resolved.scope) return resolved;

  return requireRole(actor, resolved.scope, ["owner", "admin"]);
}

export function canPostToChannel(actor: Actor, scope: Scope): PermissionDecision {
  if (scope.type !== SCOPE_TYPES.CHANNEL) {
    return deny("ambiguous_scope", "Posting requires an explicit channel scope.", scope);
  }

  return requireRole(actor, scope, CHANNEL_ROLE_MATRIX.canPost);
}

export function canPostToProjectRoom(actor: Actor, scope: Scope): PermissionDecision {
  if (scope.type !== SCOPE_TYPES.PROJECT) {
    return deny("ambiguous_scope", "Posting to a project room requires an explicit project scope.", scope);
  }

  return requireRole(actor, scope, PROJECT_ROLE_MATRIX.canPost);
}

export function canInviteChannelMember(actor: Actor, scope: Scope): PermissionDecision {
  if (scope.type !== SCOPE_TYPES.CHANNEL) {
    return deny("ambiguous_scope", "Invites require an explicit channel scope.", scope);
  }

  return requireRole(actor, scope, CHANNEL_ROLE_MATRIX.canInviteHumans);
}

export function canViewAgent(actor: Actor, agent: AgentPrincipal, scope?: Scope): PermissionDecision {
  if (scope) {
    const membership = requireActorInScope(actor, scope);
    if (!membership.allowed && !actorIsCompanyAdmin(actor, agent.ownerCompanyId ?? scope.companyId)) return membership;
  }

  return canUseAgentCapability(actor, agent, AGENT_CAPABILITIES.VIEW, scope);
}

export function canInvokeAgent(actor: Actor, agent: AgentPrincipal, scope: Scope): PermissionDecision {
  const membership = requireActorInScope(actor, scope);
  if (!membership.allowed) return membership;

  const capability = canUseAgentCapability(actor, agent, AGENT_CAPABILITIES.INVOKE, scope);
  if (!capability.allowed) return capability;

  if (agent.visibility === AGENT_VISIBILITY.PERSONAL && agent.ownerUserId !== actorId(actor)) {
    return deny("agent_not_visible", "Personal agents can only be invoked by their owner.", scope);
  }

  if (isSharedScope(scope) && agent.visibility === AGENT_VISIBILITY.PERSONAL) {
    return deny("agent_not_in_scope", "Personal agents cannot be invoked in shared scopes.", scope);
  }

  if (isSharedScope(scope) && !scope.agentIds?.includes(agent.id)) {
    return deny("agent_not_in_scope", "Agent is not allowed in the requested scope.", scope);
  }

  return allow(scope);
}

export function canMentionAgent(actor: Actor, agent: AgentPrincipal, scope: Scope): PermissionDecision {
  return canInvokeAgent(actor, agent, scope);
}

export function canConfigureAgent(actor: Actor, agent: AgentPrincipal, scope?: Scope): PermissionDecision {
  return canUseAgentCapability(actor, agent, AGENT_CAPABILITIES.CONFIGURE, scope);
}

export function canViewAgentLogs(actor: Actor, agent: AgentPrincipal, scope?: Scope): PermissionDecision {
  return canUseAgentCapability(actor, agent, AGENT_CAPABILITIES.VIEW_LOGS, scope);
}

export function canManageAgentBudget(actor: Actor, agent: AgentPrincipal, scope?: Scope): PermissionDecision {
  return canUseAgentCapability(actor, agent, AGENT_CAPABILITIES.MANAGE_BUDGET, scope);
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
      return deny("runtime_owner_mismatch", "Personal runtime owner must match private chat owner.", scope);
    }

    return allow(scope);
  }

  if (!isSharedScope(scope)) {
    return deny("runtime_class_scope_mismatch", "Shared runtimes cannot be bound to private user scopes.", scope);
  }

  if (runtime.ownerCompanyId && scope.companyId && runtime.ownerCompanyId !== scope.companyId) {
    return deny("runtime_company_mismatch", "Shared runtime company must match the shared scope company.", scope);
  }

  return allow(scope);
}

export function canBindRuntimeForActor(actor: Actor, runtime: RuntimeBindingTarget, scope: Scope): PermissionDecision {
  const binding = canBindRuntime(runtime, scope);
  if (!binding.allowed) return binding;

  if (runtime.class === RUNTIME_CLASSES.PERSONAL) {
    return runtime.ownerUserId === actorId(actor)
      ? allow(scope)
      : deny("runtime_owner_mismatch", "Only the owner can bind a personal runtime.", scope);
  }

  if (actor.type === "system" || actorIsCompanyAdmin(actor, runtime.ownerCompanyId ?? scope.companyId)) return allow(scope);

  return deny("insufficient_role", "Only company owners/admins can bind shared runtimes.", scope);
}

export function canPromoteResource(actor: Actor, resource: Resource, targetScope: Scope): PermissionDecision {
  const source = canReadResource(actor, resource);
  if (!source.allowed) return source;

  if (!isSharedScope(targetScope)) {
    return deny("ambiguous_scope", "Promotion target must be a shared scope.", targetScope);
  }

  return requireRole(actor, targetScope, ["owner", "admin", "manager"]);
}

export function assertRuntimeAllowedForScope(runtime: RuntimeBindingTarget, scope: Scope): asserts runtime is RuntimeBindingTarget {
  const decision = canBindRuntime(runtime, scope);
  if (!decision.allowed) throw new PolicyViolation(decision);
}

export function assertAgentAllowedInScope(agent: AgentPrincipal, scope: Scope): asserts agent is AgentPrincipal {
  if (isSharedScope(scope) && agent.visibility === AGENT_VISIBILITY.PERSONAL) {
    throw new PolicyViolation(deny("agent_not_in_scope", "Personal agents cannot be assigned to shared scopes.", scope));
  }

  if (isSharedScope(scope) && !scope.agentIds?.includes(agent.id)) {
    throw new PolicyViolation(deny("agent_not_in_scope", "Agent is not allowed in the requested scope.", scope));
  }
}
