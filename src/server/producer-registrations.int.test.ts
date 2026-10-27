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
 * one store never reaching another's; what has no valid registration listed through the app's reader of `commerce.missing_registrations`; a
 * scheme and country the store never recorded anything for warned of and still sold; one with a registration on record sold only while one
 * covers the store's day (its last day included, blocked from the next, and before its first), refused alike by the cart and `placeOrder()`;
 * an exemption covering as a registration does; the numbers shown on the product page; and the AI manager going through the same writer.
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
  // The mug is packaging, as the owner ticks it in the product editor (the demo store's mug already is).
  await db().execute(sql`
    insert into commerce.product_schemes (store_id, product_id, scheme) values (${fx.storeId}::uuid, ${mug.productId}::uuid, 'packaging') on conflict do nothing
  `);
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
/** The gaps the page lists: scheme, country, whether it stops sales, and whether the mug is among the products. */
const gapsOf = async (f: Fixture) =>
  (await missingRegistrations(f.storeId, "nb-NO")).filter((g) => g.products.some((p) => p.id === mug.productId)).map((g) => `${g.scheme}:${g.market}:${g.blocked ? "blocked" : "warned"}`);

describe("a scheme the store never recorded a registration for", () => {
  it("is listed as a warning in each of the store's countries, through the app's reader, only for its own store, and still sold", async () => {
    expect(await gapsOf(fx)).toEqual(expect.arrayContaining(["packaging:NO:warned", "packaging:SE:warned", "packaging:DK:warned"]));
    expect(await gapsOf(other)).toEqual([]);
    expect(await blockedSchemes(fx.storeId, mug.productId, "NO")).toEqual([]);
    jar.clear();
    expect(await changeLine(await shop(), mug.variantId, 1, "add")).toMatchObject({ outcome: "added" });
    expect((await getCart(await shop())).lines.map((l) => l.status)).toEqual(["ok"]);
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

  it("stops sales the day after a recorded registration ends, in the cart and placeOrder() alike, and before one begins", async () => {
    const store = await storeOf(fx);
    const { today, yesterday, tomorrow } = await days(fx);
    // Ended yesterday: not sold today. The line in the cart says why and blocks, adding is refused, and placeOrder() refuses it.
    const saved = await saveRegistration(store, fx.ownerId, registration({ validTo: yesterday }));
    expect(saved).toMatchObject({ ok: true });
    const id = (saved as { id: string }).id;
    expect(await blockedSchemes(fx.storeId, mug.productId, "NO")).toEqual(["packaging"]);
    expect(await gapsOf(fx)).toContain("packaging:NO:blocked");
    const cart = await getCart(await shop());
    expect(cart.lines.map((l) => l.status)).toEqual(["unregistered"]);
    expect((await cartSummary(await shop(), cart)).blocked).toBe(true);
    expect(await changeLine(await shop(), mug.variantId, 1, "add")).toMatchObject({ outcome: "unavailable" });
    await expect(paidOrder(fx, [[MUG, 1]])).rejects.toThrow(/placeOrder: unregistered/);
    // Sweden has nothing on record: still sold there.
    expect(await blockedSchemes(fx.storeId, mug.productId, "SE")).toEqual([]);

    // Begins tomorrow: not sold before its first day.
    expect(await saveRegistration(store, fx.ownerId, registration({ validFrom: tomorrow }), id)).toMatchObject({ ok: true, id });
    expect(await blockedSchemes(fx.storeId, mug.productId, "NO")).toEqual(["packaging"]);

    // Ends today: sold today, and the rule stops it tomorrow.
    expect(await saveRegistration(store, fx.ownerId, registration({ validTo: today }), id)).toMatchObject({ ok: true, id });
    expect(await blockedSchemes(fx.storeId, mug.productId, "NO")).toEqual([]);
    expect((await getCart(await shop())).lines[0].status).toBe("ok");
    const onDay = async (day: string) =>
      (await db().execute<Row>(sql`select scheme from commerce.registration_blocks(${fx.storeId}::uuid, 'NO', ${mug.productId}::uuid, ${day}::date)`)).length;
    expect(await onDay(today)).toBe(0);
    expect(await onDay(tomorrow)).toBe(1);
    expect(await gapsOf(fx)).not.toContain("packaging:NO:blocked");

    // Open-ended: the order goes through, as the cart showed it.
    expect(await saveRegistration(store, fx.ownerId, registration({ validTo: null }), id)).toMatchObject({ ok: true });
    const placed = await paidOrder(fx, [[MUG, 1]]);
    expect(placed.lines.map((l) => l.sku)).toEqual([MUG]);
  });

  it("shows the number on the product page only while chosen and valid, and an exemption covers without a number", async () => {
    const store = await storeOf(fx);
    expect(await shownRegistrationNumbers(db(), fx.storeId, mug.productId, "NO")).toEqual([{ scheme: "packaging", number: "NO-EMB-123", authority: "Miljødirektoratet" }]);
    expect(await shownRegistrationNumbers(db(), fx.storeId, mug.productId, "SE")).toEqual([]);
    // Sweden: no registration needed, in the owner's words; the warning goes, and nothing is shown.
    const exempt = await saveRegistration(store, fx.ownerId, { scheme: "packaging", market: "SE", kind: "exempt", exemption: "Below the threshold.", number: "ignored", validFrom: "2020-01-01" });
    expect(exempt).toMatchObject({ ok: true });
    expect(await gapsOf(fx)).not.toContain("packaging:SE:warned");
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
    expect(logged.length).toBeGreaterThanOrEqual(4);
    expect(logged.every((l) => l.area === "settings" && !String(l.details).includes("NO-EMB-123"))).toBe(true);
  });

  it("takes a registration away: nothing is on record for that country again, so it is warned of", async () => {
    const inNorway = (await listRegistrations(fx.storeId)).find((r) => r.market === "NO")!;
    expect(await removeRegistration(fx.storeId, fx.ownerId, inNorway.id)).toBe(true);
    expect(await gapsOf(fx)).toContain("packaging:NO:warned");
  });
});

describe("the AI manager's producer registrations", () => {
  it("reads what is registered and missing, refuses before a yes what the page refuses, and saves through the page's writer", async () => {
    const c = { ...(await ownerOf(fx)), invalidate: () => {} };
    const read = (await runOwnerTool(c, "producer_registrations", {})) as {
      not_sold: unknown[];
      no_registration_recorded: { scheme: string; country: string }[];
      registrations: { country: string; kind: string }[];
    };
    expect(read.not_sold).toEqual([]);
    expect(read.no_registration_recorded).toContainEqual(expect.objectContaining({ scheme: "packaging", country: "NO" }));
    expect(read.registrations.map((r) => [r.country, r.kind])).toEqual([["SE", "exempt"]]);
    await expect(preflightOwnerTool(c, "save_producer_registration", { scheme: "packaging", country: "NO" })).rejects.toThrow(/registration number/);
    await expect(preflightOwnerTool(c, "save_producer_registration", { scheme: "packaging", country: "FR", number: "1", authority: "A" })).rejects.toThrow(/store's countries/);
    const ok = { scheme: "packaging", country: "no", number: "NO-EMB-999", authority: "Miljødirektoratet", valid_from: "2020-01-01", valid_to: "2020-12-31" };
    await expect(preflightOwnerTool(c, "save_producer_registration", ok)).resolves.toBeUndefined();
    // A registration that ended long ago: once on record, Norway's packaging is not sold until a new one is valid.
    const done = (await runOwnerTool(c, "save_producer_registration", ok)) as { done: string; still_not_sold: { country: string }[] };
    expect(done.done).toMatch(/recorded/);
    expect(done.still_not_sold.some((g) => g.country === "NO")).toBe(true);
    expect(await blockedSchemes(fx.storeId, mug.productId, "NO")).toEqual(["packaging"]);
  });
});
