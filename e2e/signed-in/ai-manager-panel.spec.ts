import { expect, test } from "@playwright/test";

import { assistantNb } from "../../src/lib/admin-messages/assistant.nb";
import { encryptSecret, parseKey } from "../../src/lib/secret-box";
import { testDb } from "../db";

import { E2E_STORE, E2E_STORE_NB, OWNER, OWNER_NB } from "./accounts";

/**
 * The AI manager's chat is fetched when its panel is first opened, not with every admin screen (`ai-manager-launcher.tsx`, D444): the
 * screen asks for no more scripts until the button is pressed, and then the panel draws the chat (its message box, or what to set up
 * where the store has no text model) instead of staying on Loading.
 */
test.use({ storageState: OWNER.state });

test("the AI manager's panel fetches its chat when opened and draws it", async ({ page }) => {
  await page.goto(`/admin/${E2E_STORE}/products`);
  await expect(page.locator("main").first()).toBeVisible();
  await page.waitForLoadState("networkidle");
  const scripts: string[] = [];
  const sizes: Promise<number>[] = [];
  page.on("response", (response) => {
    if (response.request().resourceType() !== "script") return;
    scripts.push(response.url());
    sizes.push(response.body().then((body) => body.length, () => 0));
  });
  await page.getByRole("button", { name: /AI manager/ }).first().click();
  const panel = page.getByRole("complementary", { name: "AI manager" });
  await expect(panel.getByRole("textbox").or(panel.getByText("The AI manager uses the store's AI and needs a text model."))).toBeVisible();
  await expect(panel.getByRole("status").filter({ hasText: "Loading" })).toHaveCount(0);
  expect(scripts.length, "the chat's scripts are fetched on opening").toBeGreaterThan(0);
  // Raw bytes, as the first-scripts budgets count them (bloat review step 0.11: the chat carries no tool definitions and no admin map).
  const total = (await Promise.all(sizes)).reduce((sum, size) => sum + size, 0);
  console.log(`the chat's scripts on first opening: ${total} bytes in ${scripts.length} files`);
  expect(total, "the chat's scripts on first opening").toBeLessThanOrEqual(130_000);
});

test.describe("for a Norwegian owner", () => {
  test.use({ storageState: OWNER_NB.state });
  // The screens hand only the button's and the notices' words (`assistantBar`); the chat's arrive with its start call (bloat review step
  // 2.27), so the panel never draws the chat in English or from a noted fallback.
  test("the chat opens in Norwegian, with the words its start call brought", async ({ page }) => {
    await page.goto(`/admin/${E2E_STORE_NB}`);
    await expect(page.locator("main").first()).toBeVisible();
    await page.getByRole("button", { name: new RegExp(assistantNb.name) }).first().click();
    const panel = page.getByRole("complementary", { name: assistantNb.name });
    await expect(panel.getByPlaceholder(assistantNb.chat.placeholder).or(panel.getByText(assistantNb.chat.noModelStore))).toBeVisible();
    const fallbacks = await page.evaluate(() => (window as unknown as { __adminTextFallbacks?: string[] }).__adminTextFallbacks ?? []);
    expect(fallbacks, "words the panel read that nothing handed down").toEqual([]);
  });
});

test("the AI manager's first suggestion names the page the owner is on, and follows a move to another page", async ({ page }) => {
  // The e2e store has no text model, so the panel draws no suggestions there: a store of its own with a model set (the chat is never asked).
  const sql = testDb();
  try {
    const slug = `ai-here-${Date.now().toString(36)}`;
    const [access] = await sql`insert into commerce.access_requests (email, name, store_name) values (${`${slug}@example.com`}, 'Kari', 'Lampebutikken') returning id`;
    const [{ id: storeId }] = await sql`select commerce.approve_access_request(${access.id}, ${slug}, 'Lampebutikken', null) as id`;
    const [owner] = await sql`select id from commerce.accounts where email = ${OWNER.email}`;
    await sql`insert into commerce.store_members (store_id, account_id, role) values (${storeId}, ${owner.id}, 'owner')`;
    const key = parseKey(process.env.SETTINGS_ENCRYPTION_KEY)!;
    await sql`
      insert into commerce.ai_providers (store_id, provider, base_url, api_key_encrypted, api_key_hint, text_model, enabled)
      values (${storeId}, 'custom', 'http://127.0.0.1:9/v1', ${encryptSecret("sk-stand-in", key)}, '…in', 'stand-in', true)`;

    await page.goto(`/admin/${slug}/products`);
    await expect(page.locator("main").first()).toBeVisible();
    await page.getByRole("button", { name: /AI manager/ }).first().click();
    const panel = page.getByRole("complementary", { name: "AI manager" });
    // The name comes from the server (`pageHere`); the usual suggestions show until it arrives, and the page's comes first.
    const first = panel.getByRole("button", { name: /^Help me with .*: what can I do here\?$/ });
    await expect(first).toHaveCount(1);
    await expect(first).toContainText("products");
    await page.getByRole("navigation", { name: "Main sections" }).getByRole("link", { name: "Orders", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/admin/${slug}/orders$`));
    await expect(first).toContainText("orders");
    await expect(first).not.toContainText("products");
  } finally {
    await sql.end();
  }
});

/** How often an open tab asks for the notice count (bloat review step 2.34): a clock drives the timers, the feed's count answer is made up. */
async function watchFeed(page: import("@playwright/test").Page, body: { unread: number; waiting: boolean }) {
  const asked: number[] = [];
  await page.route("**/admin/account/notices/feed?*", (route) => {
    if (route.request().method() === "GET" && route.request().url().includes("count=1")) {
      asked.push(Date.now());
      return route.fulfill({ json: body });
    }
    return route.continue();
  });
  await page.clock.install();
  await page.goto(`/admin/${E2E_STORE}/products`);
  await expect(page.locator("main").first()).toBeVisible();
  const minutes = async (n: number) => {
    for (let i = 0; i < n; i += 1) {
      await page.clock.runFor(60_000);
      await page.waitForTimeout(50);
    }
  };
  return { asked, minutes };
}

test("an untouched tab asks for notices at most twice in ten minutes and six times in an hour", async ({ page }) => {
  const { asked, minutes } = await watchFeed(page, { unread: 0, waiting: false });
  await minutes(10);
  expect(asked.length).toBeGreaterThanOrEqual(1);
  expect(asked.length).toBeLessThanOrEqual(2);
  await minutes(49);
  expect(asked.length).toBeLessThanOrEqual(6);
});

test("while an approval waits the tab asks every minute", async ({ page }) => {
  const { asked, minutes } = await watchFeed(page, { unread: 0, waiting: true });
  await minutes(10);
  expect(asked.length).toBeGreaterThanOrEqual(9);
});

test("the next click asks at once", async ({ page }) => {
  const { asked, minutes } = await watchFeed(page, { unread: 0, waiting: false });
  await minutes(3);
  const before = asked.length;
  await page.getByRole("navigation", { name: "Main sections" }).getByRole("link", { name: "Orders", exact: true }).click();
  await expect.poll(() => asked.length, { timeout: 2000 }).toBe(before + 1);
});
