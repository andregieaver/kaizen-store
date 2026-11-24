import { expect, test } from "@playwright/test";

import { testDb } from "../db";

import { ADMIN, E2E_STORE, OWNER } from "./accounts";

/**
 * Which companies visited (D890) as Kaizena Flow's team and a store's owner meet it. The platform admin switches company recognition on in
 * Kaizena Flow's own store through the real form, finds the Leadfeeder connection there, and reads the seeded companies on Analytics →
 * Visiting companies; a store's owner is told it is not available yet and has no such page in the menu. With `COMPANY_SHOTS` set to a
 * folder it also keeps screenshots of the screens.
 */

const shots = process.env.COMPANY_SHOTS;
// Screenshots for people are taken sharp; the checks themselves run as every other spec does.
test.use({ deviceScaleFactor: shots ? 2 : 1 });
const run = Date.now().toString(36);
let houseId = "";
let countedBefore = false;

/** A day `n` days before today, as the store's calendar writes it (the test runs in UTC). */
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

test.beforeAll(async () => {
  const sql = testDb();
  try {
    const [house] = await sql`select id, visit_counting from commerce.stores where house`;
    houseId = String(house.id);
    countedBefore = Boolean(house.visit_counting);
    // Off, so the test switches visit counting on as an owner does (the store's cached facts follow the switch, not a write here).
    await sql`update commerce.stores set visit_counting = false, company_recognition = false where id = ${houseId}`;
    // Three made-up companies and their days on the house store, as recordCompanyVisit() writes them.
    const companies = [
      { id: `lf-${run}-a`, name: "Nordfjord Energi AS", industry: "Production of electricity", employees: "101-500", city: "Bergen", domain: "nordfjord-energi.example", days: [[0, 2, 5, { "/no/pricing": 3, "/no": 2 }], [2, 1, 2, { "/no/pricing": 2 }], [5, 1, 3, { "/no/features": 3 }]] },
      { id: `lf-${run}-b`, name: "Bergvik Maskin AS", industry: "Machinery", employees: "11-100", city: "Ålesund", domain: "bergvik-maskin.example", days: [[1, 1, 4, { "/no/pricing": 1, "/no/blog": 3 }], [9, 1, 1, { "/no": 1 }]] },
      { id: `lf-${run}-c`, name: "Solstad Interiør AS", industry: "Retail of furniture", employees: "1-10", city: "Oslo", domain: null, days: [[12, 1, 1, { "/no": 1 }]] },
    ] as const;
    for (const c of companies) {
      const [row] = await sql`
        insert into commerce.visit_companies (source, source_id, name, legal_form, domain, country_code, city, industry, employees)
        values ('leadfeeder', ${c.id}, ${c.name}, 'AS', ${c.domain}, 'NO', ${c.city}, ${c.industry}, ${c.employees}) returning id`;
      for (const [ago, visitors, views, pages] of c.days) {
        const day = daysAgo(ago);
        await sql`
          insert into commerce.company_visits (store_id, day, company_id, visitors, page_views, pages, first_seen, last_seen)
          values (${houseId}, ${day}, ${String(row.id)}, ${visitors}, ${views}, ${sql.json(pages)}, ${`${day}T08:00:00Z`}, ${`${day}T09:30:00Z`})`;
      }
    }
  } finally {
    await sql.end();
  }
});

test.afterAll(async () => {
  const sql = testDb();
  try {
    await sql`delete from commerce.visit_companies where source_id like ${`lf-${run}-%`}`;
    await sql`update commerce.stores set company_recognition = false, visit_counting = ${countedBefore} where id = ${houseId}`;
  } finally {
    await sql.end();
  }
});

test.describe("as Kaizena Flow's platform admin", () => {
  test.use({ storageState: ADMIN.state });

  test("switches company recognition on for Kaizena Flow's store and reads which companies visited", async ({ page }) => {
    await page.goto("/admin/kaizenaflow/analytics/settings#companies");
    const card = page.getByRole("region", { name: "Which companies visited" });
    // It rides on visit counting: until that is on, the card says so and offers no switch.
    await expect(card.getByText("Switch visit counting on first: companies are found from counted visits.")).toBeVisible();
    await expect(card.getByRole("button", { name: "Switch company recognition on" })).toHaveCount(0);
    await page.getByRole("button", { name: "Turn on visit counting" }).first().click();
    await expect(card.getByText("Switch visit counting on first", { exact: false })).toHaveCount(0);
    await expect(card.getByText("Looking up the companies behind counted visits.")).toHaveCount(0);
    await expect(card.getByText("Only the company is kept, with the day and the pages: never the visitor's address, and never a person")).toBeVisible();
    // The connection is a platform admin's: the key's field, never a key.
    await expect(card.getByLabel("API key")).toHaveAttribute("type", "password");
    await expect(card.getByLabel(/Account ID/)).toBeVisible();
    await card.getByRole("button", { name: "Switch company recognition on" }).click();
    await expect(page.getByText("Company recognition is on.", { exact: false }).first()).toBeVisible();
    await expect(card.getByText("Looking up the companies behind counted visits.")).toBeVisible();
    if (shots) await card.screenshot({ path: `${shots}/settings-card.png` });

    await card.getByRole("link", { name: "See the companies" }).click();
    await expect(page).toHaveURL(/\/admin\/kaizenaflow\/analytics\/companies/);
    await expect(page.getByRole("heading", { name: "Visiting companies", level: 1 })).toBeVisible();
    // Leadfeeder is not connected in the test database: the page says so above the companies already counted.
    await expect(page.getByText("Leadfeeder is not connected yet", { exact: false })).toBeVisible();
    const list = page.getByRole("list", { name: "Companies that visited" });
    const first = list.getByRole("listitem").filter({ has: page.getByRole("heading", { level: 3 }) }).first();
    await expect(first.getByRole("heading", { level: 3 })).toHaveText("Nordfjord Energi AS");
    await expect(first).toContainText("Production of electricity · 101-500 employees · Bergen, NO");
    await expect(first).toContainText("4 visits");
    await expect(first).toContainText("on 3 days");
    // Kaizena Flow's store has no country in its addresses: its pages are shown without one.
    await expect(first).toContainText("/pricing");
    await expect(first).not.toContainText("/no/pricing");
    await expect(list.getByRole("heading", { name: "Solstad Interiør AS" })).toBeVisible();
    if (shots) await page.screenshot({ path: `${shots}/companies-computer.png`, fullPage: true });
    if (shots) {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({ path: `${shots}/companies-phone.png`, fullPage: true });
    }
  });
});

test.describe("as a store's owner", () => {
  test.use({ storageState: OWNER.state });

  test("is told company recognition is not available yet, and has no such page in the menu", async ({ page }) => {
    await page.goto(`/admin/${E2E_STORE}/analytics/settings#companies`);
    const card = page.getByRole("region", { name: "Which companies visited" });
    await expect(card.getByText("Not available for your store yet.")).toBeVisible();
    await expect(card.getByRole("button", { name: "Switch company recognition on" })).toHaveCount(0);
    await expect(card.getByLabel("API key")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Visiting companies" })).toHaveCount(0);
  });
});
