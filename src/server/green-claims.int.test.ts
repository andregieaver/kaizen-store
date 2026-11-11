import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));
vi.mock("./stripe", () => ({ platformStripe: () => ({}), platformPublishableKey: () => "pk_test_x", platformModes: () => ["test"], WEBHOOK_EVENTS: [] }));

const { greenClaimsReport } = await import("./green-claims");
const { checkupFindings } = await import("./store-checkup");
const { storeOf } = await import("./product-data");
const { newStore } = await import("./inventory-test-support");

type Row = Record<string, unknown>;
let store: Awaited<ReturnType<typeof newStore>>;

beforeAll(async () => {
  store = await newStore("green-claims");
});

afterAll(async () => {
  await closeDb();
});

describe("environmental claims on the live site (D552)", () => {
  it("finds them in active products and published pages, not in drafts", async () => {
    const before = await greenClaimsReport(store.storeId);
    const [product] = await db().execute<Row>(sql`select p.id from commerce.products p where p.store_id = ${store.storeId}::uuid and p.status = 'active' order by p.created_at limit 1`);
    await db().execute(sql`update commerce.product_translations set description = 'En miljøvennlig kopp, levert klimakompensert.' where product_id = ${String(product.id)}::uuid and locale = (select min(locale) from commerce.product_translations where product_id = ${String(product.id)}::uuid)`);
    await db().execute(sql`
      insert into commerce.pages (store_id, slug, type, draft, published, published_at)
      values (${store.storeId}::uuid, 'om-gronn', 'page',
        '{"title": "Utkast", "rows": [{"blocks": [{"type": "heading", "text": "Bærekraftig utkast"}]}]}'::jsonb,
        '{"title": "Om oss", "rows": [{"columns": [{"blocks": [{"id": "h", "type": "heading", "text": "Vi er bærekraftige"}]}]}]}'::jsonb, now())
    `);
    const after = await greenClaimsReport(store.storeId);
    expect(after.claims - before.claims).toBe(3);
    const productPlace = after.places.find((p) => p.kind === "product" && p.id === String(product.id));
    expect(productPlace?.findings.map((f) => [f.phrase, f.offset])).toEqual([
      ["miljøvennlig", false],
      ["klimakompensert", true],
    ]);
    const page = after.places.find((p) => p.kind === "page" && p.title === "Om oss");
    expect(page?.findings.map((f) => f.phrase)).toEqual(["bærekraftige"]);
    expect(JSON.stringify(after)).not.toContain("utkast");
  });

  it("is a finding of the store checkup, linked to the page that lists them", async () => {
    const found = (await checkupFindings((await storeOf(store.storeId))!, store.accountId)).find((f) => f.key === "green_claims");
    expect(found).toMatchObject({ page: "/products/claims" });
    expect(found!.count).toBeGreaterThanOrEqual(3);
  });
});
