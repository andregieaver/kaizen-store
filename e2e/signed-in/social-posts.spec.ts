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
  await expect(page.getByLabel("Product", { exact: true })).not.toHaveValue("");

  await page.getByRole("button", { name: "Write posts" }).click();
  await expect(page.getByText("Written. Copy each post into its channel.")).toBeVisible();
  const instagram = page.getByRole("article", { name: "Instagram" });
  const facebook = page.getByRole("article", { name: "Facebook" });
  await expect(instagram).toContainText("Slow mornings start with a good cup.");
  await expect(instagram).toContainText("#handmade #ceramics #coffee");
  // Instagram opens no link in a caption: the link is its own, to copy apart; Facebook's is in the text.
  await expect(instagram).toContainText("does not open links in posts");
  await expect(facebook).toContainText("utm_source=facebook&utm_medium=social");
  await page.screenshot({ path: "test-results/social-posts.png", fullPage: true });

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
