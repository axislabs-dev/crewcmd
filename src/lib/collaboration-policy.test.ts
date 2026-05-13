import { describe, expect, it } from "vitest";
import {
  PolicyViolation,
  RUNTIME_CLASSES,
  SCOPE_ROLES,
  SCOPE_TYPES,
  assertAgentAllowedInScope,
  assertRuntimeAllowedForScope,
  canBindRuntime,
  canDeleteResource,
  canMentionAgent,
  canPostToChannel,
  canReadResource,
  type Actor,
  type RuntimeBindingTarget,
  type Scope,
} from "./collaboration-policy";

const userActor: Actor = {
  id: "user_alice",
  type: "user",
  roles: [SCOPE_ROLES.MEMBER],
};

const channelScope: Scope = {
  id: "channel_security",
  type: SCOPE_TYPES.CHANNEL,
  memberIds: ["user_alice"],
  agentIds: ["agent_triage"],
};

const privateUserScope: Scope = {
  id: "private_alice",
  type: SCOPE_TYPES.PRIVATE_USER,
  ownerUserId: "user_alice",
};

const personalRuntime: RuntimeBindingTarget = {
  id: "runtime_alice_laptop",
  class: RUNTIME_CLASSES.PERSONAL,
  ownerUserId: "user_alice",
};

describe("collaboration policy foundation", () => {
  it("defaults resources with missing scope to restricted", () => {
    const decision = canReadResource(userActor, { id: "doc_1", type: "document" });

    expect(decision).toMatchObject({
      allowed: false,
      code: "missing_scope",
    });
  });

  it("defaults resources with unresolved or conflicting scope hints to restricted", () => {
    expect(canReadResource(userActor, {
      id: "doc_1",
      type: "document",
      scopeId: channelScope.id,
    })).toMatchObject({ allowed: false, code: "ambiguous_scope" });

    expect(canReadResource(userActor, {
      id: "doc_2",
      type: "document",
      scope: channelScope,
      scopeId: "channel_other",
    })).toMatchObject({ allowed: false, code: "ambiguous_scope" });
  });

  it("allows scoped reads and channel posts only for actors in the scope", () => {
    expect(canReadResource(userActor, {
      id: "doc_1",
      type: "document",
      scope: channelScope,
    })).toMatchObject({ allowed: true, code: "allowed" });

    expect(canPostToChannel({ id: "user_bob", type: "user" }, channelScope)).toMatchObject({
      allowed: false,
      code: "actor_not_in_scope",
    });
  });

  it("keeps destructive actions role-gated", () => {
    expect(canDeleteResource(userActor, {
      id: "doc_1",
      type: "document",
      scope: channelScope,
    })).toMatchObject({ allowed: false, code: "insufficient_role" });

    expect(canDeleteResource({ ...userActor, roles: [SCOPE_ROLES.ADMIN] }, {
      id: "doc_1",
      type: "document",
      scope: channelScope,
    })).toMatchObject({ allowed: true, code: "allowed" });
  });

  it("prevents personal runtimes from binding shared collaborative scopes", () => {
    const decision = canBindRuntime(personalRuntime, channelScope);

    expect(decision).toMatchObject({
      allowed: false,
      code: "runtime_class_scope_mismatch",
    });
    expect(() => assertRuntimeAllowedForScope(personalRuntime, channelScope)).toThrow(PolicyViolation);
  });

  it("allows personal runtimes only for their matching private user scope", () => {
    expect(canBindRuntime(personalRuntime, privateUserScope)).toMatchObject({
      allowed: true,
      code: "allowed",
    });

    expect(canBindRuntime({ ...personalRuntime, ownerUserId: "user_bob" }, privateUserScope)).toMatchObject({
      allowed: false,
      code: "runtime_owner_mismatch",
    });
  });

  it("keeps shared runtimes out of private user scopes", () => {
    expect(canBindRuntime({ id: "runtime_team", class: RUNTIME_CLASSES.SHARED }, privateUserScope)).toMatchObject({
      allowed: false,
      code: "runtime_class_scope_mismatch",
    });
  });

  it("requires agents to be explicitly allowed in scope before mentions", () => {
    expect(canMentionAgent(userActor, { id: "agent_triage" }, channelScope)).toMatchObject({
      allowed: true,
      code: "allowed",
    });

    expect(canMentionAgent(userActor, { id: "agent_outside" }, channelScope)).toMatchObject({
      allowed: false,
      code: "agent_not_in_scope",
    });
    expect(() => assertAgentAllowedInScope({ id: "agent_outside" }, channelScope)).toThrow(PolicyViolation);
  });
});
