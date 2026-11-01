import { expect, test } from "@playwright/test";

test.describe("Araitchi shell", () => {
  test("loads shell chrome", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByText("Araitchi").first()).toBeVisible();
    await expect(
      page.getByRole("group", { name: "Research mode" }),
    ).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Message" })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: /researching/i }),
    ).toBeVisible();
  });

  test("settings key save/remove never exposes secret values", async ({
    page,
    request,
  }) => {
    const fakeKey = "sk-or-fake-e2e-key-do-not-leak";

    await page.goto("/");
    await page.getByRole("button", { name: "Open settings" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByRole("tab", { name: "Keys" })).toBeVisible();

    const openrouterInput = page.getByLabel(/OpenRouter API key/i);
    await openrouterInput.fill(fakeKey);
    await page.getByRole("button", { name: "Save" }).first().click();

    await expect(page.getByText("Saved").first()).toBeVisible();
    await expect(openrouterInput).toHaveValue("");
    await expect(page.locator("body")).not.toContainText(fakeKey);

    const secretsResponse = await request.get("/api/secrets");
    expect(secretsResponse.ok()).toBeTruthy();
    const secretsBody = await secretsResponse.text();
    expect(secretsBody).not.toContain(fakeKey);
    const secretsJson = JSON.parse(secretsBody) as Array<{
      name: string;
      set: boolean;
    }>;
    expect(secretsJson.every((s) => typeof s.set === "boolean")).toBe(true);
    expect(secretsJson.find((s) => s.name === "openrouter_api_key")?.set).toBe(
      true,
    );

    await page.getByRole("button", { name: "Remove" }).first().click();
    await expect(page.getByText("Not set").first()).toBeVisible();
  });
});
