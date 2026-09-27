import { expect, test } from "@playwright/test";

import { testDb } from "./db";

/**
 * Stays and rentals (D67): a new store is copied with the template's demo
 * cabin; a shopper chooses arrival and departure on its page, and the cart
 * holds the nights. On a phone nothing is wider than the screen.
 */
async function newStore(): Promise<string> {
  const slug = `stays-${Date.now()}`;
  const sql = testDb();
  try {
    const [request] = await sql`
      insert into commerce.access_requests (email, name, store_name)
      values (${`${slug}@example.com`}, 'Siri', 'Siris Hytter') returning id`;
    await sql`select commerce.approve_access_request(${request.id}, ${slug}, 'Siris Hytter', null)`;
  } finally {
    await sql.end();
  }
  return slug;
}

test("a shopper chooses arrival and departure and finds the nights in the cart", async ({ page }) => {
  const slug = await newStore();
  await page.goto(`/s/${slug}/no/p/demo-hytte`);
  await expect(page.getByText("Innsjekk fra 15:00, utsjekk innen 11:00. Minst 2 netter.")).toBeVisible();
  await expect(page.getByText("Overnatting på faste datoer har ikke angrerett.")).toBeVisible();
  const add = page.getByRole("button", { name: "Legg i handlekurven" });
  await expect(add).toBeDisabled();

  const dates = page.getByRole("group", { name: "Velg datoer" });
  // Next weeks, so every night is ahead of the notice.
  await dates.getByRole("button", { name: "Senere →" }).click();
  const free = dates.getByRole("button", { name: /, ledig$/ });
  await free.nth(1).click();
  await expect(page.getByText("Velg avreisedag.")).toBeVisible();
  // One night is too short for the cabin.
  await free.nth(2).click();
  await expect(page.getByText("Minst 2 netter.").last()).toBeVisible();
  await expect(add).toBeDisabled();
  await free.nth(1).click();
  await free.nth(4).click();
  await expect(page.getByText("3 netter")).toBeVisible();
  await add.click();
  await expect(page.getByText("Lagt i handlekurven.")).toBeVisible();

  await page.goto(`/s/${slug}/no/cart`);
  const line = page.getByRole("listitem").filter({ hasText: "Hytte ved vannet" });
  await expect(line).toContainText(/Innsjekk .*15[:.]00, utsjekk .*11[:.]00/);
  await expect(line).toContainText("3 netter");
  await expect(line.getByLabel("Antall")).toHaveCount(0);
  // 3 nights at 1 450 kr, a 30 % deposit now.
  const summary = page.locator("aside dl");
  await expect(summary.locator("div").filter({ hasText: /^Betales nå/ })).toContainText("1 305,00");
  await line.getByRole("button", { name: /Fjern/ }).click();
  await expect(page.getByText("Handlekurven er tom.")).toBeVisible();
});

test("the date picker fits a phone", async ({ page }) => {
  const slug = await newStore();
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto(`/s/${slug}/no/p/demo-sykkelutleie`);
  await expect(page.getByRole("group", { name: "Velg datoer" }).getByRole("button", { name: /, ledig$/ }).first()).toBeVisible();
  await expect(page.getByText("Hentes fra 09:00, leveres innen 17:00.")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
});
