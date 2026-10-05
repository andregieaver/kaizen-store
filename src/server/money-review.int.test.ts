import sharp from "sharp";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { writeCsv } from "@/lib/csv";

import type { Membership } from "./auth";
import { depsWith, fakeStorage, importThrough, membersOf, rowsOfCsv } from "./data-test-support";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }) }));

const fixture = await import("./invoice-test-fixture");
const { buildSubject } = await import("./privacy-fixture");
const jobs = await import("./data-jobs");
const { getStore } = await import("./stores");
const { countOrderExportRows } = await import("./order-export");

type Row = Record<string, unknown>;

/** Adversarial money and data-integrity checks for wave 2 (D165). Regression tests for the review of the first run: each was a failing test before its fix. */

let fx: Awaited<ReturnType<typeof fixture.makeStore>>;
let subject: Awaited<ReturnType<typeof buildSubject>>;
let members: Awaited<ReturnType<typeof membersOf>>;
let owner: Membership;
let png: Uint8Array;

beforeAll(async () => {
  png = new Uint8Array(await sharp({ create: { width: 40, height: 30, channels: 3, background: "#cc0000" } }).png().toBuffer());
  fx = await fixture.makeStore("mrev");
  subject = await buildSubject(fx, "buyer");
  members = await membersOf(fx);
  owner = { ...members.owner, store: (await getStore(fx.slug))! };
}, 120_000);

afterAll(async () => {
  await closeDb();
});

async function ordersOf(from: string, to: string): Promise<Set<string>> {
  const result = await jobs.requestOrderExport(members.owner, { mode: "range", from, to, dialect: "standard" });
  if (!result.ok || result.mode !== "file") throw new Error(`file: ${JSON.stringify(result)}`);
  return new Set(rowsOfCsv(result.csv).slice(1).map((r) => r[0]));
}

describe("order export, a range of the store's days across a change of the clock", () => {
  it("the last day of a range ends at the store's next midnight even when the day is 25 hours long", async () => {
    // Europe/Oslo ends summer time on 2026-10-25: that day is 25 hours long, from 2026-10-24T22:00Z to 2026-10-25T23:00Z.
    const [zone] = await db().execute<Row>(sql`select time_zone from commerce.stores where id = ${fx.storeId}::uuid`);
    expect(String(zone.time_zone)).toBe("Europe/Oslo");
    const a = subject.ids.signedInOrder;
    // 22:30 UTC is 23:30 on the 25th in Oslo (UTC+1 after the change): it belongs to the 25th.
    await db().execute(sql`update commerce.orders set placed_at = '2026-10-25T22:30:00Z' where id = ${a.orderId}::uuid`);
    const day25 = await ordersOf("2026-10-25", "2026-10-25");
    const day26 = await ordersOf("2026-10-26", "2026-10-26");
    // Nothing may fall between two consecutive days: the order is on exactly one of them.
    expect(day25.has(a.number) || day26.has(a.number), "the order is in no day's file").toBe(true);
    expect(day25.has(a.number), "it was placed at 23:30 on the 25th in Oslo").toBe(true);
    // The count a download or a job is decided by uses the same days.
    const counted = await countOrderExportRows(owner.store, { mode: "range", from: "2026-10-25", to: "2026-10-25", which: "paid", layout: "orders", profile: "accounting", copied: false, dialect: "standard" });
    expect(counted.orders).toBe(1);
  });

  it("the last day of a range does not run into the next day when the day is 23 hours long", async () => {
    // 2026-03-29: summer time starts, the day is 23 hours long, from 2026-03-28T23:00Z to 2026-03-29T22:00Z.
    const a = subject.ids.guestOrder;
    // 22:30 UTC is 00:30 on the 30th in Oslo.
    await db().execute(sql`update commerce.orders set placed_at = '2026-03-29T22:30:00Z' where id = ${a.orderId}::uuid`);
    const day29 = await ordersOf("2026-03-29", "2026-03-29");
    const day30 = await ordersOf("2026-03-30", "2026-03-30");
    expect(day30.has(a.number), "placed on the 30th").toBe(true);
    expect(day29.has(a.number), "it is also in the 29th's file: counted twice by two adjacent exports").toBe(false);
  });
});

describe("product import, a product written from a stale snapshot", () => {
  it("a sale paid while the import fetches the product's picture is not lost from the stock", async () => {
    const storage = fakeStorage();
    const [variant] = await db().execute<Row>(sql`select id from commerce.product_variants where store_id = ${fx.storeId}::uuid and sku = 'DEMO-LAMP'`);
    const variantId = String(variant.id);
    await db().execute(sql`update commerce.inventory_levels set on_hand = 10 where variant_id = ${variantId}::uuid`);
    const deps = depsWith(storage, {
      fetchPicture: async () => {
        // The payment of an order of 3 completes while the picture is being fetched (what complete_order_payment does).
        await db().execute(sql`update commerce.inventory_levels set on_hand = on_hand - 3 where variant_id = ${variantId}::uuid`);
        return { ok: true, bytes: png, contentType: "image/png" };
      },
      storePicture: async (o, image) => ({ ok: true, url: `https://lib.test/${o.storeId}/${image.name}`, thumbnailUrl: `https://lib.test/${o.storeId}/t-${image.name}` }),
    });
    const bytes = new TextEncoder().encode(writeCsv([["handle", "sku", "title", "image_url"], ["demo-bordlampe", "DEMO-LAMP", "Bordlampe med nytt bilde", "https://img.example/a/new.jpg"]]));
    await importThrough(owner, storage, bytes, {}, { deps });
    const [level] = await db().execute<Row>(sql`select on_hand from commerce.inventory_levels where variant_id = ${variantId}::uuid`);
    // 10 on hand, 3 sold during the import: 7. The import wrote back the 10 it read before the fetch.
    expect(Number(level.on_hand)).toBe(7);
  });
});
