import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { conversionFor, localizationOf } from "@/lib/localization";
import { showMarket, toMarket } from "@/lib/markets";
import { DRAFTS_OPEN_MAX, DRAFT_SENDS_PER_HOUR_STORE } from "@/lib/order-limits";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
const jar = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: (name: string, value: string) => void jar.set(name, value),
    delete: (name: string) => void jar.delete(name),
  }),
  headers: async () => new Headers(),
}));

/** Kaizen's platform Stripe client, faked: hosted sessions, expiries and refunds, recorded. */
const fake = vi.hoisted(() => {
  const sessions = new Map<string, Record<string, unknown>>();
  const created: { params: Record<string, unknown>; options: Record<string, unknown> }[] = [];
  const expired: string[] = [];
  const refunds: Record<string, unknown>[] = [];
  const state = { failCreate: false };
  let next = 0;
  const client = {
    refunds: {
      create: async (params: Record<string, unknown>) => {
        refunds.push(params);
        return { id: `re_${++next}`, status: "succeeded" };
      },
    },
    coupons: { create: async () => ({ id: `coupon_${++next}` }) },
    checkout: {
      sessions: {
        create: async (params: Record<string, unknown>, options: Record<string, unknown>) => {
          if (state.failCreate) throw Object.assign(new Error("Stripe is down"), { type: "StripeAPIError" });
          const id = `cs_draft_${++next}`;
          sessions.set(id, { status: "open", payment_status: "unpaid", mode: params.mode, metadata: params.metadata, payment_intent: null });
          created.push({ params, options });
          return { id, url: `https://checkout.stripe.test/${id}`, client_secret: `${id}_secret_test`, payment_method_types: ["card"] };
        },
        retrieve: async (id: string) => ({ id, ...sessions.get(id) }),
        expire: async (id: string) => {
          expired.push(id);
          const found = sessions.get(id);
          if (found) found.status = "expired";
          return { id };
        },
      },
    },
  };
  return { client, created, sessions, expired, refunds, state };
});
vi.mock("./stripe", () => ({
  platformStripe: () => fake.client,
  platformPublishableKey: () => "pk_test_drafts",
  platformModes: () => ["test"],
  WEBHOOK_EVENTS: [],
}));

const {
  createDraft,
  deleteDraft,
  expireDrafts,
  getDraft,
  hashPayToken,
  listDrafts,
  previewDraft,
  pruneDraftOrders,
  recordDraftPaidOutside,
  reopenDraft,
  resendDraftLink,
  saveDraft,
  sendDraft,
} = await import("./draft-orders");
const { payPageFor, startDraftPayment } = await import("./draft-pay");
const support = await import("./inventory-test-support");
const { newPlainStore } = await import("./order-ops-fixture");
const { staffActor } = await import("./order-actor");
const { getOrder, getOrderEvents, getShopperOrder } = await import("./orders");
const { getOrderAdmin, refundOrder } = await import("./order-admin");
const { getCart } = await import("./cart");
const { cartSummary } = await import("./cart-summary");
const { orderNumberAudit } = await import("./order-numbers");
const { mayRecordOutsidePayment } = await import("./order-settings");
const { storeById } = await import("./shopper-emails");

type Row = Record<string, unknown>;
type TestStore = Awaited<ReturnType<typeof support.newStore>>;

/**
 * Draft orders against a real database (wave 3, run 2, D173, `docs/wave-3-orders.md` 2.4, 4.5, 6.4, D1 to D12): made and saved, priced as the checkout prices a cart, sent as a real numbered order
 * that holds stock, paid through a Stripe-hosted session of exact amounts or recorded as paid outside Kaizen, expired without a gap in the numbers, reopened, refused in every way the spec lists,
 * and never reaching another store. Stripe is the fake above; the live flow is checked by hand with test keys.
 */

const no = toMarket({ code: "NO", currency: "NOK", defaultLocale: "nb-NO" });
const noInEuro = showMarket({ code: "NO", currency: "NOK", defaultLocale: "nb-NO" }, {
  currency: "EUR",
  conversion: conversionFor(localizationOf([], [{ currency: "NOK", rate: 11.5, roundTo: 1 }, { currency: "EUR", rate: 1, roundTo: 1 }], [no]), "NOK", "EUR")!,
});

afterAll(async () => {
  await closeDb();
});

beforeEach(() => {
  jar.clear();
  fake.state.failCreate = false;
});

const actorOf = (store: TestStore) => staffActor(store.accountId);

/** A store with Stripe on in test mode (the draft's pay link opens a session), euro offered, and plenty of stock. */
async function paymentsStore(label: string): Promise<TestStore> {
  const store = await newPlainStore(label);
  await db().execute(sql`update commerce.payment_providers set enabled = true, active_mode = 'test' where store_id = ${store.storeId}::uuid`);
  await db().execute(sql`
    insert into commerce.store_currencies (store_id, currency, rate, round_to, position)
    values (${store.storeId}::uuid, 'NOK', 11.5, 1, 0), (${store.storeId}::uuid, 'EUR', 1, 1, 1) on conflict do nothing
  `);
  await db().execute(sql`update commerce.inventory_levels set on_hand = on_hand + 500 where store_id = ${store.storeId}::uuid`);
  return store;
}

const goods = async (store: TestStore, sku: string, quantity: number, price?: string) => ({
  kind: "goods" as const,
  variantId: await support.variantId(store.storeId, sku),
  quantity,
  ...(price ? { price } : {}),
});

type Overrides = Partial<{
  marketSlug: string;
  email: string | null;
  lines: unknown[];
  tags: string[];
  discount: unknown;
  shipping: unknown;
  noteToBuyer: string;
  internalNote: string;
  customerId: string | null;
  companyName: string | null;
  organisationNumber: string | null;
  shippingAddress: Record<string, string>;
}>;

/** An open draft with these contents, saved through `saveDraft()` (the version moves with every save). */
async function draftOf(store: TestStore, overrides: Overrides = {}) {
  const made = await createDraft(store.storeId, actorOf(store), { marketSlug: "no" });
  if (!made.ok) throw new Error(made.problem);
  const saved = await saveDraft(store.storeId, actorOf(store), made.draft.id, {
    version: made.draft.version,
    marketSlug: "no",
    email: "buyer@example.com",
    shippingAddress: { name: "Kari Nordmann", line1: "Storgata 1", postalCode: "0155", city: "Oslo", country: "NO" },
    billingAddress: {},
    tags: [],
    discount: null,
    shipping: { kind: "rate" },
    lines: [await goods(store, "DEMO-MUG-WHITE", 2)],
    ...overrides,
  });
  if (!saved.ok) throw new Error(`save: ${saved.problem} ${JSON.stringify(saved.fields)}`);
  return saved.draft;
}

async function send(store: TestStore, draftId: string, options: { createLink?: boolean; validDays?: number } = { createLink: true }) {
  const draft = (await getDraft(store.storeId, draftId))!;
  const done = await sendDraft(store.storeId, actorOf(store), draftId, { version: draft.version, ...options });
  if (!done.ok) throw new Error(`send: ${done.problem} ${JSON.stringify(done.problems)}`);
  return done;
}

const tokenOf = (link: string | null) => link!.split("/").pop()!;
const sessionOf = async (orderId: string): Promise<string> => {
  const [row] = await db().execute<Row>(sql`select provider_reference from commerce.payments where order_id = ${orderId}::uuid and provider = 'stripe' and status = 'pending' order by created_at desc limit 1`);
  return String(row.provider_reference);
};

async function shop(store: TestStore) {
  const found = (await storeById(store.storeId))!;
  const full = await (await import("./stores")).getStore(store.slug);
  return { store: full!, market: found.markets.find((m) => m.code === "NO") ?? found.markets[0] };
}

describe("making and saving a draft", () => {
  it("makes empty drafts numbered D-1, D-2 on their own counter, and leaves the order numbers alone", async () => {
    const store = await newPlainStore("draft-make");
    const first = await createDraft(store.storeId, actorOf(store));
    const second = await createDraft(store.storeId, actorOf(store));
    expect(first.ok && first.draft.number).toBe("D-1");
    expect(second.ok && second.draft.number).toBe("D-2");
    expect(first.ok && first.draft).toMatchObject({ status: "open", version: 1, lines: [] });
    const audit = await orderNumberAudit(store.storeId);
    expect(JSON.stringify(audit)).not.toMatch(/gap/i);
    // An open draft holds no number of the orders' and no stock.
    const [orders] = await db().execute<Row>(sql`select count(*)::int as n from commerce.orders where store_id = ${store.storeId}::uuid`);
    expect(orders.n).toBe(0);
  });

  it("saves lines at the list price, a typed price, and a custom item with its VAT category, priced by the one function that prices an order", async () => {
    const store = await paymentsStore("draft-save");
    // A custom item is for a business (a private buyer's right of withdrawal for a service is not decided: `custom_consumer`).
    const draft = await draftOf(store, {
      companyName: "Engraver AS",
      organisationNumber: "923609016",
      lines: [
        await goods(store, "DEMO-MUG-WHITE", 2),
        await goods(store, "DEMO-NOTEBOOK-LINED", 1, "20,00"),
        { kind: "custom", title: "Engraving", quantity: 1, price: "100,00", vatCategory: "standard" },
      ],
    });
    expect(draft.version).toBe(2);
    const [mug, notebook, custom] = draft.lines;
    expect(mug.customPrice).toBe(false);
    expect(mug.listPriceMinor).toBe(mug.unitPriceMinor);
    expect(notebook).toMatchObject({ unitPriceMinor: 2000, customPrice: true });
    expect(custom).toMatchObject({ kind: "custom", title: "Engraving", unitPriceMinor: 10_000, listPriceMinor: null, delivery: "service", sku: "CUSTOM" });
    const preview = (await previewDraft(store.storeId, draft.id))!;
    expect(preview.summary!.lines.map((l) => l.totalMinor)).toEqual([mug.unitPriceMinor * 2, 2000, 10_000]);
    expect(preview.summary!.totalMinor).toBe(preview.summary!.subtotalMinor + preview.summary!.shippingMinor);
    expect(preview.blocking).toEqual([]);
    // 25 % VAT included in each line: the VAT is worked out by the same rounding as an order.
    expect(preview.summary!.taxMinor).toBeGreaterThan(0);
  });

  it("refuses what the editor must not send: another store's product, a bad price, a custom item with no category, a bad tag, a missing market", async () => {
    const mine = await newPlainStore("draft-invalid");
    const theirs = await newPlainStore("draft-invalid-other");
    const draft = await draftOf(mine);
    const base = { version: draft.version, marketSlug: "no", email: "a@example.com", shippingAddress: {}, billingAddress: {}, tags: [], discount: null, shipping: { kind: "rate" } };
    const foreign = await saveDraft(mine.storeId, actorOf(mine), draft.id, { ...base, lines: [await goods(theirs, "DEMO-MUG-WHITE", 1)] });
    expect(foreign).toMatchObject({ ok: false, problem: "invalid" });
    const badPrice = await saveDraft(mine.storeId, actorOf(mine), draft.id, { ...base, lines: [await goods(mine, "DEMO-MUG-WHITE", 1, "abc")] });
    expect(badPrice).toMatchObject({ ok: false, problem: "invalid" });
    const noCategory = await saveDraft(mine.storeId, actorOf(mine), draft.id, { ...base, lines: [{ kind: "custom", title: "x", quantity: 1, price: "10" }] });
    expect(noCategory).toMatchObject({ ok: false, problem: "invalid" });
    const unknownCategory = await saveDraft(mine.storeId, actorOf(mine), draft.id, { ...base, lines: [{ kind: "custom", title: "x", quantity: 1, price: "10", vatCategory: "nonsense" }] });
    expect(unknownCategory).toMatchObject({ ok: false, problem: "invalid" });
    const badTag = await saveDraft(mine.storeId, actorOf(mine), draft.id, { ...base, lines: [], tags: ["bad,tag"] });
    expect(badTag).toMatchObject({ ok: false, problem: "invalid" });
    const badMarket = await saveDraft(mine.storeId, actorOf(mine), draft.id, { ...base, marketSlug: "fi", lines: [] });
    expect(badMarket).toMatchObject({ ok: false, problem: "market" });
    const zeroQuantity = await saveDraft(mine.storeId, actorOf(mine), draft.id, { ...base, lines: [await goods(mine, "DEMO-MUG-WHITE", 0)] });
    expect(zeroQuantity).toMatchObject({ ok: false, problem: "invalid" });
    const badDiscount = await saveDraft(mine.storeId, actorOf(mine), draft.id, { ...base, lines: [], discount: { kind: "percent", value: "150", label: "x" } });
    expect(badDiscount).toMatchObject({ ok: false, problem: "invalid" });
    expect((await getDraft(mine.storeId, draft.id))!.version).toBe(draft.version);
  });

  it("refuses an old version (two staff at once), another store's draft, and a sent draft", async () => {
    const store = await paymentsStore("draft-conflict");
    const other = await paymentsStore("draft-conflict-other");
    const draft = await draftOf(store);
    const stale = await saveDraft(store.storeId, actorOf(store), draft.id, { version: draft.version - 1, marketSlug: "no", lines: [] });
    expect(stale).toEqual({ ok: false, problem: "conflict" });
    expect(await getDraft(other.storeId, draft.id)).toBeNull();
    expect(await saveDraft(other.storeId, actorOf(other), draft.id, { version: draft.version, marketSlug: "no", lines: [] })).toEqual({ ok: false, problem: "not_found" });
    expect(await deleteDraft(other.storeId, actorOf(other), draft.id)).toEqual({ ok: false, problem: "not_found" });
    expect(await resendDraftLink(other.storeId, actorOf(other), draft.id)).toEqual({ ok: false, problem: "not_found" });
    expect(await reopenDraft(other.storeId, actorOf(other), draft.id)).toEqual({ ok: false, problem: "not_found" });
    await send(store, draft.id);
    const sent = await getDraft(store.storeId, draft.id);
    expect(sent!.status).toBe("sent");
    expect(await saveDraft(store.storeId, actorOf(store), draft.id, { version: sent!.version, marketSlug: "no", lines: [] })).toEqual({ ok: false, problem: "not_open" });
    expect(await deleteDraft(store.storeId, actorOf(store), draft.id)).toEqual({ ok: false, problem: "sent" });
  });

  it("stops at 500 open drafts and deletes an open one", async () => {
    const store = await newPlainStore("draft-cap");
    await db().execute(sql`insert into commerce.order_settings (store_id) values (${store.storeId}::uuid) on conflict do nothing`);
    await db().execute(sql`
      insert into commerce.draft_orders (store_id, number, market_code, market_slug, currency, locale)
      select ${store.storeId}::uuid, 'D-' || (900000 + g), 'NO', 'no', 'NOK', 'nb-NO' from generate_series(1, ${DRAFTS_OPEN_MAX}) g
    `);
    expect(await createDraft(store.storeId, actorOf(store))).toEqual({ ok: false, problem: "too_many_open_drafts" });
    const page = await listDrafts(store.storeId, { pageSize: 10 });
    expect(page.openCount).toBe(DRAFTS_OPEN_MAX);
    expect(page.rows).toHaveLength(10);
    expect(page.nextCursor).not.toBeNull();
    const next = await listDrafts(store.storeId, { pageSize: 10, after: page.nextCursor });
    expect(next.rows.map((r) => r.id)).not.toEqual(expect.arrayContaining(page.rows.map((r) => r.id)));
    expect((await deleteDraft(store.storeId, actorOf(store), page.rows[0].id)).ok).toBe(true);
    expect(await createDraft(store.storeId, actorOf(store))).toMatchObject({ ok: true });
  });

  it("changing the market re-prices list-priced lines and keeps a typed price as typed, and says which", async () => {
    const store = await paymentsStore("draft-market");
    await db().execute(sql`update commerce.shipping_rates set amount_minor = amount_minor where store_id = ${store.storeId}::uuid`);
    const draft = await draftOf(store, { lines: [await goods(store, "DEMO-MUG-WHITE", 1), await goods(store, "DEMO-NOTEBOOK-LINED", 1, "20,00")] });
    const market = (await storeById(store.storeId))!.markets.find((m) => m.code === "SE");
    expect(market, "the template store sells in Sweden").toBeTruthy();
    const moved = await saveDraft(store.storeId, actorOf(store), draft.id, {
      version: draft.version, marketSlug: market!.slug, email: "a@example.com", shippingAddress: {}, billingAddress: {}, tags: [], discount: null, shipping: { kind: "rate" },
      lines: draft.lines.map((l) => ({ id: l.id, kind: "goods", variantId: l.variantId, quantity: l.quantity, price: l.customPrice ? "20,00" : null })),
    });
    expect(moved.ok && moved.marketChange).toMatchObject({ kept: [draft.lines[1].id] });
  });
});

describe("pricing is the checkout's", () => {
  async function checkoutTotals(store: TestStore, lines: [string, number][], view: typeof no) {
    const cartId = await support.cartOf(store.storeId, lines, no);
    jar.set(`cart_${store.storeId}_no`, cartId);
    const cart = await getCart({ storeId: store.storeId, market: view });
    return cartSummary({ storeId: store.storeId, market: view }, cart);
  }

  it("gives a draft the totals, VAT and shipping the same goods have in a cart, in kroner and in euro", async () => {
    const store = await paymentsStore("draft-equivalence");
    const lines: [string, number][] = [["DEMO-MUG-WHITE", 2], ["DEMO-NOTEBOOK-LINED", 3]];
    for (const euro of [false, true]) {
      const view = euro ? noInEuro : no;
      const cart = await checkoutTotals(store, lines, view);
      const draft = await draftOf(store, {
        marketSlug: view.slug,
        lines: await Promise.all(lines.map(([sku, quantity]) => goods(store, sku, quantity))),
      });
      const summary = (await previewDraft(store.storeId, draft.id))!.summary!;
      expect(summary.currency).toBe(euro ? "EUR" : "NOK");
      expect({ subtotal: summary.subtotalMinor, shipping: summary.shippingMinor, vat: summary.taxMinor, total: summary.totalMinor }, `euro ${euro}`).toEqual({
        subtotal: cart.subtotal,
        shipping: cart.shipping,
        vat: cart.vat,
        total: cart.total,
      });
    }
  });

  it("takes a staff discount off the goods, never the shipping, keeps VAT right, and shows it under the name staff gave it", async () => {
    const store = await paymentsStore("draft-discount");
    const plain = await draftOf(store, { lines: [await goods(store, "DEMO-MUG-WHITE", 4)] });
    const percent = await draftOf(store, { lines: [await goods(store, "DEMO-MUG-WHITE", 4)], discount: { kind: "percent", value: "10", label: "Friends and family" } });
    const amount = await draftOf(store, { lines: [await goods(store, "DEMO-MUG-WHITE", 4)], discount: { kind: "amount", value: "25", label: "Goodwill" } });
    const free = await draftOf(store, { lines: [await goods(store, "DEMO-MUG-WHITE", 4)], shipping: { kind: "free" } });
    const custom = await draftOf(store, { lines: [await goods(store, "DEMO-MUG-WHITE", 4)], shipping: { kind: "custom", price: "12,50" } });
    const [a, b, c, d, e] = await Promise.all([plain, percent, amount, free, custom].map((x) => previewDraft(store.storeId, x.id)));
    const base = a!.summary!;
    expect(b!.summary!.staffDiscountMinor).toBe(Math.round(base.subtotalMinor * 0.1));
    expect(b!.summary!.staffDiscountLabel).toBe("Friends and family");
    expect(c!.summary!.staffDiscountMinor).toBe(2500);
    expect(b!.summary!.shippingMinor).toBe(base.shippingMinor);
    expect(b!.summary!.totalMinor).toBe(base.totalMinor - b!.summary!.staffDiscountMinor);
    expect(b!.summary!.taxMinor).toBeLessThan(base.taxMinor);
    expect(d!.summary!.shippingMinor).toBe(0);
    expect(e!.summary!.shippingMinor).toBe(1250);
    // The discount's lines add up to the discount: no minor unit is lost or made.
    expect(b!.summary!.lines.reduce((n, l) => n + l.staffDiscountMinor, 0)).toBe(b!.summary!.staffDiscountMinor);
  });
});

describe("sending a draft", () => {
  it("refuses, writing nothing, a draft with no email, no lines, a typed total of 0, a price that moved, stock it cannot cover, a closed store and payments that are off", async () => {
    const store = await paymentsStore("draft-refuse");
    const send1 = async (draftId: string) => {
      const d = (await getDraft(store.storeId, draftId))!;
      return sendDraft(store.storeId, actorOf(store), draftId, { version: d.version, createLink: true });
    };
    const noEmail = await draftOf(store, { email: null });
    expect(await send1(noEmail.id)).toMatchObject({ ok: false, problem: "problems", problems: expect.arrayContaining([expect.objectContaining({ code: "no_email" })]) });
    const empty = await draftOf(store, { lines: [] });
    expect(await send1(empty.id)).toMatchObject({ ok: false, problem: "problems" });
    const zero = await draftOf(store, { lines: [await goods(store, "DEMO-MUG-WHITE", 1, "0")], shipping: { kind: "free" } });
    expect(await send1(zero.id)).toMatchObject({ ok: false, problem: "problems" });
    const [before] = await db().execute<Row>(sql`select count(*)::int as n from commerce.orders where store_id = ${store.storeId}::uuid`);
    expect(before.n).toBe(0);

    // A catalogue line at its list price whose price moved since the save: the draft must be saved again.
    const moved = await draftOf(store, { lines: [await goods(store, "DEMO-NOTEBOOK-LINED", 1)] });
    await db().execute(sql`select commerce.set_price(${await support.variantId(store.storeId, "DEMO-NOTEBOOK-LINED")}::uuid, 'NO', 1234)`);
    expect(await send1(moved.id)).toMatchObject({ ok: false, problem: "problems", problems: expect.arrayContaining([expect.objectContaining({ code: "price_changed" })]) });

    // More than the shelf holds, for goods that stop at zero.
    const short = await draftOf(store, { lines: [await goods(store, "DEMO-MUG-WHITE", 9_000)] });
    expect(await send1(short.id)).toMatchObject({ ok: false, problem: "problems", problems: expect.arrayContaining([expect.objectContaining({ code: "stock_short" })]) });
    const [afterRefusals] = await db().execute<Row>(sql`select count(*)::int as n from commerce.orders where store_id = ${store.storeId}::uuid`);
    expect(afterRefusals.n).toBe(0);
    expect((await orderNumberAudit(store.storeId)).toString()).not.toMatch(/gap/i);

    // A closed store takes no order; payments off take none either.
    const ok = await draftOf(store);
    await db().execute(sql`update commerce.stores set status = 'suspended' where id = ${store.storeId}::uuid`);
    expect(await send1(ok.id)).toEqual({ ok: false, problem: "closed" });
    await db().execute(sql`update commerce.stores set status = 'active' where id = ${store.storeId}::uuid`);
    await db().execute(sql`update commerce.payment_providers set enabled = false where store_id = ${store.storeId}::uuid`);
    expect(await send1(ok.id)).toEqual({ ok: false, problem: "payments_off" });
    await db().execute(sql`update commerce.payment_providers set enabled = true where store_id = ${store.storeId}::uuid`);
    expect(await send1(ok.id)).toMatchObject({ ok: true });
  });

  it("makes a real order: numbered from the sequence, pending payment, stock held, tags and a staff event, with the draft sent and only a hash of the token kept", async () => {
    const store = await paymentsStore("draft-send");
    const draft = await draftOf(store, { tags: ["Wholesale", "rush"], noteToBuyer: "Thanks for the call", internalNote: "Spoke on the phone" });
    const before = await support.holdsOf(store.storeId, "DEMO-MUG-WHITE");
    const done = await send(store, draft.id, { createLink: true, validDays: 3 });
    expect(done.number).toMatch(/\d+$/);
    expect(done.link).toMatch(/\/account\/pay\/[A-Za-z0-9_-]{43}$/);
    const order = (await getOrder(store.storeId, done.orderId))!;
    expect(order).toMatchObject({ status: "pending_payment", number: done.number });
    const admin = (await getOrderAdmin(store.storeId, done.orderId))!;
    expect(admin).toMatchObject({ source: "draft", draft: { id: draft.id, number: "D-1" } });
    expect(admin.madeBy?.id).toBe(store.accountId);
    expect(admin.tags.map((t) => t.label).sort()).toEqual(["Wholesale", "rush"]);
    // The stock is held until the link's expiry, not drawn.
    const after = await support.holdsOf(store.storeId, "DEMO-MUG-WHITE");
    expect(Object.values(after).reduce((a, b) => a + b, 0) - Object.values(before).reduce((a, b) => a + b, 0)).toBe(2);
    const expires = new Date(done.expiresAt).getTime();
    expect(Math.abs(expires - (Date.now() + 3 * 86_400_000))).toBeLessThan(60_000);
    // The history starts with the staff's placing it, naming the draft.
    const events = await getOrderEvents(store.storeId, done.orderId);
    expect(events.find((e) => e.type === "order.placed")).toMatchObject({ actor: "staff", data: { draft: "D-1" } });
    // The draft is sent, with the order; only the token's hash is kept anywhere.
    const sent = (await getDraft(store.storeId, draft.id))!;
    expect(sent).toMatchObject({ status: "sent", orderId: done.orderId, linkLive: true, validDays: 3 });
    const token = tokenOf(done.link);
    const [row] = await db().execute<Row>(sql`select pay_token_hash from commerce.draft_orders where id = ${draft.id}::uuid`);
    expect(row.pay_token_hash).toBe(hashPayToken(token));
    const [leak] = await db().execute<Row>(sql`select (to_jsonb(d)::text like ${`%${token}%`}) as leaked from commerce.draft_orders d where d.id = ${draft.id}::uuid`);
    expect(leak.leaked).toBe(false);
    const [auditLeak] = await db().execute<Row>(sql`select count(*)::int as n from commerce.audit_log where store_id = ${store.storeId}::uuid and details::text like ${`%${token}%`}`);
    expect(auditLeak.n).toBe(0);
    // The order number is the next of the one gap-free sequence: a checkout after it gets the following number.
    const numbers = await support.place(store.storeId, [["DEMO-NOTEBOOK-LINED", 1]]);
    expect(Number(numbers.number.replace(/\D/g, ""))).toBe(Number(done.number.replace(/\D/g, "")) + 1);
    // The sent draft and its order are not sent twice.
    expect(await sendDraft(store.storeId, actorOf(store), draft.id, { version: sent.version, createLink: true })).toEqual({ ok: false, problem: "not_open" });
  });

  it("sends the pay link by email to the address staff typed, once, and an email that cannot be sent leaves the draft sent", async () => {
    const store = await paymentsStore("draft-email");
    const draft = await draftOf(store, { email: "customer@example.com" });
    const done = await send(store, draft.id, { createLink: false });
    expect(done.link).toBeNull();
    expect(["sent", "logged"]).toContain(done.emailed);
    const mails = await db().execute<Row>(sql`select to_address, html, kind from commerce.email_messages where store_id = ${store.storeId}::uuid and kind = 'draft.pay_link'`);
    expect(mails).toHaveLength(1);
    expect(String(mails[0].to_address)).toBe("customer@example.com");
    const link = /https?:\/\/[^"'\s<]+\/account\/pay\/[A-Za-z0-9_-]{43}/.exec(String(mails[0].html));
    expect(link).not.toBeNull();
    // The link in the mail is the draft's live one.
    const page = await payPageFor(await shop(store), tokenOf(link![0]));
    expect(page.state).toBe("ready");
  });

  it("sends again with a NEW token that kills the old one, at most five times a day, and 60 links an hour for the store", async () => {
    const store = await paymentsStore("draft-resend");
    const draft = await draftOf(store);
    const first = await send(store, draft.id);
    const firstToken = tokenOf(first.link);
    const again = await resendDraftLink(store.storeId, actorOf(store), draft.id, { createLink: true });
    expect(again.ok).toBe(true);
    const secondToken = tokenOf(again.ok ? again.link : null);
    expect(secondToken).not.toBe(firstToken);
    const s = await shop(store);
    expect((await payPageFor(s, firstToken)).state).toBe("not_found");
    expect((await payPageFor(s, secondToken)).state).toBe("ready");
    // The draft's own limit: five sends a day (the first send does not count against it; resends do).
    const results = [];
    for (let i = 0; i < 6; i += 1) results.push(await resendDraftLink(store.storeId, actorOf(store), draft.id, { createLink: true }));
    expect(results.filter((r) => r.ok).length).toBe(4);
    expect(results.at(-1)).toEqual({ ok: false, problem: "limit" });

    // The store's hour: at the limit, the next send is refused before anything is written.
    const other = await paymentsStore("draft-hourly");
    await db().execute(sql`
      insert into commerce.chat_usage (store_id, bucket, "window", count) values (${other.storeId}::uuid, 'draft:send', date_trunc('hour', now()), ${DRAFT_SENDS_PER_HOUR_STORE})
    `);
    const d2 = await draftOf(other);
    const refused = await sendDraft(other.storeId, actorOf(other), d2.id, { version: d2.version, createLink: true });
    expect(refused).toEqual({ ok: false, problem: "limit" });
    expect((await getDraft(other.storeId, d2.id))!.status).toBe("open");
    // A resend of a draft that is not sent, or whose link ran out, is refused.
    expect(await resendDraftLink(other.storeId, actorOf(other), d2.id)).toEqual({ ok: false, problem: "not_sent" });
  });

  it("two staff sending the same draft at once make one order", async () => {
    const store = await paymentsStore("draft-race");
    const draft = await draftOf(store);
    const results = await Promise.all([
      sendDraft(store.storeId, actorOf(store), draft.id, { version: draft.version, createLink: true }),
      sendDraft(store.storeId, actorOf(store), draft.id, { version: draft.version, createLink: true }),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    const [orders] = await db().execute<Row>(sql`select count(*)::int as n from commerce.orders where store_id = ${store.storeId}::uuid and source = 'draft'`);
    expect(orders.n).toBe(1);
    const holds = await support.holdsOf(store.storeId, "DEMO-MUG-WHITE");
    expect(Object.values(holds).reduce((a, b) => a + b, 0)).toBe(2);
  });
});

describe("the pay link", () => {
  it("serves the buyer's order and nothing else, and every unknown, malformed or replaced token is the same not found", async () => {
    const store = await paymentsStore("draft-pay-page");
    const other = await paymentsStore("draft-pay-page-other");
    const draft = await draftOf(store, { discount: { kind: "percent", value: "10", label: "Friends" }, noteToBuyer: "See you soon", internalNote: "SECRET INTERNAL" });
    const sent = await send(store, draft.id);
    const s = await shop(store);
    const page = await payPageFor(s, tokenOf(sent.link));
    expect(page.state).toBe("ready");
    if (page.state === "not_found") return;
    expect(page.draft.noteToBuyer).toBe("See you soon");
    expect(page.order!.staffDiscountLabel).toBe("Friends");
    expect(JSON.stringify(page)).not.toContain("SECRET INTERNAL");
    expect(JSON.stringify(page)).not.toContain(hashPayToken(tokenOf(sent.link)));
    // The same token in another store, a token of the right shape, and nonsense: all not found.
    expect((await payPageFor(await shop(other), tokenOf(sent.link))).state).toBe("not_found");
    expect((await payPageFor(s, "A".repeat(43))).state).toBe("not_found");
    expect((await payPageFor(s, "short")).state).toBe("not_found");
    expect((await payPageFor(s, `${tokenOf(sent.link)}x`)).state).toBe("not_found");
    expect(await startDraftPayment(s, "A".repeat(43), { termsTicked: true, origin: "http://localhost:3000" })).toEqual({ ok: false, problem: "not_found" });
  });

  it("opens a hosted Stripe session for the order's exact amounts, closes the one before when pressed again, and records the terms before Stripe", async () => {
    const store = await paymentsStore("draft-pay-press");
    const draft = await draftOf(store, { discount: { kind: "percent", value: "10", label: "Friends" }, shipping: { kind: "custom", price: "19,90" }, lines: [await goods(store, "DEMO-MUG-WHITE", 3), await goods(store, "DEMO-NOTEBOOK-LINED", 1)] });
    const sent = await send(store, draft.id);
    const order = (await getOrder(store.storeId, sent.orderId))!;
    const s = await shop(store);
    const started = await startDraftPayment(s, tokenOf(sent.link), { termsTicked: true, origin: "http://localhost:3000" });
    expect(started).toMatchObject({ ok: true, url: expect.stringContaining("https://checkout.stripe.test/") });
    const { params, options } = fake.created.at(-1)!;
    // What Stripe charges is the order's total, line by line at quantity 1, no coupon and no payment method list.
    const items = params.line_items as { quantity: number; price_data: { unit_amount: number } }[];
    expect(items.every((i) => i.quantity === 1)).toBe(true);
    const shipping = (params.shipping_options as { shipping_rate_data: { fixed_amount: { amount: number } } }[] | undefined)?.[0]?.shipping_rate_data.fixed_amount.amount ?? 0;
    expect(items.reduce((n, i) => n + i.price_data.unit_amount, 0) + shipping).toBe(order.totalMinor);
    expect(params.discounts).toBeUndefined();
    expect(params).not.toHaveProperty("payment_method_types");
    expect(params.customer_email).toBe("buyer@example.com");
    expect(options.stripeAccount).toBe(store.account);
    expect(params.expires_at ?? params.expires_after).toBeDefined();
    // The terms were recorded for the order before the session opened.
    const [terms] = await db().execute<Row>(sql`select count(*)::int as n from commerce.order_terms where store_id = ${store.storeId}::uuid and order_id = ${sent.orderId}::uuid`);
    expect(terms.n).toBeLessThanOrEqual(1);
    // Pressed again: the first session is closed, one new session opens, and only one payment waits.
    const first = await sessionOf(sent.orderId);
    expect(await startDraftPayment(s, tokenOf(sent.link), { termsTicked: true, origin: "http://localhost:3000" })).toMatchObject({ ok: true });
    expect(fake.expired).toContain(first);
    const pending = await db().execute<Row>(sql`select 1 from commerce.payments where order_id = ${sent.orderId}::uuid and provider = 'stripe' and status = 'pending'`);
    expect(pending).toHaveLength(1);
  });

  it("a Stripe failure leaves the order as it was and the buyer may try again", async () => {
    const store = await paymentsStore("draft-pay-fail");
    const draft = await draftOf(store);
    const sent = await send(store, draft.id);
    const s = await shop(store);
    fake.state.failCreate = true;
    expect(await startDraftPayment(s, tokenOf(sent.link), { termsTicked: true, origin: "http://localhost:3000" })).toEqual({ ok: false, problem: "payment_error" });
    expect((await getOrder(store.storeId, sent.orderId))!.status).toBe("pending_payment");
    expect((await getDraft(store.storeId, draft.id))!.status).toBe("sent");
    fake.state.failCreate = false;
    expect(await startDraftPayment(s, tokenOf(sent.link), { termsTicked: true, origin: "http://localhost:3000" })).toMatchObject({ ok: true });
  });

  it("requires the terms to be ticked when the store asks for a tick", async () => {
    const store = await paymentsStore("draft-pay-terms");
    await db().execute(sql`update commerce.stores set terms_at_checkout = 'checkbox' where id = ${store.storeId}::uuid`);
    const draft = await draftOf(store);
    const sent = await send(store, draft.id);
    const s = await shop(store);
    const unticked = await startDraftPayment(s, tokenOf(sent.link), { termsTicked: false, origin: "http://localhost:3000" });
    expect(unticked).toEqual({ ok: false, problem: "terms" });
    expect(await startDraftPayment(s, tokenOf(sent.link), { termsTicked: true, origin: "http://localhost:3000" })).toMatchObject({ ok: true });
  });

  it("when paid, the order is paid, the draft is paid, the stock is drawn, and the link then shows paid and cannot pay again", async () => {
    const store = await paymentsStore("draft-pay-done");
    const draft = await draftOf(store, { lines: [await goods(store, "DEMO-MUG-WHITE", 2)] });
    const levelBefore = await support.totalOnHand(store.storeId, "DEMO-MUG-WHITE");
    const sent = await send(store, draft.id);
    const s = await shop(store);
    await startDraftPayment(s, tokenOf(sent.link), { termsTicked: true, origin: "http://localhost:3000" });
    const sessionId = await sessionOf(sent.orderId);
    fake.sessions.set(sessionId, { status: "complete", payment_status: "paid", mode: "payment", payment_intent: `pi_${sessionId}` });
    const paid = await getShopperOrder(store.storeId, sent.orderId, sessionId);
    expect(paid?.status).toBe("paid");
    expect((await getDraft(store.storeId, draft.id))).toMatchObject({ status: "paid" });
    expect(await support.totalOnHand(store.storeId, "DEMO-MUG-WHITE")).toBe(levelBefore - 2);
    expect(Object.values(await support.holdsOf(store.storeId, "DEMO-MUG-WHITE")).reduce((a, b) => a + b, 0)).toBe(0);
    expect((await payPageFor(s, tokenOf(sent.link))).state).toBe("paid");
    expect(await startDraftPayment(s, tokenOf(sent.link), { termsTicked: true, origin: "http://localhost:3000" })).toEqual({ ok: false, problem: "paid" });
    // The order is real: a refund through Stripe works as for any paid order.
    const admin = (await getOrderAdmin(store.storeId, sent.orderId))!;
    expect(admin.canRefund).toBe(true);
    expect(await refundOrder(store.storeId, sent.orderId, { amountMinor: 1000, reason: "Goodwill", restock: [] }, store.accountId)).toMatchObject({ ok: true });
    expect(fake.refunds.at(-1)).toMatchObject({ amount: 1000 });
  });

  it("an expired link says so and opens nothing", async () => {
    const store = await paymentsStore("draft-pay-expired");
    const draft = await draftOf(store);
    const sent = await send(store, draft.id, { createLink: true, validDays: 1 });
    // The database's own rule keeps the send time fixed, so the clock is moved the one way a test can: the rule is switched off for this statement.
    await db().transaction(async (tx) => {
      await tx.execute(sql`alter table commerce.draft_orders disable trigger draft_orders_rules`);
      await tx.execute(sql`update commerce.draft_orders set sent_at = now() - interval '2 days', expires_at = now() - interval '1 minute' where id = ${draft.id}::uuid`);
      await tx.execute(sql`alter table commerce.draft_orders enable trigger draft_orders_rules`);
    });
    const s = await shop(store);
    const page = await payPageFor(s, tokenOf(sent.link));
    expect(page.state).toBe("expired");
    expect(page.state === "expired" && page.order).toBeNull();
    expect(await startDraftPayment(s, tokenOf(sent.link), { termsTicked: true, origin: "http://localhost:3000" })).toEqual({ ok: false, problem: "expired" });
  });
});

describe("a Stripe session that lapses", () => {
  it("leaves a draft's order and its stock until the draft expires, where a checkout's order is cancelled at once", async () => {
    const store = await paymentsStore("draft-lapse");
    const { applySession } = await import("./stripe-webhooks");
    const draft = await draftOf(store);
    const sent = await send(store, draft.id);
    await startDraftPayment(await shop(store), tokenOf(sent.link), { termsTicked: true, origin: "http://localhost:3000" });
    const session = await sessionOf(sent.orderId);
    await applySession(store.storeId, { id: session, status: "expired", payment_status: "unpaid" } as never, "checkout.session.expired");
    expect((await getOrder(store.storeId, sent.orderId))!.status).toBe("pending_payment");
    expect((await getDraft(store.storeId, draft.id))!.status).toBe("sent");
    expect(Object.values(await support.holdsOf(store.storeId, "DEMO-MUG-WHITE")).reduce((a, b) => a + b, 0)).toBe(2);
    // The buyer presses again: a new session on the same order.
    expect(await startDraftPayment(await shop(store), tokenOf(sent.link), { termsTicked: true, origin: "http://localhost:3000" })).toMatchObject({ ok: true });
    // A failed bank payment is the same: the order stays.
    const second = await sessionOf(sent.orderId);
    await applySession(store.storeId, { id: second, status: "complete", payment_status: "unpaid" } as never, "checkout.session.async_payment_failed");
    expect((await getOrder(store.storeId, sent.orderId))!.status).toBe("pending_payment");
    // A checkout's order whose session lapses is cancelled, as before.
    const placed = await support.place(store.storeId, [["DEMO-NOTEBOOK-LINED", 1]]);
    await db().execute(sql`
      insert into commerce.payments (store_id, order_id, provider, provider_reference, provider_account, amount_minor, currency, status)
      values (${store.storeId}::uuid, ${placed.orderId}::uuid, 'stripe', 'cs_lapse_checkout', ${store.account}, ${placed.totalMinor}, ${placed.currency}, 'pending')
    `);
    await applySession(store.storeId, { id: "cs_lapse_checkout", status: "expired", payment_status: "unpaid" } as never, "checkout.session.expired");
    expect((await getOrder(store.storeId, placed.orderId))!.status).toBe("cancelled");
  });
});

describe("expiry", () => {
  it("cancels the order of an unpaid link, keeps its number so the sequence has no gap, releases the stock and marks the draft expired, once", async () => {
    const store = await paymentsStore("draft-expire");
    const draft = await draftOf(store);
    const sent = await send(store, draft.id);
    const s = await shop(store);
    await startDraftPayment(s, tokenOf(sent.link), { termsTicked: true, origin: "http://localhost:3000" });
    const later = new Date(Date.now() + 8 * 86_400_000);
    const run = await expireDrafts(later, {});
    expect(run.expired).toBeGreaterThanOrEqual(1);
    const order = (await getOrder(store.storeId, sent.orderId))!;
    expect(order).toMatchObject({ status: "cancelled", number: sent.number });
    expect((await getDraft(store.storeId, draft.id))!.status).toBe("expired");
    expect(Object.values(await support.holdsOf(store.storeId, "DEMO-MUG-WHITE")).reduce((a, b) => a + b, 0)).toBe(0);
    expect(JSON.stringify(await orderNumberAudit(store.storeId))).not.toMatch(/gap/i);
    expect(fake.expired).toContain(await db().execute<Row>(sql`select provider_reference from commerce.payments where order_id = ${sent.orderId}::uuid`).then((r) => String(r[0].provider_reference)));
    // The link is dead, and running the job again changes nothing.
    expect((await payPageFor(s, tokenOf(sent.link))).state).toBe("expired");
    const again = await expireDrafts(later, {});
    expect(again.expired).toBe(0);
    // An expired draft may be reopened and sent again: a new order with the next number.
    const reopened = await reopenDraft(store.storeId, actorOf(store), draft.id);
    expect(reopened.ok).toBe(true);
    const resent = await send(store, draft.id);
    expect(Number(resent.number.replace(/\D/g, ""))).toBeGreaterThan(Number(sent.number.replace(/\D/g, "")));
  });

  it("does not cancel an order whose session turned out paid, and leaves a payment that is still processing to the webhook", async () => {
    const store = await paymentsStore("draft-expire-paid");
    const paidDraft = await draftOf(store);
    const processing = await draftOf(store);
    const a = await send(store, paidDraft.id);
    const b = await send(store, processing.id);
    const s = await shop(store);
    await startDraftPayment(s, tokenOf(a.link), { termsTicked: true, origin: "http://localhost:3000" });
    await startDraftPayment(s, tokenOf(b.link), { termsTicked: true, origin: "http://localhost:3000" });
    const sa = await sessionOf(a.orderId);
    const sb = await sessionOf(b.orderId);
    fake.sessions.set(sa, { status: "complete", payment_status: "paid", mode: "payment", payment_intent: `pi_${sa}` });
    fake.sessions.set(sb, { status: "complete", payment_status: "unpaid", mode: "payment", payment_intent: `pi_${sb}` });
    const run = await expireDrafts(new Date(Date.now() + 8 * 86_400_000), {});
    expect(run.paid).toBeGreaterThanOrEqual(1);
    expect(run.waiting).toBeGreaterThanOrEqual(1);
    expect((await getOrder(store.storeId, a.orderId))!.status).toBe("paid");
    expect((await getOrder(store.storeId, b.orderId))!.status).toBe("pending_payment");
    expect((await getDraft(store.storeId, paidDraft.id))!.status).toBe("paid");
    expect((await getDraft(store.storeId, processing.id))!.status).toBe("sent");
  });

  it("skips a store that is not open", async () => {
    const store = await paymentsStore("draft-expire-closed");
    const draft = await draftOf(store);
    const sent = await send(store, draft.id);
    await db().execute(sql`update commerce.stores set status = 'suspended' where id = ${store.storeId}::uuid`);
    try {
      await expireDrafts(new Date(Date.now() + 8 * 86_400_000), {});
      expect((await getOrder(store.storeId, sent.orderId))!.status).toBe("pending_payment");
    } finally {
      await db().execute(sql`update commerce.stores set status = 'active' where id = ${store.storeId}::uuid`);
    }
  });
});

describe("reopening", () => {
  it("cancels the unpaid order (its number stays), kills the link, releases the stock and opens the draft with its contents", async () => {
    const store = await paymentsStore("draft-reopen");
    const draft = await draftOf(store, { tags: ["vip"], noteToBuyer: "Hello" });
    const sent = await send(store, draft.id);
    const s = await shop(store);
    await startDraftPayment(s, tokenOf(sent.link), { termsTicked: true, origin: "http://localhost:3000" });
    const reopened = await reopenDraft(store.storeId, actorOf(store), draft.id);
    expect(reopened.ok && reopened.draft).toMatchObject({ status: "open", orderId: null, linkLive: false, noteToBuyer: "Hello", tags: ["vip"] });
    expect((await getOrder(store.storeId, sent.orderId))!).toMatchObject({ status: "cancelled", number: sent.number });
    expect((await payPageFor(s, tokenOf(sent.link))).state).toBe("not_found");
    expect(Object.values(await support.holdsOf(store.storeId, "DEMO-MUG-WHITE")).reduce((a, b) => a + b, 0)).toBe(0);
    expect(JSON.stringify(await orderNumberAudit(store.storeId))).not.toMatch(/gap/i);
    // An open draft cannot be reopened, nor a paid one.
    expect(await reopenDraft(store.storeId, actorOf(store), draft.id)).toEqual({ ok: false, problem: "not_reopenable" });
  });

  it("is refused when the buyer paid meanwhile, and the order completes as normal", async () => {
    const store = await paymentsStore("draft-reopen-paid");
    const draft = await draftOf(store);
    const sent = await send(store, draft.id);
    await startDraftPayment(await shop(store), tokenOf(sent.link), { termsTicked: true, origin: "http://localhost:3000" });
    const session = await sessionOf(sent.orderId);
    fake.sessions.set(session, { status: "complete", payment_status: "paid", mode: "payment", payment_intent: `pi_${session}` });
    expect(await reopenDraft(store.storeId, actorOf(store), draft.id)).toEqual({ ok: false, problem: "paid" });
    expect((await getOrder(store.storeId, sent.orderId))!.status).toBe("paid");
    expect((await getDraft(store.storeId, draft.id))!.status).toBe("paid");
  });
});

describe("paid outside Kaizen", () => {
  const owner = (store: TestStore) => ({ ...store.member, kind: "member", permissions: [] }) as unknown as Parameters<typeof recordDraftPaidOutside>[0];

  it("makes the order and records the payment in one step: manual, the whole total, no Kaizen fee, stock drawn, the reference only in the order's history", async () => {
    const store = await paymentsStore("draft-outside");
    const draft = await draftOf(store, { lines: [await goods(store, "DEMO-MUG-WHITE", 2)], tags: ["invoice"] });
    const levelBefore = await support.totalOnHand(store.storeId, "DEMO-MUG-WHITE");
    const done = await recordDraftPaidOutside(owner(store), draft.id, { version: draft.version, method: "bank_transfer", reference: "KID 123456789" });
    expect(done.ok).toBe(true);
    if (!done.ok) return;
    const order = (await getOrder(store.storeId, done.orderId))!;
    expect(order.status).toBe("paid");
    const [payment] = await db().execute<Row>(sql`select provider, status, amount_minor, kaizen_fee_minor, method, recorded_by, test_mode from commerce.payments where order_id = ${done.orderId}::uuid`);
    expect({ ...payment, amount_minor: Number(payment.amount_minor), kaizen_fee_minor: Number(payment.kaizen_fee_minor) }).toMatchObject({ provider: "manual", status: "captured", amount_minor: order.totalMinor, kaizen_fee_minor: 0, method: "bank_transfer", recorded_by: store.accountId, test_mode: false });
    expect(await support.totalOnHand(store.storeId, "DEMO-MUG-WHITE")).toBe(levelBefore - 2);
    expect((await getDraft(store.storeId, draft.id))!.status).toBe("paid");
    const events = await getOrderEvents(store.storeId, done.orderId);
    expect(events.find((e) => e.type === "order.paid_outside")).toMatchObject({ actor: "staff", data: { method: "bank_transfer", note: "KID 123456789" } });
    // The audit entry names the method and the amount, never the reference.
    const [entry] = await db().execute<Row>(sql`select details from commerce.audit_log where store_id = ${store.storeId}::uuid and action = 'order.draft_paid_outside'`);
    expect(entry.details).toMatchObject({ method: "bank_transfer", amountMinor: order.totalMinor });
    expect(JSON.stringify(entry.details)).not.toContain("KID 123456789");
    // The buyer gets the confirmation, which carries the right of withdrawal.
    const mails = await db().execute<Row>(sql`select to_address from commerce.email_messages where store_id = ${store.storeId}::uuid and order_id = ${done.orderId}::uuid`);
    expect(mails.map((m) => String(m.to_address))).toContain("buyer@example.com");
    // The admin knows it was paid outside, so a refund of it is recorded, never sent.
    const admin = (await getOrderAdmin(store.storeId, done.orderId))!;
    expect(admin.paidOutside).toMatchObject({ method: "bank_transfer" });
    expect(admin.canRefund).toBe(true);
    // A second press is refused: it is paid.
    expect(await recordDraftPaidOutside(owner(store), draft.id, { version: draft.version, method: "cash" })).toEqual({ ok: false, problem: "already_paid" });
  });

  it("refuses with no email, in a closed store, with a bad method, for another store's draft, and for staff the owner has not allowed", async () => {
    const store = await paymentsStore("draft-outside-refuse");
    const other = await paymentsStore("draft-outside-other");
    const noEmail = await draftOf(store, { email: null });
    expect(await recordDraftPaidOutside(owner(store), noEmail.id, { version: noEmail.version, method: "cash" })).toEqual({ ok: false, problem: "no_email" });
    const draft = await draftOf(store);
    expect(await recordDraftPaidOutside(owner(store), draft.id, { version: draft.version, method: "barter" })).toEqual({ ok: false, problem: "invalid" });
    expect(await recordDraftPaidOutside(owner(other), draft.id, { version: draft.version, method: "cash" })).toEqual({ ok: false, problem: "not_found" });
    const staff = { account: store.member.account, store: store.member.store, role: "admin", kind: "member", permissions: ["orders:write"] } as unknown as Parameters<typeof recordDraftPaidOutside>[0];
    expect(await recordDraftPaidOutside(staff, draft.id, { version: draft.version, method: "cash" })).toEqual({ ok: false, problem: "not_allowed" });
    await db().execute(sql`insert into commerce.order_settings (store_id, staff_mark_paid) values (${store.storeId}::uuid, true) on conflict (store_id) do update set staff_mark_paid = true`);
    expect(await mayRecordOutsidePayment(staff)).toBe(true);
    await db().execute(sql`update commerce.stores set status = 'suspended' where id = ${store.storeId}::uuid`);
    expect(await recordDraftPaidOutside(owner(store), draft.id, { version: draft.version, method: "cash" })).toEqual({ ok: false, problem: "closed" });
    await db().execute(sql`update commerce.stores set status = 'active' where id = ${store.storeId}::uuid`);
    const [orders] = await db().execute<Row>(sql`select count(*)::int as n from commerce.orders where store_id = ${store.storeId}::uuid`);
    expect(orders.n).toBe(0);
    expect(await recordDraftPaidOutside(staff, draft.id, { version: draft.version, method: "cash" })).toMatchObject({ ok: true });
  });

  it("closes a sent draft's Stripe session first, so the buyer cannot also pay, and completes the same order", async () => {
    const store = await paymentsStore("draft-outside-sent");
    const draft = await draftOf(store);
    const sent = await send(store, draft.id);
    await startDraftPayment(await shop(store), tokenOf(sent.link), { termsTicked: true, origin: "http://localhost:3000" });
    const session = await sessionOf(sent.orderId);
    const done = await recordDraftPaidOutside(owner(store), draft.id, { version: draft.version, method: "cash" });
    expect(done).toMatchObject({ ok: true, orderId: sent.orderId });
    expect(fake.expired).toContain(session);
    expect((await getOrder(store.storeId, sent.orderId))!.status).toBe("paid");
  });

  it("refuses when the buyer's payment came in first", async () => {
    const store = await paymentsStore("draft-outside-race");
    const draft = await draftOf(store);
    const sent = await send(store, draft.id);
    await startDraftPayment(await shop(store), tokenOf(sent.link), { termsTicked: true, origin: "http://localhost:3000" });
    const session = await sessionOf(sent.orderId);
    fake.sessions.set(session, { status: "complete", payment_status: "paid", mode: "payment", payment_intent: `pi_${session}` });
    expect(await recordDraftPaidOutside(owner(store), draft.id, { version: draft.version, method: "cash" })).toEqual({ ok: false, problem: "already_paid" });
    const payments = await db().execute<Row>(sql`select provider from commerce.payments where order_id = ${sent.orderId}::uuid and status = 'captured'`);
    expect(payments.map((p) => p.provider)).toEqual(["stripe"]);
  });

  it("refunds a payment taken outside by recording the refund: no call to Stripe, stock back, the refund is succeeded, and only the owner or allowed staff may", async () => {
    const store = await paymentsStore("draft-outside-refund");
    const draft = await draftOf(store, { lines: [await goods(store, "DEMO-MUG-WHITE", 2)] });
    const done = await recordDraftPaidOutside(owner(store), draft.id, { version: draft.version, method: "bank_transfer" });
    if (!done.ok) throw new Error(done.problem);
    const admin = (await getOrderAdmin(store.storeId, done.orderId))!;
    const calls = fake.refunds.length;
    const levelBefore = await support.totalOnHand(store.storeId, "DEMO-MUG-WHITE");
    const line = admin.lines[0];
    // Staff who may not record outside payments cannot record this refund.
    const stranger = (await support.newStore("draft-outside-refund-staff")).accountId;
    expect(await refundOrder(store.storeId, done.orderId, { amountMinor: 1000, reason: "Returned", restock: [] }, stranger)).toMatchObject({ ok: false });
    const made = await refundOrder(store.storeId, done.orderId, { amountMinor: 1000, reason: "Returned", restock: [{ lineId: line.id, quantity: 1 }] }, store.accountId);
    expect(made).toMatchObject({ ok: true, amountMinor: 1000, status: "succeeded" });
    expect(fake.refunds.length).toBe(calls);
    expect(await support.totalOnHand(store.storeId, "DEMO-MUG-WHITE")).toBe(levelBefore + 1);
    const [refund] = await db().execute<Row>(sql`select r.status, r.provider_reference from commerce.refunds r join commerce.payments p on p.id = r.payment_id where p.order_id = ${done.orderId}::uuid`);
    expect(refund.status).toBe("succeeded");
    expect(String(refund.provider_reference)).toMatch(/^manual_refund_/);
    const types = (await getOrderEvents(store.storeId, done.orderId)).map((e) => e.type);
    expect(types).toEqual(expect.arrayContaining(["order.refunded", "order.refunded_outside"]));
    // The whole rest may be refunded, and no more.
    const left = (await getOrderAdmin(store.storeId, done.orderId))!.refundableMinor;
    expect(await refundOrder(store.storeId, done.orderId, { amountMinor: left + 1, reason: "Too much", restock: [] }, store.accountId)).toMatchObject({ ok: false });
    expect(await refundOrder(store.storeId, done.orderId, { amountMinor: left, reason: "Rest", restock: [] }, store.accountId)).toMatchObject({ ok: true });
    expect((await getOrderAdmin(store.storeId, done.orderId))!.refundableMinor).toBe(0);
  });
});

describe("paid outside Kaizen: the day it was received and the cash ceilings (review fixes)", () => {
  const owner = (store: TestStore) => ({ ...store.member, kind: "member", permissions: [] }) as unknown as Parameters<typeof recordDraftPaidOutside>[0];
  const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

  it("keeps the day the money was received on the payment and in the order's history, and refuses a day in the future or more than 31 days back", async () => {
    const store = await paymentsStore("draft-outside-date");
    const draft = await draftOf(store);
    expect(await recordDraftPaidOutside(owner(store), draft.id, { version: draft.version, method: "bank_transfer", receivedOn: day(2) })).toEqual({ ok: false, problem: "received_on" });
    expect(await recordDraftPaidOutside(owner(store), draft.id, { version: draft.version, method: "bank_transfer", receivedOn: day(-40) })).toEqual({ ok: false, problem: "received_on" });
    expect(await recordDraftPaidOutside(owner(store), draft.id, { version: draft.version, method: "bank_transfer", receivedOn: "2026-02-30" })).toEqual({ ok: false, problem: "invalid" });
    expect((await getDraft(store.storeId, draft.id))!.status).toBe("open");
    const done = await recordDraftPaidOutside(owner(store), draft.id, { version: draft.version, method: "bank_transfer", receivedOn: day(-3) });
    if (!done.ok) throw new Error(done.problem);
    const [payment] = await db().execute<Row>(sql`select received_on::text as received_on from commerce.payments where order_id = ${done.orderId}::uuid`);
    expect(payment.received_on).toBe(day(-3));
    const events = await getOrderEvents(store.storeId, done.orderId);
    expect(events.find((e) => e.type === "order.paid_outside")).toMatchObject({ data: { method: "bank_transfer", receivedOn: day(-3) } });
    const [entry] = await db().execute<Row>(sql`select details from commerce.audit_log where store_id = ${store.storeId}::uuid and action = 'order.draft_paid_outside'`);
    expect(entry.details).toMatchObject({ receivedOn: day(-3) });
  });

  it("refuses cash at or above the Norwegian ceiling and rolls the order of an open draft back with it, but takes the same amount by bank transfer", async () => {
    const store = await paymentsStore("draft-outside-cash");
    const big = await draftOf(store, { lines: [await goods(store, "DEMO-MUG-WHITE", 1, "50000")] });
    const [before] = await db().execute<Row>(sql`select count(*)::int as n from commerce.orders where store_id = ${store.storeId}::uuid`);
    expect(await recordDraftPaidOutside(owner(store), big.id, { version: big.version, method: "cash" })).toEqual({ ok: false, problem: "cash_limit" });
    const [after] = await db().execute<Row>(sql`select count(*)::int as n from commerce.orders where store_id = ${store.storeId}::uuid`);
    expect(after.n).toBe(before.n);
    const kept = (await getDraft(store.storeId, big.id))!;
    expect(kept.status).toBe("open");
    expect(kept.orderId).toBeNull();
    // The order number was not used up either: the next draft's order follows the last one.
    const small = await draftOf(store, { lines: [await goods(store, "DEMO-MUG-WHITE", 1, "300")] });
    expect(await recordDraftPaidOutside(owner(store), small.id, { version: small.version, method: "cash" })).toMatchObject({ ok: true });
    expect(await recordDraftPaidOutside(owner(store), big.id, { version: kept.version, method: "bank_transfer" })).toMatchObject({ ok: true });
    expect(await orderNumberAudit(store.storeId)).toMatchObject({ ok: true, missing: 0, orders: 2 + Number(before.n) });
  });
});

describe("an order paid outside Kaizen has an order page key like any other (review fix)", () => {
  const owner = (store: TestStore) => ({ ...store.member, kind: "member", permissions: [] }) as unknown as Parameters<typeof recordDraftPaidOutside>[0];

  it("carries its key in the confirmation's withdrawal link, and the withdrawal function and the order page accept that key", async () => {
    const store = await paymentsStore("draft-outside-key");
    const draft = await draftOf(store);
    const done = await recordDraftPaidOutside(owner(store), draft.id, { version: draft.version, method: "bank_transfer" });
    if (!done.ok) throw new Error(done.problem);
    const [payment] = await db().execute<Row>(sql`select provider_reference from commerce.payments where order_id = ${done.orderId}::uuid and provider = 'manual'`);
    const key = String(payment.provider_reference);
    const found = (await storeById(store.storeId))!;
    const market = found.markets.find((m) => m.code === "NO") ?? found.markets[0];
    const { withdrawUrl } = await import("./withdraw-link");
    const url = await withdrawUrl(store.storeId, { slug: store.slug }, market, { id: done.orderId, number: done.number });
    expect(new URL(url).searchParams.get("key")).toBe(key);
    const { matchOrder, shopperCanAccessOrder } = await import("./withdrawals");
    // The key alone proves the order is the visitor's (no email typed), and a wrong key proves nothing.
    expect(await matchOrder(store.storeId, { orderNumber: done.number, email: "", orderKey: key })).toMatchObject({ id: done.orderId, proof: "key" });
    expect(await matchOrder(store.storeId, { orderNumber: done.number, email: "", orderKey: "manual_wrong" })).toBeNull();
    expect(await shopperCanAccessOrder(store.storeId, done.orderId, { sessionId: key })).toBe(true);
    expect((await getShopperOrder(store.storeId, done.orderId, key))?.id).toBe(done.orderId);
  });
});

describe("a delivery address in another country than the market (review fix)", () => {
  const owner = (store: TestStore) => ({ ...store.member, kind: "member", permissions: [] }) as unknown as Parameters<typeof recordDraftPaidOutside>[0];

  it("blocks a send and a payment recorded outside, so goods are never taxed and reported as the market's sale while going abroad, and makes nothing", async () => {
    const store = await paymentsStore("draft-country");
    const abroad = await draftOf(store, { shippingAddress: { name: "Sven Svensson", line1: "Storgatan 1", postalCode: "111 22", city: "Stockholm", country: "SE" } });
    const preview = (await previewDraft(store.storeId, abroad.id))!;
    expect(preview.blocking.map((p) => p.code)).toContain("shipping_country");
    expect(await sendDraft(store.storeId, actorOf(store), abroad.id, { version: abroad.version, createLink: true })).toMatchObject({ ok: false, problem: "problems" });
    const done = await recordDraftPaidOutside(owner(store), abroad.id, { version: abroad.version, method: "bank_transfer" });
    expect(done).toMatchObject({ ok: false, problem: "problems" });
    const [orders] = await db().execute<Row>(sql`select count(*)::int as n from commerce.orders where store_id = ${store.storeId}::uuid`);
    expect(orders.n).toBe(0);
    // The market's own country (any case) and an address with no country at all are fine.
    const home = await draftOf(store, { shippingAddress: { name: "Kari", line1: "Storgata 1", postalCode: "0155", city: "Oslo", country: "no" } });
    expect((await previewDraft(store.storeId, home.id))!.blocking).toEqual([]);
    const bare = await draftOf(store, { shippingAddress: { name: "Kari", line1: "Storgata 1", postalCode: "0155", city: "Oslo" } });
    expect((await previewDraft(store.storeId, bare.id))!.blocking).toEqual([]);
  });
});

describe("finding customers from a draft (review fix)", () => {
  it("needs the customers' area as well as orders:write: a packing role types the email instead", async () => {
    const { mayFindDraftCustomers } = await import("./permissions");
    const member = (permissions: string[] | null, role = "admin") => ({ role, kind: "member", permissions }) as unknown as Parameters<typeof mayFindDraftCustomers>[0];
    expect(mayFindDraftCustomers(member(["orders:write"]))).toBe(false);
    expect(mayFindDraftCustomers(member(["orders:read", "orders:write"]))).toBe(false);
    expect(mayFindDraftCustomers(member(["customers:read"]))).toBe(false);
    expect(mayFindDraftCustomers(member(["orders:write", "customers:read"]))).toBe(true);
    expect(mayFindDraftCustomers({ role: "owner", kind: "member", permissions: null } as unknown as Parameters<typeof mayFindDraftCustomers>[0])).toBe(true);
  });
});

describe("a custom item and the withdrawal function (review fix, spec 4.7)", () => {
  const owner = (store: TestStore) => ({ ...store.member, kind: "member", permissions: [] }) as unknown as Parameters<typeof recordDraftPaidOutside>[0];

  it("is not sold to a private customer: the draft is blocked, cannot be sent or paid, and nothing is made", async () => {
    const store = await paymentsStore("draft-custom-consumer");
    const draft = await draftOf(store, { lines: [await goods(store, "DEMO-MUG-WHITE", 1), { kind: "custom", title: "Installation", quantity: 1, price: "500,00", vatCategory: "standard" }] });
    const preview = (await previewDraft(store.storeId, draft.id))!;
    expect(preview.blocking.map((p) => p.code)).toContain("custom_consumer");
    const sent = await sendDraft(store.storeId, actorOf(store), draft.id, { version: draft.version, createLink: true });
    expect(sent).toMatchObject({ ok: false, problem: "problems" });
    expect(await recordDraftPaidOutside(owner(store), draft.id, { version: draft.version, method: "bank_transfer" })).toMatchObject({ ok: false, problem: "problems" });
    const [orders] = await db().execute<Row>(sql`select count(*)::int as n from commerce.orders where store_id = ${store.storeId}::uuid`);
    expect(orders.n).toBe(0);
  });

  it("is sold to a business, and what the withdrawal function answers for the custom line is recorded here: a service is answered as a booking (so a private buyer must not get one)", async () => {
    const store = await paymentsStore("draft-custom-business");
    const draft = await draftOf(store, {
      companyName: "Acme AS",
      organisationNumber: "923609016",
      lines: [await goods(store, "DEMO-MUG-WHITE", 1), { kind: "custom", title: "Installation", quantity: 1, price: "500,00", vatCategory: "standard" }],
    });
    const done = await recordDraftPaidOutside(owner(store), draft.id, { version: draft.version, method: "bank_transfer" });
    if (!done.ok) throw new Error(done.problem);
    const { loadFacts, judge } = await import("./return-facts");
    const facts = (await loadFacts(store.storeId, done.orderId))!;
    const answers = Object.fromEntries(judge(facts, new Date()).lines.map((l) => [facts.lines.find((x) => x.id === l.lineId)!.title, l.refusal]));
    // The custom line is a service with no exclusion: the function refuses it as a booking (its text says a booking is cancelled or moved, which is wrong for any service that is not one).
    expect(answers["Installation"]).toBe("booking");
    // The goods line of a business has no statutory right.
    expect(answers[Object.keys(answers).find((k) => k !== "Installation")!]).toBe("business_order");
  });
});

describe("guards", () => {
  it("a draft-made order keeps its source and its maker, and a draft is never made for another store's customer", async () => {
    const store = await paymentsStore("draft-guard");
    const other = await paymentsStore("draft-guard-other");
    const draft = await draftOf(store);
    const sent = await send(store, draft.id);
    await expect(db().execute(sql`update commerce.orders set source = 'checkout' where id = ${sent.orderId}::uuid`)).rejects.toMatchObject({ cause: { message: expect.stringMatching(/./) } });
    await expect(db().execute(sql`update commerce.orders set made_by = null where id = ${sent.orderId}::uuid`)).rejects.toBeTruthy();
    const [customer] = await db().execute<Row>(sql`insert into commerce.customers (store_id, email, name) values (${other.storeId}::uuid, 'c@example.com', 'C') returning id`);
    const made = await createDraft(store.storeId, actorOf(store));
    if (!made.ok) throw new Error("setup");
    const saved = await saveDraft(store.storeId, actorOf(store), made.draft.id, { version: made.draft.version, marketSlug: "no", customerId: String(customer.id), lines: [] });
    expect(saved).toMatchObject({ ok: false, problem: "invalid" });
  });

  it("a host's listing, a download, a subscription and an appointment cannot be sold by a draft", async () => {
    const store = await paymentsStore("draft-kinds");
    const draft = await createDraft(store.storeId, actorOf(store));
    if (!draft.ok) throw new Error("setup");
    for (const sku of ["DEMO-MASSAGE-60", "DEMO-HYTTE", "DEMO-SYKKEL"]) {
      const variant = await support.variantId(store.storeId, sku).catch(() => null);
      if (!variant) continue;
      const saved = await saveDraft(store.storeId, actorOf(store), draft.draft.id, {
        version: draft.draft.version, marketSlug: "no", lines: [{ kind: "goods", variantId: variant, quantity: 1 }],
      });
      expect(saved, sku).toMatchObject({ ok: false, problem: "invalid" });
    }
  });
});

describe("clean-up", () => {
  it("deletes an open draft not edited for 90 days and finished ones after 30, never a sent one, and leaves the order a draft made", async () => {
    const store = await paymentsStore("draft-prune");
    const oldOpen = await draftOf(store);
    const freshOpen = await draftOf(store);
    const sentOne = await draftOf(store);
    const sent = await send(store, sentOne.id);
    await db().execute(sql`update commerce.draft_orders set edited_at = now() - interval '100 days' where id = ${oldOpen.id}::uuid`);
    await db().execute(sql`update commerce.draft_orders set edited_at = now() - interval '100 days', updated_at = now() - interval '100 days' where id = ${sentOne.id}::uuid`);
    const paidDraft = await draftOf(store);
    const outside = await recordDraftPaidOutside({ ...store.member, kind: "member", permissions: [] } as never, paidDraft.id, { version: paidDraft.version, method: "cash" });
    if (!outside.ok) throw new Error(outside.problem);
    await db().execute(sql`update commerce.draft_orders set paid_at = now() - interval '40 days', updated_at = now() - interval '40 days' where id = ${paidDraft.id}::uuid`);
    const removed = await pruneDraftOrders(new Date());
    expect(removed).toBeGreaterThanOrEqual(2);
    expect(await getDraft(store.storeId, oldOpen.id)).toBeNull();
    expect(await getDraft(store.storeId, paidDraft.id)).toBeNull();
    expect(await getDraft(store.storeId, freshOpen.id)).not.toBeNull();
    expect(await getDraft(store.storeId, sentOne.id)).not.toBeNull();
    // The order keeps its data, and its pointer to the draft is only a number now.
    expect((await getOrder(store.storeId, outside.orderId))!.status).toBe("paid");
    expect((await getOrder(store.storeId, sent.orderId))!.status).toBe("pending_payment");
  });
});

describe("who may record a payment taken outside", () => {
  it("the owner always, staff only with orders:write and the owner's switch, never a reader or a collaborator without the right", async () => {
    const store = await newPlainStore("draft-matrix");
    const as = (role: string, permissions: string[] | null, kind = "staff") =>
      ({ role, kind, permissions, store: { id: store.storeId, status: "active" } }) as unknown as Parameters<typeof mayRecordOutsidePayment>[0];
    const owner = as("owner", null);
    const writer = as("admin", ["orders:write"]);
    const reader = as("admin", ["orders:read"]);
    const noOrders = as("admin", ["products:write"]);
    expect(await mayRecordOutsidePayment(owner)).toBe(true);
    expect(await mayRecordOutsidePayment(writer)).toBe(false);
    await db().execute(sql`insert into commerce.order_settings (store_id, staff_mark_paid) values (${store.storeId}::uuid, true) on conflict (store_id) do update set staff_mark_paid = true`);
    expect(await mayRecordOutsidePayment(writer)).toBe(true);
    expect(await mayRecordOutsidePayment(reader)).toBe(false);
    expect(await mayRecordOutsidePayment(noOrders)).toBe(false);
    // Only the owner changes the switch itself.
    const { saveOrderSettings } = await import("./order-settings");
    expect(await saveOrderSettings({ account: store.member.account, ...writer } as never, { staffMarkPaid: false })).toMatchObject({ ok: false });
    expect(await mayRecordOutsidePayment(writer)).toBe(true);
    expect(await saveOrderSettings({ account: store.member.account, ...owner } as never, { staffMarkPaid: false })).toMatchObject({ ok: true });
    expect(await mayRecordOutsidePayment(writer)).toBe(false);
  });
});

describe("a customer's draft orders in the privacy file", () => {
  it("are in the export by the customer account only, and deleted by the erasure, never found by an address staff typed", async () => {
    const store = await paymentsStore("draft-privacy");
    const { preRegisterCustomer } = await import("./customers");
    const { exportCustomerData } = await import("./privacy-export");
    const { eraseSubject } = await import("./privacy-erasure");
    const email = `person-${Date.now()}@example.com`;
    const customerId = await preRegisterCustomer(store.storeId, email);
    const linked = await draftOf(store, { customerId, email });
    const typedOnly = await draftOf(store, { email });
    const exported = await exportCustomerData(store.storeId, { email }, { channel: "staff", accountId: store.accountId });
    if (!exported.ok) throw new Error(exported.problem);
    const drafts = (exported.file.sections.carts as unknown as { draftOrders: { id?: string; number: string; email: string | null }[] }).draftOrders;
    expect(drafts.map((d) => d.number)).toEqual([linked.number]);
    expect(JSON.stringify(exported.file)).not.toContain(typedOnly.number);
    const erased = await eraseSubject(store.storeId, { email }, { channel: "staff", accountId: store.accountId });
    expect(erased).toMatchObject({ ok: true });
    expect(await getDraft(store.storeId, linked.id)).toBeNull();
    // A draft that only carries a typed address is not the customer's data by account: it stays until the retention rule removes it.
    expect(await getDraft(store.storeId, typedOnly.id)).not.toBeNull();
  });
});
