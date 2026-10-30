import { randomBytes } from "node:crypto";

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import type { BroadcastContent } from "@/lib/broadcasts";
import { formatMoney } from "@/lib/money";
import { unframe } from "@/lib/prompt-safety";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("./ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./ai")>()),
  aiFor: async () => ({ textModel: "m", provider: "openai", source: "platform", apiUrl: "https://ai.example", apiKey: "k", space: null }),
}));

const bc = await import("./broadcasts");
const facts = await import("./broadcast-facts");
const ownerTools = await import("./owner-tools");
const { storeById } = await import("./shopper-emails");
const { newStore } = await import("./inventory-test-support");

type Row = Record<string, unknown>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Answer = Record<string, any>;

/**
 * Marketing email from the store's own facts (wave 8 unit H, D352): a product block is drawn for each recipient's market by code (Norway in
 * NOK, Finland in euro), a product the market does not sell is left out, a campaign's offer is the shop's words, and the writer keeps only
 * the products and campaigns its tools handed it.
 */

let store: Awaited<ReturnType<typeof newStore>>;
let productId = "";
let handle = "";
let campaignId = "";
const FI_PRICE = 2_490;

beforeAll(async () => {
  store = await newStore("bfacts");
  delete process.env.RESEND_API_KEY;
  await db().execute(sql`update commerce.stores set status = 'active', locales = array['nb-NO', 'en-GB'] where id = ${store.storeId}::uuid`);
  // Finland, sold in euro: one product priced there, the rest not sold there.
  await db().execute(sql`
    insert into commerce.markets (store_id, code, currency, default_locale, locales, active) values (${store.storeId}::uuid, 'FI', 'EUR', 'en-GB', array['en-GB'], true)
  `);
  const [product] = await db().execute<Row>(sql`
    select p.id, p.handle from commerce.products p
    where p.store_id = ${store.storeId}::uuid and p.status = 'active' and p.kind = 'goods'
      and exists (select 1 from commerce.current_prices cp join commerce.product_variants v on v.id = cp.variant_id where v.product_id = p.id and cp.market_code = 'NO')
    order by p.handle limit 1
  `);
  productId = String(product.id);
  handle = String(product.handle);
  const variants = await db().execute<Row>(sql`select id from commerce.product_variants where product_id = ${productId}::uuid and active`);
  for (const v of variants) await db().execute(sql`select commerce.set_price(${String(v.id)}::uuid, 'FI', ${FI_PRICE}, now())`);
  const ctx = { account: store.member.account, store: store.member.store, invalidate: () => {} };
  const made = (await ownerTools.runOwnerTool(ctx, "create_campaign", { name: "Autumn days", kind: "percent", percent: 15, ends_on: "2099-01-31" })) as Answer;
  expect(made.done).toEqual(expect.any(String));
  const [campaign] = await db().execute<Row>(sql`select id from commerce.campaigns where store_id = ${store.storeId}::uuid and name = 'Autumn days'`);
  campaignId = String(campaign.id);
}, 120_000);

afterAll(async () => {
  await closeDb();
});

const content = (): BroadcastContent => ({
  "nb-NO": {
    subject: "Nyheter",
    preview: "",
    blocks: [
      { type: "heading", text: "Høst" },
      { type: "product", product: productId, handle, label: "Product" },
      { type: "campaign", campaign: campaignId, label: "Autumn days" },
    ],
  },
});

describe("a product and a campaign drawn by code for each market", () => {
  it("writes the price as the store shows it in Norway, and in euro in Finland, with the campaign's offer in the shop's words", async () => {
    const emailStore = (await storeById(store.storeId))!;
    const no = await facts.emailFactsFor(emailStore, content(), "NO", "nb-NO");
    const fi = await facts.emailFactsFor(emailStore, content(), "FI", "en-GB");
    const [noPrice] = await db().execute<Row>(sql`
      select min(cp.amount_minor)::int as amount from commerce.current_prices cp join commerce.product_variants v on v.id = cp.variant_id
      where v.product_id = ${productId}::uuid and cp.market_code = 'NO'
    `);
    expect(no.products.get(productId)?.price).toContain(formatMoney(Number(noPrice.amount), "NOK", "nb-NO"));
    expect(fi.products.get(productId)?.price).toContain(formatMoney(FI_PRICE, "EUR", "en-GB"));
    expect(fi.products.get(productId)?.small.length).toBeGreaterThan(0);
    expect(no.campaigns.get(campaignId)).toMatchObject({ title: "Autumn days", text: expect.stringContaining("15") });
    expect(no.linkText).toBe("Se produktet");
  });

  it("sends each subscriber their market's price, and leaves out a product their market does not sell", async () => {
    const emailStore = (await storeById(store.storeId))!;
    const other = await db().execute<Row>(sql`
      select p.id, p.handle from commerce.products p where p.store_id = ${store.storeId}::uuid and p.status = 'active' and p.kind = 'goods' and p.id <> ${productId}::uuid
        and exists (select 1 from commerce.current_prices cp join commerce.product_variants v on v.id = cp.variant_id where v.product_id = p.id and cp.market_code = 'NO')
      limit 1
    `);
    const body = content();
    body["nb-NO"].blocks.push({ type: "product", product: String(other[0].id), handle: String(other[0].handle), label: "Not in Finland" });
    const saved = await bc.saveBroadcast(emailStore, store.accountId, null, { title: "Facts", audience: "everyone", segmentId: null, content: body });
    if (!saved.ok) throw new Error(saved.problem);
    for (const [email, market] of [
      [`no-${store.slug}@example.com`, "NO"],
      [`fi-${store.slug}@example.com`, "FI"],
    ]) {
      await db().execute(sql`
        insert into commerce.marketing_subscribers (store_id, email, locale, market_code, status, source, consent_text, consented_at, token)
        values (${store.storeId}::uuid, ${email}, 'nb-NO', ${market}, 'subscribed', 'account', 'Yes please', now(), ${randomBytes(32).toString("base64url")})
      `);
    }
    expect(await bc.startBroadcast(store.storeId, store.accountId, saved.id)).toMatchObject({ ok: true, recipients: 2 });
    await bc.runBroadcasts({ only: saved.id, pace: 0 });
    const sent = await db().execute<Row>(sql`select to_address, html from commerce.email_messages where idempotency_key like ${`broadcast:${saved.id}:%`}`);
    const html = (who: string) => String(sent.find((row) => String(row.to_address).startsWith(who))?.html ?? "");
    expect(html("fi-")).toContain(formatMoney(FI_PRICE, "EUR", "nb-NO"));
    expect(html("fi-")).not.toContain("NOK");
    expect(html("no-")).toContain("kr");
    // The product Finland does not sell is in Norway's email only.
    const otherTitle = String((await db().execute<Row>(sql`select title from commerce.product_translations where product_id = ${String(other[0].id)}::uuid and locale = 'nb-NO'`))[0].title);
    expect(html("no-")).toContain(otherTitle.replace(/&/g, "&amp;"));
    expect(html("fi-")).not.toContain(otherTitle.replace(/&/g, "&amp;"));
    // The campaign's offer, in both.
    expect(html("fi-")).toContain("15");
    // The product's link is a click address that leads to its page.
    expect(await bc.recordClick(saved.id, "nb-NO.1", "fi")).toContain(`/p/${handle}`);
  }, 60_000);
});

describe("the writer's tools", () => {
  it("hands the model the store's products and campaigns, and keeps only the ids it handed", async () => {
    const asked: string[] = [];
    let round = 0;
    const complete = (async (_c: unknown, messages: { role: string; content: string | null }[], tools: { name: string }[]) => {
      round += 1;
      if (round === 1) {
        asked.push(messages[0].content ?? "");
        expect(tools.map((t) => t.name)).toEqual(["find_products", "running_campaigns"]);
        return {
          content: null,
          toolCalls: [
            { id: "a", type: "function", function: { name: "find_products", arguments: "{}" } },
            { id: "b", type: "function", function: { name: "running_campaigns", arguments: "{}" } },
          ],
        };
      }
      const handed = messages.filter((m) => m.role === "tool").map((m) => unframe(m.content ?? ""));
      expect(handed.join(" ")).toContain(productId);
      expect(handed.join(" ")).toContain(campaignId);
      return {
        content: JSON.stringify({
          subject: "Autumn",
          preview: "",
          heading: "Warm days",
          paragraphs: ["A few things we like this month."],
          button: "",
          products: [productId, "11111111-1111-4111-8111-111111111111"],
          campaigns: [campaignId],
        }),
        toolCalls: [],
      };
    }) as never;
    const emailStore = (await storeById(store.storeId))!;
    const result = await bc.suggestBroadcast(emailStore, store.accountId, "Our autumn favourites", "nb-NO", { complete });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.suggestion.products.map((p) => p.id)).toEqual([productId]);
    expect(result.suggestion.campaigns.map((c) => c.id)).toEqual([campaignId]);
    expect(asked[0]).toContain("everyone on the shop's list");

    // A price in the model's own words is refused, whatever it chose.
    round = 1;
    const priced = (async () => ({
      content: JSON.stringify({ subject: "Autumn", heading: "Warm days", paragraphs: ["Now only kr 99, 20 % off."], products: [], campaigns: [] }),
      toolCalls: [],
    })) as never;
    expect(await bc.suggestBroadcast(emailStore, store.accountId, "Our autumn favourites", "nb-NO", { complete: priced })).toMatchObject({ ok: false });
  });
});
