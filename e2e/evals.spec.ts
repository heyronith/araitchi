import { expect, test } from "@playwright/test";

test.describe("Evaluations", () => {
  test("Settings → Evaluations renders fixture bench tables", async ({
    page,
  }) => {
    // Ensure wizard is not blocking (shared e2e data dir may have been reset).
    await page.request.patch("http://127.0.0.1:3000/api/onboarding", {
      data: { action: "skip" },
    });
    await page.goto("/");
    await page.getByRole("button", { name: "Open settings" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByRole("tab", { name: "Evaluations" }).click();
    await expect(page.getByTestId("evaluations-panel")).toBeVisible();
    await expect(page.getByTestId("evals-bench-table").first()).toBeVisible();
    await expect(page.getByTestId("evals-bar-chart").first()).toBeVisible();
  });
});
