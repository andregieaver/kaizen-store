import path from "node:path";

import { expect, test, type Page } from "@playwright/test";

import { testDb } from "../db";

import { OWNER } from "./accounts";

/**
 * The chat on an owner's own website (D581, `docs/support-embed.md` step 1), as its people use it: the owner adds the site on Support →
 * Settings and gets its tag; a page of the site (played by the browser at `https://www.example-shop.com`, the tag loading the loader from
 * the app) shows the chat in a frame once the site is found; a visitor's message reaches the inbox with the site's page; the same tag on
 * another site shows nothing. Each run has a store of its own, so other tests' support settings never meet it.
 *
 * With `E2E_SHOTS` set to a folder, each step is also kept there as a picture.
 */

const SITE = "https://www.example-shop.com";

// The site is played as a public https address, and the app runs on localhost: Chromium's local network access would refuse the site's
// tag the app's loader (in production both are public), so this spec's browser lets a public page reach localhost.
test.use({
  launchOptions: {
    ...(process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {}),
    args: ["--disable-features=LocalNetworkAccessChecks,PrivateNetworkAccessRespectPreflightResults,BlockInsecurePrivateNetworkRequests"],
  },
});

async function shot(page: Page, name: string) {
  if (process.env.E2E_SHOTS) await page.screenshot({ path: path.join(process.env.E2E_SHOTS, `${name}.png`) });
}

/** A page of a website that is not Kaizena Flow's: `html` served at `origin` by the browser itself, with the site's tag in its footer. */
async function sitePage(page: Page, origin: string, key: string, at: string) {
  const loader = new URL("/embed/chat.js", test.info().project.use.baseURL).href;
  await page.route(`${origin}/**`, (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><html lang="nb"><head><meta charset="utf-8"><title>Example Shop</title>
        <style>body{margin:0;font:16px/1.5 Georgia,serif;color:#222;background:#f7f3ee}header{padding:20px 40px;background:#2f4f3a;color:#fff;font-size:22px}
        main{max-width:720px;margin:40px auto;padding:0 20px}h1{font-size:40px;margin:0 0 12px}footer{padding:40px;color:#666}</style></head>
        <body><header>Example Shop</header><main><h1>Priser</h1><p>Alt du lurer på om abonnementet vårt, levering og retur.</p>
        <p>Spør oss i chatten nede til høyre.</p></main><footer>© Example Shop AS
        <script src="${loader}" data-key="${key}" async></script></footer></body></html>`,
    }),
  );
  await page.goto(`${origin}${at}`);
}

test("the owner adds a website, its pages show the chat once the tag is found, and conversations reach the inbox", async ({ browser }) => {
  test.setTimeout(120_000);
  const sql = testDb();
  try {
    // A store of its own with people answering, the e2e owner one of its admins.
    const slug = `embed-${Date.now().toString(36)}`;
    const [access] = await sql`insert into commerce.access_requests (email, name, store_name) values (${`${slug}@example.com`}, 'Kari', 'Lampebutikken') returning id`;
    const [{ id: storeId }] = await sql`select commerce.approve_access_request(${access.id}, ${slug}, 'Lampebutikken', null) as id`;
    const [owner] = await sql`select id from commerce.accounts where email = ${OWNER.email}`;
    await sql`insert into commerce.store_members (store_id, account_id, role) values (${storeId}, ${owner.id}, 'admin')`;
    await sql`insert into commerce.support_settings (store_id, mode) values (${storeId}, 'people')`;

    // The owner adds the site: Homer types the address and gets the tag to paste.
    const staffContext = await browser.newContext({ storageState: OWNER.state, viewport: { width: 1280, height: 900 } });
    const staff = await staffContext.newPage();
    await staff.goto(`/admin/${slug}/support/settings`);
    const card = staff.getByRole("region", { name: "Chat on your own website" });
    await card.getByLabel("Website address").fill("https://www.example-shop.com/kontakt");
    await card.getByRole("button", { name: "Add website" }).click();
    const row = card.locator('[data-embed="www.example-shop.com"]');
    await expect(row).toBeVisible({ timeout: 20_000 });
    await expect(row.getByText("Waiting for the tag")).toBeVisible();
    const [embed] = await sql`select id, key from commerce.support_embeds where store_id = ${storeId}`;
    await expect(row.getByText(`data-key="${embed.key}"`)).toBeVisible();
    await row.scrollIntoViewIfNeeded();
    await shot(staff, "1-admin-waiting");

    // The site's page before its tag is found: no chat.
    const visitorContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const visitor = await visitorContext.newPage();
    await sitePage(visitor, SITE, embed.key, "/priser");
    const frame = visitor.locator("iframe[data-kaizena-chat]");
    await expect(frame).toBeAttached();
    await visitor.waitForTimeout(2000);
    await expect(frame).toHaveCSS("opacity", "0");
    await expect(frame).toHaveCSS("pointer-events", "none");

    // Found (the check reads the real site, which this test has none of): the chat shows on the site's pages.
    await sql`update commerce.support_embeds set verified_at = now(), verified_by = 'page', check_problem = null where id = ${embed.id}`;
    await visitor.reload();
    await expect(frame).toHaveCSS("opacity", "1", { timeout: 20_000 });
    const chat = visitor.frameLocator("iframe[data-kaizena-chat]");
    const launcher = chat.getByRole("button", { name: /^Chat med oss/ });
    await expect(launcher).toBeVisible();
    await shot(visitor, "2-site-closed");
    await launcher.click();
    const dialog = chat.getByRole("dialog");
    await expect(dialog).toBeVisible();
    const box = await frame.boundingBox();
    expect(box?.height).toBeGreaterThan(700);
    await dialog.getByRole("textbox", { name: "Skriv en melding" }).fill("Hei! Kan jeg bytte abonnement midt i måneden?");
    await dialog.getByRole("textbox", { name: "Skriv en melding" }).press("Enter");
    await expect(dialog.getByText("Hei! Kan jeg bytte abonnement midt i måneden?")).toBeVisible({ timeout: 15_000 });
    // The conversation is the store's, and the staff see which site and page it started on.
    await expect
      .poll(async () => (await sql`select page_path from commerce.support_conversations where store_id = ${storeId}`)[0]?.page_path, { timeout: 15_000 })
      .toBe("www.example-shop.com/priser");
    await expect(dialog.getByText("Skriver …")).toBeHidden({ timeout: 15_000 });
    await shot(visitor, "3-site-open");
    await staff.goto(`/admin/${slug}/support`);
    await staff.getByRole("tab", { name: /^Waiting/ }).click();
    await staff.getByRole("list", { name: "Conversations" }).getByRole("button").first().click();
    await expect(staff.getByText("www.example-shop.com/priser")).toBeVisible({ timeout: 15_000 });
    await shot(staff, "4-inbox");

    // The settings say Live now.
    await staff.goto(`/admin/${slug}/support/settings`);
    await expect(staff.locator('[data-embed="www.example-shop.com"]').getByText("Live")).toBeVisible();

    // Another site that copies the tag shows nothing.
    const other = await visitorContext.newPage();
    await sitePage(other, "https://copycat.example.net", embed.key, "/");
    await other.waitForTimeout(3000);
    await expect(other.locator("iframe[data-kaizena-chat]")).toHaveCSS("opacity", "0");
    await staffContext.close();
    await visitorContext.close();
  } finally {
    await sql.end();
  }
});
