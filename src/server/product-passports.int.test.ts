import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));
vi.mock("next/server", async (original) => ({ ...(await original<typeof import("next/server")>()), connection: async () => {} }));
vi.mock("./stripe", () => ({ platformStripe: () => ({}), platformPublishableKey: () => "pk_test_x", platformModes: () => ["test"], WEBHOOK_EVENTS: [] }));

const { passportForEdit, publicPassport, publishedPassportId, savePassport } = await import("./product-passports");
const { getProduct } = await import("./catalog");
const route = await import("@/app/passport/[id]/json/route");
const { newStore, no } = await import("./inventory-test-support");

type Row = Record<string, unknown>;
let store: Awaited<ReturnType<typeof newStore>>;
let productId = "";
let handle = "";

beforeAll(async () => {
  store = await newStore("passports");
  const [product] = await db().execute<Row>(sql`select id, handle from commerce.products where store_id = ${store.storeId}::uuid and status = 'active' and kind = 'goods' order by created_at limit 1`);
  productId = String(product.id);
  handle = String(product.handle);
  const [maker] = await db().execute<Row>(sql`insert into commerce.economic_operators (store_id, name, postal_address, electronic_address, country) values (${store.storeId}::uuid, 'Keramikk AS', 'Storgata 1, 0155 Oslo', 'post@keramikk.example', 'NO') returning id`);
  await db().execute(sql`update commerce.products set manufacturer_id = ${String(maker.id)}::uuid where id = ${productId}::uuid`);
});

afterAll(async () => {
  await closeDb();
});

const passport = {
  materials: [{ name: "Stoneware", percent: 90, recycledPercent: 30 }, { name: "Glaze", percent: 10, recycledPercent: 0 }],
  originCountry: "pt",
  care: "Dishwasher safe.",
  repair: "Chips can be repaired with food-safe epoxy.",
  endOfLife: "Ceramics go with residual waste, not glass.",
  certifications: [{ name: "EU Ecolabel", number: "PT/123/456", url: "https://environment.ec.europa.eu/ecolabel" }],
};

describe("a product's Digital Product Passport (D554)", () => {
  it("is a draft until published, which needs something to show, and only staff who may change products save it", async () => {
    expect(await savePassport({ ...store.member, role: "viewer", permissions: ["products:read"] } as never, productId, passport, false)).toMatchObject({ ok: false });
    expect(await savePassport(store.member, productId, {}, true)).toMatchObject({ ok: false });
    const draft = await savePassport(store.member, productId, passport, false);
    if (!draft.ok) throw new Error(draft.problem);
    expect(draft.published).toBe(false);
    expect(await publicPassport(draft.id)).toBeNull();
    expect((await passportForEdit(store.storeId, productId))?.data.originCountry).toBe("PT");
  });

  it("is read by anyone once published, at an address that never changes, with the product's own facts", async () => {
    const published = await savePassport(store.member, productId, passport, true);
    if (!published.ok) throw new Error(published.problem);
    const again = await savePassport(store.member, productId, { ...passport, care: "Hand wash." }, true);
    expect(again).toMatchObject({ ok: true, id: published.id });
    const read = await publicPassport(published.id);
    expect(read).toMatchObject({ title: expect.any(String), manufacturer: { name: "Keramikk AS", address: "Storgata 1, 0155 Oslo" }, passport: { care: "Hand wash." } });
    expect(read!.identifiers.length).toBeGreaterThan(0);
    expect(await publishedPassportId(store.storeId, productId)).toBe(published.id);
    const json = await route.GET(new Request("http://localhost"), { params: Promise.resolve({ id: published.id }) } as never);
    const body = (await json.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ schema: "kaizenaflow.passport/1", recycledShare: 27, originCountry: "PT" });
    expect((await getProduct(store.storeId, no, handle))?.passportId).toBe(published.id);
  });

  it("goes offline when saved as a draft again", async () => {
    const off = await savePassport(store.member, productId, passport, false);
    if (!off.ok) throw new Error(off.problem);
    expect(await publicPassport(off.id)).toBeNull();
    const json = await route.GET(new Request("http://localhost"), { params: Promise.resolve({ id: off.id }) } as never);
    expect(json.status).toBe(404);
  });
});
