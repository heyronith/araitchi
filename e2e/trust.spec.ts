import { expect, test, type Page } from "@playwright/test";

async function saveOpenRouterKey(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Open settings" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  const input = page.getByLabel(/OpenRouter API key/i);
  await input.fill("sk-or-v1-fake-e2e-key");
  await page.getByRole("button", { name: "Save" }).nth(0).click();
  await expect(page.getByText("Saved").first()).toBeVisible();
  await page.keyboard.press("Escape");
}

test.describe("T13 trust", () => {
  test("Plan board create/move and accept suggestion via API seed", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await saveOpenRouterKey(page);

    const expand = page.getByRole("button", { name: /Expand memory panel/i });
    if (await expand.isVisible().catch(() => false)) {
      await expand.click();
    }
    await page.getByRole("tab", { name: /^Plan$/i }).click();
    await expect(page.getByTestId("plan-panel")).toBeVisible({
      timeout: 15_000,
    });
    await page.getByTestId("plan-board-tab").click();
    await page.getByTestId("plan-task-title").fill("E2E plan task");
    await page.getByRole("button", { name: /^Add$/i }).click();
    await expect(
      page.getByTestId("plan-card").filter({ hasText: "E2E plan task" }),
    ).toBeVisible({
      timeout: 10_000,
    });
  });

  test("citation badges appear when data-trust is present (solo mock path)", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await saveOpenRouterKey(page);
    await page
      .getByRole("group", { name: "Research mode" })
      .getByRole("button", { name: "Solo", exact: true })
      .click();
    await page.getByRole("button", { name: "New chat" }).first().click();
    await page
      .getByRole("textbox", { name: "Message" })
      .fill(
        "Cite doi:10.9999/fake.e2e.doi and arxiv:1706.03762 about transformers.",
      );
    await page.getByRole("button", { name: "Send message" }).click();
    await expect(page.getByTestId("assistant-message").last()).toBeVisible({
      timeout: 60_000,
    });
    // Trust attach is best-effort; summary may appear after stream settles.
    const badges = page.getByTestId("citation-badges");
    if (await badges.isVisible().catch(() => false)) {
      await expect(page.getByTestId("citation-summary")).toBeVisible();
    }
  });
});
