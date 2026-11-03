import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

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

async function openFolder(page: Page, folder: string) {
  await page.getByRole("button", { name: /Open folder/i }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByLabel(/Paste a path/i).fill(folder);
  await page.getByRole("button", { name: "Use" }).click();
  await page.getByRole("button", { name: "Confirm" }).click();
  await expect(page.getByText("Project opened")).toBeVisible({
    timeout: 15_000,
  });
}

async function ensureSolo(page: Page) {
  await page
    .getByRole("group", { name: "Research mode" })
    .getByRole("button", { name: "Solo", exact: true })
    .click();
}

test.describe("T12 continuity", () => {
  test("open project → STATE tab + Instructions DOI rule in context", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await saveOpenRouterKey(page);

    const root = mkdtempSync(path.join(tmpdir(), "araitchi-e2e-t12-"));
    writeFileSync(
      path.join(root, "README.md"),
      "# Demo\n\nexport function findMeaning() { return 42; }\n",
    );
    mkdirSync(path.join(root, "src"), { recursive: true });
    writeFileSync(
      path.join(root, "src", "util.ts"),
      "/** Find meaning */\nexport function findMeaning() { return 42; }\n",
    );

    await openFolder(page, root);

    const expand = page.getByRole("button", { name: /Expand memory panel/i });
    if (await expand.isVisible().catch(() => false)) {
      await expand.click();
    }
    await page.getByRole("tab", { name: /^State$/i }).click();
    await expect(page.getByTestId("state-panel")).toBeVisible({
      timeout: 20_000,
    });

    await page.getByRole("button", { name: "Open settings" }).click();
    await page.getByRole("tab", { name: /^Memory$/i }).click();
    await expect(page.getByTestId("project-index-progress").first()).toBeVisible(
      { timeout: 20_000 },
    );
    await page.getByRole("tab", { name: /Instructions/i }).click();
    await expect(page.getByTestId("instructions-settings")).toBeVisible();
    const editor = page.getByTestId("project-agents-editor");
    await editor.fill(
      "# Project instructions\n\nAlways cite with DOI when mentioning papers.\n",
    );
    await page.getByRole("button", { name: /Save AGENTS\.md/i }).click();
    await page.keyboard.press("Escape");

    await ensureSolo(page);
    await page.getByRole("button", { name: "New chat" }).first().click();
    await page
      .getByRole("textbox", { name: "Message" })
      .fill("Summarise this project and where we are. What's been tested?");
    await page.getByRole("button", { name: "Send message" }).click();
    await expect(page.getByTestId("assistant-message").last()).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.getByTestId("context-indicator")).toBeVisible();
    await page.getByTestId("context-indicator").click();
    await expect(page.getByTestId("context-indicator-details")).toContainText(
      /STATE|state|instructions|DOI|Already tested|Goal|project/i,
    );
  });

  test("sidebar chat search + tidy/backup in Memory settings", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await saveOpenRouterKey(page);
    await ensureSolo(page);
    await page.getByRole("button", { name: "New chat" }).first().click();
    await page
      .getByRole("textbox", { name: "Message" })
      .fill("UniqueZebraContinuitySearchPhrase for sidebar.");
    await page.getByRole("button", { name: "Send message" }).click();
    await expect(page.getByTestId("assistant-message").last()).toBeVisible({
      timeout: 60_000,
    });

    const search = page.getByTestId("sidebar-chat-search").locator("input");
    await expect(search).toBeVisible({ timeout: 15_000 });
    await search.fill("UniqueZebraContinuity");
    await page.waitForTimeout(1000);

    await page.getByRole("button", { name: "Open settings" }).click();
    await page.getByRole("tab", { name: /^Memory$/i }).click();
    await expect(page.getByTestId("backup-export")).toBeVisible({
      timeout: 10_000,
    });
    await page.getByRole("button", { name: /Tidy memory/i }).click();
    await expect(page.getByTestId("tidy-memory-dialog")).toBeVisible();
    await page.keyboard.press("Escape");
  });

  test("switch model mid-chat shows context package still available", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await saveOpenRouterKey(page);
    await ensureSolo(page);
    await page.getByRole("button", { name: "New chat" }).first().click();
    await page.getByRole("textbox", { name: "Message" }).fill("First turn.");
    await page.getByRole("button", { name: "Send message" }).click();
    await expect(page.getByTestId("assistant-message").last()).toBeVisible({
      timeout: 60_000,
    });

    // Change model if picker allows
    const picker = page.getByLabel("Select model");
    if (await picker.isVisible().catch(() => false)) {
      await picker.click();
      const opts = page.getByRole("option");
      const count = await opts.count();
      if (count > 1) {
        await opts.nth(1).click();
      } else {
        await page.keyboard.press("Escape");
      }
    }

    await page
      .getByRole("textbox", { name: "Message" })
      .fill("Continue: what was my first turn about?");
    await page.getByRole("button", { name: "Send message" }).click();
    await expect(page.getByTestId("assistant-message").last()).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.getByTestId("context-indicator")).toBeVisible();
  });
});
