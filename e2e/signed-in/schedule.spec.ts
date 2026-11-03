import { expect, test } from "@playwright/test";

import { E2E_STORE, OWNER } from "./accounts";

/**
 * A part's schedule (D432): *Show from* and *Show until* at the foot of its General settings write Display's own date
 * condition, so the canvas marks it Scheduled and Advanced → Visibility shows the same dates; a start after its end is not
 * written, and clearing the dates takes only them away.
 */
test.use({ storageState: OWNER.state });

test("a component is scheduled from its General settings, and Display shows the same dates", async ({ page }) => {
  await page.goto(`/admin/${E2E_STORE}/pages/new`);
  await page.getByRole("tab", { name: "Components" }).click();
  await page.getByRole("button", { name: "Add heading", exact: true }).press("Enter");
  await page.getByRole("textbox", { name: "Heading", exact: true }).click();
  await page.keyboard.type("Christmas sale");

  // At the foot of General: the schedule, in the store's time zone.
  const schedule = page.getByRole("group", { name: "Schedule" });
  await expect(schedule.getByText(/In the store's time zone/)).toBeVisible();
  await schedule.getByLabel("Show from").fill("2026-12-01T00:00");
  await schedule.getByLabel("Show until").fill("2026-12-24T18:00");
  const badge = page.locator('[data-builder-item="block"] [data-builder-display="rules"]');
  await expect(badge).toHaveText("Scheduled");

  // An end before the start is said, and not written: the part keeps its dates.
  await schedule.getByLabel("Show until").fill("2026-11-01T00:00");
  await expect(schedule.getByRole("alert")).toHaveText("Show until must be after Show from.");
  await schedule.getByLabel("Show until").fill("2026-12-24T18:00");
  await expect(schedule.getByRole("alert")).toHaveCount(0);

  // Display, under Advanced, holds the same dates as its own condition.
  await page.getByRole("tab", { name: "Advanced" }).click();
  await expect(page.getByLabel("Display", { exact: true })).toHaveValue("rules");
  const dates = () => page.locator('input[type="datetime-local"]').evaluateAll((inputs) => inputs.map((input) => (input as HTMLInputElement).value));
  await expect.poll(dates).toEqual(["2026-12-01T00:00", "2026-12-24T18:00"]);

  // Back under General, the dates are there to clear, and clearing them shows the part to everyone again.
  await page.getByRole("tab", { name: "General" }).click();
  await expect(schedule.getByLabel("Show from")).toHaveValue("2026-12-01T00:00");
  await schedule.getByRole("button", { name: "Clear the dates" }).click();
  await expect(badge).toHaveCount(0);
  await page.getByRole("tab", { name: "Advanced" }).click();
  await expect(page.getByLabel("Display", { exact: true })).toHaveValue("always");
});
