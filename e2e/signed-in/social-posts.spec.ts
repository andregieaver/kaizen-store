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
    { channel: "pinterest", title: "Bowls on linen", caption: "Hand-thrown bowls for a slow kitchen, glazed in small batches.", hashtags: ["ceramics", "kitchen"] },
  ],
};

const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const ADVICE = {
  verdicts: ["Your posts reach people, but few come to the shop from them.", "Reels reach far more than pictures.", "The new bowl has not been shown yet."],
  recommendations: [
    { title: "Show the workshop at work", why: "Reels reach most, and a first look brings people closer.", kind: "write", productId: null, topic: "A morning in the workshop", channels: ["instagram", "facebook"] },
    { title: "Count visits", why: "So the adviser can tell which posts bring people to the shop.", kind: "count_visits", productId: null, topic: "", channels: [] },
  ],
  calendar: [
    { day: day(1), channel: "instagram", productId: null, idea: "A reel of a bowl taking shape on the wheel." },
    { day: day(3), channel: "pinterest", productId: null, idea: "Bowls from above on linen, for a kitchen board." },
  ],
};

const CHECKED = { readable: true, shows_subject: true, whole: true, on_brand: true, note: "" };

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
          // The adviser's prompt gets the adviser's answer (S1.4), the picture checker's a pass (S2.3); every other prompt is the post creator's.
          choices: [
            {
              index: 0,
              finish_reason: "stop",
              message: { role: "assistant", content: JSON.stringify(body.includes("social media adviser") ? ADVICE : body.includes("picture checker") ? CHECKED : POSTS) },
            },
          ],
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
  // The address names the picture it shows (`v`: the drawn one, or the post's own from Canva, D898 C3), so a new one is never an old one cached.
  await expect(instagram.getByRole("link", { name: "Download picture" })).toHaveAttribute("href", /\/social\/picture\/[0-9a-f-]{36}\?v=drawn&download=1$/);
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

  // What the adviser reads (S1.3): the same figures, worked out by code, one step away.
  await page.locator("summary", { hasText: "What the adviser reads" }).click();
  const facts = page.locator("details", { hasText: "What the adviser reads" });
  await expect(facts).toContainText("@keramikkverkstedet: 3 posts");
  await expect(facts).toContainText("Posts written here, last 90 days");
  await facts.scrollIntoViewIfNeeded();
  await facts.screenshot({ path: "test-results/social-facts.png" });
});

test("how the store's Facebook Page's posts did, from choosing the Page to its figures, and disconnecting it (D870 S1.2b)", async ({ page }) => {
  await page.goto(`/admin/${SLUG}/social`);
  const card = page.getByRole("region", { name: "How your Facebook Page's posts did" });
  await expect(card).toContainText("Connect your shop's Facebook Page to see how each post does.");
  // This build has no Facebook app: the card says so rather than offering a button that cannot work.
  await expect(card).toContainText("Facebook cannot be connected here yet.");

  const sql = testDb();
  const key = parseKey(process.env.SETTINGS_ENCRYPTION_KEY)!;
  try {
    const [store] = await sql`select id from commerce.stores where slug = ${SLUG}`;
    await sql`
      insert into commerce.facebook_pages (store_id, user_token_encrypted, choices, insights)
      values (${store.id}, ${encryptSecret("stand-in", key)}, ${sql.json([{ id: "5550001", name: "Keramikkverkstedet" }, { id: "5550002", name: "Eva's other shop" }])}, true)`;
  } finally {
    await sql.end();
  }
  await page.reload();
  await expect(card.getByLabel("Which Page is your shop's?")).toContainText("Eva's other shop");
  await expect(card.getByRole("button", { name: "Use this Page" })).toBeVisible();

  const sql2 = testDb();
  try {
    const [store] = await sql2`select id from commerce.stores where slug = ${SLUG}`;
    const [fb] = await sql2`
      update commerce.facebook_pages set page_id = '5550001', page_name = 'Keramikkverkstedet', page_token_encrypted = ${encryptSecret("stand-in", key)},
        user_token_encrypted = null, choices = '[]'::jsonb, fetched_at = now()
      where store_id = ${store.id} returning id`;
    const day = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
    for (const [id, at, caption, reach, likes, comments, shares] of [
      ["5550001_1", day(1), "Julemarked i verkstedet lørdag: kom innom for gløgg og nye boller.", 2310, 84, 19, 12],
      ["5550001_2", day(5), "Nye krus fra ovnen i dag.", 960, 41, 6, 2],
      ["5550001_3", day(12), "", 430, 12, 1, 0],
    ] as const) {
      await sql2`
        insert into commerce.social_post_insights (page_id, store_id, channel, media_id, kind, posted_at, caption, permalink, reach, likes, comments, shares, interactions)
        values (${fb.id}, ${store.id}, 'facebook', ${id}, 'feed', ${at}, ${caption}, ${`https://www.facebook.com/5550001/posts/${id.split("_")[1]}`}, ${reach}, ${likes}, ${comments}, ${shares}, ${likes + comments + shares})`;
    }
  } finally {
    await sql2.end();
  }
  await page.reload();
  await expect(card.getByRole("listitem")).toHaveCount(3);
  await expect(card.getByRole("listitem").first()).toContainText("Julemarked i verkstedet");
  await expect(card.getByRole("listitem").first()).toContainText("2,310");
  await expect(card.getByRole("listitem").nth(2)).toContainText("A post without words");
  await card.scrollIntoViewIfNeeded();
  await card.screenshot({ path: "test-results/social-facebook.png" });

  await page.locator("summary", { hasText: "What the adviser reads" }).click();
  const facts = page.locator("details", { hasText: "What the adviser reads" });
  await expect(facts).toContainText("Keramikkverkstedet: 3 posts");
  await expect(facts).toContainText("Average per post: reach 1,233");

  await card.getByRole("button", { name: "Disconnect" }).click();
  await expect(card).toContainText("The Page is disconnected.");
  await expect(card).toContainText("Connect your shop's Facebook Page");
});

test("the adviser says how the store stands in three verdicts, and its one button writes the main recommendation's posts (D870 S1.4)", async ({ page }) => {
  await page.goto(`/admin/${SLUG}/social`);
  const adviser = page.getByRole("region", { name: "Your social media adviser" });
  await adviser.getByRole("button", { name: "Ask the adviser" }).click();
  await expect(adviser.getByRole("listitem").first()).toContainText("Your posts reach people");
  await expect(adviser.getByRole("listitem")).toHaveCount(3);
  await adviser.scrollIntoViewIfNeeded();
  await adviser.getByText("All recommendations").click();
  await expect(adviser).toContainText("Count visits");
  await adviser.screenshot({ path: "test-results/social-adviser.png" });

  await adviser.getByRole("button", { name: "Write posts: Show the workshop at work" }).click();
  await expect(page.getByText("About: A morning in the workshop").first()).toBeVisible();
});

test("the adviser's plan is a calendar: write the week's posts, change one's words, approve the week (D870 S2.4)", async ({ page }) => {
  await page.goto(`/admin/${SLUG}/social`);
  const calendar = page.getByRole("region", { name: "Your posting plan" });
  // The plan the adviser wrote in the test before: tomorrow on Instagram, in three days on Pinterest.
  await expect(calendar).toContainText("A reel of a bowl taking shape on the wheel.");
  await expect(calendar).toContainText("Bowls from above on linen, for a kitchen board.");
  // Write each week's missing posts with its one button (both slots may fall in one week or two).
  for (let i = 0; i < 2; i++) {
    const write = calendar.getByRole("button", { name: /^Write (this|next) week's posts/ }).first();
    if (!(await write.isVisible())) break;
    await write.click();
    await expect(calendar.getByRole("button", { name: /^Approve the week/ }).first()).toBeVisible();
  }
  await expect(calendar.getByText("Not written yet")).toHaveCount(0);
  // Each written post's picture was looked at by the store's model that sees pictures (S2.3).
  await expect(calendar.getByText("Picture checked").first()).toBeVisible();
  await expect(calendar.getByText("Picture not checked yet")).toHaveCount(0);
  await expect(calendar).toContainText("Slow mornings start with a good cup.");
  await calendar.scrollIntoViewIfNeeded();
  await calendar.screenshot({ path: "test-results/social-calendar.png" });

  // Lisa changes one post's words: a claim is refused, plain words are kept.
  const instagram = calendar.getByRole("listitem").filter({ hasText: "Instagram" }).first();
  await instagram.getByText("Change the words").click();
  await instagram.getByLabel("The post's words").fill("Only today: 50% off!");
  await instagram.getByRole("button", { name: "Save" }).click();
  await expect(calendar.getByRole("status")).toContainText("claims");
  await instagram.getByLabel("The post's words").fill("A slow morning at the wheel, glazed in small batches.");
  await instagram.getByRole("button", { name: "Save" }).click();
  await expect(calendar).toContainText("A slow morning at the wheel, glazed in small batches.");

  // Homer approves each week with one press.
  for (let i = 0; i < 2; i++) {
    const approve = calendar.getByRole("button", { name: /^Approve the week/ }).first();
    if (!(await approve.isVisible())) break;
    await approve.click();
    await expect(calendar.getByText("Every post this week is approved.").first()).toBeVisible();
  }
  await expect(calendar.getByText("Draft", { exact: true })).toHaveCount(0);
  await calendar.screenshot({ path: "test-results/social-calendar-approved.png" });
});

test("an approved post is posted from the calendar where the connection allows it, and a refusal says why (D870 S3.1)", async ({ page }) => {
  await page.goto(`/admin/${SLUG}/social`);
  const calendar = page.getByRole("region", { name: "Your posting plan" });
  const instagram = calendar.getByRole("listitem").filter({ hasText: "Instagram" }).first();
  // The Instagram account connected above allows reading only: the calendar says what is needed to post.
  await expect(instagram).toContainText("Connect Instagram with posting allowed to post from here.");
  await expect(instagram.getByRole("button", { name: "Post now" })).toHaveCount(0);

  const sql = testDb();
  try {
    await sql`update commerce.instagram_accounts set publish = true where store_id = (select id from commerce.stores where slug = ${SLUG})`;
  } finally {
    await sql.end();
  }
  await page.reload();
  await expect(instagram.getByRole("button", { name: "Post now" })).toBeVisible();
  // Approving queued it for its planned day (S3.2): the calendar says when it goes out, and a person may take it off the queue and back.
  await expect(instagram).toContainText("Goes out");
  await instagram.getByRole("button", { name: "Don't post on its day" }).click();
  await expect(instagram.getByRole("button", { name: "Post on its day" })).toBeVisible();
  await expect(instagram).not.toContainText("Goes out");
  await instagram.getByRole("button", { name: "Post on its day" }).click();
  await expect(instagram).toContainText("Goes out");
  await calendar.scrollIntoViewIfNeeded();
  await calendar.screenshot({ path: "test-results/social-calendar-post-now.png" });

  // This build reaches no picture store or Instagram: the post is not published, and the calendar says why, with Post now still there.
  await instagram.getByRole("button", { name: "Post now" }).click();
  await expect(instagram).toContainText("Posting failed:");
  await expect(instagram).not.toContainText("Posted");
  await expect(instagram.getByRole("button", { name: "Post now" })).toBeVisible();
});

test("the owner switches on posting within their rules, sets its limits, and switches it off (D870 S3.3)", async ({ page }) => {
  await page.goto(`/admin/${SLUG}/social`);
  const rules = page.getByRole("region", { name: "Post on its own within my rules" });
  await expect(rules).toContainText("Off: every post waits for your yes.");
  await rules.getByRole("switch", { name: "Switch on posting within my rules" }).click();
  await expect(rules).toContainText("On: a post whose picture passed the check goes out on its day without asking, at most 1 a day on each channel and never between 21:00 and 08:00.");
  await expect(rules.getByRole("switch", { name: "Switch off posting within my rules" })).toHaveAttribute("aria-checked", "true");

  // Lisa's limits, under Customise.
  await rules.getByText("Customise").click();
  await rules.getByLabel("Posts a day on each channel").selectOption("2");
  await rules.getByLabel("Quiet from").selectOption("22");
  await rules.getByRole("button", { name: "Save the rules" }).click();
  await expect(rules).toContainText("at most 2 a day on each channel and never between 22:00 and 08:00.");
  await rules.scrollIntoViewIfNeeded();
  await rules.screenshot({ path: "test-results/social-rules-on.png" });

  await rules.getByRole("switch", { name: "Switch off posting within my rules" }).click();
  await expect(rules).toContainText("Off: every post waits for your yes.");
});
