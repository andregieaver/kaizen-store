import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { toMarket } from "@/lib/markets";

import type { Membership } from "./auth";
import type { Store } from "./stores";

type Row = Record<string, unknown>;

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
// The admin's pages ask who is signed in: here, this store's owner.
const signedIn = vi.hoisted(() => ({ member: null as unknown }));
vi.mock("./auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./auth")>()),
  requireMember: async () => signedIn.member,
  getMembership: async () => signedIn.member,
}));

const campaigns = await import("./campaigns");

/**
 * A store's campaigns (D114): what the admin may save, when a campaign runs,
 * and what the cart and checkout look up. The whole way from the cart to a
 * paid order is held in `checkout-kinds.int.test.ts`.
 */

const run = Date.now().toString(36);
const slug = `campaigns-${run}`;
const no = toMarket({ code: "NO", currency: "NOK", defaultLocale: "nb-NO" });
let storeId: string;
let member: Membership;
let mug: { product: string; variant: string };
let notebook: { product: string; variant: string };

beforeAll(async () => {
  const [request] = await db().execute<Row>(sql`insert into commerce.access_requests (email, name, store_name) values (${`${slug}@example.com`}, 'K', 'Kampanje') returning id`);
  const [store] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${slug}, 'Kampanje', null) as id`);
  storeId = String(store.id);
  const [owner] = await db().execute<Row>(sql`select id, email from commerce.accounts where email = ${`${slug}@example.com`}`);
  member = {
    account: { id: String(owner.id), email: String(owner.email), name: "K", platformAdmin: false },
    role: "owner",
    store: { id: storeId, slug, markets: [no] } as unknown as Store,
  };
  signedIn.member = member;
  const find = async (sku: string) => {
    const [row] = await db().execute<Row>(sql`select v.id as variant, v.product_id as product from commerce.product_variants v where v.store_id = ${storeId}::uuid and v.sku = ${sku}`);
    return { product: String(row.product), variant: String(row.variant) };
  };
  mug = await find("DEMO-MUG-WHITE");
  notebook = await find("DEMO-NOTEBOOK-LINED");
});

afterAll(async () => {
  await closeDb();
});

const save = (input: Record<string, unknown>, id: string | null = null) => campaigns.saveCampaign(member, id, input);

describe("saving a campaign", () => {
  it("takes each kind, with what it reaches and when it runs", async () => {
    const percent = await save({ name: "Summer", kind: "percent", percent: "20", scope: "some", productIds: [mug.product], startsAt: "2026-06-01T00:00", endsAt: "2026-06-30T23:59" });
    expect(percent).toMatchObject({ ok: true });
    const multi = await save({ name: "3 for 2", kind: "multi_buy", buyQuantity: 3, payQuantity: 2 });
    expect(multi).toMatchObject({ ok: true });
    const gift = await save({ name: "Free notebook", kind: "gift", giftVariantId: notebook.variant, giftQuantity: 1, thresholds: { NO: "500" } });
    expect(gift).toMatchObject({ ok: true });

    const [saved] = (await campaigns.listCampaigns(storeId)).filter((c) => c.name === "Free notebook");
    expect(saved).toMatchObject({ kind: "gift", thresholds: { NO: 50000 }, giftVariantId: notebook.variant, percent: 0, buyQuantity: 0 });
    expect(saved.giftTitle).toBeTruthy();
    const summer = (await campaigns.listCampaigns(storeId)).find((c) => c.name === "Summer")!;
    // Norwegian time, summer time: midnight on 1 June is 22:00 UTC the evening before.
    expect(summer.startsAt).toBe("2026-05-31T22:00:00.000Z");
    expect(summer.productIds).toEqual([mug.product]);
  });

  it("refuses what makes no sense, and says why", async () => {
    expect(await save({ name: "", kind: "percent" })).toMatchObject({ ok: false });
    expect(await save({ name: "Bad", kind: "multi_buy", buyQuantity: 2, payQuantity: 2 })).toMatchObject({ ok: false });
    expect(await save({ name: "No amount", kind: "gift", giftVariantId: notebook.variant })).toMatchObject({ ok: false, problems: [expect.stringContaining("basket must come to")] });
    expect(await save({ name: "Bad amount", kind: "gift", giftVariantId: notebook.variant, thresholds: { NO: "abc" } })).toMatchObject({ ok: false });
    expect(await save({ name: "Ghost", kind: "percent", percent: 10, scope: "some", productIds: [crypto.randomUUID()] })).toMatchObject({ ok: false, problems: [expect.stringContaining("no longer exists")] });
    expect(await save({ name: "Ghost tag", kind: "percent", percent: 10, scope: "some", termIds: [crypto.randomUUID()] })).toMatchObject({ ok: false });
    expect(await save({ name: "Ghost gift", kind: "gift", giftVariantId: crypto.randomUUID(), thresholds: { NO: "10" } })).toMatchObject({ ok: false });
    // A download cannot be given: it needs the shopper's consent, and the order may not ship.
    await db().execute(sql`update commerce.product_variants set delivery = 'digital' where id = ${mug.variant}::uuid`);
    expect(await save({ name: "Digital", kind: "gift", giftVariantId: mug.variant, thresholds: { NO: "10" } })).toMatchObject({ ok: false, problems: [expect.stringContaining("goods you ship")] });
    await db().execute(sql`update commerce.product_variants set delivery = 'physical' where id = ${mug.variant}::uuid`);
    expect(await save({ name: "Missing", kind: "percent", percent: 10 }, crypto.randomUUID())).toMatchObject({ ok: false });
  });

  it("keeps a limit on orders, customer groups and stacking, and checks the groups are the store's", async () => {
    const [tier] = await db().execute<Row>(sql`insert into commerce.customer_tiers (store_id, name, percent) values (${storeId}::uuid, 'Grossist', 10) returning id`);
    const tierId = String(tier.id);
    const made = await save({ name: "Limited", kind: "percent", percent: 5, usageLimit: "25", tierIds: [tierId], stacks: true });
    if (!made.ok || !made.id) throw new Error("not saved");
    expect(await campaigns.getCampaign(storeId, made.id)).toMatchObject({ usageLimit: 25, tierIds: [tierId], stacks: true });
    expect(await save({ name: "Ghost group", kind: "percent", percent: 5, tierIds: [crypto.randomUUID()] })).toMatchObject({ ok: false, problems: [expect.stringContaining("customer group")] });
    // A "buy N pay for M" can stack too; a free product cannot.
    expect(await save({ name: "Stacked deal", kind: "multi_buy", buyQuantity: 3, payQuantity: 2, stacks: true })).toMatchObject({ ok: true });
    expect(await save({ name: "None", kind: "percent", percent: 5, usageLimit: 0 })).toMatchObject({ ok: false });
    // Once per customer, in the countries named; a country the store does not sell to is refused.
    const each = await save({ name: "Each", kind: "multi_buy", buyQuantity: 3, payQuantity: 2, perCustomerLimit: "1", markets: ["NO"], stacks: true });
    if (!each.ok || !each.id) throw new Error("not saved");
    // Every country the store sells to is the same as none.
    expect(await campaigns.getCampaign(storeId, each.id)).toMatchObject({ perCustomerLimit: 1, markets: [], stacks: true, kind: "multi_buy" });
    expect(await save({ name: "Abroad", kind: "percent", percent: 5, markets: ["FR"] })).toMatchObject({ ok: false, problems: [expect.stringContaining("does not sell to FR")] });
    expect(await save({ name: "Gift stacks", kind: "gift", giftVariantId: notebook.variant, thresholds: { NO: "10" }, stacks: true })).toMatchObject({ ok: false });
    // Changed back to no limit, everyone, and no stacking.
    expect(await save({ name: "Open", kind: "percent", percent: 5, usageLimit: "", tierIds: [] }, made.id)).toMatchObject({ ok: true });
    expect(await campaigns.getCampaign(storeId, made.id)).toMatchObject({ usageLimit: null, tierIds: [], stacks: false });
    // The database keeps a gift from stacking too, and a limit above nothing.
    await expect(db().execute(sql`insert into commerce.campaigns (store_id, name, kind, gift_variant_id, stacks) values (${storeId}::uuid, 'y', 'gift', ${notebook.variant}::uuid, true)`)).rejects.toThrow();
    await expect(db().execute(sql`insert into commerce.campaigns (store_id, name, kind, percent, per_customer_limit) values (${storeId}::uuid, 'w', 'percent', 5, 0)`)).rejects.toThrow();
    await expect(db().execute(sql`insert into commerce.campaigns (store_id, name, kind, percent, usage_limit) values (${storeId}::uuid, 'z', 'percent', 5, 0)`)).rejects.toThrow();
  });

  it("refuses what the database would: a gift is a gift and a percentage is a percentage", async () => {
    await expect(db().execute(sql`insert into commerce.campaigns (store_id, name, kind, percent) values (${storeId}::uuid, 'x', 'percent', 0)`)).rejects.toThrow();
    await expect(db().execute(sql`insert into commerce.campaigns (store_id, name, kind) values (${storeId}::uuid, 'x', 'gift')`)).rejects.toThrow();
    await expect(db().execute(sql`insert into commerce.campaigns (store_id, name, kind, buy_quantity, pay_quantity) values (${storeId}::uuid, 'x', 'multi_buy', 3, 3)`)).rejects.toThrow();
    await expect(db().execute(sql`insert into commerce.campaigns (store_id, name, kind, percent) values (${storeId}::uuid, 'x', 'sale', 5)`)).rejects.toThrow();
  });

  it("changes one, and orders placed earlier are left as they were", async () => {
    const made = await save({ name: "Changing", kind: "percent", percent: 10 });
    if (!made.ok || !made.id) throw new Error("not saved");
    expect(await save({ name: "Changed", kind: "multi_buy", buyQuantity: 4, payQuantity: 3 }, made.id)).toMatchObject({ ok: true, id: made.id });
    expect(await campaigns.getCampaign(storeId, made.id)).toMatchObject({ name: "Changed", kind: "multi_buy", percent: 0, buyQuantity: 4, payQuantity: 3 });
    expect(await campaigns.setCampaignActive(member, made.id, false)).toEqual({ ok: true });
    expect((await campaigns.getCampaign(storeId, made.id))?.active).toBe(false);
    expect(await campaigns.deleteCampaign(member, made.id)).toEqual({ ok: true });
    expect(await campaigns.getCampaign(storeId, made.id)).toBeNull();
    expect(await campaigns.setCampaignActive(member, made.id, true)).toMatchObject({ ok: false });
  });
});

describe("what runs", () => {
  it("is what is switched on and within its dates, with amounts in the currency shown", async () => {
    await db().execute(sql`delete from commerce.campaigns where store_id = ${storeId}::uuid`);
    const past = new Date(Date.now() - 86_400_000).toISOString();
    const future = new Date(Date.now() + 86_400_000).toISOString();
    const insert = (name: string, active: boolean, starts: string | null, ends: string | null) =>
      db().execute(sql`
        insert into commerce.campaigns (store_id, name, kind, percent, active, starts_at, ends_at)
        values (${storeId}::uuid, ${name}, 'percent', 10, ${active}, ${starts}::timestamptz, ${ends}::timestamptz)
      `);
    await insert("now", true, past, future);
    await insert("open", true, null, null);
    await insert("off", false, null, null);
    await insert("later", true, future, null);
    await insert("over", true, null, past);
    const running = await campaigns.runningCampaigns(db(), storeId, no);
    expect(running.map((c) => c.name).sort()).toEqual(["now", "open"]);
    // The list says where each stands, whatever its dates.
    expect((await campaigns.listCampaigns(storeId)).map((c) => c.name).sort()).toEqual(["later", "now", "off", "open", "over"]);
  });
});

describe("what the basket earns", () => {
  it("gives a free product only to an order that ships, from stock, never a download or a host's listing", async () => {
    await db().execute(sql`delete from commerce.campaigns where store_id = ${storeId}::uuid`);
    const made = await save({ name: "Gift", kind: "gift", giftVariantId: notebook.variant, thresholds: { NO: "1" } });
    if (!made.ok) throw new Error(made.problems.join(" "));
    const line = { key: "0", productId: mug.product, unitMinor: 38000, quantity: 1, discountable: true, valueMinor: 38000 };
    const ships = await campaigns.evaluateCampaigns(db(), { storeId, market: no }, [line], { ships: true });
    expect(ships.gifts).toMatchObject([{ variantId: notebook.variant, quantity: 1, campaignName: "Gift" }]);
    // Nothing to ship: no gift to add.
    expect((await campaigns.evaluateCampaigns(db(), { storeId, market: no }, [line], { ships: false })).gifts).toEqual([]);
    // Out of stock: none.
    await db().execute(sql`update commerce.inventory_levels set on_hand = 0 where store_id = ${storeId}::uuid and variant_id = ${notebook.variant}::uuid`);
    expect((await campaigns.evaluateCampaigns(db(), { storeId, market: no }, [line], { ships: true })).gifts).toEqual([]);
    await db().execute(sql`update commerce.inventory_levels set on_hand = 10 where store_id = ${storeId}::uuid and variant_id = ${notebook.variant}::uuid`);
    expect((await campaigns.evaluateCampaigns(db(), { storeId, market: no }, [line], { ships: true })).gifts).toHaveLength(1);
    // A host's listing is paid to the host: no gift from the store goes with it.
    const [host] = await db().execute<Row>(sql`insert into commerce.hosts (store_id, account_id, name) values (${storeId}::uuid, ${member.account.id}::uuid, 'Host') returning id`);
    await db().execute(sql`update commerce.products set host_id = ${String(host.id)}::uuid where id = ${mug.product}::uuid`);
    expect((await campaigns.evaluateCampaigns(db(), { storeId, market: no }, [line], { ships: true })).gifts).toEqual([]);
    await db().execute(sql`update commerce.products set host_id = null where id = ${mug.product}::uuid`);
  });

  it("never gives a product that keeps selling past zero (a gift is not backordered), whatever its policy", async () => {
    await db().execute(sql`delete from commerce.campaigns where store_id = ${storeId}::uuid`);
    const made = await save({ name: "Gift", kind: "gift", giftVariantId: notebook.variant, thresholds: { NO: "1" } });
    if (!made.ok) throw new Error(made.problems.join(" "));
    const line = { key: "0", productId: mug.product, unitMinor: 38000, quantity: 1, discountable: true, valueMinor: 38000 };
    const evaluate = () => campaigns.evaluateCampaigns(db(), { storeId, market: no }, [line], { ships: true });
    await db().execute(sql`update commerce.product_variants set stock_policy = 'continue', backorder_days = 7 where store_id = ${storeId}::uuid and id = ${notebook.variant}::uuid`);
    try {
      // With stock the gift is given; with none it is not, though the product keeps selling.
      expect((await evaluate()).gifts).toHaveLength(1);
      await db().execute(sql`update commerce.inventory_levels set on_hand = 0 where store_id = ${storeId}::uuid and variant_id = ${notebook.variant}::uuid`);
      expect((await evaluate()).gifts).toEqual([]);
    } finally {
      await db().execute(sql`update commerce.product_variants set stock_policy = 'deny', backorder_days = null where store_id = ${storeId}::uuid and id = ${notebook.variant}::uuid`);
      await db().execute(sql`update commerce.inventory_levels set on_hand = 10 where store_id = ${storeId}::uuid and variant_id = ${notebook.variant}::uuid`);
    }
  });

  it("reaches a product through its category's parent", async () => {
    await db().execute(sql`delete from commerce.campaigns where store_id = ${storeId}::uuid`);
    const [parent] = await db().execute<Row>(sql`insert into commerce.terms (store_id, content_type, kind, name, slug) values (${storeId}::uuid, 'product', 'category', 'Ting', ${`ting-${run}`}) returning id`);
    const [child] = await db().execute<Row>(sql`insert into commerce.terms (store_id, content_type, kind, parent_id, name, slug) values (${storeId}::uuid, 'product', 'category', ${String(parent.id)}::uuid, 'Underting', ${`under-${run}`}) returning id`);
    await db().execute(sql`insert into commerce.product_terms (store_id, product_id, term_id) values (${storeId}::uuid, ${notebook.product}::uuid, ${String(child.id)}::uuid)`);
    const made = await save({ name: "Things", kind: "percent", percent: 50, scope: "some", termIds: [String(parent.id)] });
    if (!made.ok) throw new Error(made.problems.join(" "));
    const lines = [
      { key: "a", productId: notebook.product, unitMinor: 1000, quantity: 1, discountable: true, valueMinor: 1000 },
      { key: "b", productId: mug.product, unitMinor: 1000, quantity: 1, discountable: true, valueMinor: 1000 },
    ];
    const result = await campaigns.evaluateCampaigns(db(), { storeId, market: no }, lines, { ships: true });
    expect(result.result.lineOff).toEqual({ a: 500 });
  });
});

describe("the admin's pages", () => {
  it("read the list, a campaign and the form's choices without error", async () => {
    await db().execute(sql`delete from commerce.campaigns where store_id = ${storeId}::uuid`);
    const made = await save({ name: "Sida", kind: "gift", giftVariantId: notebook.variant, thresholds: { NO: "300" }, scope: "some", productIds: [mug.product] });
    if (!made.ok || !made.id) throw new Error("not saved");
    const params = Promise.resolve({ store: slug, campaignId: made.id });
    const list = (await import("../app/admin/(gated)/[store]/campaigns/page")).default;
    expect(await list({ params } as never)).toBeTruthy();
    const detail = (await import("../app/admin/(gated)/[store]/campaigns/[campaignId]/page")).default;
    expect(await detail({ params } as never)).toBeTruthy();
    const fresh = (await import("../app/admin/(gated)/[store]/campaigns/new/page")).default;
    expect(await fresh({ params } as never)).toBeTruthy();
    const { CampaignForm } = await import("../app/admin/(gated)/[store]/campaigns/campaign-form");
    const form = (await CampaignForm({ store: member.store, campaign: await campaigns.getCampaign(storeId, made.id) })) as { props: Record<string, unknown> };
    expect(form.props.initial).toMatchObject({ kind: "gift", scope: "some", thresholds: { NO: "300,00" }, giftVariantId: notebook.variant });
    expect((form.props.gifts as { variantId: string }[]).some((g) => g.variantId === notebook.variant)).toBe(true);
    expect((form.props.products as { id: string }[]).some((p) => p.id === mug.product)).toBe(true);
  });
});
