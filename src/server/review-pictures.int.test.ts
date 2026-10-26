import { sql } from "drizzle-orm";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));

const rv = await import("./reviews");
const store_ = await import("./review-picture-store");
const admin = await import("./reviews-admin");
const { reviewFacts } = await import("./review-facts");
const { eraseSubject } = await import("./privacy-erasure");
const { exportCustomerData } = await import("./privacy-export");

type Row = Record<string, unknown>;
type Storage = import("./review-picture-store").ReviewPictureStorage;

/**
 * Pictures in product reviews (wave 5 unit G4, D301, `docs/wave-5-marketing.md` 9.7): sent with the review and checked by their bytes, three at
 * most, kept in the bucket by their ids, shown to visitors only while the review is published and the picture not hidden (to its author always),
 * hidden by staff one at a time, and gone with the review: its author's delete, the person's erasure, and the daily sweep of files left behind.
 */

const run = Date.now().toString(36);
let storeId: string;
let n = 0;

/** The bucket in memory: files by path, with when they were made. */
function memoryStorage(fail = false): Storage & { files: Map<string, { bytes: Uint8Array; at: string }> } {
  const files = new Map<string, { bytes: Uint8Array; at: string }>();
  return {
    files,
    async upload(path, bytes) {
      if (fail || files.has(path)) return false;
      files.set(path, { bytes, at: new Date().toISOString() });
      return true;
    },
    async download(path) {
      return files.get(path)?.bytes ?? null;
    },
    async remove(paths) {
      for (const p of paths) files.delete(p);
      return true;
    },
    async list(folder, limit, offset) {
      const names = new Set<string>();
      const out: { name: string; createdAt: string | null }[] = [];
      for (const [path, f] of files) {
        const rest = folder ? (path.startsWith(`${folder}/`) ? path.slice(folder.length + 1) : null) : path;
        if (rest === null) continue;
        const name = rest.split("/")[0];
        if (names.has(name)) continue;
        names.add(name);
        out.push({ name, createdAt: rest.includes("/") ? null : f.at });
      }
      return out.sort((a, b) => a.name.localeCompare(b.name)).slice(offset, offset + limit);
    },
  };
}

const webp = async (w: number, h: number) => new Uint8Array(await sharp({ create: { width: w, height: h, channels: 3, background: { r: 40, g: 90, b: 160 } } }).webp().toBuffer());
const picture = async () => ({ full: await webp(1200, 900), thumb: await webp(480, 360) });

async function makeStore(slug: string): Promise<string> {
  const [request] = await db().execute<Row>(sql`
    insert into commerce.access_requests (email, name, store_name) values (${`${slug}-${run}@example.com`}, 'Test', 'Test') returning id
  `);
  const [created] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${`${slug}-${run}`}, 'Test', null) as id`);
  const id = String(created.id);
  await db().execute(sql`update commerce.stores set status = 'active', features = array['shop', 'reviews'] where id = ${id}::uuid`);
  return id;
}

async function customer(email: string): Promise<string> {
  const [row] = await db().execute<Row>(sql`insert into commerce.customers (store_id, email, name) values (${storeId}::uuid, ${email}, 'Kari Nordmann') returning id`);
  return String(row.id);
}

/** A delivered, paid order of one line of a product of its own. */
async function boughtLine(who: string, email: string): Promise<string> {
  n += 1;
  const [p] = await db().execute<Row>(sql`
    insert into commerce.products (store_id, handle, tax_code, kind) values (${storeId}::uuid, ${`rp-${run}-${n}`}, 'txcd_99999999', 'goods') returning id
  `);
  const [v] = await db().execute<Row>(sql`
    insert into commerce.product_variants (store_id, product_id, sku, delivery) values (${storeId}::uuid, ${String(p.id)}::uuid, ${`RP-${run}-${n}`}, 'physical') returning id
  `);
  const [o] = await db().execute<Row>(sql`
    insert into commerce.orders (store_id, number, market_code, currency, locale, email, customer_id, status, subtotal_minor, shipping_minor,
      discount_minor, tax_minor, total_minor, billing_address, shipping_address, delivered_at, delivered_source)
    values (${storeId}::uuid, ${`rp${run}-${n}`}, 'NO', 'NOK', 'nb-NO', ${email}, ${who}::uuid, 'paid'::commerce.order_status,
      10000, 0, 0, 2000, 10000, '{}'::jsonb, '{"name":"Kari"}'::jsonb, now() - interval '2 days', 'staff')
    returning id
  `);
  const [line] = await db().execute<Row>(sql`
    insert into commerce.order_lines (store_id, order_id, variant_id, sku, title, quantity, unit_price_minor, total_minor, tax_minor, tax_rate, tax_code, delivery)
    values (${storeId}::uuid, ${String(o.id)}::uuid, ${String(v.id)}::uuid, 'RP', 'Lamp', 1, 10000, 10000, 2000, 0.25, 'txcd_99999999', 'physical')
    returning id
  `);
  await db().execute(sql`
    insert into commerce.payments (store_id, order_id, provider, provider_reference, amount_minor, currency, status)
    values (${storeId}::uuid, ${String(o.id)}::uuid, 'stripe', ${`cs_rp${run}_${n}`}, 10000, 'NOK', 'captured')
  `);
  return String(line.id);
}

const words = { rating: 5, title: "Lovely", body: "Warm light.", name: "Kari N." };
const productOf = async (reviewId: string) => String((await db().execute<Row>(sql`select product_id from commerce.product_reviews where id = ${reviewId}::uuid`))[0].product_id);
const pictureIds = async (reviewId: string) =>
  (await db().execute<Row>(sql`select id from commerce.review_pictures where review_id = ${reviewId}::uuid order by position`)).map((r) => String(r.id));

beforeAll(async () => {
  storeId = await makeStore("rp-a");
});

afterAll(async () => {
  await closeDb();
});

describe("a review's pictures", () => {
  it("are checked by their bytes, kept by id, and shown only while the review is published and the picture not hidden", async () => {
    const storage = memoryStorage();
    const kari = await customer(`kari-${run}@example.com`);
    const lineId = await boughtLine(kari, `kari-${run}@example.com`);
    // A file that is not a picture is refused, and so is a store without the bucket; nothing is written.
    const png = new Uint8Array(await sharp({ create: { width: 10, height: 10, channels: 3, background: "#fff" } }).png().toBuffer());
    expect(await rv.writeReview(storeId, kari, lineId, words, "nb-NO", { add: [{ full: png, thumb: png }], keep: null }, { storage })).toEqual({ ok: false, problem: "pictures" });
    expect(await rv.writeReview(storeId, kari, lineId, words, "nb-NO", { add: [await picture()], keep: null }, { storage: null })).toEqual({ ok: false, problem: "pictures_off" });
    // A bucket that refuses rolls the whole write back.
    expect(await rv.writeReview(storeId, kari, lineId, words, "nb-NO", { add: [await picture()], keep: null }, { storage: memoryStorage(true) })).toEqual({ ok: false, problem: "picture_store" });
    expect((await rv.reviewableLines(storeId, kari))[0].review).toBeNull();

    const written = await rv.writeReview(storeId, kari, lineId, words, "nb-NO", { add: [await picture(), await picture()], keep: null }, { storage });
    expect(written).toMatchObject({ ok: true, status: "pending" });
    if (!written.ok) return;
    const ids = await pictureIds(written.reviewId);
    expect(ids).toHaveLength(2);
    expect([...storage.files.keys()].sort()).toEqual(ids.flatMap((id) => [`${storeId}/${id}-480.webp`, `${storeId}/${id}.webp`]).sort());
    expect((await rv.reviewableLines(storeId, kari))[0].review?.pictures).toEqual(ids.map((id) => ({ id, type: "image/webp", hidden: false })));

    // Waiting: only its author sees a picture; staff always.
    const author = async () => true;
    const stranger = async () => false;
    expect(await store_.pictureForVisitor(ids[0], false, stranger, storage)).toBeNull();
    expect(await store_.pictureForVisitor(ids[0], true, author, storage)).toMatchObject({ type: "image/webp", shown: false });
    expect(await store_.pictureForStaff(storeId, ids[0], false, storage)).toMatchObject({ type: "image/webp" });

    // Published: everyone, until staff hide one picture alone.
    const [someone] = await db().execute<Row>(sql`select account_id from commerce.store_members where store_id = ${storeId}::uuid limit 1`);
    const staff = String(someone.account_id);
    expect(await admin.publishReview(storeId, staff, written.reviewId)).toEqual({ ok: true });
    expect(await store_.pictureForVisitor(ids[0], false, stranger, storage)).toMatchObject({ shown: true });
    expect(await admin.setPictureHidden(storeId, staff, ids[0], true)).toEqual({ ok: true });
    expect(await admin.setPictureHidden(storeId, staff, ids[0], true)).toEqual({ ok: false, problem: "state" });
    expect(await store_.pictureForVisitor(ids[0], false, stranger, storage)).toBeNull();
    expect(await store_.pictureForVisitor(ids[1], false, stranger, storage)).toMatchObject({ shown: true });
    const facts = await reviewFacts(storeId, await productOf(written.reviewId));
    expect(facts.latest[0].pictures.map((p) => p.id)).toEqual([ids[1]]);
    expect(facts.latest[0].pictures[0]).toMatchObject({ width: 1200, height: 900 });
  });

  it("are three at most; an edit keeps, takes out and adds, and the files of those taken out go", async () => {
    const storage = memoryStorage();
    const ola = await customer(`ola-${run}@example.com`);
    const lineId = await boughtLine(ola, `ola-${run}@example.com`);
    const first = await rv.writeReview(storeId, ola, lineId, words, "nb-NO", { add: [await picture(), await picture()], keep: null }, { storage });
    if (!first.ok) throw new Error("not written");
    const [a, b] = await pictureIds(first.reviewId);
    expect(await rv.writeReview(storeId, ola, lineId, words, "nb-NO", { add: [await picture(), await picture()], keep: null }, { storage })).toEqual({ ok: false, problem: "pictures" });
    const edited = await rv.writeReview(storeId, ola, lineId, words, "nb-NO", { add: [await picture(), await picture()], keep: [b] }, { storage });
    expect(edited).toMatchObject({ ok: true });
    const now = await pictureIds(first.reviewId);
    expect(now).toHaveLength(3);
    expect(now).toContain(b);
    expect(now).not.toContain(a);
    expect([...storage.files.keys()].some((p) => p.includes(a))).toBe(false);
    expect(storage.files.size).toBe(6);
    // The author's delete takes the files with the review.
    expect(await rv.deleteOwnReview(storeId, ola, first.reviewId, { storage })).toEqual({ wasShown: false });
    expect(storage.files.size).toBe(0);
  });

  it("are exported with the review and erased with it", async () => {
    const storage = memoryStorage();
    const liv = await customer(`liv-${run}@example.com`);
    const lineId = await boughtLine(liv, `liv-${run}@example.com`);
    const written = await rv.writeReview(storeId, liv, lineId, words, "nb-NO", { add: [await picture()], keep: null }, { storage });
    if (!written.ok) throw new Error("not written");
    const [id] = await pictureIds(written.reviewId);
    const exported = await exportCustomerData(storeId, { customerId: liv }, { channel: "staff", accountId: null });
    expect(exported.ok && exported.file.sections.reviews).toEqual([expect.objectContaining({ pictures: [{ address: `/api/reviews/picture/${id}`, hidden: false }] })]);
    const erased = await eraseSubject(storeId, { customerId: liv }, { channel: "staff", accountId: null }, { reviewPictures: storage });
    expect(erased.ok).toBe(true);
    expect(await pictureIds(written.reviewId)).toEqual([]);
    expect(storage.files.size).toBe(0);
  });

  it("left behind are swept daily, never one a row still names or a young one", async () => {
    const storage = memoryStorage();
    const per = await customer(`per-${run}@example.com`);
    const lineId = await boughtLine(per, `per-${run}@example.com`);
    const written = await rv.writeReview(storeId, per, lineId, words, "nb-NO", { add: [await picture()], keep: null }, { storage });
    if (!written.ok) throw new Error("not written");
    const orphan = "00000000-0000-4000-8000-000000000001";
    await storage.upload(`${storeId}/${orphan}.webp`, new Uint8Array([1]), "image/webp");
    await storage.upload(`${storeId}/${orphan}-480.webp`, new Uint8Array([1]), "image/webp");
    expect(await store_.pruneReviewPictureFiles({ storage })).toEqual({ removed: 0 });
    expect(await store_.pruneReviewPictureFiles({ storage, now: Date.now() + 2 * 60 * 60 * 1000 })).toEqual({ removed: 2 });
    expect(storage.files.size).toBe(2);
  });
});
