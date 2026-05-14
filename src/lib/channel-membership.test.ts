import { describe, expect, it } from "vitest";
import {
  AGENT_PARTICIPATION_MODES,
  CHANNEL_MEMBER_TYPES,
  CHANNEL_ROLES,
  canAgentSpeakInChannel,
  canAgentWatchChannel,
  canInviteChannelMembersFromMembership,
  canPostToChannelFromMembership,
  canReadChannel,
  channelMemberSelectorForActor,
  findChannelMembership,
  type ChannelMemberRecord,
} from "./channel-membership";

const userMember: ChannelMemberRecord = {
  channelId: "channel_1",
  memberType: CHANNEL_MEMBER_TYPES.USER,
  userId: "user_alice",
  role: CHANNEL_ROLES.MEMBER,
};

const viewerMember: ChannelMemberRecord = {
  channelId: "channel_1",
  memberType: CHANNEL_MEMBER_TYPES.USER,
  userId: "user_bob",
  role: CHANNEL_ROLES.VIEWER,
};

const agentMember: ChannelMemberRecord = {
  channelId: "channel_1",
  memberType: CHANNEL_MEMBER_TYPES.AGENT,
  agentId: "agent_triage",
  role: CHANNEL_ROLES.MEMBER,
  agentParticipationMode: AGENT_PARTICIPATION_MODES.MENTION_ONLY,
};

describe("channel membership helpers", () => {
  it("normalizes user and agent actors into membership selectors", () => {
    expect(
      channelMemberSelectorForActor({ type: "user", id: "user_alice" }),
    ).toEqual({
      memberType: CHANNEL_MEMBER_TYPES.USER,
      userId: "user_alice",
    });

    expect(
      channelMemberSelectorForActor({ type: "agent", id: "agent_triage" }),
    ).toEqual({
      memberType: CHANNEL_MEMBER_TYPES.AGENT,
      agentId: "agent_triage",
    });

    expect(
      channelMemberSelectorForActor({ type: "system", id: "system" }),
    ).toBeNull();
  });

  it("finds the exact channel membership for humans and agents", () => {
    const members = [userMember, viewerMember, agentMember];

    expect(
      findChannelMembership({ type: "user", id: "user_alice" }, members),
    ).toBe(userMember);
    expect(
      findChannelMembership({ type: "agent", id: "agent_triage" }, members),
    ).toBe(agentMember);
    expect(
      findChannelMembership({ type: "user", id: "user_unknown" }, members),
    ).toBeNull();
  });

  it("allows reads for any explicit member and denies non-members", () => {
    expect(canReadChannel(viewerMember)).toBe(true);
    expect(canReadChannel(null)).toBe(false);
  });

  it("role-gates posting and honors explicit overrides", () => {
    expect(canPostToChannelFromMembership(userMember)).toBe(true);
    expect(canPostToChannelFromMembership(viewerMember)).toBe(false);
    expect(
      canPostToChannelFromMembership({
        ...viewerMember,
        canPostOverride: true,
      }),
    ).toBe(true);
    expect(
      canPostToChannelFromMembership({ ...userMember, canPostOverride: false }),
    ).toBe(false);
  });

  it("limits invite and membership management to channel owners/admins unless overridden", () => {
    expect(canInviteChannelMembersFromMembership(userMember)).toBe(false);
    expect(
      canInviteChannelMembersFromMembership({
        ...userMember,
        role: CHANNEL_ROLES.ADMIN,
      }),
    ).toBe(true);
    expect(
      canInviteChannelMembersFromMembership({
        ...userMember,
        canInviteOverride: true,
      }),
    ).toBe(true);
  });

  it("uses agent participation mode to prevent noisy or silent agents", () => {
    expect(canAgentSpeakInChannel(agentMember)).toBe(true);
    expect(
      canAgentWatchChannel({
        ...agentMember,
        agentParticipationMode: AGENT_PARTICIPATION_MODES.WATCHING,
      }),
    ).toBe(true);
    expect(
      canAgentSpeakInChannel({
        ...agentMember,
        agentParticipationMode: AGENT_PARTICIPATION_MODES.WATCHING,
      }),
    ).toBe(false);
    expect(
      canAgentWatchChannel({
        ...agentMember,
        agentParticipationMode: AGENT_PARTICIPATION_MODES.SILENT,
      }),
    ).toBe(false);
  });
});
