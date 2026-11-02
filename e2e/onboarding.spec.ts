import { expect, test } from "@playwright/test";

test.describe("Onboarding", () => {
  test("skip completes wizard", async ({ page }) => {
    await page.request.patch("http://127.0.0.1:3000/api/onboarding", {
      data: { action: "reset" },
    });
    await page.goto("/");
    await expect(page.getByTestId("onboarding-wizard")).toBeVisible({
      timeout: 15_000,
    });
    await page.getByTestId("onboarding-skip").click();
    await expect(page.getByTestId("onboarding-wizard")).toBeHidden({
      timeout: 10_000,
    });
  });

  test("next through welcome then finish via skip", async ({ page }) => {
    await page.request.patch("http://127.0.0.1:3000/api/onboarding", {
      data: { action: "reset" },
    });
    await page.goto("/");
    await expect(page.getByTestId("onboarding-wizard")).toBeVisible();
    await page.getByTestId("onboarding-next").click();
    await expect(
      page.getByText(/Connect OpenRouter|OpenRouter/i).first(),
    ).toBeVisible();
    await page.getByTestId("onboarding-skip").click();
    await expect(page.getByTestId("onboarding-wizard")).toBeHidden();
  });
});
