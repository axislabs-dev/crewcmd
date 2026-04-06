import { test, expect } from "@playwright/test";
import { apiPost, apiGet, apiPatch, uniqueName, loginViaApi } from "./helpers";

test.describe("Inbox", () => {
  let companyId: string;

  test.beforeAll(async ({ request }) => {
    await loginViaApi(request);

    // Get (or create) a company for inbox tests
    const companies = await apiGet(request, "/api/companies");
    if (Array.isArray(companies) && companies.length > 0) {
      companyId = companies[0].id;
    } else {
      const company = await apiPost(request, "/api/companies", {
        name: uniqueName("E2E-Company"),
      });
      companyId = company.id;
    }
  });

  test.beforeEach(async ({ request }) => {
    await loginViaApi(request);
  });

  test("GET /api/inbox returns messages", async ({ request }) => {
    const messages = await apiGet(request, "/api/inbox");
    expect(Array.isArray(messages)).toBe(true);
  });

  test("POST /api/inbox creates an inbox message", async ({ request }) => {
    const title = uniqueName("E2E-Inbox");
    const message = await apiPost(request, "/api/inbox", {
      companyId,
      fromAgentId: "NEO",
      type: "update",
      priority: "normal",
      title,
      body: "Automated E2E test message",
    });

    expect(message.id).toBeTruthy();
    expect(message.title).toBe(title);
    expect(message.type).toBe("update");
    expect(message.status).toBe("unread");
    expect(message.fromAgentId).toBe("NEO");
  });

  test("POST /api/inbox with actions and context", async ({ request }) => {
    const title = uniqueName("E2E-Decision");
    const message = await apiPost(request, "/api/inbox", {
      companyId,
      fromAgentId: "CIPHER",
      type: "decision",
      priority: "high",
      title,
      body: "Need approval for deployment",
      context: {
        taskId: "test-task-123",
        relatedAgents: ["NEO", "CIPHER"],
      },
      actions: [
        {
          id: "approve",
          label: "Approve",
          style: "primary",
          action: "approve",
        },
        {
          id: "reject",
          label: "Reject",
          style: "danger",
          action: "reject",
        },
      ],
    });

    expect(message.type).toBe("decision");
    expect(message.priority).toBe("high");
    expect(message.context).toBeTruthy();
    expect(message.actions).toHaveLength(2);
  });

  test("PATCH /api/inbox/:id marks message as actioned", async ({ request }) => {
    const title = uniqueName("E2E-Action");
    const message = await apiPost(request, "/api/inbox", {
      companyId,
      fromAgentId: "HAVOC",
      type: "question",
      title,
      body: "Should we launch?",
    });

    const updated = await apiPatch(request, `/api/inbox/${message.id}`, {
      status: "actioned",
      actionResult: "Yes, approved",
      actionedBy: "e2e-test",
    });

    expect(updated.status).toBe("actioned");
    expect(updated.actionResult).toBe("Yes, approved");
    expect(updated.actionedAt).toBeTruthy();
  });

  test("PATCH /api/inbox/:id snoozes a message", async ({ request }) => {
    const title = uniqueName("E2E-Snooze");
    const message = await apiPost(request, "/api/inbox", {
      companyId,
      fromAgentId: "PULSE",
      type: "update",
      title,
      body: "Non-urgent update",
    });

    const snoozeUntil = new Date(Date.now() + 3600_000).toISOString();
    const updated = await apiPatch(request, `/api/inbox/${message.id}`, {
      status: "snoozed",
      snoozeUntil,
    });

    expect(updated.status).toBe("snoozed");
    expect(updated.snoozeUntil).toBeTruthy();
  });

  test("GET /api/inbox filters by status", async ({ request }) => {
    // Create an unread message
    await apiPost(request, "/api/inbox", {
      companyId,
      fromAgentId: "GHOST",
      type: "update",
      title: uniqueName("E2E-Filter"),
      body: "Filter test",
    });

    const unread = await apiGet(request, "/api/inbox?status=unread");
    expect(Array.isArray(unread)).toBe(true);
    for (const m of unread) {
      expect(m.status).toBe("unread");
    }
  });

  test("GET /api/inbox filters by priority", async ({ request }) => {
    await apiPost(request, "/api/inbox", {
      companyId,
      fromAgentId: "VIPER",
      type: "escalation",
      priority: "critical",
      title: uniqueName("E2E-Critical"),
      body: "Critical escalation",
    });

    const critical = await apiGet(request, "/api/inbox?priority=critical");
    expect(Array.isArray(critical)).toBe(true);
    for (const m of critical) {
      expect(m.priority).toBe("critical");
    }
  });

  test("GET /api/inbox filters by type", async ({ request }) => {
    const msgs = await apiGet(request, "/api/inbox?type=escalation");
    expect(Array.isArray(msgs)).toBe(true);
    for (const m of msgs) {
      expect(m.type).toBe("escalation");
    }
  });
});

test.describe("Chat sessions", () => {
  let companyId: string;

  test.beforeAll(async ({ request }) => {
    await loginViaApi(request);

    const companies = await apiGet(request, "/api/companies");
    if (Array.isArray(companies) && companies.length > 0) {
      companyId = companies[0].id;
    } else {
      const company = await apiPost(request, "/api/companies", {
        name: uniqueName("E2E-ChatCo"),
      });
      companyId = company.id;
    }
  });

  test.beforeEach(async ({ request }) => {
    await loginViaApi(request);
  });

  test("POST /api/chat/sessions creates a session", async ({ request }) => {
    const res = await apiPost(request, "/api/chat/sessions", {
      agentId: "neo",
      companyId,
      title: uniqueName("E2E-Chat"),
    });

    expect(res.session).toBeDefined();
    expect(res.session.agentId).toBe("neo");
    expect(res.session.companyId).toBe(companyId);
  });

  test("GET /api/chat/sessions lists sessions for company", async ({ request }) => {
    // Create a session first
    await apiPost(request, "/api/chat/sessions", {
      agentId: "cipher",
      companyId,
    });

    const res = await apiGet(
      request,
      `/api/chat/sessions?companyId=${companyId}`,
    );
    expect(res.sessions).toBeDefined();
    expect(Array.isArray(res.sessions)).toBe(true);
    expect(res.sessions.length).toBeGreaterThanOrEqual(1);
  });

  test("GET /api/chat/sessions filters by agentId", async ({ request }) => {
    const agentId = `e2echat${Date.now()}`;
    await apiPost(request, "/api/chat/sessions", {
      agentId,
      companyId,
    });

    const res = await apiGet(
      request,
      `/api/chat/sessions?companyId=${companyId}&agentId=${agentId}`,
    );
    expect(res.sessions).toBeDefined();
    for (const s of res.sessions) {
      expect(s.agentId).toBe(agentId);
    }
  });
});
