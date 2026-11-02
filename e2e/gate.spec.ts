import { expect, test, type Page } from "@playwright/test";

async function saveOpenRouterKey(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Open settings" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByLabel(/OpenRouter API key/i).fill("sk-or-v1-fake-e2e-key");
  await page.getByRole("button", { name: "Save" }).nth(0).click();
  await expect(page.getByText("Saved").first()).toBeVisible();
  await page.keyboard.press("Escape");
}

async function ensureAutoChat(page: Page) {
  await page
    .getByRole("group", { name: "Research mode" })
    .getByRole("button", { name: "Auto", exact: true })
    .click();
  await page.getByRole("button", { name: "New chat" }).first().click();
}

async function send(page: Page, text: string) {
  await page.getByRole("textbox", { name: "Message" }).fill(text);
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByTestId("assistant-message").last()).toBeVisible({
    timeout: 90_000,
  });
}

test.describe("Auto gate", () => {
  test("Auto is the default selectable mode", async ({ page }) => {
    await saveOpenRouterKey(page);
    // Scratch may retain Solo from earlier suites — reset via API, then reload.
    await page.request.put("http://127.0.0.1:3000/api/council/config", {
      data: { mode: "auto" },
    });
    await page.goto("/");
    await expect(page.getByTestId("mode-auto")).toBeVisible();
    await expect(page.getByTestId("mode-auto")).toHaveAttribute(
      "aria-pressed",
      "true",
      { timeout: 15_000 },
    );
    await page.getByTestId("mode-solo").click();
    await expect(page.getByTestId("mode-solo")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await page.getByTestId("mode-auto").click();
    await expect(page.getByTestId("mode-auto")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  test("chit-chat → Solo chip", async ({ page }) => {
    test.setTimeout(90_000);
    await saveOpenRouterKey(page);
    await ensureAutoChat(page);
    await send(page, "hi");
    await expect(page.getByTestId("gate-chip-label").last()).toContainText(
      /Solo/i,
      { timeout: 45_000 },
    );
  });

  test("factual DOI question → Evidence", async ({ page }) => {
    test.setTimeout(90_000);
    await saveOpenRouterKey(page);
    await ensureAutoChat(page);
    await send(
      page,
      "What paper has DOI 10.48550/arXiv.1706.03762? Cite the DOI.",
    );
    await expect(page.getByTestId("gate-chip-label").last()).toContainText(
      /Evidence/i,
      { timeout: 60_000 },
    );
  });

  test("hypothesis request → Council", async ({ page }) => {
    test.setTimeout(120_000);
    await saveOpenRouterKey(page);
    await ensureAutoChat(page);
    await send(
      page,
      "Propose 3 hypotheses for why our model overfits on small datasets",
    );
    await expect(page.getByTestId("gate-chip-label").last()).toContainText(
      /Council/i,
      { timeout: 90_000 },
    );
  });

  test("probe override disagreement escalates", async ({ page }) => {
    test.setTimeout(120_000);
    await saveOpenRouterKey(page);
    await page.request.patch("http://127.0.0.1:3000/api/gate/config", {
      data: {
        probeModels: ["anthropic/claude-3.5-haiku", "google/gemini-2.0-flash"],
        probeAgreementThreshold: 0.99,
      },
    });
    // Force divergent replies
    await page.request.post("http://127.0.0.1:4010/api/v1/_test/behaviors", {
      data: {
        "anthropic/claude-3.5-haiku": {
          reply: "Opinion A: this is strictly a methods question.",
        },
        "google/gemini-2.0-flash": {
          reply: "Opinion B: this is strictly a theory question.",
        },
      },
    });
    try {
      await ensureAutoChat(page);
      await send(
        page,
        "/probe Is overfitting on small data a methods or theory issue? Pick one.",
      );
      await expect(page.getByTestId("gate-chip-label").last()).toContainText(
        /escalated|Council/i,
        { timeout: 90_000 },
      );
    } finally {
      // Clear mock overrides so later suites see default Done. replies
      await page.request.post("http://127.0.0.1:4010/api/v1/_test/behaviors", {
        data: {},
      });
    }
  });

  test("Why? popover and correction; routing log lists decisions", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await saveOpenRouterKey(page);
    await ensureAutoChat(page);
    await send(page, "hi");
    await expect(page.getByTestId("gate-chip-label").last()).toBeVisible({
      timeout: 45_000,
    });
    await page.getByTestId("gate-chip-label").last().click();
    await expect(page.getByTestId("gate-why")).toBeVisible();
    await page.getByTestId("gate-correct-select").selectOption("chat");
    await page.getByTestId("gate-correct-save").click();

    await page.getByRole("button", { name: "Open settings" }).click();
    await page.getByRole("tab", { name: "Routing" }).click();
    await expect(page.getByTestId("routing-log")).toBeVisible();
    await expect(page.getByTestId("routing-log-row").first()).toBeVisible({
      timeout: 10_000,
    });
  });
});
