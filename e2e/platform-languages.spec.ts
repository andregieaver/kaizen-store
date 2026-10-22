import { expect, test } from "@playwright/test";
import { testDb } from "./db";

/**
 * Kaizena Flow's own site in more than one language (D312 P1). The Norwegian site exists only while it is offered
 * (`platform_settings.locales`), which a build reads: CI's database offers English alone, so there `/no` is a 404 and the English
 * pages name no other language; a build with Norwegian offered draws `/no` in its own root, keeps its links there and suggests it to
 * a Norwegian browser once.
 */

test("the English site is as it was, and Norwegian is there only while it is offered", async ({ page, request }) => {
  const norwegian = await request.get("/no");
  await page.goto("/sign-up");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  if (norwegian.status() === 404) {
    // English alone: no other language named, no switch, no suggestion.
    await expect(page.locator('link[rel="alternate"][hreflang]')).toHaveCount(0);
    await expect(page.getByRole("navigation", { name: "Language" })).toHaveCount(0);
    expect((await request.get("/no/sign-up")).status()).toBe(404);
    return;
  }
  expect(norwegian.status()).toBe(200);
  await expect(page.locator('link[rel="alternate"][hreflang="nb"]')).toHaveAttribute("href", /\/no\/sign-up$/);
  await page.goto("/no/sign-up");
  await expect(page.locator("html")).toHaveAttribute("lang", "nb");
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", /\/no\/sign-up$/);
  await expect(page.locator('input[name="locale"]')).toHaveValue("nb-NO");
  // The chrome and the page's own words are Norwegian (D312 P2).
  await expect(page.getByRole("heading", { level: 1, name: "Start nettbutikken din" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Be om en nettbutikk" })).toBeVisible();
  await expect(page.getByLabel("Navnet ditt")).toBeVisible();
  // The site's own links stay in Norwegian; the admin and stores keep their addresses.
  await expect(page.getByRole("contentinfo").getByRole("link", { name: /cookies|informasjonskapsler/i })).toHaveAttribute("href", "/no/cookies");
  const switcher = page.getByRole("navigation", { name: "Språk" });
  await expect(switcher.getByRole("link", { name: "English" })).toHaveAttribute("href", "/sign-up");
});

test.describe("a Norwegian browser on an English page", () => {
  test.use({ locale: "nb-NO" });

  test("is offered the page in Norwegian, never sent there", async ({ page, request }) => {
    test.skip((await request.get("/no")).status() === 404, "Norwegian is not offered in this build");
    await page.goto("/sign-up");
    await expect(page).toHaveURL(/\/sign-up$/);
    const bar = page.getByRole("region", { name: "Språk" });
    await expect(bar.getByText("Kaizena Flows nettsted finnes også på norsk.")).toBeVisible();
    await expect(bar.getByRole("link", { name: "Les det på norsk" })).toHaveAttribute("href", "/no/sign-up");
    await bar.getByRole("button", { name: "Lukk" }).click();
    await expect(bar).toHaveCount(0);
  });
});

test("the theme store reads in Norwegian under /no/themes (D312 P3)", async ({ page, request }) => {
  test.skip((await request.get("/no")).status() === 404, "Norwegian is not offered in this build");
  await page.goto("/no/themes");
  await expect(page.locator("html")).toHaveAttribute("lang", "nb");
  await expect(page.getByRole("heading", { level: 1, name: "Temaer" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Filtrer temaer" })).toBeVisible();
  await expect(page.locator('link[rel="alternate"][hreflang="en"]')).toHaveAttribute("href", /\/themes$/);
  const first = page.locator('main a[href^="/no/themes/"]').first();
  if ((await first.count()) === 0) return;
  await first.click();
  await expect(page).toHaveURL(/\/no\/themes\/[a-z0-9-]+$/);
  await expect(page.getByRole("link", { name: /^Bruk dette temaet/ })).toHaveAttribute("href", /^\/no\/sign-up\?theme=/);
  await expect(page.getByRole("link", { name: "Temaer", exact: true })).toHaveAttribute("href", "/no/themes");
  const preview = page.getByRole("link", { name: /^Forhåndsvis/ });
  if ((await preview.count()) === 0) return;
  await preview.click();
  await expect(page).toHaveURL(/\/no\/themes\/[a-z0-9-]+\/preview/);
  await expect(page.locator("html")).toHaveAttribute("lang", "nb");
  await expect(page.getByRole("navigation", { name: "Side" }).getByRole("link", { name: "Forside" })).toBeVisible();
});

test("a page of Kaizena Flow's reads in Norwegian under /no where its texts are written (D312 P4)", async ({ page, request }) => {
  test.skip((await request.get("/no")).status() === 404, "Norwegian is not offered in this build");
  const slug = `our-story-${Date.now()}`;
  const content = {
    title: "Our story",
    slug,
    seo: { title: "", description: "" },
    thumbnail: null,
    searchEngines: true,
    aiAssistants: true,
    categories: [],
    tags: [],
    rows: [
      {
        id: "r1",
        type: "row",
        layout: "1",
        columns: [
          {
            id: "c1",
            blocks: [
              { id: "h1", type: "heading", text: "Our story", level: 1 },
              { id: "h2", type: "heading", text: "Only in English", level: 2 },
            ],
          },
        ],
      },
    ],
    // The builder's translate mode keeps these (D55): only the texts written in Norwegian.
    translations: { "nb-NO": { title: "Vår historie", "block.h1.text": "Vår historie" } },
  };
  const sql = testDb();
  try {
    await sql`
      insert into commerce.pages (slug, draft, published, published_at)
      values (${slug}, ${sql.json(content)}, ${sql.json(content)}, now())
    `;
  } finally {
    await sql.end();
  }
  await page.goto(`/no/${slug}`);
  await expect(page.locator("html")).toHaveAttribute("lang", "nb");
  await expect(page.getByRole("heading", { level: 1, name: "Vår historie" })).toBeVisible();
  // A text not written in Norwegian is the English one.
  await expect(page.getByRole("heading", { level: 2, name: "Only in English" })).toBeVisible();
  await expect(page).toHaveTitle(/Vår historie/);
  // The English page is as written.
  await page.goto(`/${slug}`);
  await expect(page.getByRole("heading", { level: 1, name: "Our story" })).toBeVisible();
});
