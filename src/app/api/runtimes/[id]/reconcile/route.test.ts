import { beforeEach, describe, expect, it, vi } from "vitest";

type Field = { key: string };
type Predicate = (row: Record<string, unknown>) => boolean;

const mocks = vi.hoisted(() => ({
  access: { userId: "user-1", activeCompanyId: null, memberships: [] },
  runtime: {
    id: "runtime-new",
    name: "Personal Runtime",
    runtimeType: "openclaw",
    status: "connected",
    ownerType: "user",
    ownerUserId: "user-1",
    ownerCompanyId: null,
    companyId: null,
  },
  agents: [] as Array<Record<string, unknown>>,
  members: [] as Array<Record<string, unknown>>,
  channels: [] as Array<Record<string, unknown>>,
  grants: [] as Array<Record<string, unknown>>,
  deletedTables: [] as string[],
  tables: {
    companyRuntimes: {
      table: "companyRuntimes",
      id: { key: "id" },
    },
    channelMembers: {
      table: "channelMembers",
      channelId: { key: "channelId" },
      agentId: { key: "agentId" },
    },
    channels: {
      table: "channels",
      id: { key: "id" },
      companyId: { key: "companyId" },
      workspaceId: { key: "workspaceId" },
      type: { key: "type" },
      archivedAt: { key: "archivedAt" },
    },
    agentWorkspaceGrants: {
      table: "agentWorkspaceGrants",
      workspaceId: { key: "workspaceId" },
      agentId: { key: "agentId" },
    },
  },
}));

vi.mock("@/db/schema", () => mocks.tables);

vi.mock("drizzle-orm", () => ({
  and: (...predicates: Predicate[]): Predicate =>
    (row) => predicates.every((predicate) => predicate(row)),
  eq: (field: Field, value: unknown): Predicate =>
    (row) => row[field.key] === value,
  inArray: (field: Field, values: unknown[]): Predicate =>
    (row) => values.includes(row[field.key]),
  isNull: (field: Field): Predicate =>
    (row) => row[field.key] == null,
}));

vi.mock("@/db", () => {
  function rowsFor(table: { table: string }): Array<Record<string, unknown>> {
    if (table.table === "companyRuntimes") return [mocks.runtime as Record<string, unknown>];
    if (table.table === "channelMembers") return mocks.members;
    if (table.table === "channels") return mocks.channels;
    if (table.table === "agentWorkspaceGrants") return mocks.grants;
    return [];
  }

  function queryResult(rows: Array<Record<string, unknown>>) {
    return {
      then: <TResult1 = Array<Record<string, unknown>>, TResult2 = never>(
        onfulfilled?: ((value: Array<Record<string, unknown>>) => TResult1 | PromiseLike<TResult1>) | null,
        onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
      ) => Promise.resolve(rows).then(onfulfilled, onrejected),
      limit: (count: number) => Promise.resolve(rows.slice(0, count)),
    };
  }

  const database: Record<string, unknown> = {
    select: (selection?: Record<string, Field>) => ({
      from: (table: { table: string }) => ({
        where: (predicate: Predicate) => {
          const rows = rowsFor(table).filter((row) => predicate(row));
          const selected = selection
            ? rows.map((row) => Object.fromEntries(
                Object.entries(selection).map(([key, field]) => [key, row[field.key]]),
              ))
            : rows;
          return queryResult(selected);
        },
      }),
    }),
    update: (table: { table: string }) => ({
      set: (values: Record<string, unknown>) => ({
        where: async (predicate: Predicate) => {
          for (const row of rowsFor(table)) {
            if (predicate(row)) Object.assign(row, values);
          }
        },
      }),
    }),
    delete: (table: { table: string }) => ({
      where: async (predicate: Predicate) => {
        mocks.deletedTables.push(table.table);
        if (table.table !== "agentWorkspaceGrants") return;
        for (let index = mocks.grants.length - 1; index >= 0; index -= 1) {
          if (predicate(mocks.grants[index])) mocks.grants.splice(index, 1);
        }
      },
    }),
    transaction: (operation: (tx: unknown) => unknown) => operation(database),
  };

  return {
    db: database,
    withRetry: (operation: () => unknown) => operation(),
  };
});

vi.mock("@/lib/agent-access", () => ({
  canManageCompanyOwnedAgent: () => false,
  getAgentAccessContext: () => mocks.access,
}));

vi.mock("@/lib/workspace", () => ({
  listWorkspaceAgents: () => mocks.agents,
  resolveRuntimeWorkspace: () => ({
    id: "workspace-personal",
    type: "personal",
    name: "Personal Workspace",
    ownerUserId: "user-1",
    companyId: null,
  }),
}));

import { GET, POST } from "./route";

function context() {
  return { params: Promise.resolve({ id: "runtime-new" }) };
}

function request(agentIds: string[]) {
  return new Request("http://localhost/api/runtimes/runtime-new/reconcile", {
    method: "POST",
    body: JSON.stringify({ agentIds }),
  });
}

function agent(overrides: Record<string, unknown>) {
  return {
    id: "agent",
    callsign: "AGENT",
    name: "Agent",
    title: "Agent",
    emoji: "🤖",
    status: "offline",
    runtimeId: null,
    runtimeRef: null,
    ...overrides,
  };
}

describe("runtime reconciliation", () => {
  beforeEach(() => {
    mocks.access.userId = "user-1";
    mocks.runtime.ownerUserId = "user-1";
    mocks.deletedTables.length = 0;
    mocks.agents.splice(0, mocks.agents.length,
      agent({ id: "agent-current", callsign: "NEO", runtimeId: "runtime-new", runtimeRef: "main", status: "online" }),
      agent({ id: "agent-detached", callsign: "ATLAS", runtimeRef: "atlas" }),
      agent({ id: "agent-unbound", callsign: "PIXEL" }),
      agent({ id: "agent-other", callsign: "HERMES", runtimeId: "runtime-other", runtimeRef: "hermes" }),
    );
    mocks.members.splice(0, mocks.members.length,
      { channelId: "dm-atlas", agentId: "agent-detached" },
      { channelId: "dm-pixel", agentId: "agent-unbound" },
      { channelId: "channel-atlas", agentId: "agent-detached" },
      { channelId: "dm-archived", agentId: "agent-detached" },
    );
    mocks.channels.splice(0, mocks.channels.length,
      { id: "dm-atlas", workspaceId: "workspace-personal", companyId: null, type: "dm", archivedAt: null },
      { id: "dm-pixel", workspaceId: "workspace-personal", companyId: null, type: "dm", archivedAt: null },
      { id: "channel-atlas", workspaceId: "workspace-personal", companyId: null, type: "channel", archivedAt: null },
      { id: "dm-archived", workspaceId: "workspace-personal", companyId: null, type: "dm", archivedAt: new Date() },
    );
    mocks.grants.splice(0, mocks.grants.length,
      { workspaceId: "workspace-personal", agentId: "agent-current" },
      { workspaceId: "workspace-personal", agentId: "agent-detached" },
      { workspaceId: "workspace-personal", agentId: "agent-unbound" },
      { workspaceId: "workspace-personal", agentId: "agent-other" },
    );
  });

  it("previews current, suggested, and ambiguous agents without changing data", async () => {
    const response = await GET(new Request("http://localhost"), context());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      current: [{ id: "agent-current", callsign: "NEO", dmCount: 0 }],
      suggested: [{ id: "agent-detached", callsign: "ATLAS", dmCount: 1 }],
      unbound: [{ id: "agent-unbound", callsign: "PIXEL", dmCount: 1 }],
      otherRuntimeCount: 1,
      summary: {
        activeAgents: 1,
        suggestedAgents: 1,
        unboundAgents: 1,
        affectedDms: 2,
      },
    });
    expect(mocks.grants).toHaveLength(4);
    expect(mocks.channels.every((channel) => channel.id === "dm-archived" || channel.archivedAt == null)).toBe(true);
  });

  it("archives selected agents from the roster and preserves channel records", async () => {
    const response = await POST(request(["agent-detached", "agent-unbound"]), context());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      archivedAgents: 2,
      archivedDms: 2,
      messagesDeleted: 0,
    });
    expect(mocks.grants).toEqual([
      { workspaceId: "workspace-personal", agentId: "agent-current" },
      { workspaceId: "workspace-personal", agentId: "agent-other" },
    ]);
    expect(mocks.channels.find((channel) => channel.id === "dm-atlas")?.archivedAt).toBeInstanceOf(Date);
    expect(mocks.channels.find((channel) => channel.id === "dm-pixel")?.archivedAt).toBeInstanceOf(Date);
    expect(mocks.channels.find((channel) => channel.id === "channel-atlas")?.archivedAt).toBeNull();
    expect(mocks.deletedTables).toEqual(["agentWorkspaceGrants"]);
  });

  it("refuses to archive an agent active on the selected runtime", async () => {
    const response = await POST(request(["agent-current"]), context());

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      invalidAgentIds: ["agent-current"],
    });
    expect(mocks.grants).toHaveLength(4);
    expect(mocks.deletedTables).toEqual([]);
  });

  it("rejects a runtime owned by another user", async () => {
    mocks.runtime.ownerUserId = "user-2";

    const response = await GET(new Request("http://localhost"), context());

    expect(response.status).toBe(403);
  });
});
