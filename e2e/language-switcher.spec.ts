import { expect, test, type Browser } from "@playwright/test";

import { testDb } from "./db";

/**
 * The language a visitor sees first and the language switcher (D479). A store in one country with Norwegian, English and Swedish, its
 * header's *Languages* part side by side with names on a computer and a list to open with flags and codes on a phone, and the rule
 * `browser`: the front door sends an English browser to English (a 307, for that visitor alone), a page's own address never moves, and a
 * language chosen in the switcher is remembered for the front door.
 */
const content = (title: string, rows: unknown[]) => ({
  title,
  slug: title.toLowerCase(),
  thumbnail: null,
  seo: { title: "", description: "" },
  searchEngines: true,
  aiAssistants: true,
  categories: [],
  tags: [],
  rows,
});
const row = (id: string, blocks: unknown[]) => ({ id, type: "row", layout: "1", sideBySide: true, columns: [{ id: `${id}-c`, inline: true, blocks }] });

const slug = `lang-${Date.now()}`;
let storeId = "";

test.beforeAll(async () => {
  const header = content("Topp", [
    row("h", [
      { id: "logo", type: "site", part: "logo" },
      { id: "langs", type: "site", part: "languages", langFlag: true, at: { sm: { switcher: "dropdown", langText: "code" } } },
      { id: "cart", type: "site", part: "cart" },
    ]),
  ]);
  const about = content("Om", [row("om", [{ id: "o", type: "heading", text: "Om oss", level: 1 }])]);
  const sql = testDb();
  try {
    const [request] = await sql`
      insert into commerce.access_requests (email, name, store_name) values (${`${slug}@example.com`}, 'Siri', 'Siris Butikk') returning id`;
    const [{ id }] = await sql`select commerce.approve_access_request(${request.id}, ${slug}, 'Siris Butikk', null) as id`;
    storeId = String(id);
    const add = (type: string, value: ReturnType<typeof content>) => sql`
      insert into commerce.pages (store_id, type, slug, draft, published, published_at)
      values (${storeId}, ${type}, ${value.slug}, ${sql.json(value as never)}, ${sql.json(value as never)}, now()) returning id`;
    const [[{ id: headerId }]] = await Promise.all([add("header", header), add("page", about)]);
    await sql`
      update commerce.stores
      set header_id = ${headerId}, setup_completed_at = now(), locales = array['nb-NO', 'en-GB', 'sv-SE'],
          features = (select array_agg(distinct f) from unnest(features || array['languages']) f), language_rule = 'browser'
      where id = ${storeId}`;
  } finally {
    await sql.end();
  }
});

const visitor = (browser: Browser, locale: string, width = 1280) => browser.newContext({ locale, viewport: { width, height: 800 } });

test("an English browser at the front door is shown English; a page's own address stays in its language", async ({ browser }) => {
  const context = await visitor(browser, "en-GB");
  const page = await context.newPage();
  const door = await page.request.get(`/s/${slug}`, { maxRedirects: 0, headers: { "accept-language": "en-GB,en;q=0.9" } });
  expect(door.status()).toBe(307);
  expect(door.headers()["cache-control"]).toBe("private, no-store");
  expect(door.headers().location).toMatch(new RegExp(`/s/${slug}/en$`));
  await page.goto(`/s/${slug}`);
  await expect(page).toHaveURL(new RegExp(`/s/${slug}/en$`));
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  // A Norwegian page's address is the page the visitor asked for: never moved.
  await page.goto(`/s/${slug}/om`);
  await expect(page).toHaveURL(new RegExp(`/s/${slug}/om$`));
  await expect(page.locator("html")).toHaveAttribute("lang", "nb");
  await context.close();
});

test("a crawler and a browser in a language the store does not have see the country's own", async ({ browser }) => {
  const context = await visitor(browser, "de-DE");
  const page = await context.newPage();
  const door = await page.request.get(`/s/${slug}`, { maxRedirects: 0, headers: { "accept-language": "de-DE" } });
  expect(door.status()).toBe(200);
  const bot = await page.request.get(`/s/${slug}`, { maxRedirects: 0, headers: { "accept-language": "en", "user-agent": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)" } });
  expect(bot.status()).toBe(200);
  await context.close();
});

test("a store with flags off asks for no flag file (bloat review step 0.32)", async ({ browser }) => {
  const plain = `lang-plain-${Date.now()}`;
  const sql = testDb();
  try {
    const [access] = await sql`
      insert into commerce.access_requests (email, name, store_name) values (${`${plain}@example.com`}, 'Siri', 'Siris Butikk') returning id`;
    await sql`select commerce.approve_access_request(${access.id}, ${plain}, 'Siris Butikk', null)`;
    await sql`
      update commerce.stores
      set setup_completed_at = now(), locales = array['nb-NO', 'en-GB', 'sv-SE'],
          features = (select array_agg(distinct f) from unnest(features || array['languages']) f)
      where slug = ${plain}`;
  } finally {
    await sql.end();
  }
  const context = await visitor(browser, "nb-NO");
  const page = await context.newPage();
  const asked: string[] = [];
  page.on("request", (req) => asked.push(req.url()));
  await page.goto(`/s/${plain}/no`);
  await page.waitForTimeout(1000);
  expect(asked.filter((address) => address.includes("/flags/"))).toEqual([]);
  await context.close();
});

test("a public file with a fixed address is kept a day (bloat review step 0.32)", async ({ request }) => {
  const answer = await request.get("/flags/no.svg");
  expect(answer.headers()["cache-control"]).toContain("max-age=86400");
});

test("the switcher shows names on a computer, a list with flags on a phone, and its choice is remembered", async ({ browser }) => {
  const context = await visitor(browser, "en-GB");
  const page = await context.newPage();
  await page.goto(`/s/${slug}/om`);
  // The header's switcher (the standard footer lists the languages too).
  const switcher = page.getByRole("banner").getByRole("navigation", { name: "Velg språk" });
  await expect(switcher.getByRole("link", { name: "English" })).toBeVisible();
  await expect(switcher.getByRole("link", { name: "Svenska" })).toBeVisible();
  await expect(switcher.locator("[data-ls-list] [data-ls-flag]").first()).toBeVisible();
  await switcher.getByRole("link", { name: "Svenska" }).click();
  await expect(page).toHaveURL(new RegExp(`/s/${slug}/sv/om$`));
  const cookies = await context.cookies();
  expect(cookies.find((c) => c.name === `kaizen_lang_${storeId}`)?.value).toBe("sv");
  // The visitor's own choice comes before the browser's language at the front door.
  await page.goto(`/s/${slug}`);
  await expect(page).toHaveURL(new RegExp(`/s/${slug}/sv$`));

  await page.setViewportSize({ width: 390, height: 844 });
  const menu = page.getByRole("banner").locator("[data-ls-menu]");
  await expect(menu).toBeVisible();
  await expect(page.getByRole("banner").locator("[data-ls-list]")).toBeHidden();
  await expect(menu.locator("summary [data-ls-code]")).toHaveText("SV");
  await context.close();
});
