import { expect, test } from "@playwright/test";

import { WORDPRESS_PLUGIN_RELEASES, wordpressReleaseFile } from "../src/lib/wordpress-plugin";

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
  await expect(top.getByRole("link", { name: "API reference" })).toHaveAttribute("href", "/docs/reference");
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
  await expect(pager.getByRole("link", { name: /Next\s*Find your way around the admin/ })).toHaveAttribute("href", "/docs/owners/getting-started/find-your-way");
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

test("the WordPress plugin's section offers every version for download, newest first, each a zip the site serves", async ({ page, request }) => {
  await page.goto("/docs/developers/wordpress");
  await expect(page.getByRole("heading", { level: 1, name: "WordPress plugin" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Download the plugin" })).toBeVisible();
  const links = page.locator("[data-docs-section-body] a[href*='/downloads/wordpress/']");
  const hrefs = await links.evaluateAll((nodes) => nodes.map((node) => (node as HTMLAnchorElement).href));
  expect(hrefs.map((href) => new URL(href).pathname)).toEqual(WORDPRESS_PLUGIN_RELEASES.map((r) => wordpressReleaseFile(r.version)));
  for (const href of hrefs) {
    const answer = await request.get(new URL(href).pathname);
    expect(answer.status(), href).toBe(200);
    expect((await answer.body()).subarray(0, 2).toString("latin1"), href).toBe("PK");
  }
  // The section's pages are listed under the downloads, as any section's are.
  await expect(page.getByRole("link", { name: "Show a store's products on WordPress" }).first()).toHaveAttribute("href", "/docs/developers/wordpress/wordpress-plugin");
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
  // The search's own button (the AI guide's beside it opens a dialog too, D444).
  const opener = page.locator("button[aria-haspopup=dialog][aria-keyshortcuts]");
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
  // The AI guide (unit E5, D444) is offered with the question (below).
  await expect(dialog.getByRole("button", { name: "Ask the AI guide" })).toBeVisible();
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

// ---------------------------------------------------------------------------------------------------------------------
// The AI guide (E5, D444). The model is not called here: the answers are the browser's stand-ins for /api/docs/guide, as the chat's
// specs stub /api/chat (the guide itself is tested in src/server/docs-guide.int.test.ts and the eval).
// ---------------------------------------------------------------------------------------------------------------------

const GUIDE_PROFILE = { on: true, name: "Ada", occupation: "", avatar: null, avatarStyle: null, greeting: "", keptDays: 1, aiUse: { tone: false, summaries: false } };

/** Stands in for the guide's route: its profile, and an answer that links the page it used. */
async function stubGuide(page: import("@playwright/test").Page, sent: Record<string, unknown>[]) {
  await page.route("**/api/docs/guide**", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ json: GUIDE_PROFILE });
      return;
    }
    const body = route.request().postDataJSON() as Record<string, unknown>;
    sent.push(body);
    const at = "2026-11-03T12:00:00.000Z";
    await route.fulfill({
      json: {
        conversation: { id: "0b5c1d2e-3f40-4a51-8b62-7c83d94ea5f6", token: "tok_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345" },
        messages: [
          { seq: 1, author: "reader", body: body.message, at },
          {
            seq: 2,
            author: "ai",
            body: "The docs do not say so. You create your store by signing up and following the setup steps.",
            at,
            links: [{ title: "Create your store", href: "/docs/owners/getting-started/create-your-store" }],
          },
        ],
      },
    });
  });
}

test("Ask the AI guide from a search that found nothing opens the guide with the question filled in; an answer shows its links", async ({ page }) => {
  const sent: Record<string, unknown>[] = [];
  await stubGuide(page, sent);
  // The guide's panel is no script of the page until it is opened (D336: the docs load their few parts only).
  const scripts: Promise<string>[] = [];
  page.on("response", (response) => {
    if (response.request().resourceType() === "script") scripts.push(response.text().catch(() => ""));
  });
  const words = `zzqxgd${Date.now().toString(36)}`;
  await page.goto(PAGE, { waitUntil: "networkidle" });
  // `data-docs-guide-link` is the panel's own (its answers' links), and the guide's profile is asked only by the panel.
  const guideAsked: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/docs/guide")) guideAsked.push(request.method());
  });
  expect((await Promise.all(scripts)).filter((text) => text.includes("data-docs-guide-link"))).toEqual([]);

  await page.keyboard.press("Control+k");
  const search = page.getByRole("dialog", { name: "Search the docs" });
  await search.getByRole("searchbox").fill(words);
  await expect(search.getByRole("status")).toHaveText(`Nothing in the docs matches “${words}”.`);
  await search.getByRole("button", { name: "Ask the AI guide" }).click();

  const guide = page.getByRole("dialog", { name: "Ada" });
  await expect(guide).toBeVisible();
  await expect(search).toBeHidden();
  const field = guide.getByRole("textbox", { name: "Your question" });
  await expect(field).toHaveValue(words);
  await expect(field).toBeFocused();
  await expect(guide.getByText("An AI answers from these docs, and it can be wrong.")).toBeVisible();
  await expect(guide.getByText("We keep this conversation for up to 1 day.", { exact: false })).toBeVisible();
  // Nothing is sent for the reader: the question waits in the field. The panel's code and its profile came with the opening.
  expect(sent).toEqual([]);
  expect((await Promise.all(scripts)).some((text) => text.includes("data-docs-guide-link"))).toBe(true);
  expect(guideAsked).toEqual(["GET"]);

  await guide.getByRole("button", { name: "Send" }).click();
  const log = guide.getByRole("log", { name: "Conversation with the guide" });
  await expect(log.getByText("The docs do not say so. You create your store by signing up and following the setup steps.")).toBeVisible();
  await expect(log.getByRole("link", { name: "Create your store" })).toHaveAttribute("href", "/docs/owners/getting-started/create-your-store");
  expect(sent[0]).toMatchObject({ message: words, lang: "en", page: "owners/getting-started/create-your-store", after: 0 });
  expect(sent[0]).not.toHaveProperty("conversation");
  await expect(field).toHaveValue("");

  // Esc closes it, and the focus goes back.
  await field.press("Escape");
  await expect(guide).toBeHidden();
  await expect(page.getByRole("button", { name: "Ask the AI guide" })).toBeFocused();

  const sql = testDb();
  try {
    await sql`delete from commerce.docs_search_misses where query = ${words}`;
  } finally {
    await sql.end();
  }
});

test("the guide opens again where it was after a page change, carries its conversation, and the search page's offer fills in the question", async ({ page }) => {
  const sent: Record<string, unknown>[] = [];
  await stubGuide(page, sent);
  await page.goto("/docs?ask=How%20do%20refunds%20work%3F", { waitUntil: "networkidle" });
  const guide = page.getByRole("dialog", { name: "Ada" });
  await expect(guide.getByRole("textbox", { name: "Your question" })).toHaveValue("How do refunds work?");
  // The address keeps no question.
  await expect(page).toHaveURL(/\/docs$/);
  await guide.getByRole("button", { name: "Send" }).click();
  await expect(guide.getByRole("link", { name: "Create your store" })).toBeVisible();
  expect(sent[0]).toMatchObject({ page: "" });

  // A link it gave opens the page; the guide is there again, with the conversation, and the next message carries its reference.
  await guide.getByRole("link", { name: "Create your store" }).click();
  await expect(page).toHaveURL(/\/docs\/owners\/getting-started\/create-your-store$/);
  await expect(guide.getByText("How do refunds work?")).toBeVisible();
  await guide.getByRole("textbox", { name: "Your question" }).fill("And for a gift card?");
  await guide.getByRole("textbox", { name: "Your question" }).press("Enter");
  await expect.poll(() => sent.length).toBe(2);
  expect(sent[1]).toMatchObject({ conversation: { id: "0b5c1d2e-3f40-4a51-8b62-7c83d94ea5f6", token: "tok_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345" }, after: 2 });

  // A new conversation forgets the old one in the tab.
  await guide.getByRole("button", { name: "New conversation" }).click();
  await expect(guide.getByText("How do refunds work?")).toHaveCount(0);
});

test("a guide that is not answering says so and offers the search and Kaizena Flow's support", async ({ page }) => {
  await page.route("**/api/docs/guide**", (route) => route.fulfill({ json: { ...GUIDE_PROFILE, on: false, name: "" } }));
  await page.goto("/no/docs", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Spør KI-veilederen" }).click();
  const guide = page.getByRole("dialog", { name: "KI-veileder" });
  await expect(guide.getByText("KI-veilederen svarer ikke akkurat nå.", { exact: false })).toBeVisible();
  await expect(guide.getByRole("link", { name: "Søk i dokumentasjonen" })).toHaveAttribute("href", "/no/docs/search");
  await expect(guide.getByRole("link", { name: "Kontakt Kaizena Flows kundestøtte i administrasjonen" })).toHaveAttribute("href", "/admin/account/kaizen-support");
  await expect(guide.getByRole("button", { name: "Send" })).toBeDisabled();
});

for (const scheme of ["light", "dark"] as const) {
  test(`axe passes on the open guide with an answer, in ${scheme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await stubGuide(page, []);
    await page.goto(PAGE, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Ask the AI guide" }).click();
    const guide = page.getByRole("dialog", { name: "Ada" });
    await guide.getByRole("textbox", { name: "Your question" }).fill("How do I create my store?");
    await guide.getByRole("button", { name: "Send" }).click();
    await expect(guide.getByRole("link", { name: "Create your store" })).toBeVisible();
    const findings = await violationsOn(page);
    expect(findings, describeFindings(findings).join("\n")).toEqual([]);
  });
}

test("a section's pages are filtered and ordered as the search does, at an address of their own", async ({ page }) => {
  await page.goto("/docs/owners/getting-started");
  const bar = page.getByRole("navigation", { name: "Filter and sort these pages" });
  await expect(bar.getByRole("link", { name: /^Tutorial\s*2$/ })).toHaveAttribute("href", "/docs/search?kind=tutorial&lang=en&section=owners%2Fgetting-started");
  const az = bar.getByRole("link", { name: "A to Z" });
  await expect(az).toHaveAttribute("href", "/docs/search?lang=en&section=owners%2Fgetting-started&sort=title");
  await az.click();
  await expect(page.getByRole("heading", { level: 1, name: "Getting started" })).toBeVisible();
  const hits = page.locator("a[data-docs-hit]");
  await expect(hits).toHaveCount(4);
  await expect(hits.nth(0)).toContainText("Add your first product");
  await expect(hits.nth(1)).toContainText("Choose a plan");
  await expect(hits.nth(2)).toContainText("Create your store");
  await expect(hits.nth(3)).toContainText("Find your way around the admin");
});

test("the Norwegian search is in Norwegian, with the Norwegian pages", async ({ page }) => {
  await page.goto("/no/docs/search?q=mva&lang=nb");
  await expect(page.locator("html")).toHaveAttribute("lang", "nb");
  await expect(page.getByRole("heading", { level: 1, name: "Søk i dokumentasjonen" })).toBeVisible();
  const hit = page.locator("a[data-docs-hit]").filter({ hasText: "Legg inn ditt første produkt" });
  // "mva" is in the words under one of its headings, not in its title, so the result leads to that heading.
  await expect(hit).toHaveAttribute("href", /^\/no\/docs\/owners\/getting-started\/your-first-product(#[a-z0-9-]+)?$/);
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

// ---------------------------------------------------------------------------------------------------------------------
// The generated reference (E4): made from unit A's contracts when the docs are built, a docs page like the written ones
// ---------------------------------------------------------------------------------------------------------------------

const RESOURCE = "/docs/reference/admin-api/products";

test("the reference's front page lists every part, under the top bar's API reference, with the changelog", async ({ page }) => {
  const response = await page.goto("/docs/reference");
  expect(response?.status()).toBe(200);
  await expect(page).toHaveTitle("API reference · Kaizena Flow Docs");
  await expect(page.getByRole("navigation", { name: "Docs" }).getByRole("link", { name: "API reference" })).toHaveAttribute("aria-current", "true");
  const main = page.getByRole("main");
  for (const [name, href] of [
    ["Admin API", "/docs/reference/admin-api"],
    ["Storefront API", "/docs/reference/storefront-api"],
    ["Webhooks", "/docs/reference/webhooks"],
    ["MCP", "/docs/reference/mcp"],
    ["Scopes", "/docs/reference/scopes"],
    ["Errors", "/docs/reference/errors"],
    ["Rate limits", "/docs/reference/rate-limits"],
    ["Changelog", "/docs/changelog"],
  ]) {
    await expect(main.getByRole("link", { name, exact: true }).first()).toHaveAttribute("href", href);
  }
  // In the developers' tree, and listed as a section is: by topic, in the four orders.
  const tree = page.getByRole("navigation", { name: "Developers: pages" });
  await expect(tree.getByRole("link", { name: "API reference" })).toHaveAttribute("aria-current", "page");
  // The written Webhooks section is in the tree too: the reference's group is the one at its own address.
  await expect(tree.locator('a[href="/docs/reference/webhooks"]')).toHaveText("Webhooks");
  const bar = page.getByRole("navigation", { name: "Filter and sort these pages" });
  await expect(bar.getByRole("link", { name: /^Webhooks\s*\d+$/ })).toHaveAttribute("href", "/docs/search?area=webhooks&lang=en&section=developers%2Freference");
});

test("a resource's page lists its operations first, then each with its address, scope, schemas, errors and examples", async ({ page }) => {
  const response = await page.goto(RESOURCE);
  expect(response?.status()).toBe(200);
  await expect(page).toHaveTitle("Products · Admin API · Kaizena Flow Docs");
  await expect(page.getByRole("heading", { level: 1, name: "Products" })).toBeVisible();
  const crumbs = page.getByRole("navigation", { name: "Breadcrumb" });
  await expect(crumbs.getByRole("link", { name: "Developers" })).toHaveAttribute("href", "/docs/developers");
  await expect(crumbs.getByRole("link", { name: "API reference" })).toHaveAttribute("href", "/docs/reference");
  await expect(crumbs.getByRole("link", { name: "Admin API" })).toHaveAttribute("href", "/docs/reference/admin-api");
  await expect(page.getByRole("navigation", { name: "Developers: pages" }).getByRole("link", { name: "Products", exact: true })).toHaveAttribute("aria-current", "page");

  // The list first: each operation a link to its part of the page.
  const list = page.getByRole("main").locator("table").first();
  await expect(list.getByRole("columnheader")).toHaveText(["Operation", "Method and path", "Scope"]);
  await expect(list.getByRole("link", { name: "Create a draft product" })).toHaveAttribute("href", "#products-create");
  await expect(list.getByRole("link", { name: "products:write" }).first()).toHaveAttribute("href", "/docs/reference/scopes#products-write");
  await expect(page.getByRole("navigation", { name: "On this page" }).getByRole("link", { name: "Create a draft product" })).toHaveAttribute("href", "#products-create");

  // One operation: its address, scope, body as a table, answer, errors and its request in curl, JavaScript and Python.
  await page.getByRole("link", { name: "Create a draft product" }).first().click();
  await expect(page).toHaveURL(new RegExp(`${RESOURCE}#products-create$`));
  await expect(page.locator("h2#products-create")).toHaveText("Create a draft product");
  await expect(page.getByText("POST https://kaizenaflow.com/api/admin/v1/products", { exact: true })).toBeVisible();
  await expect(page.locator("h3#products-create-body")).toHaveText("Body");
  const body = page.locator("h3#products-create-body ~ div table").first();
  await expect(body.getByRole("row", { name: /title string, 1 to 200 characters yes/ })).toBeVisible();
  await expect(page.locator("h3#products-create-errors")).toBeVisible();
  await expect(page.getByRole("link", { name: "conflict" }).first()).toHaveAttribute("href", "/docs/reference/errors#conflict");
  await expect(page.locator("h3#products-create-example")).toHaveText("Example request");
  const code = (lang: string) => page.locator(`h3#products-create-example ~ pre[data-lang="${lang}"]`).first();
  await expect(code("shell")).toContainText(`curl -X POST 'https://kaizenaflow.com/api/admin/v1/products'`);
  await expect(code("shell")).toContainText(`-H "Authorization: Bearer $KAIZENA_TOKEN"`);
  await expect(code("shell")).toContainText(`-d '{"title":"Linen shirt"}'`);
  await expect(code("javascript")).toContainText(`await fetch("https://kaizenaflow.com/api/admin/v1/products", {`);
  await expect(code("python")).toContainText("urllib.request.Request(");
  await expect(page.getByText("Made from the API contract, version")).toBeVisible();
  await expect(page.getByRole("link", { name: "This page as Markdown" })).toHaveAttribute("href", `${RESOURCE}.md`);
  // The pager goes on through the reference.
  await expect(page.getByRole("navigation", { name: "Previous and next page" }).getByRole("link", { name: /Next\s*Inventory/ })).toHaveAttribute("href", "/docs/reference/admin-api/inventory");
});

test("each page of the reference answers as Markdown, and is in the sitemap, llms.txt and llms-full.txt", async ({ request }) => {
  const md = await request.get(`${RESOURCE}.md`);
  expect(md.status()).toBe(200);
  expect(md.headers()["content-type"]).toContain("text/markdown");
  const text = await md.text();
  expect(text.startsWith("# Products\n\n> ")).toBe(true);
  expect(text).toContain("## Create a draft product {#products-create}");
  expect(text).toContain("](http://localhost:3000/docs/reference/scopes#products-write)");
  expect(text).toContain("```python\nimport json");
  expect((await request.get("/docs/reference.md")).status()).toBe(200);
  expect(await (await request.get("/docs/llms.txt")).text()).toContain(`- [Products](http://localhost:3000${RESOURCE}.md): `);
  expect(await (await request.get("/docs/llms-full.txt")).text()).toContain("## order.paid");
  expect(await (await request.get("/docs/sitemap.xml")).text()).toContain(`<loc>http://localhost:3000${RESOURCE}</loc>`);
  // English only, as the developers' track.
  expect((await request.get(`/no${RESOURCE}`)).status()).toBe(404);
});

test("a webhook topic's page has its payload and an example; the webhooks' page the signature checks", async ({ page }) => {
  const response = await page.goto("/docs/reference/webhooks/order-paid");
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1, name: "order.paid" })).toBeVisible();
  await expect(page.locator("h2#payload")).toHaveText("Payload");
  await expect(page.getByRole("row", { name: /data\.order\.total number/ })).toBeVisible();
  const example = page.locator('pre[data-lang="json"]').first();
  await expect(example).toContainText('"topic": "order.paid"');
  await expect(example).toContainText('"status": "paid"');
  await page.getByRole("link", { name: "check the signature" }).click();
  await expect(page).toHaveURL(/\/docs\/reference\/webhooks#signature$/);
  for (const [id, lang, words] of [
    ["signature-javascript", "javascript", "export function verifyKaizenaWebhook(body, timestamp, signatures, secret)"],
    ["signature-python", "python", "def verify_kaizena_webhook(body: bytes"],
    ["signature-php", "php", "function verify_kaizena_webhook(string $body"],
  ]) {
    await expect(page.locator(`h3#${id}`)).toBeVisible();
    await expect(page.locator(`h3#${id} ~ pre[data-lang="${lang}"]`).first()).toContainText(words);
  }
});

test("the MCP catalogue is listed by area, each tool with its gate, permission and inputs", async ({ page }) => {
  const response = await page.goto("/docs/reference/mcp");
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1, name: "MCP" })).toBeVisible();
  const areas = page.getByRole("main").locator("table").first();
  await expect(areas.getByRole("columnheader")).toHaveText(["Area", "Tools", "Read-only", "With a gate"]);
  await areas.getByRole("link", { name: "Products", exact: true }).click();
  await expect(page).toHaveURL(/\/docs\/reference\/mcp\/products$/);
  const tools = page.getByRole("main").locator("table").first();
  await expect(tools.getByRole("columnheader")).toHaveText(["Tool", "What it does", "Gate", "Permission"]);
  await expect(tools.getByRole("row", { name: /update_product Update product public products:write/ })).toBeVisible();
  await expect(page.locator("h2#update-product")).toHaveText("Update product");
  await expect(page.locator("h3#update-product-inputs")).toHaveText("Inputs");
  await expect(page.locator("h3#update-product-inputs ~ div table").first().getByRole("row", { name: /store string yes/ })).toBeVisible();
});

test("a search finds an operation and leads to its heading in the reference", async ({ page }) => {
  await page.goto("/docs/search?q=products.get");
  const hit = page.locator("a[data-docs-hit]").first();
  await expect(hit).toHaveAttribute("href", "/docs/reference/admin-api/products#products-get");
  await expect(hit).toContainText("Admin API operation");
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

  // The generated reference (E4): its front page, a resource, the webhooks' page, a topic, the MCP catalogue and an area, the errors. Long
  // pages of tables, so axe takes longer over them than over an article.
  test(`the generated reference has no serious or critical accessibility findings, ${scheme}`, async ({ page }) => {
    test.slow();
    await page.emulateMedia({ colorScheme: scheme });
    const paths = ["/docs/reference", RESOURCE, "/docs/reference/webhooks", "/docs/reference/webhooks/order-paid", "/docs/reference/mcp", "/docs/reference/mcp/products", "/docs/reference/errors"];
    for (const path of paths) {
      await page.goto(path);
      expect(describeFindings(await violationsOn(page)), `${path} (${scheme})`).toEqual([]);
    }
  });
}
