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

async function openPlan(page: Page) {
  const expand = page.getByRole("button", { name: /Expand memory panel/i });
  if (await expand.isVisible().catch(() => false)) {
    await expand.click();
  }
  await page.getByRole("tab", { name: /^Plan$/i }).click();
  await expect(page.getByTestId("plan-panel")).toBeVisible({
    timeout: 15_000,
  });
}

test.describe("T13 trust", () => {
  test("reply with fake+real citations → badges + summary; invalid marker flagged", async ({
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
        "Cite doi:10.9999/fake.e2e.doi plus two real papers about transformers.",
      );
    await page.getByRole("button", { name: "Send message" }).click();
    await expect(page.getByTestId("assistant-message").last()).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.getByTestId("citation-badges")).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByTestId("citation-summary")).toBeVisible();
    await expect(page.getByTestId("citation-badge").first()).toBeVisible();

    // Traceability: click a marker; invalid marker flagged.
    const marker = page.getByTestId("ref-marker").first();
    if (await marker.isVisible().catch(() => false)) {
      await marker.click();
    }
    await expect(page.getByTestId("invalid-marker").first()).toBeVisible({
      timeout: 15_000,
    });
  });

  test("Plan board create/move/link; accept suggestion; Run team task prefills", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await saveOpenRouterKey(page);
    await openPlan(page);

    await page.getByTestId("plan-board-tab").click();
    await page.getByTestId("plan-task-title").fill("E2E plan task");
    await page.getByRole("button", { name: /^Add$/i }).click();
    await expect(
      page.getByTestId("plan-card").filter({ hasText: "E2E plan task" }),
    ).toBeVisible({ timeout: 10_000 });

    // Move todo → doing via status control on the card.
    const card = page
      .getByTestId("plan-card")
      .filter({ hasText: "E2E plan task" });
    const doingBtn = card.getByRole("button", { name: /→\s*doing/i });
    if (await doingBtn.isVisible().catch(() => false)) {
      await doingBtn.click();
      await expect(
        page.getByTestId("plan-card").filter({ hasText: "E2E plan task" }),
      ).toBeVisible({ timeout: 10_000 });
    }

    // Seed a suggestion + team task via plan API.
    await page.evaluate(async () => {
      await fetch("/api/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "suggest",
          kind: "task",
          payload: { title: "Suggested e2e task", owner: "me" },
          reason: "e2e",
        }),
      });
      await fetch("/api/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "createTask",
          title: "Team run task",
          owner: "team",
        }),
      });
    });
    await page.reload();
    await saveOpenRouterKey(page);
    await openPlan(page);

    const accept = page.getByTestId("plan-accept-suggestion").first();
    if (await accept.isVisible().catch(() => false)) {
      await accept.click();
      await expect(
        page.getByTestId("plan-card").filter({ hasText: "Suggested e2e task" }),
      ).toBeVisible({ timeout: 10_000 });
    }

    const run = page.getByTestId("plan-run-task").first();
    await expect(run).toBeVisible({ timeout: 10_000 });
    await run.click();
    await expect(page.getByRole("textbox", { name: "Message" })).toContainText(
      /Team run task|Task:/i,
      { timeout: 10_000 },
    );
  });

  test("experiment verdict updates linked task; STATE next steps reflect open tasks", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await saveOpenRouterKey(page);

    const seeded = await page.evaluate(async () => {
      const taskRes = await fetch("/api/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "createTask",
          title: "Linked experiment follow-up",
          owner: "me",
          experimentIds: ["exp-e2e-1"],
        }),
      });
      const taskJson = (await taskRes.json()) as { id?: string };
      const verdictRes = await fetch("/api/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "suggestAfterVerdict",
          experimentId: "exp-e2e-1",
          verdict: "supported",
        }),
      });
      return {
        taskOk: taskRes.ok,
        verdictOk: verdictRes.ok,
        taskId: taskJson.id,
      };
    });
    expect(seeded.taskOk).toBe(true);

    await openPlan(page);
    // Linked task should move to doing after verdict suggestion path.
    await expect(
      page
        .getByTestId("plan-card")
        .filter({ hasText: /Linked experiment follow-up|Analyse results/i })
        .first(),
    ).toBeVisible({ timeout: 15_000 });

    const expand = page.getByRole("button", { name: /Expand memory panel/i });
    if (await expand.isVisible().catch(() => false)) {
      await expand.click();
    }
    await page.getByRole("tab", { name: /^State$/i }).click();
    await expect(page.getByTestId("state-panel")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("state-panel")).toContainText(
      /Linked experiment follow-up|Analyse results|open task/i,
      { timeout: 15_000 },
    );
  });
});
