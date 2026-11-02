import { expect, test } from "@playwright/test";
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

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

async function ensureSolo(page: import("@playwright/test").Page) {
  await page
    .getByRole("group", { name: "Research mode" })
    .getByRole("button", { name: "Solo", exact: true })
    .click();
}

test.describe("project workspace", () => {
  test("open folder via paste path creates .research/", async ({ page }) => {
    const folder = mkdtempSync(path.join(tmpdir(), "araitchi-proj-"));
    // Ensure under FS root: playwright sets ARAITCHI_FS_ROOT to e2e home;
    // paste path can be absolute anywhere per spec.
    await page.goto("/");
    await page.getByRole("button", { name: /Open folder/i }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByLabel(/Paste a path/i).fill(folder);
    await page.getByRole("button", { name: "Use" }).click();
    await page.getByRole("button", { name: "Confirm" }).click();
    await expect(page.getByText("Project opened")).toBeVisible({
      timeout: 15_000,
    });
    expect(existsSync(path.join(folder, ".research", "project.json"))).toBe(
      true,
    );
    expect(existsSync(path.join(folder, ".research", "brief.md"))).toBe(true);
    expect(existsSync(path.join(folder, ".research", "notebook.db"))).toBe(
      true,
    );
  });

  test("chat writes session transcript; brief reaches model", async ({
    page,
    request,
  }) => {
    const folder = mkdtempSync(path.join(tmpdir(), "araitchi-chat-"));
    await page.goto("/");
    await page.getByRole("button", { name: /Open folder/i }).click();
    await page.getByLabel(/Paste a path/i).fill(folder);
    await page.getByRole("button", { name: "Use" }).click();
    await page.getByRole("button", { name: "Confirm" }).click();
    await expect(page.getByText("Project opened")).toBeVisible({
      timeout: 15_000,
    });

    // Edit brief in memory panel
    await page.getByRole("tab", { name: "Brief" }).click();
    const brief = page.getByLabel("Project brief");
    await brief.fill(
      "# Research brief\n\n## Goal\n\nE2E_BRIEF_TOKEN_XYZ\n\n## Constraints\n\n## Key definitions\n\n## Out of scope\n",
    );
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Brief saved")).toBeVisible();

    const onDisk = readFileSync(
      path.join(folder, ".research", "brief.md"),
      "utf8",
    );
    expect(onDisk).toContain("E2E_BRIEF_TOKEN_XYZ");

    await saveOpenRouterKey(page);
    await ensureSolo(page);
    await page.getByRole("textbox", { name: "Message" }).fill("Ping brief");
    await page.getByRole("button", { name: "Send message" }).click();
    await expect(page.getByText("Done.").first()).toBeVisible({
      timeout: 20_000,
    });

    // transcript
    await expect
      .poll(() => {
        const sessions = path.join(folder, ".research", "sessions");
        if (!existsSync(sessions)) return 0;
        return readdirSync(sessions).filter((f) => f.endsWith(".md")).length;
      })
      .toBeGreaterThan(0);

    // mock received system/brief
    const last = await request.get(
      "http://127.0.0.1:4010/api/v1/_test/last-chat",
    );
    const payload = (await last.json()) as { request: unknown };
    expect(JSON.stringify(payload.request)).toContain("E2E_BRIEF_TOKEN_XYZ");
  });

  test("hypothesis pin, search, delete+undo; save to memory", async ({
    page,
  }) => {
    const folder = mkdtempSync(path.join(tmpdir(), "araitchi-mem-"));
    await page.goto("/");
    await page.getByRole("button", { name: /Open folder/i }).click();
    await page.getByLabel(/Paste a path/i).fill(folder);
    await page.getByRole("button", { name: "Use" }).click();
    await page.getByRole("button", { name: "Confirm" }).click();
    await expect(page.getByText("Project opened")).toBeVisible({
      timeout: 15_000,
    });

    await page.getByRole("tab", { name: "Hypotheses" }).click();
    await page.getByRole("button", { name: /Add Hypotheses/i }).click();
    const editor = page.getByRole("dialog");
    await editor.getByLabel("Title").fill("FTS searchable hypothesis");
    await editor.getByLabel("Body").fill("unique-quark-gluon plasma marker");
    await editor.locator("select").selectOption("testing");
    await editor.getByRole("checkbox").check();
    await editor.getByRole("button", { name: "Save" }).click();

    await expect(page.getByText("FTS searchable hypothesis")).toBeVisible();

    const memory = readFileSync(
      path.join(folder, ".research", "memory.md"),
      "utf8",
    );
    expect(memory).toContain("FTS searchable hypothesis");

    await page.getByLabel(/Search Hypotheses/i).fill("quark-gluon");
    await expect(page.getByText("FTS searchable hypothesis")).toBeVisible();

    await page.getByText("FTS searchable hypothesis").hover();
    await page.getByRole("button", { name: "Delete" }).first().click();
    await expect(page.getByText("Deleted")).toBeVisible();
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(page.getByText("FTS searchable hypothesis")).toBeVisible();

    await saveOpenRouterKey(page);
    await ensureSolo(page);
    await page.getByRole("textbox", { name: "Message" }).fill("Save me");
    await page.getByRole("button", { name: "Send message" }).click();
    await expect(page.getByText("Done.").first()).toBeVisible({
      timeout: 20_000,
    });

    await page.getByRole("button", { name: "Save to memory" }).last().click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.locator("#mem-type").selectOption("note");
    await page.getByRole("button", { name: "Save" }).last().click();
    await expect(page.getByText("Saved to memory")).toBeVisible();

    await page.getByRole("tab", { name: "Notes" }).click();
    await expect
      .poll(() =>
        readFileSync(path.join(folder, ".research", "memory.md"), "utf8"),
      )
      .toMatch(/source: openai\/gpt-4o-mini/);
  });

  test("switch Scratch and back scopes chats; reload restores project", async ({
    page,
  }) => {
    const folder = mkdtempSync(path.join(tmpdir(), "araitchi-switch-"));
    mkdirSync(folder, { recursive: true });

    await page.goto("/");
    await page.getByRole("button", { name: /Open folder/i }).click();
    await page.getByLabel(/Paste a path/i).fill(folder);
    await page.getByRole("button", { name: "Use" }).click();
    await page.getByRole("button", { name: "Confirm" }).click();
    await expect(page.getByText("Project opened")).toBeVisible({
      timeout: 15_000,
    });

    await saveOpenRouterKey(page);
    await ensureSolo(page);
    await page
      .getByRole("textbox", { name: "Message" })
      .fill("Project chat only");
    await page.getByRole("button", { name: "Send message" }).click();
    await expect(page.getByText("Done.").first()).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByText(/Project chat/i).first()).toBeVisible();

    // Switch to Scratch from recents
    await page.getByRole("button", { name: "Scratch" }).click();
    await expect(page.getByText("Scratch").first()).toBeVisible();
    // Project chat should not be in scratch list typically
    await page.getByRole("button", { name: "New chat" }).first().click();

    // Switch back via recent (folder basename)
    const name = path.basename(folder);
    await page.getByRole("button", { name, exact: true }).click();
    await expect(page.getByText(/Project chat/i).first()).toBeVisible({
      timeout: 10_000,
    });

    await page.reload();
    await expect(page.getByText(name).first()).toBeVisible({ timeout: 15_000 });
  });
});
