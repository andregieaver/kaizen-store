import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

type Row = Record<string, unknown>;

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));

const { gatherSocialFacts } = await import("./social-facts");
const { getStore } = await import("./stores");

/**
 * The adviser's facts as the server gathers them (D870 S1.3), against a store made for the test: with nothing yet, then with a product
 * sold, its stock, a post written and copied, and an Instagram account's figures. The arithmetic is held by `social-facts.test.ts`; this
 * holds that every source is read and joined.
 */

const run = Date.now().toString(36);
let slug: string;
let storeId: string;
let accountId: string;

beforeAll(async () => {
  slug = `facts-${run}`;
  const [request] = await db().execute<Row>(sql`insert into commerce.access_requests (email, name, store_name) values (${`${slug}@example.com`}, 'Test', 'Facts') returning id`);
  const [created] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${slug}, 'Facts', null) as id`);
  storeId = String(created.id);
  const [account] = await db().execute<Row>(sql`insert into commerce.accounts (email, name) values (${`facts-owner-${run}@example.com`}, 'Facts') returning id`);
  accountId = String(account.id);
}, 60_000);

afterAll(async () => {
  await db().execute(sql`delete from commerce.instagram_accounts where store_id = ${storeId}::uuid`);
  await closeDb();
});

describe("the adviser's facts, gathered", () => {
  it("are whole for a store with no sales, no posts and no Instagram", async () => {
    const store = (await getStore(slug))!;
    const facts = await gatherSocialFacts(store, accountId);
    expect(facts.sales).toMatchObject({ days: 28, revenueMinor: 0, orders: 0, revenueChange: null });
    expect(facts.creator).toEqual({ written: 0, copied: 0 });
    expect(facts.instagram).toEqual({ state: "none" });
    expect(facts.taggedPosts).toEqual([]);
    expect(facts.goals).toEqual([]);
  });

  it("join the store's products and stock, the creator's posts and the Instagram figures", async () => {
    const store = (await getStore(slug))!;
    // The store's seeded products, with stock on one of them; a post written and copied; an account with two posts' figures.
    const [variant] = await db().execute<Row>(sql`
      select v.id, v.product_id from commerce.product_variants v join commerce.products p on p.id = v.product_id
      where v.store_id = ${storeId}::uuid and p.status = 'active' limit 1`);
    if (variant) {
      const [location] = await db().execute<Row>(sql`select id from commerce.inventory_locations where store_id = ${storeId}::uuid limit 1`);
      if (location) {
        await db().execute(sql`
          insert into commerce.inventory_levels (store_id, variant_id, location_id, on_hand) values (${storeId}::uuid, ${String(variant.id)}::uuid, ${String(location.id)}::uuid, 40)
          on conflict (variant_id, location_id) do update set on_hand = 40`);
      }
    }
    await db().execute(sql`
      insert into commerce.social_posts (store_id, channel, ref, topic, locale, caption, link, copied_at)
      values (${storeId}::uuid, 'instagram', 'factsfacts01', 'x', 'nb-NO', 'Hello', 'https://example.com', now()),
             (${storeId}::uuid, 'facebook', 'factsfacts01', 'x', 'nb-NO', 'Hello', 'https://example.com', null),
             (${storeId}::uuid, 'facebook', 'factsfacts02', 'x', 'nb-NO', 'Hello', 'https://example.com', null)`);
    const [ig] = await db().execute<Row>(sql`
      insert into commerce.instagram_accounts (store_id, ig_user_id, username, token_encrypted, token_expires_at, insights, insights_fetched_at)
      values (${storeId}::uuid, '17841400000000009', 'facts', 'x', now() + interval '30 days', true, now()) returning id`);
    await db().execute(sql`
      insert into commerce.social_post_insights (account_id, store_id, media_id, kind, posted_at, caption, reach, saves)
      values (${String(ig.id)}::uuid, ${storeId}::uuid, '9001', 'feed', now() - interval '3 days', 'One', 900, 9),
             (${String(ig.id)}::uuid, ${storeId}::uuid, '9002', 'reel', now() - interval '10 days', 'Two', 3000, 30)`);

    const facts = await gatherSocialFacts(store, accountId);
    expect(facts.creator).toEqual({ written: 2, copied: 1 });
    expect(facts.instagram).toMatchObject({ state: "ready", username: "facts", posts: 2, daysSinceLastPost: 3, savesPer100Reach: 1 });
    // Nothing sold in 28 days, so nothing is pushed; a seeded product made today is new, with its stock (the 40 added, and the seed's).
    expect(facts.push).toEqual([]);
    if (variant) expect(facts.newProducts.find((p) => p.id === String(variant.product_id))?.stock).toBeGreaterThanOrEqual(40);
  });
});
