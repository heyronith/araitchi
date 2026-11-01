import { expect, test } from "@playwright/test";

test.describe("Araitchi shell", () => {
  test("loads shell chrome", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByText("Araitchi").first()).toBeVisible();
    await expect(
      page.getByRole("group", { name: "Research mode" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Connect OpenRouter to start" }),
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

    await page.getByRole("button", { name: "Remove" }).first().click();
    await expect(page.getByText("Not set").first()).toBeVisible();
  });
});
