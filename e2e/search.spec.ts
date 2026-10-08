import { expect, test } from "@playwright/test";

import { testDb } from "./db";

/**
 * Keyword search (Phase 2, S1): from the header to the search page, with
 * suggestions as the shopper types, results in the market's language, and
 * the store's categories when nothing is found.
 */
async function newStore(): Promise<string> {
  const slug = `search-${Date.now()}`;
  const sql = testDb();
  try {
    const [request] = await sql`
      insert into commerce.access_requests (email, name, store_name)
      values (${`${slug}@example.com`}, 'Siri', 'Siris Butikk') returning id`;
    await sql`select commerce.approve_access_request(${request.id}, ${slug}, 'Siris Butikk', null)`;
    // A new store starts with the shop alone (D178): stays and rentals are switched on, as an owner would under Features, so the
    // demo cabin is found.
    await sql`update commerce.stores set features = array['shop', 'bookings', 'countries'] where slug = ${slug}`;
  } finally {
    await sql.end();
  }
  return slug;
}

test("a shopper searches from the header, picks a suggestion, and finds results", async ({ page }) => {
  const slug = await newStore();
  await page.goto(`/s/${slug}/no`);
  await page.getByRole("link", { name: "Søk" }).first().click();
  await expect(page).toHaveURL(new RegExp(`/s/${slug}/no/search$`));
  await expect(page.getByText("Skriv hva du leter etter.")).toBeVisible();

  // Suggestions from the start of a word, chosen with the keyboard.
  const box = page.getByRole("combobox", { name: "Søk i butikken" });
  await box.fill("kera");
  const list = page.getByRole("listbox", { name: "Forslag" });
  await expect(list.getByRole("option", { name: /Keramikkopp/ })).toBeVisible();
  await box.press("ArrowDown");
  await box.press("Enter");
  await expect(page).toHaveURL(new RegExp(`/s/${slug}/no/p/demo-keramikkopp$`));

  // The whole search: a part of a compound word finds the mug.
  await page.goto(`/s/${slug}/no/search?q=kopp`);
  await expect(page.getByText(/\d+ treff for «kopp»/)).toBeVisible();
  await expect(page.getByRole("link", { name: /Keramikkopp/ }).first()).toBeVisible();
});

test("nothing found offers the categories, and the search is logged for the store", async ({ page }) => {
  const slug = await newStore();
  await page.goto(`/s/${slug}/no/search?q=xyzzyqwv`);
  await expect(page.getByText("Ingen treff for «xyzzyqwv».")).toBeVisible();
  // The top-level categories, to browse instead.
  await expect(page.getByText("Se gjennom kategoriene i stedet:")).toBeVisible();
  await expect(page.getByRole("main").getByRole("link", { name: "Papir" })).toBeVisible();
  const sql = testDb();
  try {
    await expect
      .poll(async () => {
        const [row] = await sql`
          select count(*)::int as n from commerce.search_queries q join commerce.stores s on s.id = q.store_id
          where s.slug = ${slug} and q.query = 'xyzzyqwv' and q.results = 0`;
        return row.n;
      })
      .toBe(1);
  } finally {
    await sql.end();
  }
});

test("a Swedish shopper finds products by their Swedish names", async ({ page }) => {
  const slug = await newStore();
  await page.goto(`/s/${slug}/se/search?q=stuga`);
  await expect(page.getByRole("link", { name: /Stuga vid sjön/ }).first()).toBeVisible();
});

test("opening a result goes to the product and is recorded against the search, with no cookie", async ({ page, context }) => {
  const slug = await newStore();
  await page.goto(`/s/${slug}/no/search?q=kopp`);
  const result = page.getByRole("link", { name: /Keramikkopp/ }).first();
  await expect(result).toHaveAttribute("rel", "nofollow");
  // Its place in the results as shown (other demo products match "kopp" too and can rank first): the click must be recorded at that place.
  const shownAt = new URL((await result.getAttribute("href")) ?? "", "http://x").searchParams.get("r");
  expect(Number(shownAt)).toBeGreaterThan(0);
  await result.click();
  await expect(page).toHaveURL(new RegExp(`/s/${slug}/no/p/demo-keramikkopp$`));
  expect((await context.cookies()).filter((c) => /search|arm|experiment/i.test(c.name))).toEqual([]);
  const sql = testDb();
  try {
    await expect
      .poll(async () => {
        const [row] = await sql`
          select c.position, q.query from commerce.search_clicks c
          join commerce.search_queries q on q.id = c.search_id
          join commerce.stores s on s.id = c.store_id
          where s.slug = ${slug}`;
        return row ? `${row.query}@${row.position}` : null;
      })
      .toBe(`kopp@${shownAt}`);
  } finally {
    await sql.end();
  }
});
