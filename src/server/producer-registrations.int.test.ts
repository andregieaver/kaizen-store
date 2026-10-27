import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { nextDay } from "@/lib/producer-registrations";

import { makeStore, no, ownerOf, paidOrder, type Fixture } from "./invoice-test-fixture";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/server", () => ({ connection: async () => {}, after: () => {} }));
const jar = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    getAll: () => [...jar].map(([name, value]) => ({ name, value })),
    set: (name: string, value: string) => void jar.set(name, value),
    delete: (name: string) => void jar.delete(name),
  }),
  headers: async () => new Headers(),
}));

const { blockedSchemes, listRegistrations, missingRegistrations, removeRegistration, saveRegistration, shownRegistrationNumbers, storeToday } = await import(
  "./producer-registrations"
);
const { changeLine, getCart } = await import("./cart");
const { cartSummary } = await import("./cart-summary");
const { getStore } = await import("./stores");
const { preflightOwnerTool, runOwnerTool } = await import("./owner-tools");

type Row = Record<string, unknown>;

/**
 * Producer responsibility (wave 7 unit H, D342, `docs/wave-7-storefront.md` section 4, H): registrations written only through the page's writer,
 * one store never reaching another's; a product under a scheme with no valid registration in a country listed as not sold there (the view through
 * the app's reader) and refused alike by the cart and `placeOrder()`; a registration covering its last day and blocking from the next; an
 * exemption covering as a registration does; the numbers shown on the product page; and the AI manager going through the same writer.
 */

let fx: Fixture;
let other: Fixture;
let mug: { productId: string; variantId: string };

const MUG = "DEMO-MUG-WHITE";

beforeAll(async () => {
  fx = await makeStore("producer");
  other = await makeStore("producer-other");
  const [row] = await db().execute<Row>(sql`select product_id, id from commerce.product_variants where store_id = ${fx.storeId}::uuid and sku = ${MUG}`);
  mug = { productId: String(row.product_id), variantId: String(row.id) };
  // The mug is packaging, as the owner ticks it in the product editor.
  await db().execute(sql`insert into commerce.product_schemes (store_id, product_id, scheme) values (${fx.storeId}::uuid, ${mug.productId}::uuid, 'packaging')`);
}, 120_000);

afterAll(async () => {
  await closeDb();
});

const storeOf = async (f: Fixture) => (await getStore(f.slug))!;
const shop = async () => ({ storeId: fx.storeId, market: no });
const registration = (o: Record<string, unknown> = {}) => ({
  scheme: "packaging",
  market: "NO",
  kind: "registered",
  number: "NO-EMB-123",
  authority: "Miljødirektoratet",
  showNumber: true,
  validFrom: "2020-01-01",
  validTo: null,
  ...o,
});
const days = async (f: Fixture) => {
  const today = await storeToday(f.storeId);
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return { today, yesterday: d.toISOString().slice(0, 10), tomorrow: nextDay(today) };
};
const missingIn = async (f: Fixture) =>
  (await missingRegistrations(f.storeId, "nb-NO")).map((g) => `${g.scheme}:${g.market}:${g.products.map((p) => p.id).join(",")}`);

describe("a product under a scheme with no registration", () => {
  it("is listed as not sold in each of the store's countries, through the app's reader, and only for its own store", async () => {
    const listed = await missingIn(fx);
    expect(listed).toContain(`packaging:NO:${mug.productId}`);
    expect(await blockedSchemes(fx.storeId, mug.productId, "NO")).toEqual(["packaging"]);
    expect((await missingIn(other)).some((g) => g.includes(mug.productId))).toBe(false);
  });

  it("is refused by the cart and by placeOrder() alike, with its own reason", async () => {
    // Adding puts nothing in the cart.
    jar.clear();
    expect(await changeLine(await shop(), mug.variantId, 1, "add")).toMatchObject({ outcome: "unavailable" });
    // A line that was there before the tag (or the registration ran out) shows the reason and blocks checkout.
    await db().execute(sql`delete from commerce.product_schemes where store_id = ${fx.storeId}::uuid and product_id = ${mug.productId}::uuid`);
    expect(await changeLine(await shop(), mug.variantId, 1, "add")).toMatchObject({ outcome: "added" });
    await db().execute(sql`insert into commerce.product_schemes (store_id, product_id, scheme) values (${fx.storeId}::uuid, ${mug.productId}::uuid, 'packaging')`);
    const cart = await getCart(await shop());
    expect(cart.lines.map((l) => l.status)).toEqual(["unregistered"]);
    const summary = await cartSummary(await shop(), cart);
    expect(summary.blocked).toBe(true);
    await expect(paidOrder(fx, [[MUG, 1]])).rejects.toThrow(/placeOrder: unregistered/);
  });
});

describe("the writer", () => {
  it("checks what is typed, against the store's own countries, and writes nothing then", async () => {
    const store = await storeOf(fx);
    expect(await saveRegistration(store, fx.ownerId, registration({ market: "FR", number: "", validTo: "2019-12-31" }))).toEqual({
      ok: false,
      problems: ["market", "number", "range"],
    });
    expect(await listRegistrations(fx.storeId)).toEqual([]);
  });

  it("sells the product from the day a registration covers, through the day it ends, and stops the day after", async () => {
    const store = await storeOf(fx);
    const { today, yesterday, tomorrow } = await days(fx);
    // Ended yesterday: still not sold today.
    const saved = await saveRegistration(store, fx.ownerId, registration({ validFrom: "2020-01-01", validTo: yesterday }));
    expect(saved).toMatchObject({ ok: true });
    const id = (saved as { id: string }).id;
    expect(await blockedSchemes(fx.storeId, mug.productId, "NO")).toEqual(["packaging"]);
    expect((await getCart(await shop())).lines[0].status).toBe("unregistered");

    // Ends today: sold today, and the rule says it stops tomorrow.
    expect(await saveRegistration(store, fx.ownerId, registration({ validFrom: "2020-01-01", validTo: today }), id)).toMatchObject({ ok: true, id });
    expect(await blockedSchemes(fx.storeId, mug.productId, "NO")).toEqual([]);
    expect((await getCart(await shop())).lines[0].status).toBe("ok");
    const onDay = async (day: string) =>
      (await db().execute<Row>(sql`select scheme from commerce.registration_blocks(${fx.storeId}::uuid, 'NO', ${mug.productId}::uuid, ${day}::date)`)).length;
    expect(await onDay(today)).toBe(0);
    expect(await onDay(tomorrow)).toBe(1);
    expect((await missingIn(fx)).some((g) => g.startsWith("packaging:NO:"))).toBe(false);
    // Still not sold in the store's other countries.
    expect(await blockedSchemes(fx.storeId, mug.productId, "SE")).toEqual(["packaging"]);

    // Open-ended: the order goes through, as the cart showed it.
    expect(await saveRegistration(store, fx.ownerId, registration({ validTo: null }), id)).toMatchObject({ ok: true });
    const placed = await paidOrder(fx, [[MUG, 1]]);
    expect(placed.lines.map((l) => l.sku)).toEqual([MUG]);
  });

  it("shows the number on the product page only while chosen and valid, and an exemption covers without a number", async () => {
    const store = await storeOf(fx);
    expect(await shownRegistrationNumbers(db(), fx.storeId, mug.productId, "NO")).toEqual([{ scheme: "packaging", number: "NO-EMB-123", authority: "Miljødirektoratet" }]);
    expect(await shownRegistrationNumbers(db(), fx.storeId, mug.productId, "SE")).toEqual([]);
    // Sweden: no registration needed, in the owner's words.
    const exempt = await saveRegistration(store, fx.ownerId, { scheme: "packaging", market: "SE", kind: "exempt", exemption: "Below the threshold.", number: "ignored", validFrom: "2020-01-01" });
    expect(exempt).toMatchObject({ ok: true });
    expect(await blockedSchemes(fx.storeId, mug.productId, "SE")).toEqual([]);
    const kept = (await listRegistrations(fx.storeId)).find((r) => r.market === "SE")!;
    expect(kept).toMatchObject({ kind: "exempt", number: null, authority: null, exemption: "Below the threshold.", showNumber: false });
    expect(await shownRegistrationNumbers(db(), fx.storeId, mug.productId, "SE")).toEqual([]);
  });

  it("never reaches another store's registration, and audits each change without the number", async () => {
    const theirs = await storeOf(other);
    const [mine] = await listRegistrations(fx.storeId);
    expect(await saveRegistration(theirs, other.ownerId, registration({ number: "TAKEN" }), mine.id)).toEqual({ ok: false, missing: true });
    expect(await removeRegistration(other.storeId, other.ownerId, mine.id)).toBe(false);
    expect((await listRegistrations(fx.storeId)).find((r) => r.id === mine.id)?.number).toBe(mine.number);
    expect(await listRegistrations(other.storeId)).toEqual([]);
    const logged = await db().execute<Row>(sql`
      select action, area, details::text as details from commerce.audit_log where store_id = ${fx.storeId}::uuid and action like 'settings.producer_registration%'
    `);
    expect(logged.length).toBeGreaterThanOrEqual(3);
    expect(logged.every((l) => l.area === "settings" && !String(l.details).includes("NO-EMB-123"))).toBe(true);
  });

  it("takes a registration away, and the product stops being sold there", async () => {
    const inNorway = (await listRegistrations(fx.storeId)).find((r) => r.market === "NO")!;
    expect(await removeRegistration(fx.storeId, fx.ownerId, inNorway.id)).toBe(true);
    expect(await blockedSchemes(fx.storeId, mug.productId, "NO")).toEqual(["packaging"]);
  });
});

describe("the AI manager's producer registrations", () => {
  it("reads what is registered and not sold, refuses before a yes what the page refuses, and saves through the page's writer", async () => {
    const c = { ...(await ownerOf(fx)), invalidate: () => {} };
    const read = (await runOwnerTool(c, "producer_registrations", {})) as { not_sold: { scheme: string; country: string }[]; registrations: { country: string }[] };
    expect(read.not_sold).toContainEqual(expect.objectContaining({ scheme: "packaging", country: "NO" }));
    expect(read.registrations.map((r) => r.country)).toEqual(["SE"]);
    await expect(preflightOwnerTool(c, "save_producer_registration", { scheme: "packaging", country: "NO" })).rejects.toThrow(/registration number/);
    await expect(preflightOwnerTool(c, "save_producer_registration", { scheme: "packaging", country: "FR", number: "1", authority: "A" })).rejects.toThrow(/store's countries/);
    const ok = { scheme: "packaging", country: "no", number: "NO-EMB-999", authority: "Miljødirektoratet" };
    await expect(preflightOwnerTool(c, "save_producer_registration", ok)).resolves.toBeUndefined();
    const done = (await runOwnerTool(c, "save_producer_registration", ok)) as { done: string; still_not_sold: { country: string }[] };
    expect(done.done).toMatch(/recorded/);
    expect(done.still_not_sold.some((g) => g.country === "NO")).toBe(false);
    expect(await blockedSchemes(fx.storeId, mug.productId, "NO")).toEqual([]);
  });
});
