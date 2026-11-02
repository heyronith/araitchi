import { expect, test, type Page } from "@playwright/test";

test.describe.configure({ timeout: 120_000 });

async function saveOpenRouterKey(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Open settings" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByLabel(/OpenRouter API key/i).fill("sk-or-v1-fake-e2e-key");
  await page.getByRole("button", { name: "Save" }).nth(0).click();
  await expect(page.getByText("Saved").first()).toBeVisible();
  await page.keyboard.press("Escape");
}

test.describe("tool wiring", () => {
  test("composer toggles persist via /api/tools/config", async ({
    page,
    request,
  }) => {
    await saveOpenRouterKey(page);
    const docs = page.getByRole("button", { name: "Documents", exact: true });
    await expect(docs).toHaveAttribute("aria-pressed", "false");
    await docs.click();
    await expect(docs).toHaveAttribute("aria-pressed", "true");
    const res = await request.get("/api/tools/config");
    const data = (await res.json()) as { toggles: { documents: boolean } };
    expect(data.toggles.documents).toBe(true);
    await docs.click();
    await expect(docs).toHaveAttribute("aria-pressed", "false");
  });

  test("settings Tools tab shows contact email and MCP warning", async ({
    page,
  }) => {
    await saveOpenRouterKey(page);
    await page.getByRole("button", { name: "Open settings" }).click();
    await page.getByRole("tab", { name: "Tools" }).click();
    await expect(page.getByLabel("Contact email")).toBeVisible();
    await expect(page.getByTestId("mcp-warning")).toContainText(
      "run commands on this computer",
    );
  });

  test("solo tool call persists tool card and sources after reload", async ({
    page,
  }) => {
    await saveOpenRouterKey(page);
    await page
      .getByRole("group", { name: "Research mode" })
      .getByRole("button", { name: "Solo", exact: true })
      .click();
    await page.getByRole("button", { name: "New chat" }).first().click();
    await expect(page.getByLabel("Select model")).toBeVisible({
      timeout: 15_000,
    });
    const papers = page.getByRole("button", { name: "Papers", exact: true });
    if ((await papers.getAttribute("aria-pressed")) !== "true") {
      await papers.click();
    }
    await page
      .getByRole("textbox", { name: "Message" })
      .fill("Search papers on graph neural networks");
    await page.getByRole("button", { name: "Send message" }).click();
    await expect(page.getByTestId("tool-card").first()).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.getByText(/Mock Paper One/).first()).toBeVisible({
      timeout: 30_000,
    });

    await page.reload();
    await expect(page.getByTestId("tool-card").first()).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByTestId("sources-section")).toBeVisible();
  });

  test("council members share tools and show tool cards", async ({
    page,
    request,
  }) => {
    await request.post("http://127.0.0.1:4010/api/v1/_test/behaviors", {
      data: {},
    });
    await saveOpenRouterKey(page);
    await page.getByRole("button", { name: "New chat" }).first().click();
    await page
      .getByRole("group", { name: "Research mode" })
      .getByRole("button", { name: "Council", exact: true })
      .click();
    await expect(page.getByTestId("council-estimate")).toBeVisible({
      timeout: 15_000,
    });
    const papers = page.getByRole("button", { name: "Papers", exact: true });
    if ((await papers.getAttribute("aria-pressed")) !== "true") {
      await papers.click();
    }
    await page
      .getByRole("textbox", { name: "Message" })
      .fill("Find recent papers on graph neural networks");
    await page.getByRole("button", { name: "Send message" }).click();
    await expect(page.getByTestId("tool-card").first()).toBeVisible({
      timeout: 90_000,
    });
    await expect(page.getByText("Final answer").last()).toBeVisible({
      timeout: 90_000,
    });
  });
});
