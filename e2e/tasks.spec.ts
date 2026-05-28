import { test, expect } from "@playwright/test";
import { apiPost, apiGet, apiPatch, apiDelete, uniqueName, loginViaApi } from "./helpers";

test.describe("Tasks lifecycle", () => {
  test.beforeEach(async ({ request }) => {
    await loginViaApi(request);
  });

  test("GET /api/tasks returns created tasks", async ({ request }) => {
    const firstTitle = uniqueName("E2E-ListTask-A");
    const secondTitle = uniqueName("E2E-ListTask-B");
    await apiPost(request, "/api/tasks", { title: firstTitle, status: "inbox" });
    await apiPost(request, "/api/tasks", { title: secondTitle, status: "queued" });

    const tasks = await apiGet(request, "/api/tasks");
    expect(Array.isArray(tasks)).toBe(true);
    const titles = tasks.map((task: { title: string }) => task.title);
    expect(titles).toContain(firstTitle);
    expect(titles).toContain(secondTitle);
  });

  test("POST /api/tasks creates a task in inbox", async ({ request }) => {
    const title = uniqueName("E2E-Task");
    const task = await apiPost(request, "/api/tasks", {
      title,
      description: "Created by E2E test",
      status: "inbox",
      priority: "high",
    });

    expect(task.id).toBeTruthy();
    expect(task.title).toBe(title);
    expect(task.status).toBe("inbox");
    expect(task.priority).toBe("high");
    expect(task.shortId).toBeTruthy();
  });

  test("task lifecycle: inbox → queued → in_progress → review → done", async ({ request }) => {
    const title = uniqueName("E2E-Lifecycle");
    const task = await apiPost(request, "/api/tasks", {
      title,
      status: "inbox",
      priority: "medium",
    });
    expect(task.status).toBe("inbox");

    // inbox → queued
    const queued = await apiPatch(request, `/api/tasks/${task.id}`, {
      status: "queued",
    });
    expect(queued.status).toBe("queued");

    // queued → in_progress
    const inProgress = await apiPatch(request, `/api/tasks/${task.id}`, {
      status: "in_progress",
      assignedAgentId: "NEO",
    });
    expect(inProgress.status).toBe("in_progress");

    // in_progress → review
    const review = await apiPatch(request, `/api/tasks/${task.id}`, {
      status: "review",
      reviewNotes: "Ready for review",
    });
    expect(review.status).toBe("review");

    // review → done
    const done = await apiPatch(request, `/api/tasks/${task.id}`, {
      status: "done",
    });
    expect(done.status).toBe("done");
  });

  test("GET /api/tasks?status=inbox filters by status", async ({ request }) => {
    const tasks = await apiGet(request, "/api/tasks?status=inbox");
    expect(Array.isArray(tasks)).toBe(true);
    for (const t of tasks) {
      expect(t.status).toBe("inbox");
    }
  });

  test("GET /api/tasks?priority=critical filters by priority", async ({ request }) => {
    // Create a critical task first
    const title = uniqueName("E2E-Critical");
    await apiPost(request, "/api/tasks", {
      title,
      priority: "critical",
      status: "inbox",
    });

    const tasks = await apiGet(request, "/api/tasks?priority=critical");
    expect(Array.isArray(tasks)).toBe(true);
    expect(tasks.length).toBeGreaterThanOrEqual(1);
    for (const t of tasks) {
      expect(t.priority).toBe("critical");
    }
  });

  test("PATCH /api/tasks/:id assigns an agent", async ({ request }) => {
    const title = uniqueName("E2E-Assign");
    const task = await apiPost(request, "/api/tasks", {
      title,
      status: "queued",
    });

    const updated = await apiPatch(request, `/api/tasks/${task.id}`, {
      assignedAgentId: "CIPHER",
    });
    expect(updated.assignedAgentId).toBe("CIPHER");
  });

  test("DELETE /api/tasks/:id removes a task", async ({ request }) => {
    const title = uniqueName("E2E-DeleteTask");
    const task = await apiPost(request, "/api/tasks", {
      title,
      status: "inbox",
    });

    const deleted = await apiDelete(request, `/api/tasks/${task.id}`);
    expect(deleted.id).toBe(task.id);
  });

  test("POST /api/tasks deduplicates by errorHash", async ({ request }) => {
    const hash = `e2e-hash-${Date.now()}`;
    const title = uniqueName("E2E-Dedup");

    // First creation succeeds
    const task = await apiPost(request, "/api/tasks", {
      title,
      status: "inbox",
      errorHash: hash,
    });
    expect(task.id).toBeTruthy();

    // Second creation with same hash returns 409
    const res = await request.post("/api/tasks", {
      data: { title: "Duplicate", status: "inbox", errorHash: hash },
    });
    expect(res.status()).toBe(409);
    const body = await res.json();
    expect(body.existingTask).toBeTruthy();
  });

  test("task comments CRUD", async ({ request }) => {
    const title = uniqueName("E2E-Comments");
    const task = await apiPost(request, "/api/tasks", {
      title,
      status: "inbox",
    });

    // Add a comment
    const comment = await apiPost(request, `/api/tasks/${task.id}/comments`, {
      content: "E2E test comment",
    });
    expect(comment.content).toBe("E2E test comment");
    expect(comment.taskId).toBe(task.id);

    // List comments
    const comments = await apiGet(request, `/api/tasks/${task.id}/comments`);
    expect(Array.isArray(comments)).toBe(true);
    expect(comments.length).toBeGreaterThanOrEqual(1);
    expect(comments.some((c: { content: string }) => c.content === "E2E test comment")).toBe(true);
  });
});
