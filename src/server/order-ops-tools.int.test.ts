import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { formatMoney } from "@/lib/money";
import { BULK_REASON_TEXT } from "@/lib/order-bulk";
import { ROLE_TEMPLATES, type PermissionHolder } from "@/lib/permissions";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));

/** Kaizen's platform Stripe client, faked: a draft's pay link opens a hosted session; nothing here is a real call. */
const fake = vi.hoisted(() => {
  const sessions = new Map<string, Record<string, unknown>>();
  let next = 0;
  const client = {
    refunds: { create: async () => ({ id: `re_${++next}`, status: "succeeded" }) },
    coupons: { create: async () => ({ id: `coupon_${++next}` }) },
    checkout: {
      sessions: {
        create: async (params: Record<string, unknown>) => {
          const id = `cs_tools_${++next}`;
          sessions.set(id, { status: "open", payment_status: "unpaid", mode: params.mode, metadata: params.metadata, payment_intent: null });
          return { id, url: `https://checkout.stripe.test/${id}`, client_secret: `${id}_secret_test`, payment_method_types: ["card"] };
        },
        retrieve: async (id: string) => ({ id, ...sessions.get(id) }),
        expire: async (id: string) => ({ id }),
      },
    },
  };
  return { client };
});
vi.mock("./stripe", () => ({ platformStripe: () => fake.client, platformPublishableKey: () => "pk_test_tools", platformModes: () => ["test"], WEBHOOK_EVENTS: [] }));

const ownerTools = await import("./owner-tools");
const { getDraft, listDrafts, previewDraft, saveDraft } = await import("./draft-orders");
const { controlCenter } = await import("./control-center");
const { staffActor } = await import("./order-actor");
const { orderNumberAudit } = await import("./order-numbers");
const { getStore } = await import("./stores");
const { newPlainStore, seedOrder } = await import("./order-ops-fixture");

type Row = Record<string, unknown>;
type TestStore = import("./inventory-test-support").TestStore;

/**
 * The AI manager's order tools against a real database (wave 3, run 2, D173, `docs/wave-3-orders.md` 2.6 and 5.5, `src/server/order-ops-tools.ts`): the widened `list_orders` answers
 * as the Orders page does (the page's own query, archived orders found by a search, an erased person never named or found by name, nothing of another store's); `tag_orders` and
 * `archive_orders` run the page's bulk engine (per order, each refusal in words, copied history taggable, one audit entry per call with counts); `create_draft_order` makes a DRAFT only
 * (no order number used, no stock held, nothing sent) priced by the store, a euro market included; `send_draft_order` is refused before it is kept for a yes when the draft cannot be
 * sent, and when approved makes the numbered order and holds the goods; `refund_order` refuses money taken outside Kaizen. Stripe is the fake above.
 */

afterAll(async () => {
  await closeDb();
});

const readOnly: PermissionHolder = { role: "admin", permissions: ROLE_TEMPLATES.read_only.permissions };

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

async function ctxOf(store: TestStore, holder?: PermissionHolder) {
  const full = (await getStore(store.slug))!;
  return { account: store.member.account, store: full, invalidate: () => {}, holder };
}

/** What a tool answers: JSON the model repeats, read here by its keys. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Answer = Record<string, any>;
const run = async (store: TestStore, tool: string, input: unknown, holder?: PermissionHolder) => ownerTools.runOwnerTool(await ctxOf(store, holder), tool, input) as Promise<Answer>;
const refusalOf = async (promise: Promise<unknown>) => {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ownerTools.OwnerToolError);
  return (error as Error).message;
};

/** An amount as the store writes it to the assistant: in the language of its first market (the draft's own market for a draft). */
const moneyIn = async (store: TestStore, minor: number, currency = "NOK") => formatMoney(minor, currency, (await getStore(store.slug))!.markets[0].locale);
const MUG = "DEMO-MUG-WHITE";

describe("list_orders, widened", () => {
  it("answers as the page does: the filters are the page's, archived orders are left out unless asked for or searched for, and a tag finds its orders", async () => {
    const store = await newPlainStore("tool-list");
    const vip = await seedOrder(store, { captured: true, tags: ["VIP"], name: "Kari Nordmann", email: "kari@example.com", totalMinor: 123_450 });
    const archived = await seedOrder(store, { captured: true, status: "fulfilled", archived: true, tags: ["VIP"], name: "Arne Arkiv", email: "arne@example.com", tracking: "TRK-777" });
    await seedOrder(store, { captured: true, name: "Per Plain", email: "per@example.com", lines: [{ title: "Notebook", sku: "NB-1", quantity: 1 }] });
    await seedOrder(store, { status: "pending_payment", name: "Una Unpaid", email: "una@example.com" });

    const all = await run(store, "list_orders", { limit: 50 });
    expect(all.count).toBe(2);
    expect(all.orders.map((o: Row) => o.number)).not.toContain(archived.number);

    const tagged = await run(store, "list_orders", { tag: ["vip"], archived: "all" });
    expect(tagged.orders.map((o: Row) => o.number).sort()).toEqual([vip.number, archived.number].sort());
    expect(tagged.orders.find((o: Row) => o.number === vip.number)).toMatchObject({ customer: "Kari Nordmann", email: "kari@example.com", tags: ["VIP"], payment: "Paid", total: await moneyIn(store, 123_450) });
    expect(tagged.orders.find((o: Row) => o.number === archived.number)).toMatchObject({ archived: true });

    // A search finds an archived order by its tracking number, and a product by its SKU; the words are the page's.
    expect((await run(store, "list_orders", { search: "trk-777" })).orders.map((o: Row) => o.number)).toEqual([archived.number]);
    expect((await run(store, "list_orders", { search: "NB-1" })).count).toBe(1);
    expect((await run(store, "list_orders", { search: `#${vip.number}` })).orders.map((o: Row) => o.number)).toEqual([vip.number]);
    expect((await run(store, "list_orders", { show: "archived" })).orders.map((o: Row) => o.number)).toEqual([archived.number]);
    expect((await run(store, "list_orders", { which: "unpaid" })).count).toBe(1);
    expect((await run(store, "list_orders", { pay: ["unpaid"] })).count).toBe(1);
    expect((await run(store, "list_orders", { ship: ["to_send"] })).count).toBe(2);
  });

  it("walks every order once with a page size of two, the cursor in `next`, and sorts by total", async () => {
    const store = await newPlainStore("tool-page");
    const numbers: string[] = [];
    for (let i = 0; i < 5; i += 1) numbers.push((await seedOrder(store, { captured: true, totalMinor: 10_000 + i * 1_000, placedAt: new Date(Date.UTC(2026, 8, 1 + i)) })).number);
    const seen: string[] = [];
    let after: string | undefined;
    for (let pass = 0; pass < 6; pass += 1) {
      const page = await run(store, "list_orders", { limit: 2, ...(after ? { after } : {}) });
      seen.push(...page.orders.map((o: Row) => String(o.number)));
      if (!page.next) break;
      after = page.next;
    }
    expect(seen).toEqual([...numbers].reverse());
    const cheapest = await run(store, "list_orders", { sort: "total_asc", limit: 1 });
    expect(cheapest.orders[0].number).toBe(numbers[0]);
    expect(cheapest.orders[0].total).toBe(await moneyIn(store, 10_000));
    // A junk cursor is the first page, never an error.
    expect((await run(store, "list_orders", { after: "not-a-real-cursor", limit: 1 })).orders[0].number).toBe(numbers[4]);
  });

  it("never names an erased person or finds one by name or email, and never shows another store's orders", async () => {
    const store = await newPlainStore("tool-erased");
    const other = await newPlainStore("tool-erased-other");
    const erased = await seedOrder(store, { captured: true, restricted: true, name: "Elin Erased", email: "elin@example.com", tags: ["secret-tag"] });
    await seedOrder(other, { captured: true, name: "Elin Erased", email: "elin@example.com", tags: ["secret-tag"] });
    const byName = await run(store, "list_orders", { search: "Elin" });
    expect(byName.count).toBe(0);
    expect((await run(store, "list_orders", { search: "elin@example.com" })).count).toBe(0);
    const listed = await run(store, "list_orders", {});
    expect(listed.orders).toHaveLength(1);
    expect(listed.orders[0]).toMatchObject({ number: erased.number, customer: "(personal data removed or restricted)" });
    expect(JSON.stringify(listed)).not.toMatch(/Elin|elin@example|secret-tag/);
    // The other store sees its own Elin and only that one.
    expect((await run(other, "list_orders", { search: "Elin" })).count).toBe(1);
  });
});

describe("tag_orders and archive_orders", () => {
  it("tag and untag by number, copied history included, say what they did, and write one audit entry of counts", async () => {
    const store = await newPlainStore("tool-tag");
    const a = await seedOrder(store, { captured: true });
    // History copied from another store is taggable too (and has no payment of its own).
    const copied = await seedOrder(store, { copied: true });
    const answer = await run(store, "tag_orders", { orders: [a.number, copied.number], add: ["VIP", "gift wrap"] });
    expect(answer.done).toBe("Tagged 2 of 2 orders.");
    expect(answer.not_done).toEqual([]);
    const tags = await db().execute<Row>(sql`select o.number, t.label from commerce.order_tags t join commerce.orders o on o.id = t.order_id where t.store_id = ${store.storeId}::uuid order by o.number collate "C", t.label collate "C"`);
    expect(tags.map((r) => [r.number, r.label])).toEqual([[a.number, "VIP"], [a.number, "gift wrap"], [copied.number, "VIP"], [copied.number, "gift wrap"]].sort());
    const removed = await run(store, "tag_orders", { orders: [a.number], remove: ["vip"] });
    expect(removed.done).toBe("Took tags off 1 of 1 order.");
    expect((await run(store, "get_order", { order: a.number })).tags).toEqual(["gift wrap"]);
    // A tag change is in the order's history and in the audit log by count, never the numbers or the tags.
    const events = await db().execute<Row>(sql`select type from commerce.order_events where store_id = ${store.storeId}::uuid and order_id = ${a.id}::uuid and type = 'order.tags_changed'`);
    expect(events.length).toBe(2);
    const audits = await db().execute<Row>(sql`select details from commerce.audit_log where store_id = ${store.storeId}::uuid and action = 'order.bulk_tagged' order by id`);
    expect(audits).toHaveLength(2);
    expect(JSON.stringify(audits)).not.toContain(a.number);
    expect(JSON.stringify(audits)).not.toMatch(/VIP|gift wrap/);
  });

  it("refuses a bad tag before anything runs, and reports an order that is not this store's as not found without touching it", async () => {
    const store = await newPlainStore("tool-tag-bad");
    const other = await newPlainStore("tool-tag-bad-other");
    const mine = await seedOrder(store, { captured: true });
    const theirs = await seedOrder(other, { captured: true });
    expect(await refusalOf(run(store, "tag_orders", { orders: [mine.number], add: ["a,b"] }))).toMatch(/cannot be empty, hold a comma/);
    expect(await refusalOf(run(store, "tag_orders", { orders: [mine.number] }))).toMatch(/Say which tags/);
    // A number is the store's own (both stores have an order 1001): it is found in this store or not at all; an id of another store's is nothing here.
    expect(theirs.number).toBe(mine.number);
    const mixed = await run(store, "tag_orders", { orders: [mine.number, theirs.id, "999999"], add: ["x"] });
    expect(mixed.done).toBe("Tagged 1 of 1 order.");
    expect(mixed.not_found).toEqual([theirs.id, "999999"]);
    expect((await db().execute<Row>(sql`select 1 from commerce.order_tags where store_id = ${other.storeId}::uuid`)).length).toBe(0);
    // Nothing of this store's orders: refused whole.
    expect(await refusalOf(run(store, "tag_orders", { orders: [theirs.id], add: ["x"] }))).toMatch(/No such order/);
  });

  it("archive only what needs no more work, say why for the rest in the page's own words, and bring orders back", async () => {
    const store = await newPlainStore("tool-archive");
    const done = await seedOrder(store, { captured: true, status: "fulfilled" });
    const toSend = await seedOrder(store, { captured: true });
    const unpaid = await seedOrder(store, { status: "pending_payment" });
    const answer = await run(store, "archive_orders", { orders: [done.number, toSend.number, unpaid.number] });
    expect(answer.done).toBe("Archived 1 of 3 orders.");
    expect(answer.not_done).toEqual(
      expect.arrayContaining([
        { order: toSend.number, why: BULK_REASON_TEXT.needs_sending },
        { order: unpaid.number, why: BULK_REASON_TEXT.unfinished_checkout },
      ]),
    );
    expect((await run(store, "list_orders", {})).orders.map((o: Row) => o.number)).not.toContain(done.number);
    // Archiving changes no number, amount or document: the order is the same order, found by its number.
    expect((await run(store, "get_order", { order: done.number })).archived).toBe(true);
    expect((await orderNumberAudit(store.storeId)).missing).toBe(0);
    const back = await run(store, "archive_orders", { orders: [done.number], archived: false });
    expect(back.done).toBe("Brought back 1 of 1 order.");
    expect((await run(store, "list_orders", {})).orders.map((o: Row) => o.number)).toContain(done.number);
    const again = await run(store, "archive_orders", { orders: [done.number], archived: false });
    expect(again.not_done).toEqual([{ order: done.number, why: BULK_REASON_TEXT.not_archived }]);
  });

  it("are refused to a role that can only look, before any handler runs", async () => {
    const store = await newPlainStore("tool-role");
    const order = await seedOrder(store, { captured: true });
    expect(await refusalOf(run(store, "tag_orders", { orders: [order.number], add: ["x"] }, readOnly))).toBe("I can't do that for you: your role has no access to orders.");
    expect(await refusalOf(run(store, "archive_orders", { orders: [order.number] }, readOnly))).toBe("I can't do that for you: your role has no access to orders.");
    expect(await refusalOf(run(store, "create_draft_order", { email: "a@b.no", lines: [{ sku: MUG, quantity: 1 }] }, readOnly))).toMatch(/no access to orders/);
    // Looking is the read's.
    expect(await run(store, "list_draft_orders", {}, readOnly)).toMatchObject({ count: 0 });
    expect((await run(store, "list_orders", {}, readOnly)).count).toBe(1);
  });
});

describe("get_order and refund_order for the new kinds of order", () => {
  it("says an order is staff-made, tagged, archived and a gift, and gives none of the gift's words to the model", async () => {
    const store = await newPlainStore("tool-get");
    const made = await seedOrder(store, { captured: true, status: "fulfilled", archived: true, tags: ["rush"], draft: { accountId: store.accountId }, gift: { to: "Mormor", from: "Kari", message: "SECRET-GIFT-WORDS" } });
    const view = await run(store, "get_order", { order: made.number });
    expect(view).toMatchObject({ staff_made: true, archived: true, tags: ["rush"], gift: true });
    expect(JSON.stringify(view)).not.toMatch(/SECRET-GIFT-WORDS|Mormor/);
    const listed = await run(store, "list_orders", { archived: "all", source: "draft" });
    expect(listed.orders[0]).toMatchObject({ number: made.number, staff_made: true, gift: true, archived: true });
    expect(JSON.stringify(listed)).not.toContain("SECRET-GIFT-WORDS");
  });

  it("refuses to refund an order paid outside Kaizen, and says where that is done; a Stripe order is refunded as before", async () => {
    const store = await newPlainStore("tool-outside");
    const outside = await seedOrder(store, { status: "paid", draft: { accountId: store.accountId } });
    await db().execute(sql`
      insert into commerce.payments (store_id, order_id, provider, provider_reference, amount_minor, currency, status, method, recorded_by)
      values (${store.storeId}::uuid, ${outside.id}::uuid, 'manual', ${`manual_${outside.id}`}, 10000, 'NOK', 'captured', 'cash', ${store.accountId}::uuid)
    `);
    const message = await refusalOf(run(store, "refund_order", { order: outside.number, reason: "customer asked" }));
    expect(message).toMatch(/paid outside Kaizen \(cash\)/);
    expect(message).toMatch(/records the refund on the order's page/);
    expect((await db().execute<Row>(sql`select 1 from commerce.refunds where store_id = ${store.storeId}::uuid`)).length).toBe(0);
    expect(await run(store, "get_order", { order: outside.number })).toMatchObject({ paid_outside_kaizen: "cash", staff_made: true });
  });
});

describe("create_draft_order", () => {
  it("writes a draft only: no order, no number, no stock held, nothing sent; the summary is the store's own pricing in the market's currency", async () => {
    const store = await paymentsStore("tool-draft");
    const before = await orderNumberAudit(store.storeId);
    const answer = await run(store, "create_draft_order", { email: "kari@example.com", lines: [{ sku: MUG, quantity: 2 }] });
    expect(answer.draft).toBe("D-1");
    expect(answer.status).toBe("Open");
    expect(answer.done).toMatch(/Nothing has been sent, no order number is used and no stock is held/);
    const [orders] = await db().execute<Row>(sql`select count(*)::int as n from commerce.orders where store_id = ${store.storeId}::uuid`);
    const [holds] = await db().execute<Row>(sql`select count(*)::int as n from commerce.inventory_reservations where store_id = ${store.storeId}::uuid`);
    expect([orders.n, holds.n]).toEqual([0, 0]);
    expect(await orderNumberAudit(store.storeId)).toEqual(before);
    // The figures are `previewDraft()`'s, written with formatMoney: the model works out nothing.
    const drafts = await listDrafts(store.storeId);
    const preview = (await previewDraft(store.storeId, drafts.rows[0].id))!;
    const inMarket = (minor: number) => formatMoney(minor, preview.draft.currency, preview.market!.locale);
    expect(answer.total).toBe(inMarket(preview.summary!.totalMinor));
    expect(answer.subtotal).toBe(inMarket(preview.summary!.subtotalMinor));
    expect(answer.vat).toBe(inMarket(preview.summary!.taxMinor));
    expect(answer.lines[0]).toMatchObject({ sku: MUG, quantity: 2, price_each: inMarket(preview.summary!.lines[0].unitPriceMinor), total: inMarket(preview.summary!.lines[0].totalMinor) });
    // The draft needs a shipping address before it can be sent: said in the store's words, not the model's.
    expect(answer.cannot_be_sent_yet).toEqual(["Goods are shipped: add a shipping address."]);
    expect(answer.admin).toBe(`/admin/${store.slug}/orders/drafts/${drafts.rows[0].id}`);
  });

  it("prices a euro market in euro, the same as the draft's own summary, and a percent off with the name the customer sees", async () => {
    const store = await paymentsStore("tool-draft-eur");
    const answer = await run(store, "create_draft_order", { email: "eva@example.com", lines: [{ sku: MUG, quantity: 1 }], market: "no-eur", discount_percent: "10", discount_label: "Loyal customer" });
    const draft = (await listDrafts(store.storeId)).rows[0];
    expect(draft.currency).toBe("EUR");
    const preview = (await previewDraft(store.storeId, draft.id))!;
    expect(answer.market).toMatch(/EUR/);
    expect(answer.total).toBe(formatMoney(preview.summary!.totalMinor, "EUR", preview.market!.locale));
    expect(answer.total).toMatch(/€|EUR/);
    expect(answer.discount).toEqual({ name: "Loyal customer", off: formatMoney(preview.summary!.staffDiscountMinor, "EUR", preview.market!.locale) });
    expect(preview.summary!.staffDiscountMinor).toBeGreaterThan(0);
  });

  it("refuses an unknown SKU or a mistake in the discount, and leaves no draft behind", async () => {
    const store = await paymentsStore("tool-draft-bad");
    const count = async () => (await listDrafts(store.storeId)).rows.length;
    expect(await refusalOf(run(store, "create_draft_order", { email: "a@b.no", lines: [{ sku: "NOT-A-SKU", quantity: 1 }] }))).toMatch(/No shipped variant with the SKU NOT-A-SKU/);
    expect(await refusalOf(run(store, "create_draft_order", { email: "a@b.no", lines: [{ sku: MUG, quantity: 1 }], discount_percent: "10" }))).toMatch(/needs both its percent and the name/);
    expect(await refusalOf(run(store, "create_draft_order", { email: "a@b.no", lines: [{ sku: MUG, quantity: 1 }], discount_percent: "ten", discount_label: "Friends" }))).toMatch(/not a percent from 0.01 to 100/);
    // The name reaches the customer: it passes the claims filter like any text written for one.
    expect(await refusalOf(run(store, "create_draft_order", { email: "a@b.no", lines: [{ sku: MUG, quantity: 1 }], discount_percent: "10", discount_label: "Best price ever" }))).toMatch(/cannot say/);
    expect(await refusalOf(run(store, "create_draft_order", { email: "a@b.no", lines: [{ sku: MUG, quantity: 1 }], market: "xx" }))).toMatch(/no market xx/);
    expect(await count()).toBe(0);
  });
});

describe("send_draft_order", () => {
  /** An open draft the owner finished on its page: the tool's draft, plus the address the page asks for. */
  async function finishedDraft(store: TestStore, extra: Record<string, unknown> = {}) {
    const made = await run(store, "create_draft_order", { email: "kari@example.com", lines: [{ sku: MUG, quantity: 2 }], ...extra });
    const draft = (await listDrafts(store.storeId)).rows.find((d) => d.number === made.draft)!;
    const open = (await getDraft(store.storeId, draft.id))!;
    const saved = await saveDraft(store.storeId, staffActor(store.accountId), draft.id, {
      version: open.version,
      marketSlug: open.marketSlug,
      email: open.email,
      shippingAddress: { name: "Kari Nordmann", line1: "Storgata 1", postalCode: "0155", city: "Oslo", country: open.marketCode },
      billingAddress: {},
      tags: [],
      discount: open.discount,
      shipping: { kind: "rate" },
      lines: open.lines.map((l) => ({ id: l.id, kind: "goods", variantId: l.variantId, quantity: l.quantity })),
    });
    if (!saved.ok) throw new Error(`save: ${saved.problem} ${JSON.stringify(saved.fields)}`);
    return { id: draft.id, number: made.draft as string };
  }

  it("is refused before it is kept for a yes while the draft cannot be sent, in the store's own words, and kept once it can", async () => {
    const store = await paymentsStore("tool-send");
    const made = await run(store, "create_draft_order", { email: "kari@example.com", lines: [{ sku: MUG, quantity: 1 }] });
    const ctx = await ctxOf(store);
    expect(await refusalOf(ownerTools.preflightOwnerTool(ctx, "send_draft_order", { draft: made.draft }))).toMatch(/cannot be sent yet: Goods are shipped: add a shipping address/);
    const finished = await finishedDraft(store);
    await expect(ownerTools.preflightOwnerTool(ctx, "send_draft_order", { draft: finished.number })).resolves.toBeUndefined();
    expect(await refusalOf(ownerTools.preflightOwnerTool(ctx, "send_draft_order", { draft: "D-999" }))).toMatch(/No draft order D-999/);
    expect(await refusalOf(ownerTools.preflightOwnerTool(ctx, "send_draft_order", { draft: finished.number, valid_days: 31 }))).toMatch(/could not be read/);
  });

  it("is a gated tool: it describes itself to the owner from the draft's own customer, goods and total", async () => {
    const store = await paymentsStore("tool-approve");
    const { number } = await finishedDraft(store);
    const { draftApprovalSummary } = await import("./order-ops-tools");
    const full = (await getStore(store.slug))!;
    const summary = (await draftApprovalSummary(full, { draft: number, valid_days: 14 }))!;
    const preview = (await previewDraft(store.storeId, (await listDrafts(store.storeId)).rows[0].id))!;
    expect(summary).toContain(`draft order ${number}`);
    expect(summary).toContain("14 days");
    expect(summary).toContain("kari@example.com");
    expect(summary).toContain("2 × ");
    expect(summary).toContain(formatMoney(preview.summary!.totalMinor, preview.draft.currency, preview.market!.locale));
    expect(await draftApprovalSummary(full, { draft: "D-404" })).toBeNull();
  });

  it("is kept for the owner's yes with the draft's own words, not the model's, and nothing is sent until the yes", async () => {
    const store = await paymentsStore("tool-keep");
    const { id, number } = await finishedDraft(store);
    const assistant = await import("./owner-assistant");
    const [conversation] = await db().execute<Row>(sql`
      insert into commerce.assistant_conversations (store_id, account_id, title) values (${store.storeId}::uuid, ${store.accountId}::uuid, 'drafts') returning id
    `);
    const full = (await getStore(store.slug))!;
    const approval = await assistant.keepForApproval({ account: store.member.account, store: full, invalidate: () => {} }, String(conversation.id), "send_draft_order", "send", { draft: number, valid_days: 7 });
    expect(approval.summary).toContain(`draft order ${number}`);
    expect(approval.summary).toContain("kari@example.com");
    expect(approval.summary).toMatch(/2 × .+Total .+VAT included/);
    expect(approval.summary).toContain("7 days");
    expect(approval.category).toBe("send");
    // Kept, not run: the draft is still open and no order exists.
    expect((await getDraft(store.storeId, id))!.status).toBe("open");
    expect((await db().execute<Row>(sql`select 1 from commerce.orders where store_id = ${store.storeId}::uuid`)).length).toBe(0);
  });

  it("keeps the draft's version with the approval and sends nothing when the draft was changed after the owner was asked; an unchanged draft is sent (review fix)", async () => {
    const store = await paymentsStore("tool-pinned");
    const { id, number } = await finishedDraft(store);
    const assistant = await import("./owner-assistant");
    const [conversation] = await db().execute<Row>(sql`
      insert into commerce.assistant_conversations (store_id, account_id, title) values (${store.storeId}::uuid, ${store.accountId}::uuid, 'drafts') returning id
    `);
    const full = (await getStore(store.slug))!;
    const ctx = { account: store.member.account, store: full, invalidate: () => {} };
    const shown = (await getDraft(store.storeId, id))!;
    // A version the model passed itself is replaced by the one the owner is shown.
    const approval = await assistant.keepForApproval(ctx, String(conversation.id), "send_draft_order", "send", { draft: number, approved_version: 999 });
    const [kept] = await db().execute<Row>(sql`select args from commerce.assistant_approvals where id = ${approval.id}::uuid`);
    expect(kept.args).toMatchObject({ draft: number, approved_version: shown.version });
    // Someone raises the quantity while the question waits: the total the owner saw is no longer the draft's.
    const changed = await saveDraft(store.storeId, staffActor(store.accountId), id, {
      version: shown.version,
      marketSlug: shown.marketSlug,
      email: shown.email,
      shippingAddress: { name: "Kari Nordmann", line1: "Storgata 1", postalCode: "0155", city: "Oslo", country: shown.marketCode },
      billingAddress: {},
      tags: [],
      discount: shown.discount,
      shipping: { kind: "rate" },
      lines: shown.lines.map((l) => ({ id: l.id, kind: "goods", variantId: l.variantId, quantity: l.quantity + 10 })),
    });
    if (!changed.ok) throw new Error(changed.problem);
    const decided = await assistant.decideApproval({ account: store.member.account, store: full }, approval.id, true, () => {}, { note: false });
    expect(decided?.outcome ?? "").toMatch(/changed after the owner was asked/);
    expect((await getDraft(store.storeId, id))!.status).toBe("open");
    expect((await db().execute<Row>(sql`select 1 from commerce.orders where store_id = ${store.storeId}::uuid`)).length).toBe(0);
    // Asked again about the changed draft, the yes sends what was shown.
    const again = await assistant.keepForApproval(ctx, String(conversation.id), "send_draft_order", "send", { draft: number });
    const sent = await assistant.decideApproval({ account: store.member.account, store: full }, again.id, true, () => {}, { note: false });
    expect(sent?.outcome ?? "").toMatch(/was sent: order/);
    expect((await getDraft(store.storeId, id))!.status).toBe("sent");
  });

  it("when approved makes the numbered order and holds the goods, marks the draft sent and tells the owner how the email went; a second send is refused", async () => {
    const store = await paymentsStore("tool-run");
    const { id, number } = await finishedDraft(store);
    const answer = await run(store, "send_draft_order", { draft: number, valid_days: 3 });
    expect(answer.done).toMatch(new RegExp(`^Draft ${number} was sent: order .+ was made and its goods are held until `));
    const draft = (await getDraft(store.storeId, id))!;
    expect(draft.status).toBe("sent");
    expect(draft.orderId).toBeTruthy();
    const [order] = await db().execute<Row>(sql`select number, status, source, draft_id from commerce.orders where store_id = ${store.storeId}::uuid and id = ${draft.orderId}::uuid`);
    expect(order).toMatchObject({ number: answer.order, status: "pending_payment", source: "draft" });
    const [holds] = await db().execute<Row>(sql`select coalesce(sum(quantity), 0)::int as n from commerce.inventory_reservations where store_id = ${store.storeId}::uuid and order_id = ${draft.orderId}::uuid`);
    expect(Number(holds.n)).toBe(2);
    expect((await orderNumberAudit(store.storeId)).missing).toBe(0);
    // The draft is no longer open: the owner is told, and nothing is made twice.
    expect(await refusalOf(run(store, "send_draft_order", { draft: number }))).toMatch(/is sent, not open/);
    expect((await db().execute<Row>(sql`select 1 from commerce.orders where store_id = ${store.storeId}::uuid and source = 'draft'`)).length).toBe(1);
    // The list says what waits, and the control center and Home say so too.
    const listed = await run(store, "list_draft_orders", { status: "sent" });
    expect(listed.count).toBe(1);
    expect(listed.drafts[0]).toMatchObject({ number, status: "Sent", order: answer.order });
    const center = await controlCenter(store.member.account, store.slug);
    expect(center.stores[0].drafts).toMatchObject({ waiting: 1, expiringSoon: 0 });
    expect(center.stores[0].drafts?.oldestSentAt).toBeTruthy();
  });

  it("never reaches another store's draft", async () => {
    const mine = await paymentsStore("tool-send-mine");
    const theirs = await paymentsStore("tool-send-theirs");
    const { number } = await finishedDraft(theirs);
    expect(await refusalOf(run(mine, "send_draft_order", { draft: number }))).toMatch(/No draft order D-1 in this store/);
    expect((await getDraft(theirs.storeId, (await listDrafts(theirs.storeId)).rows[0].id))!.status).toBe("open");
    expect((await run(mine, "list_draft_orders", {})).count).toBe(0);
  });
});

describe("the control center's draft figures", () => {
  it("count only sent drafts that wait, only for a member who may read orders, and tell which pay links end within two days", async () => {
    const store = await paymentsStore("tool-center");
    expect((await controlCenter(store.member.account, store.slug)).stores[0].drafts).toBeUndefined();
    const made = await run(store, "create_draft_order", { email: "kari@example.com", lines: [{ sku: MUG, quantity: 1 }] });
    // An open draft is not waiting for payment.
    expect((await controlCenter(store.member.account, store.slug)).stores[0].drafts).toBeUndefined();
    const draft = (await listDrafts(store.storeId)).rows.find((d) => d.number === made.draft)!;
    const open = (await getDraft(store.storeId, draft.id))!;
    await saveDraft(store.storeId, staffActor(store.accountId), draft.id, {
      version: open.version,
      marketSlug: open.marketSlug,
      email: open.email,
      shippingAddress: { name: "Kari", line1: "Storgata 1", postalCode: "0155", city: "Oslo", country: open.marketCode },
      billingAddress: {},
      tags: [],
      discount: null,
      shipping: { kind: "rate" },
      lines: open.lines.map((l) => ({ id: l.id, kind: "goods", variantId: l.variantId, quantity: l.quantity })),
    });
    await run(store, "send_draft_order", { draft: made.draft, valid_days: 1 });
    const figures = (await controlCenter(store.member.account, store.slug)).stores[0];
    expect(figures.drafts).toMatchObject({ waiting: 1, expiringSoon: 1 });
  });
});
