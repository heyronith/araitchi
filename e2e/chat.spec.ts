import { expect, test } from "@playwright/test";

async function saveOpenRouterKey(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Open settings" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  const input = page.getByLabel(/OpenRouter API key/i);
  await input.fill("sk-or-v1-fake-e2e-key");
  await page.getByRole("button", { name: "Save" }).nth(0).click();
  await expect(page.getByText("Saved").first()).toBeVisible();
  await page.keyboard.press("Escape");
}

async function ensureSoloChat(page: import("@playwright/test").Page) {
  await page
    .getByRole("group", { name: "Research mode" })
    .getByRole("button", { name: "Solo", exact: true })
    .click();
  await page.getByRole("button", { name: "New chat" }).first().click();
  await expect(page.getByLabel("Select model")).toBeVisible({
    timeout: 15_000,
  });
}

test.describe("solo chat", () => {
  test("stream reply with code copy and cost footer", async ({ page }) => {
    await saveOpenRouterKey(page);
    await ensureSoloChat(page);

    await page.getByRole("textbox", { name: "Message" }).fill("Hello from e2e");
    await page.getByRole("button", { name: "Send message" }).click();

    await expect(page.getByText("Done.").first()).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByRole("button", { name: "Copy code" })).toBeVisible();
    await expect(page.getByText(/\$0\.0012|0\.0012/)).toBeVisible({
      timeout: 10_000,
    });
  });

  test("retry creates a branch; edit creates another", async ({ page }) => {
    await saveOpenRouterKey(page);
    await ensureSoloChat(page);
    await page.getByRole("textbox", { name: "Message" }).fill("Branch me");
    await page.getByRole("button", { name: "Send message" }).click();
    await expect(page.getByText("Done.").first()).toBeVisible({
      timeout: 20_000,
    });

    await page.getByRole("button", { name: "Retry" }).last().click();
    await expect(page.getByText("2/2")).toBeVisible({ timeout: 20_000 });

    await page.getByRole("button", { name: "Edit message" }).first().click();
    await page.locator('textarea[rows="3"]').fill("Edited user message");
    await page.getByRole("button", { name: /Save.*branch/i }).click();
    await expect(page.getByText("Done.").first()).toBeVisible({
      timeout: 20_000,
    });
    // Editing creates another assistant sibling branch.
    await expect(page.getByText(/\d\/\d/).first()).toBeVisible();
  });

  test("stop cancels an in-flight stream", async ({ page }) => {
    test.setTimeout(60_000);
    await saveOpenRouterKey(page);
    await ensureSoloChat(page);
    await page.getByRole("textbox", { name: "Message" }).fill("Stop please");
    await page.getByRole("button", { name: "Send message" }).click();
    await expect(
      page.getByRole("button", { name: "Stop generating" }),
    ).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: "Stop generating" }).click();
    await expect(
      page.getByRole("button", { name: "Send message" }),
    ).toBeVisible({ timeout: 15_000 });
  });

  test("reload restores chat; rename and delete work", async ({ page }) => {
    await saveOpenRouterKey(page);
    await ensureSoloChat(page);
    await page
      .getByRole("textbox", { name: "Message" })
      .fill("Persist this conversation forever");
    await page.getByRole("button", { name: "Send message" }).click();
    await expect(page.getByText("Done.").first()).toBeVisible({
      timeout: 20_000,
    });

    await page.reload();
    await expect(page.getByText("Done.").first()).toBeVisible({
      timeout: 15_000,
    });
    await expect(
      page.getByText(/Persist this conversation/, { exact: false }).first(),
    ).toBeVisible();

    await page.getByRole("button", { name: "Chat actions" }).first().click();
    await page.getByRole("menuitem", { name: "Rename" }).click();
    await page.getByLabel("Rename chat").fill("Renamed chat");
    await page.getByLabel("Rename chat").press("Enter");
    await expect(page.getByText("Renamed chat")).toBeVisible();

    await page.getByRole("button", { name: "Chat actions" }).first().click();
    await page.getByRole("menuitem", { name: "Delete" }).click();
    await page.getByRole("button", { name: "Delete" }).click();
    await expect(page.getByText("Renamed chat")).toHaveCount(0);
  });
});

test.describe("OpenRouter OAuth", () => {
  test("connect sets cookie; callback stores key without leaking it", async ({
    page,
    context,
    request,
  }) => {
    const connectRes = await page.request.get("/api/openrouter/connect", {
      maxRedirects: 0,
    });
    expect([302, 307, 308]).toContain(connectRes.status());
    const location = connectRes.headers().location ?? "";
    expect(location).toContain("/auth");
    expect(location).toContain("code_challenge");

    const cookies = await context.cookies();
    const verifier = cookies.find((c) => c.name === "araitchi_or_verifier");
    expect(verifier?.value.length).toBeGreaterThanOrEqual(43);

    // Simulate callback with mock code (cookie already set from connect)
    await page.goto("/api/openrouter/callback?code=mock-auth-code");
    await expect(page).toHaveURL(/connected=openrouter|\/$/);
    expect(page.url()).not.toMatch(/sk-or-/);

    await page.getByRole("button", { name: "Open settings" }).click();
    await expect(page.getByText("Saved").first()).toBeVisible();
    await expect(page.locator("body")).not.toContainText("sk-or-v1-mock");

    const secrets = await request.get("/api/secrets");
    const body = await secrets.text();
    expect(body).not.toMatch(/sk-or-/);
  });
});
