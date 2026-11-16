import { expect, test } from "@playwright/test";

import { E2E_STORE, OWNER } from "./accounts";

/**
 * A part's schedule (D432): *Show from* and *Show until*, under Visibility's *When* (D631, beside the screens and who sees it),
 * write Display's own date condition, so the canvas marks it Scheduled, *Who sees it* shows conditions and the sentence at the top
 * says the dates; a start after its end is not written, and clearing the dates takes only them away.
 */
test.use({ storageState: OWNER.state });

test("a component is scheduled under Visibility, where who sees it shows the same dates", async ({ page }) => {
  await page.goto(`/admin/${E2E_STORE}/pages/new`);
  await page.getByRole("tab", { name: "Components" }).click();
  await page.getByRole("button", { name: "Add heading", exact: true }).press("Enter");
  await page.getByRole("textbox", { name: "Heading", exact: true }).click();
  await page.keyboard.type("Christmas sale");

  // Under Visibility: the schedule, in the store's time zone, after who sees it.
  await page.getByRole("tab", { name: "Visibility" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Shown to everyone on every screen size." })).toBeVisible();
  const schedule = page.getByRole("group", { name: "When" });
  await expect(schedule.getByText(/In the store's time zone/)).toBeVisible();
  await schedule.getByLabel("Show from").fill("2026-12-01T00:00");
  await schedule.getByLabel("Show until").fill("2026-12-24T18:00");
  const badge = page.locator('[data-builder-item="block"] [data-builder-display="rules"]');
  await expect(badge).toHaveText("Scheduled");
  // A schedule alone is still everyone's: the sentence says the dates.
  await expect(page.getByRole("status").filter({ hasText: /^Shown to everyone on every screen size from / })).toBeVisible();

  // An end before the start is said, and not written: the part keeps its dates.
  await schedule.getByLabel("Show until").fill("2026-11-01T00:00");
  await expect(schedule.getByRole("alert")).toHaveText("Show until must be after Show from.");
  await schedule.getByLabel("Show until").fill("2026-12-24T18:00");
  await expect(schedule.getByRole("alert")).toHaveCount(0);

  // Who sees it holds the same dates as its own condition.
  await expect(page.getByLabel("Who sees it", { exact: true })).toHaveValue("rules");
  const dates = () => page.locator('input[type="datetime-local"]').evaluateAll((inputs) => inputs.map((input) => (input as HTMLInputElement).value));
  await expect.poll(dates).toEqual(["2026-12-01T00:00", "2026-12-24T18:00", "2026-12-01T00:00", "2026-12-24T18:00"]);

  // Clearing them shows the part to everyone again.
  await schedule.getByRole("button", { name: "Clear the dates" }).click();
  await expect(badge).toHaveCount(0);
  await expect(page.getByLabel("Who sees it", { exact: true })).toHaveValue("always");
});
