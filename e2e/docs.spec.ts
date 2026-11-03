import { expect, test } from "@playwright/test";

import { describeFindings, violationsOn } from "./a11y";
import { testDb } from "./db";

/**
 * The docs portal on Kaizena Flow's own site (D442, `docs/wave-14-developer-platform.md` E1 and E2): `/docs` in English and `/no/docs` in
 * Norwegian (the owners' track only), as they run until the docs' own host is set (`e2e/docs-host.spec.ts` is that build). Each page is
 * prerendered from `content/docs/`; these read the first pages written there.
 */
test.skip(Boolean(process.env.NEXT_PUBLIC_DOCS_HOST), "a build with the docs' own host moves /docs there (e2e/docs-host.spec.ts)");

const PAGE = "/docs/owners/getting-started/create-your-store";

test("the front page offers the two tracks, in their own frame without the site's chrome", async ({ page }) => {
  const response = await page.goto("/docs");
  expect(response?.status()).toBe(200);
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page).toHaveTitle("Kaizena Flow Docs");
  await expect(page.getByRole("heading", { level: 1, name: "Kaizena Flow Docs" })).toBeVisible();
  const top = page.getByRole("navigation", { name: "Docs" });
  await expect(top.getByRole("link", { name: "Store owners" })).toHaveAttribute("href", "/docs/owners");
  await expect(top.getByRole("link", { name: "Developers" })).toHaveAttribute("href", "/docs/developers");
  await expect(top.getByRole("link", { name: "API reference" })).toHaveAttribute("href", "/docs/developers");
  await expect(top.getByRole("link", { name: "Changelog" })).toHaveAttribute("href", "/docs/changelog");
  await expect(top.getByRole("link", { name: "Status" })).toHaveAttribute("href", "/status");
  // The search box opens the search (D443); before the page's script it is a link to the search page.
  await expect(page.getByRole("button", { name: "Search", exact: true })).toHaveAttribute("aria-haspopup", "dialog");
  await expect(page.getByRole("region", { name: "Store owners" }).getByRole("link", { name: "Getting started" })).toHaveAttribute("href", "/docs/owners/getting-started");
  await expect(page.getByRole("region", { name: "Developers" }).getByRole("link", { name: "Overview" })).toHaveAttribute("href", "/docs/developers/overview");
  // The docs carry no chat and no consent banner of the site's.
  await expect(page.locator("[data-chat-avatar]")).toHaveCount(0);
});

test("a page has its tree, breadcrumbs, On this page, its check date, its neighbours and its other language", async ({ page }) => {
  const response = await page.goto(PAGE);
  expect(response?.status()).toBe(200);
  await expect(page).toHaveTitle("Create your store · Kaizena Flow Docs");
  await expect(page.getByRole("heading", { level: 1, name: "Create your store" })).toBeVisible();
  expect(await page.locator("link[rel=canonical]").getAttribute("href")).toBe(`http://localhost:3000${PAGE}`);
  await expect(page.locator('link[rel="alternate"][hreflang="nb"]')).toHaveAttribute("href", `http://localhost:3000/no${PAGE}`);
  await expect(page.locator('link[rel="alternate"][type="text/markdown"]')).toHaveAttribute("href", `http://localhost:3000${PAGE}.md`);

  const crumbs = page.getByRole("navigation", { name: "Breadcrumb" });
  await expect(crumbs.getByRole("link", { name: "Docs" })).toHaveAttribute("href", "/docs");
  await expect(crumbs.getByRole("link", { name: "Store owners" })).toHaveAttribute("href", "/docs/owners");
  await expect(crumbs.getByRole("link", { name: "Getting started" })).toHaveAttribute("href", "/docs/owners/getting-started");

  const tree = page.getByRole("navigation", { name: "Store owners: pages" });
  await expect(tree.getByRole("link", { name: "Create your store" })).toHaveAttribute("aria-current", "page");
  await expect(tree.getByRole("link", { name: "Add your first product" })).toHaveAttribute("href", "/docs/owners/getting-started/your-first-product");

  const toc = page.getByRole("navigation", { name: "On this page" });
  await expect(toc.getByRole("link", { name: "Sign up" })).toHaveAttribute("href", "#sign-up");
  await expect(page.locator("h2#sign-up")).toHaveText("Sign up");

  await expect(page.getByText("In the admin:")).toBeVisible();
  await expect(page.getByText("Last checked 3 November 2026")).toBeVisible();
  await expect(page.getByRole("link", { name: "This page as Markdown" })).toHaveAttribute("href", `${PAGE}.md`);
  await expect(page.getByRole("link", { name: "Start your store" })).toHaveAttribute("href", "/sign-up");
  await expect(page.getByRole("note").first()).toContainText("Note");

  const pager = page.getByRole("navigation", { name: "Previous and next page" });
  await expect(pager.getByRole("link", { name: /Next\s*Add your first product/ })).toHaveAttribute("href", "/docs/owners/getting-started/your-first-product");
  await expect(pager.getByRole("link", { name: /Previous/ })).toHaveCount(0);

  const languages = page.getByRole("navigation", { name: "Language" });
  await expect(languages.getByRole("link", { name: "Norsk" })).toHaveAttribute("href", `/no${PAGE}`);
});

test("the Norwegian page is the owners' track in Norwegian; the developers' track is English alone", async ({ page, request }) => {
  const response = await page.goto(`/no${PAGE}`);
  expect(response?.status()).toBe(200);
  await expect(page.locator("html")).toHaveAttribute("lang", "nb");
  await expect(page.getByRole("heading", { level: 1, name: "Lag nettbutikken din" })).toBeVisible();
  await expect(page.getByText("Sist kontrollert 3. november 2026")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Brødsmulesti" }).getByRole("link", { name: "Butikkeiere" })).toHaveAttribute("href", "/no/docs/owners");
  await expect(page.getByRole("navigation", { name: "Språk" }).getByRole("link", { name: "English" })).toHaveAttribute("href", PAGE);
  // A link to another owners' page stays in Norwegian (the article's own words; the tree and the pager name the page with a capital).
  await expect(page.getByRole("link", { name: "legg inn ditt første produkt", exact: true })).toHaveAttribute("href", "/no/docs/owners/getting-started/your-first-product");
  await page.goto("/no/docs");
  await expect(page.getByRole("region", { name: /Utviklere/ }).getByRole("link", { name: "Utviklere" })).toHaveAttribute("href", "/docs/developers");
  expect((await request.get("/no/docs/developers/overview/introduction")).status()).toBe(404);
});

test("Was this page helpful? keeps a yes or no and an optional sentence, and nothing about the reader", async ({ page }) => {
  await page.goto("/docs/developers/overview/authentication");
  const box = page.getByRole("region", { name: "Was this page helpful?" });
  await box.getByRole("button", { name: "No" }).click();
  await expect(box.getByRole("status")).toHaveText("Thank you for telling us.");
  const sentence = `The error table could say more ${Date.now().toString(36)}.`;
  await box.getByLabel("Anything to add? (optional)").fill(sentence);
  await box.getByRole("button", { name: "Send" }).click();
  await expect(box.getByRole("status")).toHaveText("Thank you. We read every sentence.");
  const sql = testDb();
  try {
    const rows = await sql`select path, lang, helpful from commerce.docs_feedback where comment = ${sentence}`;
    expect(rows).toEqual([{ path: "developers/overview/authentication", lang: "en", helpful: false }]);
    await sql`delete from commerce.docs_feedback where comment = ${sentence}`;
  } finally {
    await sql.end();
  }
});

test("each page answers as Markdown, and the docs have their llms.txt, llms-full.txt and sitemap", async ({ request }) => {
  const md = await request.get(`${PAGE}.md`);
  expect(md.status()).toBe(200);
  expect(md.headers()["content-type"]).toContain("text/markdown");
  const text = await md.text();
  expect(text.startsWith("# Create your store\n\n> ")).toBe(true);
  expect(text).toContain("](http://localhost:3000/docs/owners/getting-started/your-first-product)");
  expect(text).toContain("](http://localhost:3000/sign-up)");
  expect(await (await request.get(`/no${PAGE}.md`)).text()).toMatch(/^# Lag nettbutikken din/);
  expect((await request.get("/docs/owners/getting-started/nowhere.md")).status()).toBe(404);

  const llms = await (await request.get("/docs/llms.txt")).text();
  expect(llms).toContain("# Kaizena Flow Docs");
  expect(llms).toContain(`- [Create your store](http://localhost:3000${PAGE}.md): `);
  expect(llms).toContain("- [Authentication, scopes and limits](http://localhost:3000/docs/developers/overview/authentication.md): ");
  const full = await (await request.get("/docs/llms-full.txt")).text();
  expect(full).toContain("## Create your store");
  expect(full).toContain("## Authentication, scopes and limits");
  expect(full).toContain("## Lag nettbutikken din");

  const sitemap = await (await request.get("/docs/sitemap.xml")).text();
  expect(sitemap).toContain(`<loc>http://localhost:3000${PAGE}</loc>`);
  expect(sitemap).toContain(`<loc>http://localhost:3000/no${PAGE}</loc>`);
  expect(await (await request.get("/sitemap.xml")).text()).toContain("<loc>http://localhost:3000/docs/sitemap.xml</loc>");
  // Rules for crawlers are Kaizena Flow's own while the docs have no host.
  expect((await request.get("/docs/robots.txt")).status()).toBe(404);
});

test("the changelog, a track and a section have their pages; an address that is no page is the docs' 404", async ({ page }) => {
  await page.goto("/docs/changelog");
  await expect(page.getByRole("heading", { level: 1, name: "Changelog" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Docs" }).getByRole("link", { name: "Changelog" })).toHaveAttribute("aria-current", "true");
  await page.goto("/docs/developers");
  await expect(page.getByRole("heading", { level: 1, name: "Developers" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Build on Kaizena Flow" }).first()).toHaveAttribute("href", "/docs/developers/overview/introduction");
  await page.goto("/docs/owners/getting-started");
  await expect(page.getByRole("heading", { level: 1, name: "Getting started" })).toBeVisible();
  const missing = await page.goto("/docs/owners/getting-started/nowhere");
  expect(missing?.status()).toBe(404);
  await expect(page.getByRole("heading", { level: 1, name: "This page is not in the docs." })).toBeVisible();
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("folds the track's pages under one button", async ({ page }) => {
    await page.goto(PAGE, { waitUntil: "networkidle" });
    const button = page.getByRole("button", { name: "Show the pages" });
    await expect(button).toHaveAttribute("aria-expanded", "false");
    const tree = page.getByRole("navigation", { name: "Store owners: pages" });
    await expect(tree).toBeHidden();
    await button.click();
    await expect(button).toHaveAttribute("aria-expanded", "true");
    await expect(tree).toBeVisible();
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// The search (D443): the dialog, the keyboard, the address that shares a search, the page without JavaScript, the gap list
// ---------------------------------------------------------------------------------------------------------------------

test("⌘K opens the search dialog, which searches as you type within the page's track and language", async ({ page }) => {
  await page.goto(PAGE, { waitUntil: "networkidle" });
  const opener = page.locator("button[aria-haspopup=dialog]");
  await page.keyboard.press("Control+k");
  const dialog = page.getByRole("dialog", { name: "Search the docs" });
  await expect(dialog).toBeVisible();
  await expect(opener).toHaveAttribute("aria-expanded", "true");
  const field = dialog.getByRole("searchbox", { name: "Search the docs" });
  await expect(field).toBeFocused();
  // An owners' page searches the owners' track in English first: two chips, chosen, each taken away with one press.
  await expect(dialog.getByRole("group", { name: "For" }).getByRole("link", { name: /Store owners.*\(chosen\)/ })).toBeVisible();
  await expect(dialog.getByRole("group", { name: "Language" }).getByRole("link", { name: /English.*\(chosen\)/ })).toBeVisible();
  await field.fill("setup steps");
  await expect(dialog.getByRole("status")).toHaveText(/^(1 result|\d+ results)$/);
  const hit = dialog.getByRole("link", { name: /Create your store › Follow the setup steps/ });
  await expect(hit).toHaveAttribute("href", "/docs/owners/getting-started/create-your-store#follow-the-setup-steps");
  // Each result says its track, its section and its kind.
  await expect(hit).toContainText("Store owners › Getting started");
  await expect(hit).toContainText("Tutorial");
  // Esc closes it, and the focus goes back to where it was.
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(opener).toHaveAttribute("aria-expanded", "false");
});

test("the keyboard works throughout the dialog: ↓ and ↑ through the results, the focus kept in it, Enter opens one", async ({ page }) => {
  await page.goto("/docs", { waitUntil: "networkidle" });
  await page.keyboard.press("/");
  const dialog = page.getByRole("dialog", { name: "Search the docs" });
  const field = dialog.getByRole("searchbox", { name: "Search the docs" });
  await expect(field).toBeFocused();
  await field.fill("token");
  const results = dialog.locator("a[data-docs-hit]");
  await expect(results.nth(1)).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await expect(results.nth(0)).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(results.nth(1)).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowUp");
  await expect(field).toBeFocused();
  // The modal keeps the focus in it: Tab never leaves for the page behind.
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press("Tab");
    expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  }
  // Enter on a result opens it.
  await field.focus();
  await page.keyboard.press("ArrowDown");
  const href = await results.first().getAttribute("href");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL((url) => `${url.pathname}${url.hash}` === href);
});

test("filters are chips with their counts, and a search opened as a page keeps them in its address to share", async ({ page }) => {
  await page.goto("/docs", { waitUntil: "networkidle" });
  await page.keyboard.press("Control+k");
  const dialog = page.getByRole("dialog", { name: "Search the docs" });
  await dialog.getByRole("searchbox").fill("token");
  await expect(dialog.getByRole("status")).toHaveText(/^(1 result|\d+ results)$/);
  await dialog.getByText("More filters").click();
  const kinds = dialog.getByRole("group", { name: "Kind of page" });
  await kinds.getByRole("link", { name: /^Reference\s*\d+$/ }).click();
  await expect(kinds.getByRole("link", { name: /Reference.*\(chosen\)/ })).toBeVisible();
  await expect(dialog.locator("a[data-docs-hit]").first()).toContainText("Reference");
  const asPage = dialog.getByRole("link", { name: "Open this search as a page" });
  await expect(asPage).toHaveAttribute("href", "/docs/search?q=token&kind=reference&lang=en");
  await asPage.click();
  await expect(page).toHaveURL(/\/docs\/search\?q=token&kind=reference&lang=en$/);
  await expect(page.getByRole("heading", { level: 1, name: "Search the docs" })).toBeVisible();
  await expect(page.getByRole("searchbox", { name: "Search the docs" })).toHaveValue("token");
  // On the page, a change keeps the address in step.
  await page.getByRole("group", { name: "Kind of page" }).getByRole("link", { name: /Reference.*\(chosen\)/ }).click();
  await expect(page).toHaveURL(/\/docs\/search\?q=token&lang=en$/);
  // The API answers the same search to anyone, as JSON.
  const api = await page.request.get("/api/docs/search?q=token&kind=reference");
  expect(api.status()).toBe(200);
  const body = (await api.json()) as { results: { kind: string }[]; facets: Record<string, unknown> };
  expect(body.results.every((r) => r.kind === "reference")).toBe(true);
  expect(Object.keys(body.facets)).toEqual(["track", "kind", "lang", "area"]);
});

test("a search that finds nothing says so politely, offers the whole docs, and is counted for the gap list", async ({ page }) => {
  const words = `zzqx${Date.now().toString(36)}`;
  await page.goto(PAGE, { waitUntil: "networkidle" });
  await page.keyboard.press("Control+k");
  const dialog = page.getByRole("dialog", { name: "Search the docs" });
  await dialog.getByRole("searchbox").fill(words);
  await expect(dialog.getByRole("status")).toHaveText(`Nothing in the docs matches “${words}”.`);
  await expect(dialog.getByText("Try fewer words, other words or another spelling.")).toBeVisible();
  await expect(dialog.getByRole("link", { name: "Search all the docs" })).toBeVisible();
  // The AI guide (unit E5) is not there yet: its offer waits for it.
  await expect(dialog.getByRole("button", { name: "Ask the AI guide" })).toHaveCount(0);
  const sql = testDb();
  try {
    await expect
      .poll(async () => (await sql`select misses from commerce.docs_search_misses where query = ${words} and lang = 'en'`).map((r) => r.misses), { timeout: 10_000 })
      .toEqual([1]);
    await sql`delete from commerce.docs_search_misses where query = ${words}`;
  } finally {
    await sql.end();
  }
});

test("a section's pages are filtered and ordered as the search does, at an address of their own", async ({ page }) => {
  await page.goto("/docs/owners/getting-started");
  const bar = page.getByRole("navigation", { name: "Filter and sort these pages" });
  await expect(bar.getByRole("link", { name: /^Tutorial\s*2$/ })).toHaveAttribute("href", "/docs/search?kind=tutorial&lang=en&section=owners%2Fgetting-started");
  const az = bar.getByRole("link", { name: "A to Z" });
  await expect(az).toHaveAttribute("href", "/docs/search?lang=en&section=owners%2Fgetting-started&sort=title");
  await az.click();
  await expect(page.getByRole("heading", { level: 1, name: "Getting started" })).toBeVisible();
  const hits = page.locator("a[data-docs-hit]");
  await expect(hits).toHaveCount(2);
  await expect(hits.nth(0)).toContainText("Add your first product");
  await expect(hits.nth(1)).toContainText("Create your store");
});

test("the Norwegian search is in Norwegian, with the Norwegian pages", async ({ page }) => {
  await page.goto("/no/docs/search?q=mva&lang=nb");
  await expect(page.locator("html")).toHaveAttribute("lang", "nb");
  await expect(page.getByRole("heading", { level: 1, name: "Søk i dokumentasjonen" })).toBeVisible();
  const hit = page.locator("a[data-docs-hit]").filter({ hasText: "Legg inn ditt første produkt" });
  await expect(hit).toHaveAttribute("href", "/no/docs/owners/getting-started/your-first-product");
  await expect(hit.locator("mark").first()).toHaveText(/^mva/i);
});

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("the search box is a link to the search page, which searches, filters and pages on the server", async ({ page }) => {
    await page.goto(PAGE);
    await expect(page.getByRole("link", { name: "Search", exact: true })).toHaveAttribute("href", "/docs/search");
    const response = await page.goto("/docs/search?q=token&track=developers");
    expect(response?.status()).toBe(200);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
    await expect(page.getByRole("status")).toHaveText(/^(1 result|\d+ results)$/);
    await expect(page.locator("a[data-docs-hit]").first()).toBeVisible();
    // A chip is a link that searches again, here, with the filter in the address.
    await page.getByText("More filters").click();
    await page.getByRole("group", { name: "Kind of page" }).getByRole("link", { name: /^Reference\s*\d+$/ }).click();
    await expect(page).toHaveURL(/\/docs\/search\?q=token&track=developers&kind=reference$/);
    await expect(page.locator("a[data-docs-hit]").first()).toContainText("Reference");
    // The form searches here too.
    await page.getByRole("searchbox", { name: "Search the docs" }).fill("create your store");
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await expect(page).toHaveURL(/\/docs\/search\?q=create\+your\+store/);
    // Show more is a link to the next page.
    await page.goto("/docs/search?track=developers");
    const more = page.getByRole("link", { name: "Show more results" });
    await expect(more).toHaveAttribute("href", /^\/docs\/search\?track=developers&cursor=[A-Za-z0-9_-]+$/);
    const first = await page.locator("a[data-docs-hit]").first().getAttribute("href");
    await more.click();
    await expect(page.locator("a[data-docs-hit]").first()).not.toHaveAttribute("href", first!);
  });
});

for (const scheme of ["light", "dark"] as const) {
  test(`has no serious or critical accessibility findings, ${scheme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    const paths = ["/docs", PAGE, "/docs/developers/overview/authentication", `/no${PAGE}`, "/docs/owners/getting-started", "/docs/search?q=token", "/docs/search?q=zzqxnothing"];
    for (const path of paths) {
      await page.goto(path);
      const findings = await violationsOn(page);
      expect(describeFindings(findings), `${path} (${scheme})`).toEqual([]);
    }
    // The dialog open, with its results.
    await page.goto(PAGE, { waitUntil: "networkidle" });
    await page.keyboard.press("Control+k");
    await page.getByRole("dialog", { name: "Search the docs" }).getByRole("searchbox").fill("store");
    await expect(page.locator("dialog a[data-docs-hit]").first()).toBeVisible();
    expect(describeFindings(await violationsOn(page)), `the dialog (${scheme})`).toEqual([]);
  });
}
