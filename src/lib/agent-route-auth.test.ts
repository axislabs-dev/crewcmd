import { beforeEach, describe, expect, it, vi } from "vitest";

const agent = {
  id: "agent-1",
  callsign: "SCOUT",
  ownerType: "user",
  ownerUserId: "owner-1",
  ownerCompanyId: null,
  visibility: "private",
};

const mockCanReadAgent = vi.fn();
const mockGetAgentAccessContext = vi.fn();
const mockResolveAccessibleWorkspace = vi.fn();
const mockGrantRows = vi.fn();

vi.mock("drizzle-orm", () => ({
  and: vi.fn(() => "and-clause"),
  eq: vi.fn(() => "eq-clause"),
}));

vi.mock("@/db/schema", () => ({
  agents: "agents-table",
  agentWorkspaceGrants: {
    id: "grant-id-column",
    agentId: "grant-agent-id-column",
    workspaceId: "grant-workspace-id-column",
  },
}));

vi.mock("@/db", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn((table: string) => {
        if (table === "agents-table") return Promise.resolve([agent]);
        return {
          where: vi.fn(() => ({
            limit: vi.fn(() => Promise.resolve(mockGrantRows())),
          })),
        };
      }),
    })),
  },
  withRetry: (fn: () => unknown) => fn(),
}));

vi.mock("@/lib/agent-access", () => ({
  canReadAgent: (...args: unknown[]) => mockCanReadAgent(...args),
  getAgentAccessContext: () => mockGetAgentAccessContext(),
}));

vi.mock("@/lib/workspace", () => ({
  resolveAccessibleWorkspace: (...args: unknown[]) => mockResolveAccessibleWorkspace(...args),
}));

import { resolveReadableAgentByCallsign } from "./agent-route-auth";

describe("resolveReadableAgentByCallsign", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAgentAccessContext.mockResolvedValue({ userId: "user-1", activeCompanyId: null, memberships: [] });
    mockCanReadAgent.mockReturnValue(false);
    mockResolveAccessibleWorkspace.mockResolvedValue(null);
    mockGrantRows.mockReturnValue([]);
  });

  it("returns the agent when existing ownership/company policy allows reading", async () => {
    mockCanReadAgent.mockReturnValue(true);

    await expect(resolveReadableAgentByCallsign("scout", new Request("http://test"))).resolves.toMatchObject({
      id: "agent-1",
      callsign: "SCOUT",
    });

    expect(mockResolveAccessibleWorkspace).not.toHaveBeenCalled();
  });

  it("returns null when the user has neither agent policy access nor a workspace grant", async () => {
    mockResolveAccessibleWorkspace.mockResolvedValue({ id: "workspace-1" });
    mockGrantRows.mockReturnValue([]);

    await expect(resolveReadableAgentByCallsign("scout", new Request("http://test"))).resolves.toBeNull();
  });

  it("allows a callsign read through an accessible workspace grant", async () => {
    mockResolveAccessibleWorkspace.mockResolvedValue({ id: "workspace-1" });
    mockGrantRows.mockReturnValue([{ id: "grant-1" }]);

    await expect(resolveReadableAgentByCallsign("SCOUT", new Request("http://test"))).resolves.toMatchObject({
      id: "agent-1",
    });
  });
});
