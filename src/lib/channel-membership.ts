export const CHANNEL_ROLES = {
  OWNER: "owner",
  ADMIN: "admin",
  MEMBER: "member",
  CONTRIBUTOR: "contributor",
  VIEWER: "viewer",
  GUEST: "guest",
} as const;

export type ChannelRole = (typeof CHANNEL_ROLES)[keyof typeof CHANNEL_ROLES];

export const AGENT_PARTICIPATION_MODES = {
  SILENT: "silent",
  WATCHING: "watching",
  MENTION_ONLY: "mention_only",
  PROACTIVE: "proactive",
  ON_CALL: "on_call",
} as const;

export type AgentParticipationMode =
  (typeof AGENT_PARTICIPATION_MODES)[keyof typeof AGENT_PARTICIPATION_MODES];

export const CHANNEL_MEMBER_TYPES = {
  USER: "user",
  AGENT: "agent",
} as const;

export type ChannelMemberType =
  (typeof CHANNEL_MEMBER_TYPES)[keyof typeof CHANNEL_MEMBER_TYPES];

export type ChannelMemberRecord = {
  channelId: string;
  memberType: ChannelMemberType;
  userId?: string | null;
  /** Database UUID from agents.id, not an agent callsign like "neo". */
  agentId?: string | null;
  role: ChannelRole;
  agentParticipationMode?: AgentParticipationMode | null;
  canPostOverride?: boolean | null;
  canInviteOverride?: boolean | null;
};

export type ChannelActor = {
  type: "user" | "agent" | "system";
  /**
   * User id for humans; agent callsign/session identifier for agents.
   * Agent membership matching intentionally does not fall back to this value
   * because channel_members.agent_id stores the agents.id database UUID.
   */
  id: string;
  userId?: string | null;
  /** Database UUID from agents.id. Required for agent membership matching. */
  agentDbId?: string | null;
  /** @deprecated Use agentDbId for membership matching; agentId is retained as a UUID alias. */
  agentId?: string | null;
  agentCallsign?: string | null;
};

export type ChannelMemberSelector = {
  memberType: ChannelMemberType;
  userId?: string;
  agentId?: string;
};

const POSTING_ROLES = new Set<ChannelRole>([
  CHANNEL_ROLES.OWNER,
  CHANNEL_ROLES.ADMIN,
  CHANNEL_ROLES.MEMBER,
  CHANNEL_ROLES.CONTRIBUTOR,
]);

const INVITE_ROLES = new Set<ChannelRole>([
  CHANNEL_ROLES.OWNER,
  CHANNEL_ROLES.ADMIN,
]);

const AGENT_SPEAKING_MODES = new Set<AgentParticipationMode>([
  AGENT_PARTICIPATION_MODES.MENTION_ONLY,
  AGENT_PARTICIPATION_MODES.PROACTIVE,
  AGENT_PARTICIPATION_MODES.ON_CALL,
]);

export function channelMemberSelectorForActor(
  actor: ChannelActor,
): ChannelMemberSelector | null {
  if (actor.type === "system") return null;

  if (actor.type === "agent") {
    const agentId = actor.agentDbId ?? actor.agentId;
    return agentId ? { memberType: CHANNEL_MEMBER_TYPES.AGENT, agentId } : null;
  }

  const userId = actor.userId ?? actor.id;
  return userId ? { memberType: CHANNEL_MEMBER_TYPES.USER, userId } : null;
}

export function isMatchingChannelMember(
  member: Pick<ChannelMemberRecord, "memberType" | "userId" | "agentId">,
  selector: ChannelMemberSelector,
): boolean {
  if (member.memberType !== selector.memberType) return false;
  if (selector.memberType === CHANNEL_MEMBER_TYPES.USER)
    return member.userId === selector.userId;
  return member.agentId === selector.agentId;
}

export function findChannelMembership(
  actor: ChannelActor,
  members: readonly ChannelMemberRecord[],
): ChannelMemberRecord | null {
  const selector = channelMemberSelectorForActor(actor);
  if (!selector) return null;

  return (
    members.find((member) => isMatchingChannelMember(member, selector)) ?? null
  );
}

export function canReadChannel(
  member: ChannelMemberRecord | null | undefined,
): boolean {
  return !!member;
}

export function canPostToChannelFromMembership(
  member: ChannelMemberRecord | null | undefined,
): boolean {
  if (!member) return false;
  if (member.canPostOverride !== null && member.canPostOverride !== undefined)
    return member.canPostOverride;
  return POSTING_ROLES.has(member.role);
}

export function canInviteChannelMembersFromMembership(
  member: ChannelMemberRecord | null | undefined,
): boolean {
  if (!member) return false;
  if (
    member.canInviteOverride !== null &&
    member.canInviteOverride !== undefined
  )
    return member.canInviteOverride;
  return INVITE_ROLES.has(member.role);
}

export function canAgentSpeakInChannel(
  member: ChannelMemberRecord | null | undefined,
): boolean {
  if (!member || member.memberType !== CHANNEL_MEMBER_TYPES.AGENT) return false;
  if (!canPostToChannelFromMembership(member)) return false;
  return AGENT_SPEAKING_MODES.has(
    member.agentParticipationMode ?? AGENT_PARTICIPATION_MODES.MENTION_ONLY,
  );
}

export function canAgentWatchChannel(
  member: ChannelMemberRecord | null | undefined,
): boolean {
  if (!member || member.memberType !== CHANNEL_MEMBER_TYPES.AGENT) return false;
  return member.agentParticipationMode !== AGENT_PARTICIPATION_MODES.SILENT;
}
