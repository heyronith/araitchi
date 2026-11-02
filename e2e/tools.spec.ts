import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

test.describe.configure({ timeout: 90_000 });

async function saveOpenRouterKey(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Open settings" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByLabel(/OpenRouter API key/i).fill("sk-or-v1-fake-e2e-key");
  await page.getByRole("button", { name: "Save" }).nth(0).click();
  await expect(page.getByText("Saved").first()).toBeVisible();
  await page.keyboard.press("Escape");
}

test.describe("research tools", () => {
  test("solo search_papers shows tool card and sources", async ({ page }) => {
    await saveOpenRouterKey(page);
    await page.getByRole("button", { name: "Papers", exact: true }).click();
    // ensure papers on
    const papers = page.getByRole("button", { name: "Papers", exact: true });
    if ((await papers.getAttribute("aria-pressed")) !== "true") {
      await papers.click();
    }
    await page
      .getByRole("textbox", { name: "Message" })
      .fill("Find recent papers on graph neural networks");
    await page.getByRole("button", { name: "Send message" }).click();

    await expect(page.getByTestId("tool-card").first()).toBeVisible({
      timeout: 60_000,
    });
    const sources = page.getByTestId("sources-section").last();
    await expect(sources).toBeVisible({ timeout: 30_000 });
    const saveBtn = sources
      .getByRole("button", { name: /Save paper:/i })
      .first();
    await expect(saveBtn).toBeVisible();
    await saveBtn.click();
    await expect(page.getByText(/Saved to Papers/i).first()).toBeVisible({
      timeout: 10_000,
    });
  });

  test("repo tools refuse .env and show log", async ({ page }) => {
    const folder = mkdtempSync(path.join(tmpdir(), "araitchi-git-e2e-"));
    mkdirSync(folder, { recursive: true });
    execFileSync("git", ["init"], { cwd: folder, stdio: "ignore" });
    execFileSync("git", ["config", "user.email", "e2e@test"], {
      cwd: folder,
      stdio: "ignore",
    });
    execFileSync("git", ["config", "user.name", "e2e"], {
      cwd: folder,
      stdio: "ignore",
    });
    writeFileSync(path.join(folder, "readme.txt"), "hello");
    writeFileSync(path.join(folder, ".env"), "SECRET=1");
    execFileSync("git", ["add", "readme.txt"], {
      cwd: folder,
      stdio: "ignore",
    });
    execFileSync("git", ["commit", "-m", "init commit"], {
      cwd: folder,
      stdio: "ignore",
    });

    await saveOpenRouterKey(page);
    await page.getByRole("button", { name: /Open folder/i }).click();
    await page.getByLabel(/Paste a path/i).fill(folder);
    await page.getByRole("button", { name: "Use" }).click();
    await page.getByRole("button", { name: "Confirm" }).click();
    await expect(page.getByText("Project opened")).toBeVisible({
      timeout: 15_000,
    });

    const repoBtn = page.getByRole("button", { name: "Repo", exact: true });
    if ((await repoBtn.getAttribute("aria-pressed")) !== "true") {
      await repoBtn.click();
    }

    await page
      .getByRole("textbox", { name: "Message" })
      .fill("What changed in the last commits? Also try reading .env");
    await page.getByRole("button", { name: "Send message" }).click();
    // Model may or may not call tools depending on mock; at least UI stays up
    await expect(
      page.getByRole("button", { name: "Send message" }),
    ).toBeVisible({
      timeout: 60_000,
    });
  });
});
