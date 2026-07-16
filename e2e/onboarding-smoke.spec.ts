import { expect, test } from "@playwright/test";

const ADMIN = {
  name: "Fresh Install Admin",
  email: "fresh-install@crewcmd.test",
  password: "fresh-install-password",
};

test("fresh install reaches a durable first task", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveTitle(/CrewCmd/i);
  await expect(page.getByRole("heading", { name: "CREATE YOUR ACCOUNT" })).toBeVisible();
  await page.getByPlaceholder("Your name").fill(ADMIN.name);
  await page.getByPlaceholder("you@example.com").fill(ADMIN.email);
  await page.getByPlaceholder("Min 8 characters").fill(ADMIN.password);
  await page.getByRole("button", { name: "CREATE ACCOUNT" }).click();

  await expect(page).toHaveURL(/\/onboarding$/);
  await expect(page.getByRole("heading", { name: "CREATE YOUR COMPANY" })).toBeVisible();

  const initialWorkspacesResponse = await page.request.get("/api/workspaces");
  expect(initialWorkspacesResponse.ok()).toBe(true);
  const initialWorkspaces = await initialWorkspacesResponse.json() as {
    workspaces: Array<{ id: string; name: string; type: string }>;
  };
  const personalWorkspace = initialWorkspaces.workspaces.find(({ type }) => type === "personal");
  expect(personalWorkspace).toMatchObject({ name: ADMIN.name, type: "personal" });

  const channelsResponse = await page.request.get(
    `/api/channels?workspaceId=${personalWorkspace!.id}`,
  );
  expect(channelsResponse.ok()).toBe(true);
  const channels = await channelsResponse.json() as {
    channels: Array<{ name: string }>;
  };
  expect(channels.channels.map(({ name }) => name)).toContain("crew");

  await page.getByPlaceholder("e.g., Acme Corp").fill("Fresh Install Company");
  await page.getByRole("button", { name: "CREATE COMPANY" }).click();
  await expect(page.getByRole("heading", { name: "BUILD YOUR TEAM" })).toBeVisible();
  await page.getByRole("button", { name: "SKIP FOR NOW" }).click();

  const personalReady = page.getByRole("heading", { name: "PERSONAL WORKSPACE READY" });
  const inviteTeam = page.getByRole("heading", { name: "INVITE YOUR TEAM" });
  await expect(personalReady.or(inviteTeam)).toBeVisible();
  if (await personalReady.isVisible()) {
    await page.getByRole("button", { name: "GO TO CHAT" }).click();
    await expect(page).toHaveURL(/\/chat$/);
  } else {
    await page.getByRole("button", { name: "SKIP", exact: true }).click();
    await expect(page).toHaveURL(/\/team$/);
  }

  const taskTitle = "Verify the fresh CrewCMD install";
  await page.goto("/tasks");
  await expect(page.getByRole("button", { name: "NEW TASK" })).toBeVisible();
  await page.getByRole("button", { name: "NEW TASK" }).click();
  await page.getByPlaceholder("Task title...").fill(taskTitle);
  await page.getByRole("button", { name: "CREATE TASK" }).click();
  await expect(page.getByText(taskTitle, { exact: true })).toBeVisible();

  await page.goto("/settings");
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { name: "SIGN IN" })).toBeVisible();

  await page.getByPlaceholder("you@example.com").fill(ADMIN.email);
  await page.getByPlaceholder("Min 8 characters").fill(ADMIN.password);
  await page.getByRole("button", { name: "SIGN IN" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);

  await page.goto("/tasks");
  await expect(page.getByText(taskTitle, { exact: true })).toBeVisible();
});
