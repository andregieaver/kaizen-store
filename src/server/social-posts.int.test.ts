import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

import type { Membership } from "./auth";

type Row = Record<string, unknown>;

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));

process.env.SETTINGS_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString("base64");

const { writeSocialPosts, listSocialPosts, markSocialPostCopied, socialProducts, socialPages } = await import("./social-posts");
const { getStore } = await import("./stores");
const { encryptSecret, parseKey } = await import("@/lib/secret-box");

/** The social post creator (D870 C1) against the demo store, with the model's answer handed in (`complete`). */

const run = Date.now().toString(36);
let member: Membership;
let productId: string;
let productTitle: string;

const answer = (posts: unknown) => async () => ({ content: JSON.stringify({ posts }), toolCalls: [] });

beforeAll(async () => {
  const store = (await getStore("demo"))!;
  const [account] = await db().execute<Row>(sql`insert into commerce.accounts (email, name) values (${`social-${run}@example.com`}, 'Social') returning id, email, name`);
  member = { account: { id: String(account.id), email: String(account.email), name: String(account.name) }, store, role: "owner" } as unknown as Membership;
  await db().execute(sql`delete from commerce.ai_providers where store_id = ${store.id}::uuid`);
  await db().execute(sql`
    insert into commerce.ai_providers (store_id, provider, api_key_encrypted, api_key_hint, enabled, text_model)
    values (${store.id}::uuid, 'openai', ${encryptSecret("sk-test", parseKey(process.env.SETTINGS_ENCRYPTION_KEY)!)}, 'test', true, 'text-a')`);
  const products = await socialProducts(store);
  expect(products.length).toBeGreaterThan(0);
  productId = products[0].id;
  productTitle = products[0].title;
}, 60_000);

afterAll(async () => {
  await db().execute(sql`delete from commerce.social_posts where store_id = ${member.store.id}::uuid`);
  await db().execute(sql`delete from commerce.ai_providers where store_id = ${member.store.id}::uuid`);
  await closeDb();
});

describe("the social post creator", () => {
  it("writes a post per channel about a product, with code's price line and one tagged link per channel, and keeps them", async () => {
    const result = await writeSocialPosts(
      member,
      { productId, channels: ["instagram", "facebook"], campaign: "Spring" },
      {
        ref: "abcdef123456",
        complete: answer([
          { channel: "instagram", caption: "Slow mornings start here.", hashtags: ["#mugs", "coffee"] },
          { channel: "facebook", caption: "Meet our favourite for slow mornings.", hashtags: [] },
        ]),
      },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const [ig, fb] = result.posts;
    expect(ig).toMatchObject({ channel: "instagram", ref: "abcdef123456", caption: "Slow mornings start here.", hashtags: ["mugs", "coffee"] });
    expect(ig.link).toContain("utm_source=instagram&utm_medium=social&utm_campaign=spring&utm_content=p-abcdef123456");
    expect(fb.link).toContain("utm_source=facebook");
    expect(ig.priceLine).toMatch(new RegExp(`^${productTitle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} · .*\\d`));
    // Instagram opens no link in a caption, so it is copied apart; Facebook's goes in the text.
    expect(ig.text).not.toContain("http");
    expect(fb.text).toContain(fb.link);
    expect(ig.text.endsWith("#mugs #coffee")).toBe(true);

    const listed = await listSocialPosts(member.store.id);
    expect(listed.filter((p) => p.ref === "abcdef123456").map((p) => p.channel).sort()).toEqual(["facebook", "instagram"]);
  });

  it("writes from the owner's topic alone, with no price, linking to the shop's front page", async () => {
    const result = await writeSocialPosts(
      member,
      { topic: "We are open late on Thursdays before Christmas", channels: ["linkedin"] },
      { complete: answer([{ channel: "linkedin", caption: "Late opening on Thursdays in December.", hashtags: ["christmas"] }]) },
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.posts[0]).toMatchObject({ productId: null, priceLine: null });
  });

  it("writes about a page of the site, linking to it, with no price (C1b: Kaizena Flow's own site has pages, not products)", async () => {
    const [page] = await socialPages(member.store);
    expect(page).toBeDefined();
    const result = await writeSocialPosts(
      member,
      { pageId: page.id, channels: ["linkedin"] },
      { complete: answer([{ channel: "linkedin", caption: "Everything you need to start selling, in one place.", hashtags: ["ecommerce"] }]) },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.posts[0]).toMatchObject({ pageId: page.id, productId: null, priceLine: null });
    expect(result.posts[0].link).toContain("utm_source=linkedin");
    expect(await writeSocialPosts(member, { pageId: page.id, productId, channels: ["linkedin"] })).toEqual({ ok: false, problem: "Choose a product or a page, not both." });
  });

  it("keeps nothing when the AI writes a price or urgency", async () => {
    const before = (await listSocialPosts(member.store.id)).length;
    const result = await writeSocialPosts(
      member,
      { productId, channels: ["tiktok"] },
      { complete: answer([{ channel: "tiktok", caption: "Only 199 kr, last chance!", hashtags: [] }]) },
    );
    expect(result).toMatchObject({ ok: false });
    expect((await listSocialPosts(member.store.id)).length).toBe(before);
  });

  it("refuses without a product or a topic, without a channel, and for a product of another store", async () => {
    expect(await writeSocialPosts(member, { channels: ["instagram"] })).toEqual({ ok: false, problem: "Choose a product or a page, or say in a few words what the post is about." });
    expect(await writeSocialPosts(member, { productId, channels: [] })).toEqual({ ok: false, problem: "Choose at least one channel." });
    expect(await writeSocialPosts(member, { productId: "00000000-0000-4000-8000-000000000000", channels: ["instagram"] })).toMatchObject({ ok: false });
  });

  it("notes the first copy, only of the store's own post", async () => {
    const [post] = await listSocialPosts(member.store.id);
    expect(await markSocialPostCopied(member, post.id)).toBe(true);
    const [again] = (await listSocialPosts(member.store.id)).filter((p) => p.id === post.id);
    expect(again.copiedAt).not.toBeNull();
    expect(await markSocialPostCopied(member, "00000000-0000-4000-8000-000000000000")).toBe(false);
  });
});

describe("a social post's picture (D870 C2)", () => {
  it("is drawn in the channel's shape, with the product's photo read from the store's own files only", async () => {
    const { socialPicture } = await import("./social-pictures");
    const sharp = (await import("sharp")).default;
    const posts = await listSocialPosts(member.store.id);
    const ig = posts.find((p) => p.channel === "instagram" && p.productId)!;
    const asked: string[] = [];
    const fakeFetch = (async (url: URL | string) => {
      asked.push(String(url));
      const png = await sharp({ create: { width: 40, height: 40, channels: 3, background: "#c0ffee" } }).png().toBuffer();
      return new Response(new Uint8Array(png), { status: 200 });
    }) as typeof fetch;
    // Google Fonts is not asked in tests: without the store's fonts the picture is drawn in next/og's own.
    const noFonts = (async () => new Response("", { status: 503 })) as typeof fetch;
    const result = await socialPicture(member, ig.id, "http://localhost:3000", { fetch: fakeFetch, fontFetch: noFonts });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.fileName).toBe(`instagram-${ig.ref}-4x5.png`);
    const meta = await sharp(Buffer.from(await result.response.arrayBuffer())).metadata();
    expect([meta.width, meta.height]).toEqual([1080, 1350]);
    expect(asked.every((u) => u.startsWith("http://localhost:3000/") || u.includes("/storage/v1/object/public/"))).toBe(true);

    const topic = posts.find((p) => p.channel === "linkedin" && !p.productId)!;
    const drawn = await socialPicture(member, topic.id, "http://localhost:3000", { fetch: fakeFetch, fontFetch: noFonts });
    expect(drawn.ok && (await sharp(Buffer.from(await drawn.response.arrayBuffer())).metadata()).width).toBe(1200);

    expect((await socialPicture(member, "00000000-0000-4000-8000-000000000000", "http://localhost:3000")).ok).toBe(false);
  }, 60_000);
});
