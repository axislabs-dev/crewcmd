import { describe, expect, it } from "vitest";
import {
  AGENT_VISIBILITY,
  CHANNEL_ROLES,
  COLLABORATION_SURFACE_TYPES,
  COMPANY_ROLES,
  PolicyViolation,
  PROJECT_ROLES,
  RUNTIME_CLASSES,
  SCOPE_ROLES,
  SCOPE_TYPES,
  assertAgentAllowedInScope,
  assertRuntimeAllowedForScope,
  canBindRuntime,
  canBindRuntimeForActor,
  canConfigureAgent,
  canDeleteResource,
  canInvokeAgent,
  canManageAgentBudget,
  canMentionAgent,
  canPostToChannel,
  canPostToProjectRoom,
  canReadResource,
  canViewAgent,
  canViewAgentLogs,
  type Actor,
  type AgentPrincipal,
  type RuntimeBindingTarget,
  type Scope,
} from "./collaboration-policy";

const companyId = "company_axis";
const channelId = "channel_security";
const projectId = "project_launch";

function actor(id: string, role?: string): Actor {
  return {
    id,
    type: "user",
    roles: role ? [role as never] : undefined,
    companyRoles: { [companyId]: COMPANY_ROLES.MEMBER },
  };
}

const owner = actor("user_owner", CHANNEL_ROLES.OWNER);
const admin = actor("user_admin", CHANNEL_ROLES.ADMIN);
const member = actor("user_member", CHANNEL_ROLES.MEMBER);
const contributor = actor("user_contributor", CHANNEL_ROLES.CONTRIBUTOR);
const viewer = actor("user_viewer", CHANNEL_ROLES.VIEWER);
const guest = actor("user_guest", CHANNEL_ROLES.GUEST);

const channelScope: Scope = {
  id: channelId,
  type: SCOPE_TYPES.CHANNEL,
  surface: COLLABORATION_SURFACE_TYPES.CHANNEL,
  companyId,
  memberIds: [owner.id, admin.id, member.id, contributor.id, viewer.id, guest.id],
  agentIds: ["agent_triage"],
  rolesByUserId: {
    [owner.id]: CHANNEL_ROLES.OWNER,
    [admin.id]: CHANNEL_ROLES.ADMIN,
    [member.id]: CHANNEL_ROLES.MEMBER,
    [contributor.id]: CHANNEL_ROLES.CONTRIBUTOR,
    [viewer.id]: CHANNEL_ROLES.VIEWER,
    [guest.id]: CHANNEL_ROLES.GUEST,
  },
};

const privateChatScope: Scope = {
  id: "chat_alice_private",
  type: SCOPE_TYPES.PRIVATE_USER,
  surface: COLLABORATION_SURFACE_TYPES.DIRECT_MESSAGE,
  ownerUserId: "user_owner",
  memberIds: ["user_owner"],
};

const projectRoomScope: Scope = {
  id: projectId,
  type: SCOPE_TYPES.PROJECT,
  surface: COLLABORATION_SURFACE_TYPES.PROJECT_ROOM,
  companyId,
  memberIds: [owner.id, admin.id, member.id, contributor.id, viewer.id, guest.id],
  agentIds: ["agent_pm"],
  rolesByUserId: {
    [owner.id]: PROJECT_ROLES.OWNER,
    [admin.id]: PROJECT_ROLES.MANAGER,
    [member.id]: PROJECT_ROLES.MEMBER,
    [viewer.id]: PROJECT_ROLES.VIEWER,
    [guest.id]: PROJECT_ROLES.GUEST,
  },
};

const teamAgent: AgentPrincipal = {
  id: "agent_triage",
  visibility: AGENT_VISIBILITY.TEAM,
  ownerCompanyId: companyId,
};

const personalAgent: AgentPrincipal = {
  id: "agent_personal",
  visibility: AGENT_VISIBILITY.PERSONAL,
  ownerUserId: "user_owner",
};

const personalRuntime: RuntimeBindingTarget = {
  id: "runtime_owner_laptop",
  class: RUNTIME_CLASSES.PERSONAL,
  ownerUserId: "user_owner",
};

const sharedRuntime: RuntimeBindingTarget = {
  id: "runtime_company_pool",
  class: RUNTIME_CLASSES.SHARED,
  ownerCompanyId: companyId,
};

describe("collaboration policy foundation", () => {
  it("defaults resources with missing scope to restricted", () => {
    const decision = canReadResource(member, { id: "doc_1", type: "document" });

    expect(decision).toMatchObject({
      allowed: false,
      code: "missing_scope",
    });
  });

  it("defaults resources with unresolved or conflicting scope hints to restricted", () => {
    expect(canReadResource(member, {
      id: "doc_1",
      type: "document",
      scopeId: channelScope.id,
    })).toMatchObject({ allowed: false, code: "ambiguous_scope" });

    expect(canReadResource(member, {
      id: "doc_2",
      type: "document",
      scope: channelScope,
      scopeId: "channel_other",
    })).toMatchObject({ allowed: false, code: "ambiguous_scope" });
  });

  it("supports channel role matrix for owner/admin/member/contributor/viewer/guest", () => {
    for (const principal of [owner, admin, member, contributor, viewer, guest]) {
      expect(canReadResource(principal, { id: `doc_${principal.id}`, type: "doc", scope: channelScope })).toMatchObject({
        allowed: true,
      });
    }

    for (const principal of [owner, admin, member, contributor]) {
      expect(canPostToChannel(principal, channelScope)).toMatchObject({ allowed: true });
    }

    for (const principal of [viewer, guest]) {
      expect(canPostToChannel(principal, channelScope)).toMatchObject({
        allowed: false,
        code: "insufficient_role",
      });
    }
  });

  it("keeps destructive actions role-gated", () => {
    expect(canDeleteResource(member, {
      id: "doc_1",
      type: "document",
      scope: channelScope,
    })).toMatchObject({ allowed: false, code: "insufficient_role" });

    expect(canDeleteResource(admin, {
      id: "doc_1",
      type: "document",
      scope: channelScope,
    })).toMatchObject({ allowed: true, code: "allowed" });
  });

  it("allows private chat resources only for the private owner", () => {
    expect(canReadResource(owner, { id: "msg_private", type: "chat_message", scope: privateChatScope })).toMatchObject({
      allowed: true,
    });

    expect(canReadResource(member, { id: "msg_private", type: "chat_message", scope: privateChatScope })).toMatchObject({
      allowed: false,
      code: "actor_not_in_scope",
    });
  });

  it("allows project room posting by project owners/managers/members but not viewers/guests", () => {
    expect(canPostToProjectRoom(owner, projectRoomScope)).toMatchObject({ allowed: true });
    expect(canPostToProjectRoom(admin, projectRoomScope)).toMatchObject({ allowed: true });
    expect(canPostToProjectRoom(member, projectRoomScope)).toMatchObject({ allowed: true });
    expect(canPostToProjectRoom(viewer, projectRoomScope)).toMatchObject({ allowed: false, code: "insufficient_role" });
    expect(canPostToProjectRoom(guest, projectRoomScope)).toMatchObject({ allowed: false, code: "insufficient_role" });
  });

  it("prevents personal runtimes from binding shared channels and project rooms", () => {
    const channelDecision = canBindRuntime(personalRuntime, channelScope);
    expect(channelDecision).toMatchObject({
      allowed: false,
      code: "runtime_class_scope_mismatch",
    });
    expect(() => assertRuntimeAllowedForScope(personalRuntime, channelScope)).toThrow(PolicyViolation);

    expect(canBindRuntime(personalRuntime, projectRoomScope)).toMatchObject({
      allowed: false,
      code: "runtime_class_scope_mismatch",
    });
  });

  it("allows personal runtimes only for their matching private chat owner", () => {
    expect(canBindRuntime(personalRuntime, privateChatScope)).toMatchObject({
      allowed: true,
      code: "allowed",
    });

    expect(canBindRuntime({ ...personalRuntime, ownerUserId: "user_bob" }, privateChatScope)).toMatchObject({
      allowed: false,
      code: "runtime_owner_mismatch",
    });
  });

  it("allows shared runtimes only in matching shared scopes", () => {
    expect(canBindRuntime(sharedRuntime, channelScope)).toMatchObject({ allowed: true });
    expect(canBindRuntime(sharedRuntime, projectRoomScope)).toMatchObject({ allowed: true });

    expect(canBindRuntime(sharedRuntime, privateChatScope)).toMatchObject({
      allowed: false,
      code: "runtime_class_scope_mismatch",
    });

    expect(canBindRuntime({ ...sharedRuntime, ownerCompanyId: "company_other" }, channelScope)).toMatchObject({
      allowed: false,
      code: "runtime_company_mismatch",
    });
  });

  it("requires company owner/admin to bind shared runtimes", () => {
    const companyAdmin: Actor = {
      ...admin,
      companyRoles: { [companyId]: COMPANY_ROLES.ADMIN },
    };

    expect(canBindRuntimeForActor(companyAdmin, sharedRuntime, channelScope)).toMatchObject({ allowed: true });
    expect(canBindRuntimeForActor(member, sharedRuntime, channelScope)).toMatchObject({
      allowed: false,
      code: "insufficient_role",
    });
  });

  it("requires agents to be visible, invokable, and explicitly allowed in shared scope", () => {
    expect(canViewAgent(member, teamAgent, channelScope)).toMatchObject({ allowed: true });
    expect(canInvokeAgent(member, teamAgent, channelScope)).toMatchObject({ allowed: true });
    expect(canMentionAgent(member, teamAgent, channelScope)).toMatchObject({ allowed: true });

    expect(canInvokeAgent(member, { ...teamAgent, id: "agent_outside" }, channelScope)).toMatchObject({
      allowed: false,
      code: "agent_not_in_scope",
    });
    expect(() => assertAgentAllowedInScope({ id: "agent_outside" }, channelScope)).toThrow(PolicyViolation);
  });

  it("keeps personal agents out of shared channels", () => {
    expect(canInvokeAgent(owner, personalAgent, channelScope)).toMatchObject({
      allowed: false,
      code: "agent_not_in_scope",
    });
  });

  it("splits invoke, configure, logs, and budget capabilities", () => {
    const companyOwner: Actor = {
      ...owner,
      companyRoles: { [companyId]: COMPANY_ROLES.OWNER },
    };

    expect(canInvokeAgent(member, teamAgent, channelScope)).toMatchObject({ allowed: true });
    expect(canConfigureAgent(member, teamAgent, channelScope)).toMatchObject({
      allowed: false,
      code: "insufficient_capability",
    });
    expect(canViewAgentLogs(member, teamAgent, channelScope)).toMatchObject({
      allowed: false,
      code: "insufficient_capability",
    });
    expect(canManageAgentBudget(member, teamAgent, channelScope)).toMatchObject({
      allowed: false,
      code: "insufficient_capability",
    });

    expect(canConfigureAgent(companyOwner, teamAgent, channelScope)).toMatchObject({ allowed: true });
    expect(canViewAgentLogs(companyOwner, teamAgent, channelScope)).toMatchObject({ allowed: true });
    expect(canManageAgentBudget(companyOwner, teamAgent, channelScope)).toMatchObject({ allowed: true });
  });

  it("preserves legacy scope role aliases", () => {
    expect(SCOPE_ROLES.OWNER).toBe("owner");
  });
});
