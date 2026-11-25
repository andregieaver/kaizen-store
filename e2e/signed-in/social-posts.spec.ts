import { createServer, type Server } from "node:http";

import { expect, test } from "@playwright/test";

import { encryptSecret, parseKey } from "../../src/lib/secret-box";
import { testDb } from "../db";
import { OWNER } from "./accounts";

/**
 * The social post creator (D870 C1) as the owner sees it: choose a product, keep two channels, press Write posts, and copy each post. The
 * store's writer is a stand-in for an OpenAI-shaped chat answering with posts; what the server keeps and checks is held by
 * social-posts.int.test.ts.
 */

test.use({ storageState: OWNER.state, permissions: ["clipboard-read", "clipboard-write"] });

const RUN = Date.now().toString(36).toLowerCase();
const SLUG = `e2e-social-${RUN}`;
let stub: Server;
let port = 0;

const POSTS = {
  posts: [
    { channel: "instagram", caption: "Slow mornings start with a good cup.\nMade by hand, glazed in small batches.", hashtags: ["handmade", "ceramics", "coffee"] },
    { channel: "facebook", caption: "Meet the mug we reach for first every morning: heavy in the hand, warm to hold.", hashtags: ["ceramics"] },
  ],
};

test.beforeAll(async () => {
  stub = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          id: "chatcmpl-stand-in",
          object: "chat.completion",
          choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: JSON.stringify(POSTS) } }],
          usage: { prompt_tokens: 100, completion_tokens: 100, total_tokens: 200 },
        }),
      );
    });
  });
  await new Promise<void>((done) => stub.listen(0, "127.0.0.1", () => done()));
  port = (stub.address() as { port: number }).port;

  const sql = testDb();
  try {
    const [access] = await sql`insert into commerce.access_requests (email, name, store_name) values (${`${SLUG}@example.com`}, 'Eva', 'Keramikkverkstedet') returning id`;
    const [{ id: storeId }] = await sql`select commerce.approve_access_request(${access.id}, ${SLUG}, 'Keramikkverkstedet', null) as id`;
    await sql`update commerce.stores set setup_completed_at = coalesce(setup_completed_at, now()), status = 'active' where id = ${storeId}`;
    const [owner] = await sql`select id from commerce.accounts where email = ${OWNER.email}`;
    await sql`insert into commerce.store_members (store_id, account_id, role) values (${storeId}, ${owner.id}, 'owner')`;
    const key = parseKey(process.env.SETTINGS_ENCRYPTION_KEY)!;
    await sql`
      insert into commerce.ai_providers (store_id, provider, base_url, api_key_encrypted, api_key_hint, text_model, enabled)
      values (${storeId}, 'custom', ${`http://127.0.0.1:${port}/v1`}, ${encryptSecret("sk-stand-in", key)}, '…in', 'stand-in', true)`;
  } finally {
    await sql.end();
  }
});

test.afterAll(async () => {
  await new Promise((done) => stub.close(done));
});

test("the owner writes posts for two channels from a product and copies one", async ({ page }) => {
  await page.goto(`/admin/${SLUG}/social`);
  await expect(page.getByRole("heading", { name: "Social posts", level: 1 })).toBeVisible();
  await expect(page.getByText("No posts yet. Choose a product and press Write posts.")).toBeVisible();
  await expect(page.getByLabel("What the posts are about", { exact: true })).toHaveValue(/^product:/);

  await page.getByRole("button", { name: "Write posts" }).click();
  await expect(page.getByText("Written. Copy each post into its channel.")).toBeVisible();
  const instagram = page.getByRole("article", { name: "Instagram" });
  const facebook = page.getByRole("article", { name: "Facebook" });
  await expect(instagram).toContainText("Slow mornings start with a good cup.");
  await expect(instagram).toContainText("#handmade #ceramics #coffee");
  // Instagram opens no link in a caption: the link is its own, to copy apart; Facebook's is in the text.
  await expect(instagram).toContainText("does not open links in posts");
  await expect(facebook).toContainText("utm_source=facebook&utm_medium=social");
  // Each post's picture is drawn by the server in the channel's shape, and offered to download under the channel's name.
  const picture = instagram.getByRole("img", { name: "The Instagram picture, 4:5" });
  await expect(picture).toBeVisible();
  await expect.poll(() => picture.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth)).toBe(1080);
  await expect(instagram.getByRole("link", { name: "Download picture" })).toHaveAttribute("href", /\/social\/picture\/[0-9a-f-]{36}\?download=1$/);
  await page.screenshot({ path: "test-results/social-posts.png", fullPage: true });
  const download = await page.request.get((await instagram.getByRole("link", { name: "Download picture" }).getAttribute("href"))!);
  expect(download.headers()["content-type"]).toBe("image/png");
  expect(download.headers()["content-disposition"]).toMatch(/^attachment; filename="instagram-[a-z0-9]{12}-4x5\.png"$/);

  await facebook.getByRole("button", { name: "Copy text" }).click();
  await expect(facebook.getByRole("button", { name: "Copied" })).toBeVisible();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toContain("Meet the mug we reach for first every morning");
  expect(copied).toContain("utm_content=p-");

  // After a reload the posts are the store's, and the copied one says so.
  await page.reload();
  await expect(page.getByRole("article", { name: "Facebook" })).toContainText(/Copied /);
  await expect(page.getByRole("article", { name: "Instagram" })).toContainText("Not copied yet");
});

test("a store's page is a subject too, and a post about it links to it (C1b: Kaizena Flow's own site has pages, not products)", async ({ page }) => {
  await page.goto(`/admin/${SLUG}/social`);
  const subject = page.getByLabel("What the posts are about", { exact: true });
  const option = subject.locator("optgroup[label='Pages of your site'] option").first();
  await expect(option).toHaveCount(1);
  await subject.selectOption((await option.getAttribute("value"))!);
  await expect(page.getByText("The posts link to this page and invite people to it.")).toBeVisible();
  await page.getByRole("button", { name: "Write posts" }).click();
  await expect(page.getByText("Written. Copy each post into its channel.")).toBeVisible();
  await expect(page.getByRole("article", { name: "Facebook" }).first()).toContainText("utm_source=facebook");
  await page.screenshot({ path: "test-results/social-posts-page.png", fullPage: true });
});


test("how the store's own Instagram posts did, newest first, once the account granted insights (D870 S1.2)", async ({ page }) => {
  await page.goto(`/admin/${SLUG}/social`);
  const card = page.getByRole("region", { name: "How your Instagram posts did" });
  await expect(card).toContainText("Connect your Instagram account to see how each post does.");
  await expect(card.getByRole("link", { name: "Connect Instagram" })).toHaveAttribute("href", `/admin/${SLUG}/integrations/instagram`);

  const sql = testDb();
  try {
    const [store] = await sql`select id from commerce.stores where slug = ${SLUG}`;
    const key = parseKey(process.env.SETTINGS_ENCRYPTION_KEY)!;
    const [account] = await sql`
      insert into commerce.instagram_accounts (store_id, ig_user_id, username, token_encrypted, token_expires_at, insights, insights_fetched_at)
      values (${store.id}, '17841400000000001', 'keramikkverkstedet', ${encryptSecret("stand-in", key)}, now() + interval '50 days', true, now())
      returning id`;
    const day = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
    for (const [id, kind, at, caption, reach, likes, saves, shares] of [
      ["2001", "feed", day(2), "Nye krus fra ovnen i dag, glasert i små serier.", 1840, 132, 27, 9],
      ["2002", "reel", day(6), "Slik dreier vi en bolle, fra leire til glasur.", 5210, 388, 61, 44],
      ["2003", "story", day(9), "", 610, null, null, 3],
    ] as const) {
      await sql`
        insert into commerce.social_post_insights (account_id, store_id, media_id, kind, posted_at, caption, permalink, reach, likes, saves, shares)
        values (${account.id}, ${store.id}, ${id}, ${kind}, ${at}, ${caption}, ${`https://www.instagram.com/p/${id}/`}, ${reach}, ${likes}, ${saves}, ${shares})`;
    }
  } finally {
    await sql.end();
  }
  await page.reload();
  await expect(card.getByRole("listitem")).toHaveCount(3);
  await expect(card.getByRole("listitem").first()).toContainText("Nye krus fra ovnen i dag");
  await expect(card.getByRole("listitem").first()).toContainText("1,840");
  await expect(card.getByRole("listitem").nth(2)).toContainText("(no caption)");
  await card.scrollIntoViewIfNeeded();
  await card.screenshot({ path: "test-results/social-insights.png" });
});
