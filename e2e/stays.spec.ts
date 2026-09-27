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
  // Final cleaning and the seasons' prices, before choosing (D70).
  await expect(page.getByText(/^Sluttrengjøring$/)).toBeVisible();
  const seasons = page.getByRole("region", { name: "Priser gjennom året" });
  await expect(seasons.getByText(/Høysesong \(15\. juni–15\. august\)/)).toBeVisible();
  await expect(seasons.getByRole("listitem").filter({ hasText: "Høysesong" })).toContainText(/1\s?885,00/);
  await expect(seasons.getByRole("listitem").filter({ hasText: "Helg" })).toContainText(/fre\.?, lør/);
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
  await expect(line).toContainText("Sluttrengjøring 500,00");
  // A 30 % deposit now, the rest on arrival.
  const summary = page.locator("aside dl");
  await expect(summary.locator("div").filter({ hasText: /^Betales nå/ })).toBeVisible();
  await expect(summary.locator("div").filter({ hasText: /^Betales på stedet/ })).toBeVisible();
  await line.getByRole("button", { name: /Fjern/ }).click();
  await expect(page.getByText("Handlekurven er tom.")).toBeVisible();
});

test("the date picker fits a phone", async ({ page }) => {
  const slug = await newStore();
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto(`/s/${slug}/no/p/demo-sykkelutleie`);
  await expect(page.getByText("Hentes fra 09:00, leveres innen 17:00.")).toBeVisible();
  // It opens on the cheapest way to rent, by the hour: a day, then its hours.
  const days = page.getByRole("group", { name: "Velg dag" });
  await days.getByRole("button", { name: "Senere →" }).click();
  await days.getByRole("button", { name: /, ledig$/ }).first().click();
  await expect(page.getByRole("group", { name: "Velg tid" }).getByRole("button").first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
});

test("a room's calendar is published at its secret address, as whole days, and nowhere else", async ({ request }) => {
  const slug = await newStore();
  const token = `e2e${Date.now()}abcdefghijklmnop`;
  const sql = testDb();
  try {
    await sql`
      update commerce.booking_resources r set calendar_token = ${token}
      from commerce.stores s where s.id = r.store_id and s.slug = ${slug} and r.kind = 'unit'`;
    await sql`
      insert into commerce.resource_blocks (store_id, resource_id, starts_at, ends_at, note)
      select r.store_id, r.id, '2030-05-01T10:00Z', '2030-05-03T10:00Z', 'Eierens uke'
      from commerce.booking_resources r join commerce.stores s on s.id = r.store_id
      where s.slug = ${slug} and r.kind = 'unit'`;
  } finally {
    await sql.end();
  }
  const response = await request.get(`/api/calendar/${token}.ics`);
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("text/calendar");
  const body = await response.text();
  expect(body).toContain("DTSTART;VALUE=DATE:20300501\r\nDTEND;VALUE=DATE:20300503");
  expect(body).toContain("SUMMARY:Blocked");
  expect(body).not.toContain("Eierens uke");
  expect((await request.get(`/api/calendar/${token}x.ics`)).status()).toBe(404);
});

test("a shopper rents a bike by the hour, then for half a day", async ({ page }) => {
  const slug = await newStore();
  await page.goto(`/s/${slug}/no/p/demo-sykkelutleie`);
  const add = page.getByRole("button", { name: "Legg i handlekurven" });

  await page.getByRole("radio", { name: "Leie: Per time" }).check();
  const days = page.getByRole("group", { name: "Velg dag" });
  await days.getByRole("button", { name: "Senere →" }).click();
  await days.getByRole("button", { name: /, ledig$/ }).first().click();
  const times = page.getByRole("group", { name: "Velg tid" });
  await times.getByRole("button", { name: /^10[:.]00$/ }).click();
  await page.getByLabel("Antall timer").selectOption("3");
  await expect(add).toBeEnabled();
  await add.click();
  await expect(page.getByText("Lagt i handlekurven.")).toBeVisible();

  await page.getByRole("radio", { name: "Leie: Halv dag" }).check();
  await days.getByRole("button", { name: /, ledig$/ }).nth(1).click();
  await times.getByRole("button", { name: /^13[:.]00–17[:.]00$/ }).click();
  await add.click();
  await expect(page.getByText("Lagt i handlekurven.")).toBeVisible();

  await page.goto(`/s/${slug}/no/cart`);
  const hourly = page.getByRole("listitem").filter({ hasText: "3 timer" });
  await expect(hourly).toContainText(/Henting .*10[:.]00, levering .*13[:.]00/);
  await expect(hourly).toContainText("360,00");
  const half = page.getByRole("listitem").filter({ hasText: "Halv dag" });
  await expect(half).toContainText(/Henting .*13[:.]00, levering .*17[:.]00/);
  await expect(half).toContainText("300,00");
});

test("a host's listing names its host (D71)", async ({ page }) => {
  const slug = await newStore();
  const sql = testDb();
  try {
    const [account] = await sql`insert into commerce.accounts (email) values (${`host-${slug}@example.com`}) returning id`;
    await sql`
      with host as (
        insert into commerce.hosts (store_id, account_id, name)
        select id, ${account.id}, 'Karis hytter' from commerce.stores where slug = ${slug}
        returning id, store_id
      )
      update commerce.products p set host_id = host.id from host
      where p.store_id = host.store_id and p.handle = 'demo-hytte'`;
  } finally {
    await sql.end();
  }
  await page.goto(`/s/${slug}/no/p/demo-hytte`);
  await expect(page.getByText("Utleier: Karis hytter")).toBeVisible();
});
