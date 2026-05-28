import { test, expect } from "@playwright/test";
import { apiPost, apiGet, apiPatch, apiDelete, uniqueName, loginViaApi } from "./helpers";

test.describe("Projects CRUD", () => {
  test.beforeEach(async ({ request }) => {
    await loginViaApi(request);
  });

  test("GET /api/projects returns created projects", async ({ request }) => {
    const firstName = uniqueName("E2E-ListProject-A");
    const secondName = uniqueName("E2E-ListProject-B");
    await apiPost(request, "/api/projects", { name: firstName });
    await apiPost(request, "/api/projects", { name: secondName });

    const projects = await apiGet(request, "/api/projects");
    expect(Array.isArray(projects)).toBe(true);
    const names = projects.map((p: { name: string }) => p.name);
    expect(names).toContain(firstName);
    expect(names).toContain(secondName);
  });

  test("POST /api/projects creates a new project", async ({ request }) => {
    const name = uniqueName("E2E-Project");
    const project = await apiPost(request, "/api/projects", {
      name,
      description: "Created by E2E test",
      color: "#ff0000",
      status: "active",
    });

    expect(project.id).toBeTruthy();
    expect(project.name).toBe(name);
    expect(project.description).toBe("Created by E2E test");
    expect(project.color).toBe("#ff0000");
    expect(project.status).toBe("active");
  });

  test("GET /api/projects/:id returns project with tasks", async ({ request }) => {
    // Create a project
    const name = uniqueName("E2E-Detail");
    const created = await apiPost(request, "/api/projects", { name });

    // Fetch by ID
    const detail = await apiGet(request, `/api/projects/${created.id}`);
    expect(detail.name).toBe(name);
    expect(Array.isArray(detail.tasks)).toBe(true);
  });

  test("PATCH /api/projects/:id updates a project", async ({ request }) => {
    const name = uniqueName("E2E-Update");
    const created = await apiPost(request, "/api/projects", { name });

    const updated = await apiPatch(request, `/api/projects/${created.id}`, {
      description: "Updated description",
      status: "completed",
    });

    expect(updated.description).toBe("Updated description");
    expect(updated.status).toBe("completed");
  });

  test("DELETE /api/projects/:id removes a project", async ({ request }) => {
    const name = uniqueName("E2E-Delete");
    const created = await apiPost(request, "/api/projects", { name });

    const deleted = await apiDelete(request, `/api/projects/${created.id}`);
    expect(deleted.id).toBe(created.id);
  });

  test("GET /api/projects?status=active filters by status", async ({ request }) => {
    const projects = await apiGet(request, "/api/projects?status=active");
    expect(Array.isArray(projects)).toBe(true);
    for (const p of projects) {
      expect(p.status).toBe("active");
    }
  });
});
