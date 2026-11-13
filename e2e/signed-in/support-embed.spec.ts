import path from "node:path";

import { expect, test, type Page } from "@playwright/test";

import { testDb } from "../db";

import { OWNER } from "./accounts";

/**
 * Chat widgets on the owner's own websites (D582, `docs/support-embed.md`), as their people use them: the owner makes two widgets on
 * Support → Website chat, each styled for its site with the preview beside it, and copies each one's tag; a page of each site (played by
 * the browser at its https address, the tag loading the loader from the app) shows its own widget in its own look once the site is found;
 * a visitor's message reaches the inbox with the site's page; the tag on a site that is not the widget's shows nothing. Each run has a
 * store of its own, so other tests' support settings never meet it.
 *
 * With `E2E_SHOTS` set to a folder, each step is also kept there as a picture.
 */

// The sites are played as public https addresses, and the app runs on localhost: Chromium's local network access would refuse the sites'
// tags the app's loader (in production both are public), so this spec's browser lets a public page reach localhost.
test.use({
  launchOptions: {
    ...(process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {}),
    args: ["--disable-features=LocalNetworkAccessChecks,PrivateNetworkAccessRespectPreflightResults,BlockInsecurePrivateNetworkRequests"],
  },
});

async function shot(page: Page, name: string, options: { fullPage?: boolean } = {}) {
  if (process.env.E2E_SHOTS) await page.screenshot({ path: path.join(process.env.E2E_SHOTS, `${name}.png`), ...options });
}

type Look = { title: string; body: string; header: string; text: string };

/** A page of a website that is not Kaizena Flow's, served at `origin` by the browser itself, with a widget's tag in its footer. */
async function sitePage(page: Page, origin: string, key: string, at: string, look: Look) {
  const loader = new URL("/embed/chat.js", test.info().project.use.baseURL).href;
  await page.route(`${origin}/**`, (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><html lang="nb"><head><meta charset="utf-8"><title>${look.title}</title>
        <style>body{margin:0;font:16px/1.5 Georgia,serif;color:${look.text};background:${look.body}}header{padding:20px 40px;background:${look.header};color:#fff;font-size:22px}
        main{max-width:720px;margin:40px auto;padding:0 20px}h1{font-size:40px;margin:0 0 12px}footer{padding:40px;opacity:.7}</style></head>
        <body><header>${look.title}</header><main><h1>Priser</h1><p>Alt du lurer på om abonnementet vårt, levering og retur.</p>
        <p>Spør oss i chatten.</p></main><footer>© ${look.title}
        <script src="${loader}" data-key="${key}" async></script></footer></body></html>`,
    }),
  );
  await page.goto(`${origin}${at}`);
}

const GREEN: Look = { title: "Example Shop", body: "#f7f3ee", header: "#2f4f3a", text: "#222" };
const DARK: Look = { title: "The Journal", body: "#0d1014", header: "#1f2630", text: "#d7dbe0" };

test("the owner makes two styled chat widgets for two websites, each shows on its own site, and conversations reach the inbox", async ({ browser }) => {
  test.setTimeout(180_000);
  const sql = testDb();
  try {
    // A store of its own with people answering, the e2e owner one of its admins.
    const slug = `embed-${Date.now().toString(36)}`;
    const [access] = await sql`insert into commerce.access_requests (email, name, store_name) values (${`${slug}@example.com`}, 'Kari', 'Lampebutikken') returning id`;
    const [{ id: storeId }] = await sql`select commerce.approve_access_request(${access.id}, ${slug}, 'Lampebutikken', null) as id`;
    const [owner] = await sql`select id from commerce.accounts where email = ${OWNER.email}`;
    await sql`insert into commerce.store_members (store_id, account_id, role) values (${storeId}, ${owner.id}, 'admin')`;
    await sql`insert into commerce.support_settings (store_id, mode) values (${storeId}, 'people')`;

    const staffContext = await browser.newContext({ storageState: OWNER.state, viewport: { width: 1280, height: 1000 } });
    const staff = await staffContext.newPage();

    // Homer makes a widget from a name and the website it is for, and lands on it.
    await staff.goto(`/admin/${slug}/support/widgets`);
    await staff.getByLabel("Name").fill("Company site");
    await staff.getByLabel("Website address (optional)").fill("https://www.example-shop.com/kontakt");
    await staff.getByRole("button", { name: "Make widget" }).click();
    await staff.waitForURL(/\/support\/widgets\/[0-9a-f-]{36}$/, { timeout: 20_000 });
    await expect(staff.locator('[data-site="www.example-shop.com"]').getByText("Waiting for the tag")).toBeVisible();

    // Styled to match the site: a green button, round corners, on the left with words.
    await staff.getByLabel("Button colour").fill("#2f4f3a");
    await staff.getByRole("button", { name: "Round" }).click();
    await staff.getByRole("button", { name: "Bottom left" }).click();
    await staff.getByRole("button", { name: "Icon and words" }).click();
    await staff.getByLabel("The button's words").fill("Spør oss");
    await expect(staff.locator(".kz-widget-preview [data-chat-launcher]")).toContainText("Spør oss");
    await staff.getByRole("button", { name: "Save" }).click();
    await expect(staff.getByText("Saved.")).toBeVisible({ timeout: 15_000 });

    // The same widget goes on a second website.
    await staff.getByRole("textbox", { name: "Add website" }).fill("shop.example-shop.com");
    await staff.getByRole("button", { name: "Add website" }).click();
    await expect(staff.locator('[data-site="shop.example-shop.com"]')).toBeVisible({ timeout: 20_000 });
    await shot(staff, "1-admin-widget", { fullPage: true });
    const [shopWidget] = await sql`select id, key, style from commerce.support_widgets where store_id = ${storeId} and name = 'Company site'`;
    expect(shopWidget.style).toMatchObject({ accent: "#2f4f3a", corners: "round", side: "left", launcher: "label", label: "Spør oss" });

    // A second widget, for the blog, dark.
    await staff.goto(`/admin/${slug}/support/widgets`);
    await staff.getByLabel("Name").fill("Blog");
    await staff.getByLabel("Website address (optional)").fill("blog.example-journal.com");
    await staff.getByRole("button", { name: "Make widget" }).click();
    await staff.waitForURL(/\/support\/widgets\/[0-9a-f-]{36}$/, { timeout: 20_000 });
    await staff.getByLabel("Button colour").fill("#e8b04b");
    await staff.getByLabel("Background", { exact: true }).fill("#14181f");
    await staff.getByLabel("Text colour").fill("#eef0f3");
    await staff.getByRole("button", { name: "Square" }).click();
    await staff.getByRole("button", { name: "Save" }).click();
    await expect(staff.getByText("Saved.")).toBeVisible({ timeout: 15_000 });
    await shot(staff, "2-admin-blog-widget", { fullPage: true });
    const [blogWidget] = await sql`select id, key from commerce.support_widgets where store_id = ${storeId} and name = 'Blog'`;
    await staff.goto(`/admin/${slug}/support/widgets`);
    await expect(staff.locator('[data-widget="Company site"]')).toContainText("2 websites");
    await expect(staff.getByRole("heading", { level: 1, name: "Website chat" })).toBeVisible();
    await staff.waitForLoadState("networkidle");
    await shot(staff, "3-admin-list");

    // A site's page before its tag is found: the frame is there, see-through, and lets clicks through.
    const visitorContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const visitor = await visitorContext.newPage();
    await sitePage(visitor, "https://www.example-shop.com", shopWidget.key, "/priser", GREEN);
    const frame = visitor.locator("iframe[data-kaizena-chat]");
    await expect(frame).toBeAttached();
    await visitor.waitForTimeout(2000);
    await expect(frame).toHaveCSS("opacity", "0");
    await expect(frame).toHaveCSS("pointer-events", "none");

    // Found (the check reads the real sites, which this test has none of): each site shows its own widget, in its own look.
    await sql`update commerce.support_widget_sites set verified_at = now(), verified_by = 'page', check_problem = null where widget_id in (${shopWidget.id}, ${blogWidget.id})`;
    await visitor.reload();
    await expect(frame).toHaveCSS("opacity", "1", { timeout: 20_000 });
    await expect(frame).toHaveCSS("left", "0px");
    const chat = visitor.frameLocator("iframe[data-kaizena-chat]");
    const launcher = chat.getByRole("button", { name: /^Spør oss/ });
    await expect(launcher).toBeVisible();
    await expect(launcher).toHaveCSS("background-color", "rgb(47, 79, 58)");
    await shot(visitor, "4-site-closed");
    await launcher.click();
    const dialog = chat.getByRole("dialog");
    await expect(dialog).toBeVisible();
    expect((await frame.boundingBox())?.height).toBeGreaterThan(700);
    await dialog.getByRole("textbox", { name: "Skriv en melding" }).fill("Hei! Kan jeg bytte abonnement midt i måneden?");
    await dialog.getByRole("textbox", { name: "Skriv en melding" }).press("Enter");
    await expect
      .poll(async () => (await sql`select page_path from commerce.support_conversations where store_id = ${storeId}`)[0]?.page_path, { timeout: 15_000 })
      .toBe("www.example-shop.com/priser");
    await expect(dialog.getByText("Skriver …")).toBeHidden({ timeout: 15_000 });
    await shot(visitor, "5-site-open");

    const blogPage = await visitorContext.newPage();
    await sitePage(blogPage, "https://blog.example-journal.com", blogWidget.key, "/", DARK);
    const blogFrame = blogPage.locator("iframe[data-kaizena-chat]");
    await expect(blogFrame).toHaveCSS("opacity", "1", { timeout: 20_000 });
    await expect(blogFrame).toHaveCSS("right", "0px");
    const blogChat = blogPage.frameLocator("iframe[data-kaizena-chat]");
    await shot(blogPage, "6-blog-closed");
    await blogChat.getByRole("button", { name: /^Chat med oss/ }).click();
    await expect(blogChat.getByRole("dialog")).toHaveCSS("background-color", "rgb(20, 24, 31)");
    await shot(blogPage, "7-blog-open");

    // The conversation is the store's, and the staff see which site and page it started on.
    await staff.goto(`/admin/${slug}/support`);
    await staff.getByRole("tab", { name: /^Waiting/ }).click();
    await staff.getByRole("list", { name: "Conversations" }).getByRole("button").first().click();
    await expect(staff.getByText("www.example-shop.com/priser")).toBeVisible({ timeout: 15_000 });
    await shot(staff, "8-inbox");

    // A widget's tag on a site that is not one of its own (a copycat's, or the other widget's site) shows nothing.
    for (const origin of ["https://copycat.example.net", "https://blog.example-journal.com"]) {
      const other = await visitorContext.newPage();
      await sitePage(other, origin, shopWidget.key, "/", GREEN);
      await other.waitForTimeout(3000);
      await expect(other.locator("iframe[data-kaizena-chat]")).toHaveCSS("opacity", "0");
    }
    await staffContext.close();
    await visitorContext.close();
  } finally {
    await sql.end();
  }
});
