import { randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { t } from "@/lib/i18n";
import type { Market } from "@/lib/markets";
import { DEFAULT_MIX, type RecommendRequest } from "@/lib/recommendations";

type Row = Record<string, unknown>;

/** One browser's cookies, kept between calls as a real browser would. */
const jar = vi.hoisted(() => new Map<string, string>());
/** What the stand-in AI answers: the model's order, as JSON, and how often it was asked. */
const model = vi.hoisted(() => ({ answer: "[]", asked: 0, fail: false, connection: true }));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {} }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    getAll: () => [...jar].map(([name, value]) => ({ name, value })),
    set: (name: string, value: string) => void jar.set(name, value),
    delete: (name: string) => void jar.delete(name),
  }),
}));
vi.mock("./ai", async (original) => ({
  ...(await original<typeof import("./ai")>()),
  aiFor: async () => (model.connection ? ({ textModel: "stand-in", space: null, minSimilarity: 0.5, source: "store" } as never) : null),
  completeText: async () => {
    model.asked += 1;
    if (model.fail) throw new Error("The model is down.");
    return { text: model.answer, region: null };
  },
}));

const recommend = await import("./recommend");
const settings = await import("./recommend-settings");
const events = await import("./recommend-events");
const replay = await import("./recommend-eval");
const stores = await import("./stores");
const shop = await import("./shop");

const run = Date.now().toString(36);
let storeId: string;
let market: Market;
let store: NonNullable<Awaited<ReturnType<typeof stores.getOpenStore>>>;
let accountId: string;
const product: Record<string, string> = {};
const variant: Record<string, string> = {};
const handleOf = new Map<string, string>();
const term: Record<string, string> = {};

const SESSION = "abcdefghijklmnopqrstuvwx";
const request = (over: Partial<RecommendRequest> & { place?: RecommendRequest["place"] } = {}): RecommendRequest => ({
  store: store.slug,
  market: "no",
  session: SESSION,
  place: { kind: "product", productId: product["demo-bordlampe"] },
  block: { limit: 4, mix: { ...DEFAULT_MIX }, explain: true, categories: [], tags: [], tileFields: [] },
  signals: { views: [], searches: [] },
  ...over,
});
const handles = (items: { href: string }[]) => items.map((item) => item.href.split("/p/")[1]);

beforeAll(async () => {
  const [req] = await db().execute<Row>(sql`
    insert into commerce.access_requests (email, name, store_name) values (${`rec-${run}@example.com`}, 'Test', 'Test') returning id
  `);
  const [created] = await db().execute<Row>(sql`
    select commerce.approve_access_request(${String(req.id)}::uuid, ${`rec-${run}`}, 'Test', null) as id
  `);
  storeId = String(created.id);
  const [slug] = await db().execute<Row>(sql`select slug from commerce.stores where id = ${storeId}::uuid`);
  const found = await stores.getOpenStore(String(slug.slug));
  if (!found) throw new Error("The test store is not open.");
  store = found;
  market = shop.marketIn(store, "no")!;
  const [account] = await db().execute<Row>(sql`select id from commerce.accounts limit 1`);
  accountId = String(account.id);
  for (const row of await db().execute<Row>(sql`select id, handle from commerce.products where store_id = ${storeId}::uuid`)) {
    product[String(row.handle)] = String(row.id);
    handleOf.set(String(row.id), String(row.handle));
  }
  for (const row of await db().execute<Row>(sql`
    select v.id, p.handle from commerce.product_variants v join commerce.products p on p.id = v.product_id where p.store_id = ${storeId}::uuid order by v.created_at
  `)) {
    variant[String(row.handle)] ??= String(row.id);
  }
  // The demo lamp is out of stock on purpose; the test sells it.
  await db().execute(sql`
    update commerce.inventory_levels set on_hand = 20
    where store_id = ${storeId}::uuid and variant_id in (select id from commerce.product_variants where product_id = ${product["demo-bordlampe"]}::uuid)
  `);
  for (const row of await db().execute<Row>(sql`select id, slug from commerce.terms where store_id = ${storeId}::uuid and content_type = 'product'`)) {
    term[String(row.slug)] = String(row.id);
  }
});

beforeEach(async () => {
  jar.clear();
  model.answer = "[]";
  model.asked = 0;
  model.fail = false;
  model.connection = true;
  await db().execute(sql`delete from commerce.recommendation_rules where store_id = ${storeId}::uuid`);
  await db().execute(sql`delete from commerce.search_cache where store_id = ${storeId}::uuid and kind = 'rerank'`);
  await db().execute(sql`delete from commerce.ai_usage where store_id = ${storeId}::uuid`);
  await save({ enabled: true, ai: true, holdout: 0, ceiling: 50, cap: "" });
});

afterAll(async () => {
  await closeDb();
});

async function save(s: { enabled: boolean; ai: boolean; holdout: number; ceiling: number; cap: string }) {
  const form = new FormData();
  if (s.enabled) form.set("enabled", "on");
  if (s.ai) form.set("ai", "on");
  form.set("holdoutPercent", String(s.holdout));
  form.set("upsellCeilingPercent", String(s.ceiling));
  form.set("monthlyTokenCap", s.cap);
  const result = await settings.saveRecommendSettings({ id: accountId } as never, storeId, form);
  expect(result).toEqual({ ok: true });
}

let orderNumber = 0;
/** A paid order of these products, from an email or a cart (a device); copied history is written as the store copy does (its lines only under that setting). */
async function order(handlesBought: string[], who: { email?: string; cartId?: string; status?: string; copied?: boolean; daysAgo?: number } = {}) {
  orderNumber += 1;
  return db().transaction(async (tx) => {
    if (who.copied) await tx.execute(sql`select set_config('commerce.copying', 'on', true)`);
    const [o] = await tx.execute<Row>(sql`
      insert into commerce.orders (store_id, number, market_code, currency, locale, email, status, cart_id, subtotal_minor, shipping_minor, tax_minor, total_minor,
        billing_address, shipping_address, placed_at, copied_from)
      values (${storeId}::uuid, ${`${who.copied ? "C-" : ""}${run}-${orderNumber}`}, 'NO', 'NOK', 'nb-NO', ${who.email ?? `anon-${orderNumber}@example.com`},
        ${who.status ?? "paid"}, ${who.cartId ?? null}::uuid, 0, 0, 0, 0, '{}', '{}', now() - make_interval(days => ${who.daysAgo ?? 1}),
        ${who.copied ? randomUUID() : null}::uuid)
      returning id
    `);
    for (const handle of handlesBought) {
      await tx.execute(sql`
        insert into commerce.order_lines (store_id, order_id, variant_id, sku, title, quantity, unit_price_minor, total_minor, tax_minor, tax_rate, tax_code)
        values (${storeId}::uuid, ${String(o.id)}::uuid, ${variant[handle]}::uuid, ${handle}, ${handle}, 1, 10000, 10000, 0, 0.25, 'txcd_99999999')
      `);
    }
    return String(o.id);
  });
}

describe("what is recommended", () => {
  it("is nothing while the store has not switched recommendations on", async () => {
    await save({ enabled: false, ai: true, holdout: 0, ceiling: 50, cap: "" });
    expect((await recommend.recommendFor(store, market, request())).items).toEqual([]);
  });

  it("never offers the product itself, only what is on sale, and says why in the shopper's language", async () => {
    const outcome = await recommend.recommendFor(store, market, request({ block: { ...request().block, limit: 12 } }));
    const shown = handles(outcome.items);
    expect(shown).not.toContain("demo-bordlampe");
    expect(shown.length).toBeGreaterThan(2);
    expect(outcome.items.every((item) => item.price && item.note)).toBe(true);
    expect(outcome.placement).toBe("product");
    await db().execute(sql`update commerce.products set status = 'draft' where id = ${product["demo-handlenett"]}::uuid`);
    try {
      expect(handles((await recommend.recommendFor(store, market, request({ block: { ...request().block, limit: 12 } }))).items)).not.toContain("demo-handlenett");
    } finally {
      await db().execute(sql`update commerce.products set status = 'active' where id = ${product["demo-handlenett"]}::uuid`);
    }
  });

  it("puts what was bought with the product first, as a pairing, from the last year's paid orders only", async () => {
    for (let i = 0; i < 3; i++) await order(["demo-bordlampe", "demo-keramikkopp"]);
    // Not counted: unpaid, copied history, and an order from more than a year ago.
    await order(["demo-bordlampe", "demo-notatbok"], { status: "pending_payment" });
    await order(["demo-bordlampe", "demo-notatbok"], { copied: true });
    await order(["demo-bordlampe", "demo-handlenett"], { daysAgo: 400 });
    const outcome = await recommend.recommendFor(store, market, request());
    expect(handles(outcome.items)[0]).toBe("demo-keramikkopp");
    expect(outcome.items[0].note).toBe(t("nb").recommend.pairs((await recommendTitle("demo-bordlampe"))));
  });

  it("never offers what the shopper has bought: by device, by email, but not bookings, unpaid or copied orders", async () => {
    await order(["demo-bordlampe", "demo-keramikkopp"]);
    const [cart] = await db().execute<Row>(sql`
      insert into commerce.carts (store_id, market_code, currency, locale, expires_at) values (${storeId}::uuid, 'NO', 'NOK', 'nb-NO', now() + interval '7 days') returning id
    `);
    await order(["demo-keramikkopp", "demo-hytte"], { cartId: String(cart.id) });
    jar.set(`cart_${storeId}_no`, String(cart.id));
    const bought = await recommend.purchasedProductIds(storeId, { customerId: null, email: null, cartIds: [String(cart.id)] });
    // The stay is a booking: it is booked again, so it is not "bought".
    expect([...bought].map((id) => handleOf.get(id))).toEqual(["demo-keramikkopp"]);
    expect(handles((await recommend.recommendFor(store, market, request({ block: { ...request().block, limit: 12 } }))).items)).not.toContain("demo-keramikkopp");

    await order(["demo-notatbok"], { email: `Reader-${run}@Example.com` });
    await order(["demo-handlenett"], { email: `reader-${run}@example.com`, status: "pending_payment" });
    await order(["demo-massasje"], { email: `reader-${run}@example.com`, copied: true });
    const byEmail = await recommend.purchasedProductIds(storeId, { customerId: null, email: `reader-${run}@example.com`, cartIds: [] });
    expect([...byEmail].map((id) => handleOf.get(id))).toEqual(["demo-notatbok"]);
    expect((await recommend.purchasedProductIds(storeId, { customerId: null, email: null, cartIds: [] })).size).toBe(0);
  });

  it("leaves out what is in the cart and uses it, with what was looked at, to recommend", async () => {
    const outcome = await recommend.recommendFor(
      store,
      market,
      request({ place: { kind: "other" }, signals: { views: [product["demo-notatbok"]], searches: [] }, block: { ...request().block, limit: 12 } }),
    );
    expect(handles(outcome.items)).not.toContain("demo-notatbok");
    expect(outcome.items.length).toBeGreaterThan(0);
  });

  it("follows the owner's rules: pairings first, never together, never at all", async () => {
    const ok = async (input: Parameters<typeof settings.addRule>[2]) => expect(await settings.addRule({ id: accountId } as never, storeId, input)).toEqual({ ok: true });
    await ok({ kind: "goes_with", productId: product["demo-bordlampe"], otherProductId: product["demo-handlenett"] });
    expect(handles((await recommend.recommendFor(store, market, request())).items)[0]).toBe("demo-handlenett");

    await ok({ kind: "never_with", productId: product["demo-bordlampe"], otherProductId: product["demo-notatbok"] });
    await ok({ kind: "hide", productId: product["demo-keramikkopp"] });
    const shown = handles((await recommend.recommendFor(store, market, request({ block: { ...request().block, limit: 12 } }))).items);
    expect(shown).toContain("demo-handlenett");
    expect(shown).not.toContain("demo-notatbok");
    expect(shown).not.toContain("demo-keramikkopp");
    // A never-with works from the other product's page too, and a hidden product is hidden on every page.
    const other = handles((await recommend.recommendFor(store, market, request({ place: { kind: "product", productId: product["demo-notatbok"] }, block: { ...request().block, limit: 12 } }))).items);
    expect(other).not.toContain("demo-bordlampe");
    expect(other).not.toContain("demo-keramikkopp");
  });

  it("refuses rules that are not the store's, repeated ones are kept once, and removing one is audited", async () => {
    const [foreign] = await db().execute<Row>(sql`select id from commerce.products where store_id <> ${storeId}::uuid limit 1`);
    expect(await settings.addRule({ id: accountId } as never, storeId, { kind: "goes_with", productId: product["demo-bordlampe"], otherProductId: String(foreign.id) })).toMatchObject({ ok: false });
    expect(await settings.addRule({ id: accountId } as never, storeId, { kind: "goes_with", productId: product["demo-bordlampe"], otherProductId: product["demo-bordlampe"] })).toMatchObject({ ok: false });
    expect(await settings.addRule({ id: accountId } as never, storeId, { kind: "goes_with", productId: product["demo-bordlampe"] })).toMatchObject({ ok: false });
    await settings.addRule({ id: accountId } as never, storeId, { kind: "goes_with", productId: product["demo-bordlampe"], otherProductId: product["demo-handlenett"], both: true });
    await settings.addRule({ id: accountId } as never, storeId, { kind: "goes_with", productId: product["demo-bordlampe"], otherProductId: product["demo-handlenett"], both: true });
    const rules = await settings.listRules(storeId);
    expect(rules).toHaveLength(2);
    expect((await settings.removeRule({ id: accountId } as never, storeId, rules[0].id)).ok).toBe(true);
    expect(await settings.listRules(storeId)).toHaveLength(1);
  });

  it("calls a dearer product of the same category an upsell, within the owner's ceiling", async () => {
    // The lamp and the mug in one category: the lamp costs 3.6 times the mug.
    await db().execute(sql`
      insert into commerce.product_terms (store_id, product_id, term_id) values (${storeId}::uuid, ${product["demo-bordlampe"]}::uuid, ${term.hjem}::uuid)
      on conflict do nothing
    `);
    try {
      const mug = request({ place: { kind: "product", productId: product["demo-keramikkopp"] }, block: { ...request().block, limit: 12, mix: { upsell: true, crossSell: false, complement: false } } });
      expect(handles((await recommend.recommendFor(store, market, mug)).items)).not.toContain("demo-bordlampe");
      await save({ enabled: true, ai: false, holdout: 0, ceiling: 400, cap: "" });
      const outcome = await recommend.recommendFor(store, market, mug);
      expect(handles(outcome.items)).toContain("demo-bordlampe");
      const lamp = outcome.items.find((item) => item.href.endsWith("demo-bordlampe"))!;
      expect(lamp.note).toBe(t("nb").recommend.stepUp(await recommendTitle("demo-keramikkopp")));
    } finally {
      await db().execute(sql`delete from commerce.product_terms where product_id = ${product["demo-bordlampe"]}::uuid and term_id = ${term.hjem}::uuid`);
    }
  });

  it("mixes only the kinds the grid asks for, and keeps to its categories", async () => {
    for (let i = 0; i < 2; i++) await order(["demo-bordlampe", "demo-keramikkopp"]);
    const none = await recommend.recommendFor(
      store,
      market,
      request({ block: { ...request().block, limit: 12, mix: { upsell: false, crossSell: false, complement: false } } }),
    );
    // With no kind allowed only what has no relation to compare is left to fill: nothing here beats a pairing.
    expect(handles(none.items)).not.toContain("demo-keramikkopp");
    const scoped = await recommend.recommendFor(store, market, request({ block: { ...request().block, limit: 12, categories: [term.hjem] } }));
    expect(handles(scoped.items)).toEqual(["demo-keramikkopp"]);
  });

  it("finds what the shopper searched for, and says so", async () => {
    const outcome = await recommend.recommendFor(
      store,
      market,
      request({ place: { kind: "other" }, signals: { views: [], searches: ["bordlampe"] }, block: { ...request().block, limit: 12 } }),
    );
    expect(handles(outcome.items)[0]).toBe("demo-bordlampe");
    expect(outcome.items[0].note).toBe(t("nb").recommend.search);
  });

  it("recommends around an archive's chosen category, and has only what sells to go on for a page it knows nothing of", async () => {
    const archive = await recommend.recommendFor(
      store,
      market,
      request({ place: { kind: "listing", query: "category=hjem" }, block: { ...request().block, limit: 12 } }),
    );
    // A category includes the categories below it (belysning is under hjem).
    expect(handles(archive.items).sort()).toEqual(["demo-bordlampe", "demo-keramikkopp"]);
    expect(archive.placement).toBe("listing");
    // A category's own page (D140) recommends around that category, with the ones below it.
    const categoryPage = await recommend.recommendFor(
      store,
      market,
      request({ place: { kind: "listing", query: "", termId: term.hjem }, block: { ...request().block, limit: 12 } }),
    );
    expect(handles(categoryPage.items).sort()).toEqual(["demo-bordlampe", "demo-keramikkopp"]);
    const tagPage = await recommend.recommendFor(
      store,
      market,
      request({ place: { kind: "listing", query: "", termId: term.nyhet }, block: { ...request().block, limit: 12 } }),
    );
    expect(handles(tagPage.items).sort()).toEqual(["demo-handlenett", "demo-notatbok"]);
    const unknown = await recommend.recommendFor(store, market, request({ place: { kind: "article", pageId: randomUUID() }, block: { ...request().block, limit: 12 } }));
    expect(unknown.items.length).toBeGreaterThan(0);
    expect(unknown.items.every((item) => item.note === t("nb").recommend.popular)).toBe(true);
  });

  it("can leave the line under each product out", async () => {
    const quiet = await recommend.recommendFor(store, market, request({ block: { ...request().block, explain: false } }));
    expect(quiet.items.length).toBeGreaterThan(0);
    expect(quiet.items.every((item) => item.note === undefined)).toBe(true);
  });

  it("is the same for everyone in the stand-in a page is built with, without a session", async () => {
    const items = await recommend.standInFor(storeId, "no", { kind: "product", productId: product["demo-bordlampe"] }, request().block);
    expect(items.length).toBeGreaterThan(0);
    expect(handles(items)).not.toContain("demo-bordlampe");
    await save({ enabled: false, ai: true, holdout: 0, ceiling: 50, cap: "" });
    expect(await recommend.standInFor(storeId, "no", { kind: "product", productId: product["demo-bordlampe"] }, request().block)).toEqual([]);
  });
});

/** A product's title as the market shows it. */
async function recommendTitle(handle: string): Promise<string> {
  const [row] = await db().execute<Row>(sql`select title from commerce.product_translations where product_id = ${product[handle]}::uuid and locale = 'nb-NO'`);
  return String(row.title);
}

describe("the AI's re-ranking", () => {
  const pick = (handle: string, reason = "pairs") => ({ id: product[handle], reason, because: product["demo-bordlampe"] });

  it("reorders the best candidates, once for the same question, and never adds or drops a product", async () => {
    model.answer = JSON.stringify([pick("demo-notatbok"), { id: randomUUID(), reason: "pairs", because: null }, pick("demo-handlenett")]);
    const plain = handles((await recommend.recommendFor(store, market, request({ session: "plainplainplainplainplain" }))).items);
    expect(model.asked).toBe(1);
    const first = await recommend.recommendFor(store, market, request());
    const second = await recommend.recommendFor(store, market, request());
    // Asked once for that question (the plain request above had another session but the same facts: kept).
    expect(model.asked).toBe(1);
    expect(handles(first.items).slice(0, 2)).toEqual(["demo-notatbok", "demo-handlenett"]);
    expect(handles(second.items)).toEqual(handles(first.items));
    expect([...handles(first.items)].sort()).toEqual([...plain].sort());
    expect(first.ai).toBe("used");
  });

  it("keeps the reason true to what the product is: a model cannot call a cross-sell a step up", async () => {
    model.answer = JSON.stringify([{ id: product["demo-notatbok"], reason: "step_up", because: product["demo-bordlampe"] }, pick("demo-handlenett")]);
    const outcome = await recommend.recommendFor(store, market, request());
    const note = outcome.items.find((item) => item.href.endsWith("demo-notatbok"))!.note!;
    expect(note).not.toBe(t("nb").recommend.stepUp(await recommendTitle("demo-bordlampe")));
  });

  it("is left out in the plain arm, with the AI off, with no model, over the cap, and when the model fails", async () => {
    model.answer = JSON.stringify([pick("demo-notatbok")]);
    // Plain arm: a tab drawn into the held-out share.
    await save({ enabled: true, ai: true, holdout: 50, ceiling: 50, cap: "" });
    const baselineSession = Array.from({ length: 50 }, (_, i) => `session${i}abcdefghijklmnop`).find((s) => recommendArm(s) === "baseline")!;
    const held = await recommend.recommendFor(store, market, request({ session: baselineSession }));
    expect(held).toMatchObject({ arm: "baseline", ai: "holdout" });
    expect(model.asked).toBe(0);

    await save({ enabled: true, ai: false, holdout: 0, ceiling: 50, cap: "" });
    expect((await recommend.recommendFor(store, market, request())).ai).toBe("off");

    await save({ enabled: true, ai: true, holdout: 0, ceiling: 50, cap: "" });
    model.connection = false;
    expect((await recommend.recommendFor(store, market, request())).items.length).toBeGreaterThan(0);
    expect(model.asked).toBe(0);
    model.connection = true;

    // Over the cap: this month's tokens for recommendations already count.
    await db().execute(sql`
      insert into commerce.ai_usage (store_id, source, provider, model, kind, feature, input_tokens, output_tokens)
      values (${storeId}::uuid, 'store', 'x', 'y', 'text', 'recommendations', 4000, 1000)
    `);
    expect(await settings.tokensUsedThisMonth(storeId)).toBe(5000);
    await save({ enabled: true, ai: true, holdout: 0, ceiling: 50, cap: "5" });
    expect((await recommend.recommendFor(store, market, request())).ai).toBe("cap");
    expect(model.asked).toBe(0);
    await save({ enabled: true, ai: true, holdout: 0, ceiling: 50, cap: "6" });

    model.fail = true;
    const failed = await recommend.recommendFor(store, market, request());
    expect(failed.items.length).toBeGreaterThan(0);
    expect(failed.ai).toBe("none");
  });
});

const recommendArm = (session: string) => {
  // The same draw the engine makes.
  let hash = 0x811c9dc5;
  for (let i = 0; i < session.length; i++) {
    hash ^= session.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash % 100 < 50 ? "baseline" : "ai";
};

describe("the chat agent's recommendations", () => {
  it("come from the same engine, off while the store's recommendations are off", async () => {
    const on = await recommend.recommendForChat(store, market, { productId: product["demo-bordlampe"], signals: { views: [], searches: [] } });
    expect(on.on).toBe(true);
    expect(on.picked.length).toBeGreaterThan(0);
    expect(on.picked.every((p) => p.product.id !== product["demo-bordlampe"])).toBe(true);
    expect(model.asked).toBe(0);
    await save({ enabled: false, ai: true, holdout: 0, ceiling: 50, cap: "" });
    expect(await recommend.recommendForChat(store, market, { productId: null, signals: { views: [], searches: [] } })).toEqual({ on: false, picked: [] });
  });
});

describe("the check against past orders (D140)", () => {
  it("holds a product of each order back and sees whether the engine finds it, against the best sellers", async () => {
    // People buy the lamp with the mug, and the bag with the notebook.
    for (let i = 0; i < 6; i++) await order(["demo-bordlampe", "demo-keramikkopp"]);
    for (let i = 0; i < 6; i++) await order(["demo-handlenett", "demo-notatbok"]);
    // Not counted: one product only, unpaid, and copied history.
    await order(["demo-keramikkopp"]);
    await order(["demo-handlenett", "demo-notatbok"], { status: "pending_payment" });
    await order(["demo-handlenett", "demo-notatbok"], { copied: true });
    const result = await replay.replayOnOrders(store, market, 200);
    expect(result.evaluated).toBeGreaterThanOrEqual(12);
    expect(result.considered).toBeGreaterThanOrEqual(result.evaluated);
    // What was bought together comes first far more often than best sellers alone would put it (a small shop's best
    // sellers are all its products, so only the first places tell them apart).
    expect(result.engine.hit[1]!).toBeGreaterThan(result.bestSellers.hit[1]!);
    expect(result.engine.hit[12]!).toBeGreaterThanOrEqual(80);
    expect(result.engine.mrr!).toBeGreaterThan(result.bestSellers.mrr!);
    expect(result.liftAt4 === null || result.liftAt4 >= 1).toBe(true);
    // Never asks a model.
    expect(model.asked).toBe(0);
  });

  it("leaves the order it replays out of what it learns from, so one order cannot vouch for itself", async () => {
    const mine = sql`select id from commerce.orders where store_id = ${storeId}::uuid and number like ${`${run}-%`} and copied_from is null`;
    await db().execute(sql`delete from commerce.order_lines where order_id in (${mine})`);
    await db().execute(sql`delete from commerce.orders where id in (${mine})`);
    // One pair, bought once: replayed with itself left out, nothing is known of it.
    await order(["demo-notatbok", "demo-keramikkopp"]);
    const result = await replay.replayOnOrders(store, market, 10);
    expect(result.evaluated).toBe(1);
    expect(result.engine.hit[1]).toBe(0);
  });
});

describe("what shoppers did, and what it earned", () => {
  it("counts shown, clicked, added and ordered by ranking, with revenue per currency", async () => {
    await db().execute(sql`delete from commerce.recommendation_events where store_id = ${storeId}::uuid`);
    await db().execute(sql`delete from commerce.recommendation_adds where store_id = ${storeId}::uuid`);
    const mug = product["demo-keramikkopp"];
    const sessionAi = "aaaaaaaaaaaaaaaaaaaaaaaa";
    const sessionPlain = "bbbbbbbbbbbbbbbbbbbbbbbb";
    expect(await events.recordRecommendEvents(storeId, { store: store.slug, session: sessionAi, arm: "ai", placement: "product", events: [
      { productId: mug, event: "impression" },
      { productId: mug, event: "impression" },
      { productId: product["demo-notatbok"], event: "impression" },
      { productId: mug, event: "click" },
      // Not the store's: dropped.
      { productId: randomUUID(), event: "click" },
    ] })).toBe(3);
    await events.recordRecommendEvents(storeId, { store: store.slug, session: sessionPlain, arm: "baseline", placement: "listing", events: [{ productId: mug, event: "impression" }] });

    // The shopper puts the clicked mug in a cart, then buys it; the plain visitor adds one but never buys.
    const [cart] = await db().execute<Row>(sql`insert into commerce.carts (store_id, market_code, currency, locale, expires_at) values (${storeId}::uuid, 'NO', 'NOK', 'nb-NO', now() + interval '7 days') returning id`);
    const [cart2] = await db().execute<Row>(sql`insert into commerce.carts (store_id, market_code, currency, locale, expires_at) values (${storeId}::uuid, 'NO', 'NOK', 'nb-NO', now() + interval '7 days') returning id`);
    await events.recordRecommendedAdd(storeId, String(cart.id), mug, { session: sessionAi, arm: "ai", placement: "product" });
    await events.recordRecommendedAdd(storeId, String(cart.id), mug, { session: sessionAi, arm: "ai", placement: "product" });
    await events.recordRecommendedAdd(storeId, String(cart2.id), mug, { session: sessionPlain, arm: "baseline", placement: "listing" });
    await events.recordRecommendedAdd(storeId, String(cart2.id), randomUUID(), { session: sessionPlain, arm: "baseline", placement: "listing" });
    await order(["demo-keramikkopp", "demo-bordlampe"], { cartId: String(cart.id), daysAgo: 0 });
    // An order of that cart from before the add does not count.
    await order(["demo-keramikkopp"], { cartId: String(cart.id), daysAgo: 3 });

    const report = await events.recommendationReport(storeId, 30);
    const ai = report.arms.find((a) => a.arm === "ai")!;
    const plain = report.arms.find((a) => a.arm === "baseline")!;
    expect(ai).toMatchObject({ visitors: 1, impressions: 2, clicks: 1, adds: 1, orders: 1 });
    expect(ai.revenue).toEqual([{ currency: "NOK", minor: 10000, orders: 1 }]);
    expect(plain).toMatchObject({ visitors: 1, impressions: 1, clicks: 0, adds: 1, orders: 0, revenue: [] });
    expect(report.placements.find((p) => p.placement === "product")).toMatchObject({ impressions: 2, clicks: 1, adds: 1 });
    expect(report.topProducts[0]).toMatchObject({ productId: mug, clicks: 1, adds: 2 });
  });

  it("finds the product a variant belongs to, in the store only, and forgets old events", async () => {
    expect(await events.productOfVariant(storeId, variant["demo-keramikkopp"])).toBe(product["demo-keramikkopp"]);
    const [foreign] = await db().execute<Row>(sql`select v.id from commerce.product_variants v join commerce.products p on p.id = v.product_id where p.store_id <> ${storeId}::uuid limit 1`);
    expect(await events.productOfVariant(storeId, String(foreign.id))).toBeNull();
    await db().execute(sql`update commerce.recommendation_events set created_at = now() - interval '91 days' where store_id = ${storeId}::uuid`);
    expect(await events.pruneRecommendEvents()).toBeGreaterThan(0);
    expect((await events.recommendationReport(storeId, 90)).arms.every((a) => a.impressions === 0)).toBe(true);
  });

  it("limits what one visitor can send", async () => {
    let allowed = 0;
    for (let i = 0; i < 250; i++) if (await events.takeRecommendRequest(storeId, `visitor-${run}`, "ask")) allowed += 1;
    expect(allowed).toBe(240);
  });
});
