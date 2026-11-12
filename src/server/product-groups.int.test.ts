import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { toMarket } from "@/lib/markets";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));
vi.mock("./stripe", () => ({ platformStripe: () => ({}), platformPublishableKey: () => "pk_test_x", platformModes: () => ["test"], WEBHOOK_EVENTS: [] }));
vi.mock("./stripe-keys", () => ({ platformModes: () => ["test"], platformPublishableKey: () => "pk_test_x", platformSecretKey: () => "sk_test_x" }));

const groups = await import("./product-groups");
const catalog = await import("./catalog");
const { newStore } = await import("./inventory-test-support");

type Row = Record<string, unknown>;
const no = toMarket({ code: "NO", currency: "NOK", defaultLocale: "nb-NO" });

let store: Awaited<ReturnType<typeof newStore>>;
const ids: Record<string, string> = {};

beforeAll(async () => {
  store = await newStore("groups");
  for (const handle of ["demo-keramikkopp", "demo-termokopp", "demo-notatbok", "demo-bordlampe"]) {
    const [row] = await db().execute<Row>(sql`select id from commerce.products where store_id = ${store.storeId}::uuid and handle = ${handle}`);
    ids[handle] = String(row.id);
  }
});

afterAll(async () => {
  await closeDb();
});

describe("combined listings (D566)", () => {
  it("start from a product with what tells them apart, and take others with their own values", async () => {
    expect(await groups.startGroup(store.member, ids["demo-keramikkopp"], { option: "", value: "Hvit" })).toMatchObject({ ok: false });
    expect(await groups.startGroup(store.member, ids["demo-keramikkopp"], { option: "Farge", value: "Hvit", swatch: "#FFFFFF" })).toEqual({ ok: true });
    expect(await groups.startGroup(store.member, ids["demo-keramikkopp"], { option: "Farge", value: "Hvit" })).toMatchObject({ ok: false, problem: "This product is in a listing already." });
    expect(await groups.addToGroup(store.member, ids["demo-keramikkopp"], ids["demo-termokopp"], { value: "Svart", swatch: "#111111" })).toEqual({ ok: true });
    expect(await groups.addToGroup(store.member, ids["demo-keramikkopp"], ids["demo-notatbok"], { value: "Papir", swatch: "red" })).toMatchObject({ ok: false });
    expect(await groups.addToGroup(store.member, ids["demo-keramikkopp"], ids["demo-notatbok"], { value: "Papir" })).toEqual({ ok: true });
    // A product in one listing joins no other.
    expect(await groups.addToGroup(store.member, ids["demo-keramikkopp"], ids["demo-termokopp"], { value: "x" })).toMatchObject({ ok: false });
    const group = await groups.groupOfProduct(store.storeId, ids["demo-termokopp"], "nb-NO");
    expect(group).toMatchObject({ option: "Farge" });
    expect(group?.members.map((m) => [m.handle, m.value, m.swatch])).toEqual([
      ["demo-keramikkopp", "Hvit", "#ffffff"],
      ["demo-termokopp", "Svart", "#111111"],
      ["demo-notatbok", "Papir", null],
    ]);
    expect((await groups.groupCandidates(store.storeId, ids["demo-keramikkopp"], "nb-NO")).map((c) => c.handle)).not.toContain("demo-termokopp");
  });

  it("show each product's page its listing, itself marked, and each card the others", async () => {
    const detail = await catalog.getProduct(store.storeId, no, "demo-termokopp");
    expect(detail?.group).toEqual({
      option: "Farge",
      items: [
        { handle: "demo-keramikkopp", value: "Hvit", swatch: "#ffffff", current: false },
        { handle: "demo-termokopp", value: "Svart", swatch: "#111111", current: true },
        { handle: "demo-notatbok", value: "Papir", swatch: null, current: false },
      ],
    });
    // Each product keeps its own page and price: the listing lists every product once, each with the listing.
    const cards = await catalog.listProducts(store.storeId, no);
    const mug = cards.filter((c) => c.handle === "demo-keramikkopp");
    expect(mug).toHaveLength(1);
    expect(mug[0].group?.items.map((i) => i.handle)).toEqual(["demo-keramikkopp", "demo-termokopp", "demo-notatbok"]);
    expect(cards.find((c) => c.handle === "demo-bordlampe")?.group).toBeNull();
  });

  it("leave out a product no shopper can see, and a listing with only one product shown", async () => {
    await db().execute(sql`update commerce.products set status = 'draft' where id = ${ids["demo-notatbok"]}::uuid`);
    expect((await catalog.getProduct(store.storeId, no, "demo-keramikkopp"))?.group?.items.map((i) => i.handle)).toEqual(["demo-keramikkopp", "demo-termokopp"]);
    await db().execute(sql`update commerce.products set status = 'draft' where id = ${ids["demo-termokopp"]}::uuid`);
    expect((await catalog.getProduct(store.storeId, no, "demo-keramikkopp"))?.group).toBeNull();
    await db().execute(sql`update commerce.products set status = 'active' where id in (${ids["demo-notatbok"]}::uuid, ${ids["demo-termokopp"]}::uuid)`);
  });

  it("rename the option and a value, and end when fewer than two are left", async () => {
    expect(await groups.renameGroupOption(store.member, ids["demo-notatbok"], { option: "Variant" })).toEqual({ ok: true });
    expect(await groups.updateGroupMember(store.member, ids["demo-notatbok"], { value: "Linjert", swatch: "" })).toEqual({ ok: true });
    expect((await groups.groupOfProduct(store.storeId, ids["demo-notatbok"], "nb-NO"))?.members.find((m) => m.handle === "demo-notatbok")).toMatchObject({ value: "Linjert", swatch: null });
    expect(await groups.leaveGroup(store.member, ids["demo-notatbok"])).toEqual({ ok: true });
    expect(await groups.groupOfProduct(store.storeId, ids["demo-notatbok"], "nb-NO")).toBeNull();
    expect(await groups.leaveGroup(store.member, ids["demo-termokopp"])).toEqual({ ok: true });
    expect(await groups.groupOfProduct(store.storeId, ids["demo-keramikkopp"], "nb-NO")).toBeNull();
    const [left] = await db().execute<Row>(sql`select count(*)::int as n from commerce.product_groups where store_id = ${store.storeId}::uuid`);
    expect(left.n).toBe(0);
  });

  it("is for staff who may change products", async () => {
    const reader = { ...store.member, role: "read_only" as never, permissions: [] as never };
    expect(await groups.startGroup(reader as never, ids["demo-keramikkopp"], { option: "Farge", value: "Hvit" })).toMatchObject({ ok: false });
  });
});
