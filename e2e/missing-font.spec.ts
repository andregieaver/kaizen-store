import { expect, test, type Page } from "@playwright/test";

import { storePageWith, testDb } from "./db";

/**
 * A font Kaizena Flow cannot serve only means the fallback font (D59). React holds a streamed `<Suspense>` boundary until the
 * stylesheets it links with `precedence` have loaded, and a stylesheet that fails (a 404) makes it give the boundary up and draw
 * it again in the browser: the page then holds its content twice, the server's copy hidden, and logs "Switched to client
 * rendering". So `/api/fonts/css/{slug}` answers a family with no stylesheet (never installed, or an empty one) with an empty
 * stylesheet, and the page draws once, in the fallback font.
 */

// Families no other test uses: the server keeps a stylesheet it read for days, so another test's copy would hide the empty one.
const EMPTY = { family: "Bitter", slug: "bitter" };
const MISSING = { family: "Rokkitt", slug: "rokkitt" };
const PREVIEW = { family: "Fraunces", slug: "fraunces" };

/** A stylesheet that is empty, as `commerce.fonts` was found holding one, and a family that was never installed. */
async function breakFonts() {
  const sql = testDb();
  try {
    for (const { family, slug } of [EMPTY, PREVIEW]) {
      await sql`
        insert into commerce.fonts (family, slug, category, css, bytes) values (${family}, ${slug}, 'serif', '', 0)
        on conflict (family) do update set css = ''`;
    }
    await sql`delete from commerce.fonts where family = ${MISSING.family}`;
  } finally {
    await sql.end();
  }
}

/** What the page reports going wrong: a script error, React's own message about a boundary, and any failed request. */
function watch(page: Page): string[] {
  const problems: string[] = [];
  page.on("pageerror", (error) => problems.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" || /client rendering/i.test(message.text())) problems.push(message.text());
  });
  page.on("response", (response) => {
    if (response.url().includes("/api/fonts/") && !response.ok()) problems.push(`${response.status()} ${response.url()}`);
  });
  return problems;
}

/**
 * Every streamed boundary is in place: React moves a finished one's server copy out of its hidden `S:` segment once its
 * stylesheets have loaded, and leaves it there for good when it gives the boundary up.
 */
async function settled(page: Page) {
  await page.waitForLoadState("load");
  await expect(page.locator('div[hidden][id^="S:"]')).toHaveCount(0);
}

test("a store page whose fonts cannot be served draws once, in the fallback font", async ({ page, request }) => {
  await breakFonts();
  // Shown to signed-out visitors only (D179), so each heading is a boundary streamed after the page's shell, as React holds them.
  const signedOut = { show: "signedOut" };
  const address = await storePageWith("missing-font", [
    { id: "b1", type: "heading", text: "Laget for hånd", level: 2, typography: { text: { family: EMPTY.family } }, visibility: signedOut },
    { id: "b2", type: "heading", text: "Fra verkstedet", level: 2, typography: { text: { family: MISSING.family } }, visibility: signedOut },
  ]);
  const problems = watch(page);
  await page.goto(address);
  await settled(page);

  await expect(page.locator("main")).toBeVisible();
  for (const [text, font] of [
    ["Laget for hånd", EMPTY],
    ["Fra verkstedet", MISSING],
  ] as const) {
    const heading = page.locator("h2", { hasText: text });
    await expect(heading).toHaveCount(1);
    await expect(heading).toBeVisible();
    // Still linked, so a stylesheet that comes later is used; until then the fallback.
    await expect(page.locator(`link[rel="stylesheet"][href="/api/fonts/css/${font.slug}?v=1"]`)).toHaveCount(1);
    expect(await heading.evaluate((element) => getComputedStyle(element).fontFamily)).not.toContain(font.family);
  }
  expect(problems).toEqual([]);

  // The answer is an empty stylesheet, kept for a moment only, never for a year as a real one is.
  for (const { slug } of [EMPTY, MISSING]) {
    const css = await request.get(`/api/fonts/css/${slug}?v=1`);
    expect(css.status()).toBe(200);
    expect(css.headers()["content-type"]).toContain("text/css");
    expect(css.headers()["cache-control"]).not.toContain("immutable");
    expect(await css.text()).not.toContain("@font-face");
  }
});

test("a design profile's preview whose font cannot be served draws one canvas", async ({ page }) => {
  await breakFonts();
  const run = Date.now().toString(36);
  const sql = testDb();
  let preset: string;
  let starter: string;
  try {
    // A published store template, as the platform makes one, and a published profile whose heading font has an empty stylesheet.
    const [request] = await sql`
      insert into commerce.access_requests (email, name, store_name) values (${`missing-font-${run}@example.com`}, 'Platform', 'Verksted') returning id`;
    const [{ id: store }] = await sql`select commerce.approve_access_request(${request.id}, ${`missing-font-${run}`}, 'Verksted', null) as id`;
    await sql`update commerce.stores set starter = true where id = ${store}`;
    [{ id: starter }] = await sql`
      insert into commerce.store_starters (store_id, title, category, published) values (${store}, 'Verksted', 'retail', true) returning id`;
    const settings = {
      mode: "light",
      visitorSwitch: false,
      light: { background: "#fdf6e3", surface: "#eee8d5", text: "#073642", muted: "#586e75", border: "#d9d2bf", accent: "#c2185b", accentText: "#ffffff" },
      dark: { background: "#002b36", surface: "#073642", text: "#eee8d5", muted: "#93a1a1", border: "#0b4452", accent: "#ec407a", accentText: "#002b36" },
      fonts: { heading: PREVIEW.family },
      headings: { weight: "bold", case: "normal" },
      buttons: { style: "filled", corners: "square" },
      corners: { cards: "none", fields: "none" },
      layout: { width: "normal", headerAlign: "left", headerBackground: "page" },
      productCards: { image: "square", style: "plain", align: "left" },
    };
    const snapshot = { v: 1, theme: { base: "warm", settings }, header: null, footer: null, productLayout: null, css: "" };
    [{ id: preset }] = await sql`
      insert into commerce.design_presets (title, snapshot, published) values (${`Verksted ${run}`}, ${sql.json(snapshot)}, true) returning id`;
  } finally {
    await sql.end();
  }

  // As the theme store's frame shows it, and as a visitor opens it.
  const problems = watch(page);
  for (const query of ["&embed=1", ""]) {
    await page.goto(`/admin/account/design-profiles/${preset}/preview?starter=${starter}${query}`);
    await settled(page);
    await expect(page.locator("[data-design-preview]")).toHaveCount(1);
    await expect(page.locator("[data-design-preview] main")).toBeVisible();
    await expect(page.locator(`link[rel="stylesheet"][href="/api/fonts/css/${PREVIEW.slug}?v=1"]`)).toHaveCount(1);
  }
  expect(problems).toEqual([]);
});
