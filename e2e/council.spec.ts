import { expect, test } from "@playwright/test";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

test.describe.configure({ timeout: 90_000 });

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

function modeButton(
  page: import("@playwright/test").Page,
  name: "Solo" | "Council",
) {
  return page
    .getByRole("group", { name: "Research mode" })
    .getByRole("button", { name, exact: true });
}

async function switchCouncil(page: import("@playwright/test").Page) {
  await modeButton(page, "Council").click();
  await expect(modeButton(page, "Council")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByTestId("council-estimate")).toBeVisible({
    timeout: 15_000,
  });
}

async function newChat(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: "New chat" }).first().click();
}

async function ensureBudgetCap(
  page: import("@playwright/test").Page,
  cap: string,
) {
  await page.getByRole("button", { name: "Open settings" }).click();
  await page.getByRole("tab", { name: "Council" }).click();
  await page.getByLabel(/Budget cap/i).fill(cap);
  await page.getByLabel(/Budget cap/i).blur();
  await expect(page.getByText("Council settings saved")).toBeVisible();
  await page.keyboard.press("Escape");
}

test.describe("council mode", () => {
  test("streams members, final answer, and needs-evidence contradiction", async ({
    page,
  }) => {
    await saveOpenRouterKey(page);
    await newChat(page);
    await switchCouncil(page);
    await page
      .getByRole("textbox", { name: "Message" })
      .fill("What is caffeine half-life?");
    await page.getByRole("button", { name: "Send message" }).click();

    await expect(page.getByText("Final answer").last()).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.getByText(/needs evidence/i).last()).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText("Disagreement analysis").last()).toBeVisible();
  });

  test("over-cap confirm dialog; Run anyway proceeds", async ({ page }) => {
    await saveOpenRouterKey(page);
    await newChat(page);
    await switchCouncil(page);
    await ensureBudgetCap(page, "0.0001");

    try {
      await page
        .getByRole("textbox", { name: "Message" })
        .fill("Over cap please");
      await page.getByRole("button", { name: "Send message" }).click();
      await expect(page.getByText(/Over budget cap/i)).toBeVisible({
        timeout: 10_000,
      });
      await page.getByRole("button", { name: "Run anyway" }).click();
      await expect(page.getByText("Final answer").last()).toBeVisible({
        timeout: 60_000,
      });
    } finally {
      await ensureBudgetCap(page, "0.50");
    }
  });

  test("failing member shows substituted or failed while council completes", async ({
    page,
    request,
  }) => {
    // Fail a member that is not the synthesizer (anthropic is synthesizer for Balanced)
    await request.post("http://127.0.0.1:4010/api/v1/_test/behaviors", {
      data: {
        "google/gemini-2.0-flash": { fail: true },
      },
    });
    await saveOpenRouterKey(page);
    await newChat(page);
    await switchCouncil(page);
    await ensureBudgetCap(page, "0.50");
    await page
      .getByRole("textbox", { name: "Message" })
      .fill("Substitute please");
    await page.getByRole("button", { name: "Send message" }).click();
    await expect(page.getByText("Final answer").last()).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.getByText(/substituted|failed/i).first()).toBeVisible({
      timeout: 60_000,
    });
    await request.post("http://127.0.0.1:4010/api/v1/_test/behaviors", {
      data: {},
    });
  });

  test("stop cancels council", async ({ page, request }) => {
    await request.post("http://127.0.0.1:4010/api/v1/_test/behaviors", {
      data: {
        "anthropic/claude-3.5-haiku": { timeoutMs: 8000 },
        "google/gemini-2.0-flash": { timeoutMs: 8000 },
        "meta-llama/llama-3.3-70b": { timeoutMs: 8000 },
      },
    });
    await saveOpenRouterKey(page);
    await newChat(page);
    await switchCouncil(page);
    await ensureBudgetCap(page, "0.50");
    await page.getByRole("textbox", { name: "Message" }).fill("Stop council");
    await page.getByRole("button", { name: "Send message" }).click();
    await expect(
      page.getByRole("button", { name: "Stop generating" }),
    ).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: "Stop generating" }).click();
    await expect(
      page.getByRole("button", { name: "Send message" }),
    ).toBeVisible({ timeout: 15_000 });
    await request.post("http://127.0.0.1:4010/api/v1/_test/behaviors", {
      data: {},
    });
  });

  test("reload restores council; retry branches", async ({ page }) => {
    await saveOpenRouterKey(page);
    await newChat(page);
    await switchCouncil(page);
    await ensureBudgetCap(page, "0.50");
    await page
      .getByRole("textbox", { name: "Message" })
      .fill("Persist council");
    await page.getByRole("button", { name: "Send message" }).click();
    await expect(page.getByText("Final answer").last()).toBeVisible({
      timeout: 60_000,
    });
    await page.reload();
    await expect(page.getByText("Final answer").last()).toBeVisible({
      timeout: 30_000,
    });
    await page.getByRole("button", { name: "Retry" }).last().click();
    await expect(page.getByText("2/2")).toBeVisible({ timeout: 60_000 });
  });

  test("save contradiction to Questions", async ({ page }) => {
    await saveOpenRouterKey(page);
    await newChat(page);
    await switchCouncil(page);
    await ensureBudgetCap(page, "0.50");
    await page
      .getByRole("textbox", { name: "Message" })
      .fill("Save contradiction");
    await page.getByRole("button", { name: "Send message" }).click();
    await expect(page.getByText(/needs evidence/i).last()).toBeVisible({
      timeout: 60_000,
    });
    await page
      .getByRole("button", { name: "Save contradiction to memory" })
      .last()
      .click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.locator("#mem-type").selectOption("question");
    await page.getByRole("button", { name: "Save" }).last().click();
    await expect(page.getByText("Saved to memory")).toBeVisible();
    await page.getByRole("tab", { name: "Questions" }).click();
    await expect(page.getByText(/Contradiction/i).first()).toBeVisible({
      timeout: 10_000,
    });
  });

  test("member request payloads never include other members' answers", async ({
    page,
    request,
  }) => {
    await request.post("http://127.0.0.1:4010/api/v1/_test/behaviors", {
      data: {},
    });
    await saveOpenRouterKey(page);
    await newChat(page);
    await switchCouncil(page);
    await ensureBudgetCap(page, "0.50");
    await page
      .getByRole("textbox", { name: "Message" })
      .fill("Isolation check caffeine");
    await page.getByRole("button", { name: "Send message" }).click();
    await expect(page.getByText("Final answer").last()).toBeVisible({
      timeout: 60_000,
    });

    const res = await request.get(
      "http://127.0.0.1:4010/api/v1/_test/requests",
    );
    const data = (await res.json()) as {
      requests: { model?: string; messages?: unknown[] }[];
    };
    const memberReqs = data.requests.filter((r) => {
      const blob = JSON.stringify(r.messages ?? []);
      return (
        !blob.includes("Member A") &&
        !blob.includes("Synthesize") &&
        !blob.includes("independent answers")
      );
    });
    expect(memberReqs.length).toBeGreaterThanOrEqual(3);

    const uniqueSnippets = ["Anthropic view:", "Google view:", "Open-weight ("];
    for (const req of memberReqs) {
      const blob = JSON.stringify(req.messages ?? []);
      const hits = uniqueSnippets.filter((s) => blob.includes(s));
      // A member request must not contain another member's distinctive answer
      expect(hits.length).toBeLessThanOrEqual(0);
    }
  });

  test("mode and council config persist per project after switching", async ({
    page,
  }) => {
    const folder = mkdtempSync(path.join(tmpdir(), "araitchi-council-sw-"));
    mkdirSync(folder, { recursive: true });

    await saveOpenRouterKey(page);
    await switchCouncil(page);
    // Ensure mode write lands before switching projects
    await page.waitForTimeout(300);

    await page.getByRole("button", { name: /Open folder/i }).click();
    await page.getByLabel(/Paste a path/i).fill(folder);
    await page.getByRole("button", { name: "Use" }).click();
    await page.getByRole("button", { name: "Confirm" }).click();
    await expect(page.getByText("Project opened")).toBeVisible({
      timeout: 15_000,
    });

    await modeButton(page, "Solo").click();
    await expect(modeButton(page, "Solo")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await page.waitForTimeout(300);

    await page.getByRole("button", { name: "Scratch" }).click();
    await expect(modeButton(page, "Council")).toHaveAttribute(
      "aria-pressed",
      "true",
      { timeout: 10_000 },
    );
  });
});
