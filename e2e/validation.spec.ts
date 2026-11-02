import { expect, test, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  writeFileSync,
  readFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

async function saveOpenRouterKey(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Open settings" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByLabel(/OpenRouter API key/i).fill("sk-or-v1-fake-e2e-key");
  await page.getByRole("button", { name: "Save" }).nth(0).click();
  await expect(page.getByText("Saved").first()).toBeVisible();
  await page.keyboard.press("Escape");
}

function initGitRepo(folder: string) {
  execFileSync("git", ["init"], { cwd: folder, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "e2e@test"], {
    cwd: folder,
    stdio: "ignore",
  });
  execFileSync("git", ["config", "user.name", "e2e"], {
    cwd: folder,
    stdio: "ignore",
  });
  writeFileSync(path.join(folder, "README.md"), "# e2e\n");
  execFileSync("git", ["add", "."], { cwd: folder, stdio: "ignore" });
  execFileSync("git", ["commit", "-m", "init"], {
    cwd: folder,
    stdio: "ignore",
  });
}

async function openFolder(page: Page, folder: string) {
  await page.goto("/");
  await page.getByRole("button", { name: /Open folder/i }).click();
  await page.getByLabel(/Paste a path/i).fill(folder);
  await page.getByRole("button", { name: "Use" }).click();
  await page.getByRole("button", { name: "Confirm" }).click();
  await expect(page.getByText("Project opened")).toBeVisible({
    timeout: 15_000,
  });
}

test.describe("validation loop", () => {
  test.setTimeout(120_000);

  test("hypothesis → design → lock → check supported / refuted / inconclusive / override / version", async ({
    page,
    request,
  }) => {
    const folder = mkdtempSync(path.join(tmpdir(), "araitchi-val-"));
    initGitRepo(folder);
    await openFolder(page, folder);
    await saveOpenRouterKey(page);

    // Create hypothesis via API
    const hypRes = await request.post(
      "http://127.0.0.1:3000/api/projects/records",
      {
        data: {
          type: "hypothesis",
          title: "Insertion sort beats merge sort for n<32",
          body: "For tiny arrays, insertion has lower constant factors.",
          status: "proposed",
          source: "user",
        },
      },
    );
    expect(hypRes.ok()).toBeTruthy();
    const hypJson = (await hypRes.json()) as { record: { id: string } };
    const hypId = hypJson.record.id;

    await page.getByRole("tab", { name: "Hypotheses" }).click();
    await expect(
      page.getByText("Insertion sort beats merge sort for n<32"),
    ).toBeVisible();
    await page.getByTestId("design-experiment").first().click();
    await expect(page.getByTestId("experiment-designer")).toBeVisible();

    await page.getByTestId("exp-title").fill("Tiny-array sort race");
    await page
      .getByTestId("exp-objective")
      .fill("Insertion ms mean below merge baseline");
    await page
      .getByTestId("exp-protocol")
      .fill("1. Bench both\n2. Write results.json");
    await page.getByTestId("exp-pred-value").first().fill("10");
    await page.getByTestId("exp-pred-comparator").first().selectOption("<");

    await page.getByTestId("exp-design").click();
    await expect(page.getByTestId("experiment-designer")).toContainText(
      /E-\d+/,
    );

    // Edit prediction then lock
    await page.getByTestId("exp-pred-value").first().fill("1");
    await page.getByTestId("exp-lock").click();
    await expect(page.getByTestId("experiment-designer")).toContainText(
      /awaiting_run|locked/i,
    );

    await page.getByTestId("exp-instructions-btn").click();
    await expect(page.getByTestId("exp-instructions")).toBeVisible({
      timeout: 10_000,
    });

    // Discover experiment id + lock hash from API
    const list = await request.get("http://127.0.0.1:3000/api/experiments");
    const listJson = (await list.json()) as {
      experiments: {
        id: string;
        lockHash: string | null;
        resultsPath: string;
        status: string;
      }[];
    };
    const exp = listJson.experiments[0]!;
    expect(exp.lockHash).toBeTruthy();

    const instructionsPath = path.join(
      folder,
      ".research",
      "experiments",
      exp.id,
      "instructions.md",
    );
    expect(existsSync(instructionsPath)).toBeTruthy();

    // Passing results
    const resultsDir = path.join(folder, "experiments", exp.id);
    mkdirSync(resultsDir, { recursive: true });
    const resultsPath = path.join(folder, exp.resultsPath);
    mkdirSync(path.dirname(resultsPath), { recursive: true });
    writeFileSync(
      resultsPath,
      JSON.stringify({
        experimentId: exp.id,
        lockHash: exp.lockHash,
        runs: [
          { seed: 1, metrics: { accuracy: 0.2 } },
          { seed: 2, metrics: { accuracy: 0.2 } },
          { seed: 3, metrics: { accuracy: 0.2 } },
        ],
      }),
    );
    // Align metric with UI default "accuracy" and comparator < 1
    // (designer default metric accuracy; value edited to 1)
    execFileSync("git", ["add", "."], { cwd: folder, stdio: "ignore" });
    execFileSync("git", ["commit", "-m", `exp(${exp.id}): pass`], {
      cwd: folder,
      stdio: "ignore",
    });

    await page.getByTestId("exp-check").click();
    await expect(page.getByTestId("exp-verdict")).toContainText(/supported/i, {
      timeout: 30_000,
    });

    await page.keyboard.press("Escape");
    await page.getByRole("tab", { name: "Timeline" }).click();
    await expect(page.getByTestId("timeline-event").first()).toBeVisible();
    await expect(page.getByTestId("timeline-verdict").first()).toBeVisible();

    // Hypothesis status
    const hypAfter = await request.get(
      `http://127.0.0.1:3000/api/projects/records?type=hypothesis`,
    );
    const hyps = (await hypAfter.json()) as {
      records: { id: string; status: string }[];
    };
    expect(hyps.records.find((r) => r.id === hypId)?.status).toBe("supported");

    // Failing results → refuted on a new experiment
    const failDraft = await request.post(
      "http://127.0.0.1:3000/api/experiments",
      {
        data: {
          hypothesisId: hypId,
          draft: {
            title: "Fail case",
            objective: "Should refute",
            protocol: "fail",
            baselines: "",
            dataset: "",
            requiredRuns: 3,
            seeds: [1, 2, 3],
            environmentNotes: "",
            predictions: [
              {
                id: "p1",
                metric: "score",
                comparator: ">",
                value: 0.9,
                aggregate: "mean",
              },
            ],
          },
        },
      },
    );
    const failExp = ((await failDraft.json()) as { experiment: { id: string } })
      .experiment;
    await request.post(
      `http://127.0.0.1:3000/api/experiments/${failExp.id}/lock`,
    );
    const failGet = await request.get(
      `http://127.0.0.1:3000/api/experiments/${failExp.id}`,
    );
    const failLocked = (
      (await failGet.json()) as {
        experiment: { id: string; lockHash: string; resultsPath: string };
      }
    ).experiment;
    mkdirSync(path.dirname(path.join(folder, failLocked.resultsPath)), {
      recursive: true,
    });
    writeFileSync(
      path.join(folder, failLocked.resultsPath),
      JSON.stringify({
        experimentId: failLocked.id,
        lockHash: failLocked.lockHash,
        runs: [
          { seed: 1, metrics: { score: 0.1 } },
          { seed: 2, metrics: { score: 0.1 } },
          { seed: 3, metrics: { score: 0.1 } },
        ],
      }),
    );
    execFileSync("git", ["add", "."], { cwd: folder, stdio: "ignore" });
    execFileSync("git", ["commit", "-m", `exp(${failLocked.id}): fail`], {
      cwd: folder,
      stdio: "ignore",
    });
    const failCheck = await request.post(
      `http://127.0.0.1:3000/api/experiments/${failLocked.id}/check`,
      { data: { skipInterpretation: true } },
    );
    const failChecked = (await failCheck.json()) as {
      experiment: { verdict: string };
    };
    expect(failChecked.experiment.verdict).toBe("refuted");

    // Context indicator includes Already tested after chat
    await page
      .getByRole("group", { name: "Research mode" })
      .getByRole("button", { name: "Solo", exact: true })
      .click();
    await page.getByRole("button", { name: "New chat" }).first().click();
    await page
      .getByRole("textbox", { name: "Message" })
      .fill("Tell me about sorting on tiny arrays");
    await page.getByRole("button", { name: "Send message" }).click();
    await expect(page.getByText("Done.").first()).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByTestId("context-indicator")).toBeVisible();
    await page.getByTestId("context-indicator").click();
    await expect(page.getByTestId("context-indicator-details")).toContainText(
      /Already tested/i,
      { timeout: 10_000 },
    );

    // Missing file → inconclusive
    const miss = await request.post("http://127.0.0.1:3000/api/experiments", {
      data: {
        draft: {
          title: "Missing file",
          objective: "o",
          protocol: "p",
          baselines: "",
          dataset: "",
          requiredRuns: 1,
          seeds: [1],
          environmentNotes: "",
          predictions: [
            {
              id: "p1",
              metric: "x",
              comparator: ">",
              value: 0,
              aggregate: "mean",
            },
          ],
        },
      },
    });
    const missExp = ((await miss.json()) as { experiment: { id: string } })
      .experiment;
    await request.post(
      `http://127.0.0.1:3000/api/experiments/${missExp.id}/lock`,
    );
    const missCheck = await request.post(
      `http://127.0.0.1:3000/api/experiments/${missExp.id}/check`,
      { data: { skipInterpretation: true } },
    );
    const missOut = (await missCheck.json()) as {
      experiment: { verdict: string; verdictEvidence: { reasons: string[] } };
    };
    expect(missOut.experiment.verdict).toBe("inconclusive");
    expect(missOut.experiment.verdictEvidence.reasons.join(" ")).toMatch(
      /not found/i,
    );

    // Override requires reason
    const badOv = await request.post(
      `http://127.0.0.1:3000/api/experiments/${failLocked.id}/override`,
      { data: { verdict: "supported", reason: "" } },
    );
    expect(badOv.status()).toBe(400);

    const goodOv = await request.post(
      `http://127.0.0.1:3000/api/experiments/${failLocked.id}/override`,
      {
        data: {
          verdict: "supported",
          reason: "Manual review of measurement noise",
        },
      },
    );
    expect(goodOv.ok()).toBeTruthy();

    // Edit after lock creates version 2
    const v2 = await request.patch(
      `http://127.0.0.1:3000/api/experiments/${exp.id}`,
      { data: { title: "Modified after lock" } },
    );
    const v2json = (await v2.json()) as {
      experiment: { id: string; version: number; status: string };
    };
    expect(v2json.experiment.version).toBe(2);
    expect(v2json.experiment.status).toBe("draft");
    expect(v2json.experiment.id).not.toBe(exp.id);

    // instructions file still present for original
    expect(readFileSync(instructionsPath, "utf8")).toMatch(
      /Cursor instructions/,
    );
  });
});
