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

async function ensureSoloChat(page: Page) {
  await page
    .getByRole("group", { name: "Research mode" })
    .getByRole("button", { name: "Solo", exact: true })
    .click();
  await page.getByRole("button", { name: "New chat" }).first().click();
  await expect(page.getByLabel("Select model")).toBeVisible({
    timeout: 15_000,
  });
}

async function send(page: Page, text: string) {
  await page.getByRole("textbox", { name: "Message" }).fill(text);
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByTestId("assistant-message").last()).toBeVisible({
    timeout: 60_000,
  });
}

test.describe("memory + scribe", () => {
  test("Chat A files a hypothesis; Chat B sees it in context", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await saveOpenRouterKey(page);
    await ensureSoloChat(page);
    await send(page, "Our hypothesis is that X causes Y because Z.");
    await expect(page.getByTestId("memory-line").last()).toContainText(
      /Memory:.*hypothesis/i,
      { timeout: 45_000 },
    );

    const expand = page.getByRole("button", { name: /Expand memory panel/i });
    if (await expand.isVisible().catch(() => false)) {
      await expand.click();
    }
    await page.getByRole("tab", { name: /Hypotheses/i }).click();
    await expect(page.getByTestId("scribe-badge").first()).toBeVisible({
      timeout: 15_000,
    });

    await ensureSoloChat(page);
    await send(page, "What are we currently testing about X and Y?");

    await expect(page.getByTestId("context-indicator")).toBeVisible();
    await page.getByTestId("context-indicator").click();
    await expect(page.getByTestId("context-indicator-details")).toContainText(
      /X causes Y|hypothesis|Relevant|Pinned|Active/i,
    );

    const captured = await page.request.get(
      "http://127.0.0.1:4010/api/v1/_test/requests",
    );
    expect(captured.ok()).toBeTruthy();
    const body = (await captured.json()) as { requests: unknown[] };
    const blob = JSON.stringify(body);
    expect(blob).toMatch(/X causes Y|Active hypotheses|Relevant memory|\[H-/i);
  });

  test("Undo removes the scribe batch", async ({ page }) => {
    test.setTimeout(90_000);
    await saveOpenRouterKey(page);
    await ensureSoloChat(page);
    await send(page, "Remember that X causes Y because Z.");
    const line = page.getByTestId("memory-line").last();
    await expect(line).toBeVisible({ timeout: 45_000 });
    await page.getByTestId("memory-undo").last().click();
    await expect(line).toContainText(/undone/i);
  });

  test("requireReview → Accept creates the record", async ({ page }) => {
    test.setTimeout(90_000);
    await saveOpenRouterKey(page);
    const cfg = await page.request.patch(
      "http://127.0.0.1:3000/api/memory/config",
      { data: { scribeRequireReview: true } },
    );
    expect(cfg.ok()).toBeTruthy();
    const cfgBody = (await cfg.json()) as {
      settings: { scribeRequireReview: boolean };
    };
    expect(cfgBody.settings.scribeRequireReview).toBe(true);

    await ensureSoloChat(page);
    await send(page, "Hypothesis: widgets reduce friction uniquely.");
    await expect(page.getByTestId("memory-line").last()).toContainText(
      /suggestion/i,
      { timeout: 45_000 },
    );
    await expect
      .poll(
        async () => {
          const res = await page.request.get(
            "http://127.0.0.1:3000/api/memory/scribe",
          );
          const json = (await res.json()) as { suggestions: unknown[] };
          return json.suggestions?.length ?? 0;
        },
        { timeout: 15_000 },
      )
      .toBeGreaterThan(0);
    await expect(page.getByTestId("scribe-suggestion").first()).toBeVisible({
      timeout: 20_000,
    });
    await page.getByTestId("scribe-accept").first().click();
    const expand = page.getByRole("button", { name: /Expand memory panel/i });
    if (await expand.isVisible().catch(() => false)) {
      await expand.click();
    }
    await page.getByRole("tab", { name: /Hypotheses/i }).click();
    await expect(page.getByTestId("scribe-badge").first()).toBeVisible({
      timeout: 15_000,
    });
    await page.request.patch("http://127.0.0.1:3000/api/memory/config", {
      data: { scribeRequireReview: false },
    });
  });

  test("Rebuild index shows progress and completes", async ({ page }) => {
    await saveOpenRouterKey(page);
    await page.goto("/");
    const expand = page.getByRole("button", { name: /Expand memory panel/i });
    if (await expand.isVisible().catch(() => false)) {
      await expand.click();
    }
    await page.getByTestId("rebuild-memory-index").click();
    await expect
      .poll(
        async () => {
          const res = await page.request.get(
            "http://127.0.0.1:3000/api/memory/config",
          );
          const json = (await res.json()) as {
            index: { phase: string } | null;
          };
          return json.index?.phase === "done" || json.index == null;
        },
        { timeout: 30_000 },
      )
      .toBeTruthy();
  });
});
