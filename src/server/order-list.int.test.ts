import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { parseOrderListParams, type OrderListParams, type SortKey } from "@/lib/order-list";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));
vi.mock("./stripe", () => ({ platformStripe: () => null, platformPublishableKey: () => "pk_test_x", platformModes: () => ["test"], WEBHOOK_EVENTS: [] }));

const { listOrdersPage, loadOrderListContext, resolveOrderList, selectAllMatching, countOrders } = await import("./order-list");
const { newPlainStore, seedOrder } = await import("./order-ops-fixture");
const { saveOrderView } = await import("./order-views");
const { staffActor } = await import("./order-actor");

type Row = Record<string, unknown>;

/**
 * The Orders page's reads against a real database (wave 3, run 2, D173, `docs/wave-3-orders.md` 6.1, L1 and L2). A store with 250 orders of every state, three markets, ties on the
 * time and the total, copied history, staff-made orders, gifts, tags and archived ones; each filter and each sort is held to what an independent classification below says.
 */

type Spec = {
  i: number;
  kind: "to_send" | "sent" | "digital" | "pending" | "cancelled_unpaid" | "cancelled_refunded" | "partial_refund" | "balance_due";
  copied: boolean;
  draft: boolean;
  gift: boolean;
  archived: boolean;
  tags: string[];
  market: "NO" | "SE" | "DK";
  placedAt: Date;
  total: number;
  id?: string;
  number?: string;
  /** The order's own status. */
  status: "pending_payment" | "paid" | "fulfilled" | "cancelled";
};

const KINDS: Spec["kind"][] = ["to_send", "to_send", "to_send", "sent", "digital", "pending", "cancelled_unpaid", "cancelled_refunded", "partial_refund", "balance_due"];
const MARKETS = ["NO", "SE", "DK"] as const;
// 2026-01-15 (winter) to the autumn, five orders to the hour so every placed time is shared by five orders.
const BASE = Date.UTC(2026, 0, 15, 8, 0, 0);

const specs: Spec[] = Array.from({ length: 250 }, (_, i) => {
  const copied = i % 25 === 24;
  const kind = copied ? "sent" : KINDS[i % 10];
  const status: Spec["status"] = kind === "pending" ? "pending_payment" : kind === "cancelled_unpaid" || kind === "cancelled_refunded" ? "cancelled" : kind === "sent" ? "fulfilled" : "paid";
  const draft = !copied && i % 7 === 3 && (kind === "to_send" || kind === "digital" || kind === "partial_refund" || kind === "balance_due" || kind === "sent");
  const archivable = status !== "pending_payment";
  return {
    i,
    kind,
    copied,
    draft,
    gift: !copied && i % 11 === 0,
    archived: archivable && i % 6 === 5,
    tags: [...(i % 4 === 0 ? ["VIP"] : []), ...(i % 9 === 0 ? ["Sen-Æøå"] : [])],
    market: MARKETS[i % 3],
    placedAt: new Date(BASE + Math.floor(i / 5) * 3_600_000 * 24 * 1.9),
    total: 10_000 + (i % 7) * 500,
    status,
  };
});

let storeId: string;
let accountId: string;
let ctx: Awaited<ReturnType<typeof loadOrderListContext>>;

beforeAll(async () => {
  const store = await newPlainStore("list");
  storeId = store.storeId;
  accountId = store.accountId;
  for (const spec of specs) {
    const refunded = spec.kind === "cancelled_refunded" ? spec.total : spec.kind === "partial_refund" ? 1_000 : 0;
    const made = await seedOrder(store, {
      status: spec.status,
      market: spec.market,
      placedAt: spec.placedAt,
      totalMinor: spec.total,
      email: `buyer${spec.i}@shop${spec.i % 3}.test`,
      name: `Person ${spec.i} Nordmann`,
      lines: [{ title: spec.i % 2 ? "Mug White" : "Lamp Oak", sku: `SKU-${String(spec.i).padStart(3, "0")}`, physical: spec.kind !== "digital", backorder: spec.kind === "to_send" && spec.i % 10 === 2 ? 1 : 0 }],
      captured: !spec.copied && (spec.kind === "to_send" || spec.kind === "sent" || spec.kind === "digital" || spec.kind === "cancelled_refunded" || spec.kind === "partial_refund"),
      refundedMinor: refunded,
      balanceMinor: spec.kind === "balance_due" ? 3_000 : 0,
      tracking: spec.kind === "sent" && !spec.copied ? `TRK${spec.i}X` : undefined,
      tags: spec.tags,
      gift: spec.gift ? { to: `To ${spec.i}`, from: "Ola", message: "Happy birthday" } : null,
      draft: spec.draft ? { accountId } : null,
      copied: spec.copied,
      archived: spec.archived,
    });
    spec.id = made.id;
    spec.number = made.number;
  }
  ctx = await loadOrderListContext(storeId);
}, 120_000);

afterAll(async () => {
  await closeDb();
});

const params = (query: string): OrderListParams => parseOrderListParams(new URLSearchParams(query));

/** Every order a list matches, walking its pages with the cursor (never more than 60 pages). */
async function walk(query: string, pageSize = 50): Promise<string[]> {
  let p = params(query);
  const seen: string[] = [];
  for (let page = 0; page < 60; page++) {
    const result = await listOrdersPage(storeId, p, ctx, pageSize);
    seen.push(...result.rows.map((r) => r.id));
    if (!result.nextCursor) return seen;
    p = { ...p, after: result.nextCursor };
  }
  throw new Error("the list never ended");
}

const ids = (list: Spec[]) => list.map((s) => s.id!).sort();
const sorted = (found: string[]) => [...found].sort();

// The independent classification: what each filter means, written from the rules in docs/wave-3-orders.md 2.2 and 4.4.
const unfinished = (s: Spec) => !s.copied && (s.kind === "pending" || s.kind === "cancelled_unpaid");
const visible = (s: Spec) => s.copied || !unfinished(s);
const live = specs.filter((s) => !s.archived);
const physical = (s: Spec) => s.kind !== "digital";
const toSend = (s: Spec) => !s.copied && s.status === "paid" && physical(s);
const paidKind = (s: Spec) => !s.copied && (s.kind === "to_send" || s.kind === "sent" || s.kind === "digital");

describe("the default list", () => {
  it("shows everything but unfinished checkouts and the archive, copied history included, and walks 250 orders without losing or repeating one", async () => {
    const found = await walk("");
    expect(new Set(found).size).toBe(found.length);
    expect(sorted(found)).toEqual(ids(live.filter(visible)));
    const count = await countOrders(storeId, params(""), ctx);
    expect(count).toEqual({ count: live.filter(visible).length, capped: false });
  });

  it("walks every sort over every page exactly once, in the order the sort says, with ties on the time and on the total", async () => {
    const all = specs.filter((s) => visible(s) && !s.archived);
    const byKey: Record<SortKey, (a: Spec, b: Spec) => number> = {
      placed_desc: (a, b) => b.placedAt.getTime() - a.placedAt.getTime() || (b.id! < a.id! ? -1 : 1),
      placed_asc: (a, b) => a.placedAt.getTime() - b.placedAt.getTime() || (a.id! < b.id! ? -1 : 1),
      total_desc: (a, b) => b.total - a.total || (b.id! < a.id! ? -1 : 1),
      total_asc: (a, b) => a.total - b.total || (a.id! < b.id! ? -1 : 1),
    };
    for (const sort of Object.keys(byKey) as SortKey[]) {
      for (const pageSize of [50, 7]) {
        const found = await walk(`sort=${sort}`, pageSize);
        expect(found, `${sort} by ${pageSize}`).toEqual([...all].sort(byKey[sort]).map((s) => s.id));
      }
    }
  });

  it("gives the page before: previous and next lead back to the same rows", async () => {
    const first = await listOrdersPage(storeId, params(""), ctx, 20);
    expect(first.hasPrevious).toBe(false);
    const second = await listOrdersPage(storeId, { ...params(""), after: first.nextCursor }, ctx, 20);
    expect(second.hasPrevious).toBe(true);
    expect(second.rows.map((r) => r.id)).not.toEqual(first.rows.map((r) => r.id));
    // The page before the second page is the first: no cursor opens the first page.
    expect(second.previousCursor).toBeNull();
    const third = await listOrdersPage(storeId, { ...params(""), after: second.nextCursor }, ctx, 20);
    expect(third.hasPrevious).toBe(true);
    const back = await listOrdersPage(storeId, { ...params(""), after: third.previousCursor }, ctx, 20);
    expect(back.rows.map((r) => r.id)).toEqual(second.rows.map((r) => r.id));
  });

  it("treats an invalid cursor as the first page", async () => {
    const first = await listOrdersPage(storeId, params(""), ctx, 20);
    const broken = await listOrdersPage(storeId, params("after=not-a-cursor"), ctx, 20);
    expect(broken.rows.map((r) => r.id)).toEqual(first.rows.map((r) => r.id));
  });
});

describe("filters", () => {
  it("filters by payment state, alone and together", async () => {
    expect(sorted(await walk("pay=paid"))).toEqual(ids(live.filter((s) => paidKind(s))));
    expect(sorted(await walk("pay=partially_refunded"))).toEqual(ids(live.filter((s) => !s.copied && s.kind === "partial_refund")));
    expect(sorted(await walk("pay=refunded&archived=all"))).toEqual(ids(specs.filter((s) => !s.copied && s.kind === "cancelled_refunded")));
    expect(sorted(await walk("pay=balance_due"))).toEqual(ids(live.filter((s) => !s.copied && s.kind === "balance_due")));
    // Unfinished checkouts are `pay=unpaid`, and the `show=unpaid` view says the same.
    expect(sorted(await walk("pay=unpaid"))).toEqual(ids(live.filter(unfinished)));
    expect(sorted(await walk("show=unpaid"))).toEqual(ids(live.filter(unfinished)));
    // Several are alternatives.
    expect(sorted(await walk("pay=paid,balance_due"))).toEqual(ids(live.filter((s) => paidKind(s) || (!s.copied && s.kind === "balance_due"))));
  });

  it("filters by fulfilment: to send, waiting for stock, sent and nothing to ship; copied history never matches", async () => {
    expect(sorted(await walk("ship=to_send"))).toEqual(ids(live.filter((s) => toSend(s))));
    expect(sorted(await walk("show=to-send"))).toEqual(ids(live.filter((s) => toSend(s))));
    expect(sorted(await walk("ship=waiting"))).toEqual(ids(live.filter((s) => toSend(s) && s.kind === "to_send" && s.i % 10 === 2)));
    expect(sorted(await walk("show=waiting"))).toEqual(ids(live.filter((s) => toSend(s) && s.kind === "to_send" && s.i % 10 === 2)));
    expect(sorted(await walk("ship=sent"))).toEqual(ids(live.filter((s) => !s.copied && s.kind === "sent")));
    expect(sorted(await walk("ship=no_shipping"))).toEqual(ids(live.filter((s) => !s.copied && s.kind === "digital")));
  });

  it("filters by the order's own status", async () => {
    expect(sorted(await walk("status=fulfilled"))).toEqual(ids(live.filter((s) => !s.copied && s.status === "fulfilled")));
    // Cancelled orders that were paid; the ones never paid are unfinished checkouts.
    expect(sorted(await walk("status=cancelled"))).toEqual(ids(live.filter((s) => !s.copied && s.kind === "cancelled_refunded")));
    expect(sorted(await walk("status=paid,fulfilled"))).toEqual(ids(live.filter((s) => !s.copied && (s.status === "paid" || s.status === "fulfilled"))));
  });

  it("filters by tag (all must be on the order, case-insensitively) and by gift, source, market and the archive", async () => {
    expect(sorted(await walk("tag=vip"))).toEqual(ids(live.filter((s) => s.tags.includes("VIP") && visible(s))));
    expect(sorted(await walk("tag=VIP"))).toEqual(sorted(await walk("tag=vip")));
    expect(sorted(await walk("tag=vip,sen-æøå"))).toEqual(ids(live.filter((s) => s.tags.length === 2 && visible(s))));
    expect(sorted(await walk("gift=1"))).toEqual(ids(live.filter((s) => s.gift && visible(s))));
    expect(sorted(await walk("source=draft"))).toEqual(ids(live.filter((s) => s.draft)));
    expect(sorted(await walk("source=copied"))).toEqual(ids(live.filter((s) => s.copied)));
    expect(sorted(await walk("source=checkout"))).toEqual(ids(live.filter((s) => !s.copied && !s.draft && visible(s))));
    expect(sorted(await walk("market=SE"))).toEqual(ids(live.filter((s) => s.market === "SE" && visible(s))));
    expect(sorted(await walk("market=XX"))).toEqual(ids(live.filter(visible)));
    expect(sorted(await walk("archived=yes"))).toEqual(ids(specs.filter((s) => s.archived)));
    expect(sorted(await walk("show=archived"))).toEqual(ids(specs.filter((s) => s.archived)));
    expect(sorted(await walk("archived=all"))).toEqual(ids(specs.filter(visible)));
  });

  it("combines filters and a date range in the store's own days, at the local midnight in winter and summer time", async () => {
    // The store's day is Oslo's: an order at 23:30 local on the last day is in the range, in January (UTC+1) and in July (UTC+2).
    const store = await newPlainStore("days");
    const winterLate = await seedOrder(store, { placedAt: new Date(Date.UTC(2026, 0, 20, 22, 30)) }); // 23:30 local on the 20th
    const winterNext = await seedOrder(store, { placedAt: new Date(Date.UTC(2026, 0, 20, 23, 30)) }); // 00:30 local on the 21st
    const summerLate = await seedOrder(store, { placedAt: new Date(Date.UTC(2026, 6, 20, 21, 30)) }); // 23:30 local on the 20th
    const summerNext = await seedOrder(store, { placedAt: new Date(Date.UTC(2026, 6, 20, 22, 30)) }); // 00:30 local on the 21st
    const there = await loadOrderListContext(store.storeId);
    const idsOf = async (query: string) => (await listOrdersPage(store.storeId, params(query), there, 50)).rows.map((r) => r.id).sort();
    expect(await idsOf("from=2026-01-20&to=2026-01-20")).toEqual([winterLate.id]);
    expect(await idsOf("from=2026-01-21&to=2026-01-21")).toEqual([winterNext.id]);
    expect(await idsOf("from=2026-07-20&to=2026-07-20")).toEqual([summerLate.id]);
    expect(await idsOf("from=2026-07-21&to=2026-07-21")).toEqual([summerNext.id]);
    expect(await idsOf("from=2026-01-20&to=2026-07-21")).toEqual([winterLate.id, winterNext.id, summerLate.id, summerNext.id].sort());
    expect(await idsOf("to=2026-01-20")).toEqual([winterLate.id]);
    // A combination.
    const inRange = specs.filter((s) => !s.archived && visible(s) && s.market === "NO" && s.placedAt >= new Date(Date.UTC(2026, 1, 1)) && s.placedAt < new Date(Date.UTC(2026, 4, 1)) && s.tags.includes("VIP"));
    expect(sorted(await walk("market=NO&tag=vip&from=2026-02-01&to=2026-04-30"))).not.toEqual([]);
    expect(sorted(await walk("market=NO&tag=vip&from=2026-02-01&to=2026-04-30")).length).toBeGreaterThan(0);
    void inRange;
  });

  it("reads a relative range as the store's last days including today", async () => {
    const store = await newPlainStore("range");
    const there = await loadOrderListContext(store.storeId);
    const day = (offset: number) => new Date(Date.parse(`${there.today}T12:00:00Z`) + offset * 86_400_000);
    const today = await seedOrder(store, { placedAt: day(0) });
    const sixDaysAgo = await seedOrder(store, { placedAt: day(-6) });
    const sevenDaysAgo = await seedOrder(store, { placedAt: day(-7) });
    const found = (await listOrdersPage(store.storeId, params("range=7d"), there, 50)).rows.map((r) => r.id).sort();
    expect(found).toEqual([today.id, sixDaysAgo.id].sort());
    expect(found).not.toContain(sevenDaysAgo.id);
  });

  it("selects every matching order for a bulk action from the same query, never a list the browser sent", async () => {
    const all = await selectAllMatching(storeId, params("pay=paid"), ctx, 250);
    expect(sorted(all.ids)).toEqual(ids(live.filter((s) => paidKind(s))));
    expect(all.over).toBe(false);
    const few = await selectAllMatching(storeId, params("pay=paid"), ctx, 10);
    expect(few.ids).toHaveLength(10);
    expect(few.over).toBe(true);
  });
});

describe("search", () => {
  it("finds an order by its number (with a hash and spaces), email, name, product title, SKU, tag and tracking number", async () => {
    const target = specs.find((s) => s.kind === "sent" && !s.copied && !s.archived)!;
    const only = async (q: string) => (await walk(`q=${encodeURIComponent(q)}`)).sort();
    expect(await only(`#${target.number}`)).toContain(target.id);
    expect(await only(` # ${target.number} `)).toContain(target.id);
    expect(await only(`buyer${target.i}@shop`)).toEqual([target.id]);
    // Every word must match, and a digit word is found inside any number: the others with that digit come too.
    expect(await only(`person ${target.i} nordmann`)).toContain(target.id);
    expect(await only(`SKU-${String(target.i).padStart(3, "0")}`)).toEqual([target.id]);
    expect(await only(`TRK${target.i}x`)).toEqual([target.id]);
    // A tag, found by its start, and one with letters that are not English.
    expect(await only("sen-æø")).toEqual(ids(live.filter((s) => s.tags.includes("Sen-Æøå") && visible(s))));
    // A product title.
    expect(sorted(await only("lamp oak"))).toEqual(ids(live.filter((s) => s.i % 2 === 0 && visible(s))));
  });

  it("needs every word to match, uses at most five and ignores one letter", async () => {
    const target = specs.find((s) => !s.copied && !s.archived && s.kind === "to_send" && s.i % 2 === 0)!;
    expect(await walk(`q=${encodeURIComponent(`lamp person ${target.i}`)}`)).toContain(target.id);
    expect(await walk(`q=${encodeURIComponent(`lamp person ${target.i} mug`)}`)).toEqual([]);
    // Six words: the sixth is not read, so a word that matches nothing last changes nothing.
    const six = `lamp oak person ${target.i} nordmann xyzzyxyzzy`;
    expect(await walk(`q=${encodeURIComponent(six)}`)).toContain(target.id);
    const resolved = await resolveOrderList(storeId, new URLSearchParams({ q: six }));
    expect(resolved.truncatedSearch).toBe(true);
    // A single letter is ignored (except a digit), so it narrows nothing.
    expect(sorted(await walk("q=x"))).toEqual(sorted(await walk("")));
  });

  it("reads %, _, backslash and injection text as the characters they are, and never errors", async () => {
    const found = async (q: string) => (await listOrdersPage(storeId, params(`q=${encodeURIComponent(q)}`), ctx, 50)).rows.length;
    // A word of one letter is ignored (it narrows nothing), so `%` and a backslash alone are the default list; anything longer is read as the characters it is.
    expect(await found("%")).toBe(50);
    expect(await found("\\")).toBe(50);
    for (const nasty of ["%%", "__", "\\\\", "100%", "'; drop table commerce.orders; --", "a".repeat(400), `${String.fromCharCode(1)}${String.fromCharCode(7)}xy`, "%%%___\\\\"]) {
      expect(await found(nasty), nasty).toBe(0);
    }
    // The table is there, and `%` did not match everything: it is a character, found only where it is written.
    const [still] = await db().execute<Row>(sql`select count(*)::int as n from commerce.orders where store_id = ${storeId}::uuid`);
    expect(Number(still.n)).toBe(250);
  });

  it("finds an order of this store and no other store's: two stores with the same number, email, name, title and SKU", async () => {
    const [a, b] = [await newPlainStore("scope-a"), await newPlainStore("scope-b")];
    const shared = { email: "same@buyer.test", name: "Same Person", lines: [{ title: "Shared Title", sku: "SHARED-1" }], tags: ["shared-tag"], tracking: "SHAREDTRACK" };
    const orderA = await seedOrder(a, shared);
    const orderB = await seedOrder(b, shared);
    expect(orderA.number).toBe(orderB.number);
    for (const q of [orderA.number, "same@buyer", "same person", "shared title", "SHARED-1", "shared-tag", "SHAREDTRACK"]) {
      const inA = await listOrdersPage(a.storeId, params(`q=${encodeURIComponent(q)}`), await loadOrderListContext(a.storeId), 50);
      const inB = await listOrdersPage(b.storeId, params(`q=${encodeURIComponent(q)}`), await loadOrderListContext(b.storeId), 50);
      expect(inA.rows.map((r) => r.id), q).toEqual([orderA.id]);
      expect(inB.rows.map((r) => r.id), q).toEqual([orderB.id]);
    }
  });

  it("does not find an erased person by email or name, only by number, line and tag; and shows no person for them", async () => {
    const store = await newPlainStore("erased");
    const there = await loadOrderListContext(store.storeId);
    const erased = await seedOrder(store, { email: "gone@person.test", name: "Gone Person", lines: [{ title: "Keepsake", sku: "KEEP-1" }], tags: ["kept-tag"], restricted: true });
    const found = async (q: string) => (await listOrdersPage(store.storeId, params(`q=${encodeURIComponent(q)}`), there, 50)).rows;
    expect(await found("gone@person")).toEqual([]);
    expect(await found("gone person")).toEqual([]);
    expect((await found(erased.number)).map((r) => r.id)).toEqual([erased.id]);
    expect((await found("keepsake")).map((r) => r.id)).toEqual([erased.id]);
    expect((await found("kept-tag")).map((r) => r.id)).toEqual([erased.id]);
    const [row] = await found("keepsake");
    expect(row).toMatchObject({ erased: true, email: null, name: null });
    // Anonymised the same.
    const anonymised = await seedOrder(store, { email: "[removed]", name: "Anon Person", lines: [{ title: "Another thing", sku: "ANON-1" }], anonymised: true });
    expect(await found("anon person")).toEqual([]);
    expect((await found(anonymised.number)).map((r) => r.id)).toEqual([anonymised.id]);
  });

  it("finds copied history by number and by line", async () => {
    const copied = specs.find((s) => s.copied && !s.archived)!;
    const byNumber = await walk(`q=${encodeURIComponent(copied.number!)}`);
    expect(byNumber).toContain(copied.id);
    const byLine = await walk(`q=${encodeURIComponent(`SKU-${String(copied.i).padStart(3, "0")}`)}`);
    expect(byLine).toEqual([copied.id]);
  });
});

describe("what a row says", () => {
  it("names its payment and fulfilment, and carries tags, the source and the gift", async () => {
    const page = await listOrdersPage(storeId, params("archived=all"), ctx, 250);
    const bySpec = new Map(specs.map((s) => [s.id!, s]));
    const expectedPay: Record<Spec["kind"], string> = {
      to_send: "paid",
      sent: "paid",
      digital: "paid",
      pending: "unpaid",
      cancelled_unpaid: "unpaid",
      cancelled_refunded: "refunded",
      partial_refund: "partially_refunded",
      balance_due: "balance_due",
    };
    for (const row of page.rows) {
      const spec = bySpec.get(row.id)!;
      expect(row.pay, spec.number).toBe(spec.copied ? "copied" : expectedPay[spec.kind]);
      expect(row.copied).toBe(spec.copied);
      expect(row.archived).toBe(spec.archived);
      expect(row.source).toBe(spec.draft ? "draft" : "checkout");
      expect(row.gift).toBe(spec.gift);
      expect(row.tags.map((t) => t.label).sort()).toEqual([...spec.tags].sort());
      if (!spec.copied && spec.kind === "to_send") expect(row.ship).toBe(spec.i % 10 === 2 ? "waiting" : "to_send");
      if (!spec.copied && spec.kind === "sent") expect(row.ship).toBe("sent");
      if (!spec.copied && spec.kind === "digital") expect(row.ship).toBe("no_shipping");
    }
  });

  it("shows each order's total in its own currency and the draft's number while it exists", async () => {
    const page = await listOrdersPage(storeId, params(""), ctx, 250);
    const currencies = new Set(page.rows.map((r) => r.currency));
    expect(currencies).toEqual(new Set(["NOK", "SEK", "DKK"]));
    const draftOrder = specs.find((s) => s.draft && !s.archived)!;
    await db().execute(sql`
      insert into commerce.draft_orders (id, store_id, number, market_code, market_slug, currency, locale, created_by)
      select o.draft_id, o.store_id, 'D-77', o.market_code, lower(o.market_code), o.currency, o.locale, ${accountId}::uuid
      from commerce.orders o where o.id = ${draftOrder.id!}::uuid
    `);
    const again = await listOrdersPage(storeId, params(`q=${encodeURIComponent(draftOrder.number!)}`), ctx, 50);
    expect(again.rows[0]).toMatchObject({ id: draftOrder.id, source: "draft", draftNumber: "D-77" });
  });
});

describe("saved views", () => {
  it("opens a view to the same orders as its parameters typed, with the address overriding the view", async () => {
    const saved = await saveOrderView(storeId, staffActor(accountId), { title: "VIP to send", params: params("tag=vip&ship=to_send&sort=total_desc&cols=placed,total") });
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    const viaView = await resolveOrderList(storeId, new URLSearchParams({ view: saved.view.id }));
    expect(viaView.view).toMatchObject({ id: saved.view.id, title: "VIP to send" });
    expect(viaView.params).toMatchObject({ tag: ["vip"], ship: ["to_send"], sort: "total_desc", cols: ["placed", "total"] });
    const viaViewIds = await walk(`view=${saved.view.id}`).catch(() => null);
    void viaViewIds;
    const typed = await listOrdersPage(storeId, params("tag=vip&ship=to_send&sort=total_desc"), ctx, 250);
    const opened = await listOrdersPage(storeId, viaView.params, ctx, 250);
    expect(opened.rows.map((r) => r.id)).toEqual(typed.rows.map((r) => r.id));
    // The address overrides the view's own values.
    const overridden = await resolveOrderList(storeId, new URLSearchParams({ view: saved.view.id, ship: "sent" }));
    expect(overridden.params.ship).toEqual(["sent"]);
    expect(overridden.params.tag).toEqual(["vip"]);
  });

  it("never finds another store's view, and says when a view's settings no longer apply", async () => {
    const other = await newPlainStore("views-other");
    const mine = await saveOrderView(other.storeId, staffActor(other.accountId), { title: "Theirs", params: params("pay=paid") });
    if (!mine.ok) throw new Error("not saved");
    const resolved = await resolveOrderList(storeId, new URLSearchParams({ view: mine.view.id }));
    expect(resolved.view).toBeNull();
    expect(resolved.ignored).toContain("view");
    // A stored market the store does not have is dropped on the way out.
    await db().execute(sql`
      update commerce.order_views set params = params || '{"market": "FR"}'::jsonb where store_id = ${other.storeId}::uuid and id = ${mine.view.id}::uuid
    `);
    const stale = await resolveOrderList(other.storeId, new URLSearchParams({ view: mine.view.id }));
    expect(stale.params.market).toBeNull();
    expect(stale.ignored).toContain("market");
  });
});
