import { expect, test } from "@playwright/test";

async function saveOpenRouterKey(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Open settings" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByLabel(/OpenRouter API key/i).fill("sk-or-v1-fake-e2e-key");
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

async function switchCouncil(page: import("@playwright/test").Page) {
  await page
    .getByRole("group", { name: "Research mode" })
    .getByRole("button", { name: "Council", exact: true })
    .click();
  await expect(page.getByTestId("council-estimate")).toBeVisible({
    timeout: 15_000,
  });
}

test.describe("chat UX polish", () => {
  test("shows Thinking… before first token, then open assistant reply", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await saveOpenRouterKey(page);
    await ensureSoloChat(page);
    await page
      .getByRole("textbox", { name: "Message" })
      .fill("Please think carefully about caffeine half-life");
    await page.getByRole("button", { name: "Send message" }).click();

    await expect(page.getByTestId("thinking-status")).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByTestId("thinking-status")).toContainText(
      /Thinking/i,
    );

    const assistant = page.getByTestId("assistant-message").last();
    await expect(assistant).toHaveAttribute("data-variant", "open");

    await expect(
      page.getByText(/Done\.|half-life|caffeine/i).first(),
    ).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByTestId("thinking-status")).toHaveCount(0);
  });

  test("streams reasoning then collapses to Thought for N s", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await saveOpenRouterKey(page);
    await ensureSoloChat(page);
    await page
      .getByRole("textbox", { name: "Message" })
      .fill("show your thinking about water");
    await page.getByRole("button", { name: "Send message" }).click();

    await expect(page.getByTestId("reasoning-block")).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByTestId("reasoning-toggle")).toContainText(
      /Thinking|Thought for/i,
    );

    await expect(
      page.getByText(/Done\.|Anthropic|Google|water/i).first(),
    ).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByTestId("reasoning-toggle")).toContainText(
      /Thought for \d+ s/i,
    );

    const open = page.getByTestId("assistant-message").last();
    await expect(open).toHaveAttribute("data-variant", "open");
  });

  test("council shows progress then Comparing answers…", async ({ page }) => {
    test.setTimeout(90_000);
    await saveOpenRouterKey(page);
    await page.getByRole("button", { name: "New chat" }).first().click();
    await switchCouncil(page);
    await page
      .getByRole("textbox", { name: "Message" })
      .fill("council progress on caffeine half-life");
    await page.getByRole("button", { name: "Send message" }).click();

    await expect(
      page.getByTestId("thinking-status").filter({ hasText: /\d\/\d done/i }),
    ).toBeVisible({ timeout: 30_000 });

    await expect(
      page
        .getByTestId("thinking-status")
        .filter({ hasText: /Comparing answers/i }),
    ).toBeVisible({ timeout: 45_000 });

    await expect(page.getByText("Final answer").last()).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.getByTestId("council-message")).toHaveAttribute(
      "data-variant",
      "open",
    );
  });
});
