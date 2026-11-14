import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/server", () => ({ connection: async () => {}, after: () => {} }));

const { closeDb, db } = await import("@/db/client");
const ownerTools = await import("./owner-tools");
const { marginAfterOffer, marginAfterPrices } = await import("./product-tools");
const { autopilotDecision } = await import("./autopilot-gate");
const { readAutonomy } = await import("@/lib/autopilot-autonomy");
const { newStore } = await import("./inventory-test-support");

/**
 * The margin floor (`docs/100-day-challenge.md` D5) on a real store: a price change and an offer measured against the variant's cost, without
 * the market's VAT, and the autopilot asking for a yes when either leaves a product under the owner's lowest margin.
 */

let store: Awaited<ReturnType<typeof newStore>>;
let id: string;
const ctx = () => ({ account: store.member.account, store: store.member.store, holder: { role: "owner" as const }, invalidate: () => {} });
const run = (name: string, input: unknown) => ownerTools.runOwnerTool(ctx(), name, input) as Promise<Record<string, unknown>>;
const settings = readAutonomy({ levels: { catalogue: "auto", marketing: "auto" }, budgets: { marginFloorPercent: 15, priceChangePercent: 50, discountPercent: 50 } });
const decide = (tool: string, args: Record<string, unknown>) => autopilotDecision({ account: store.member.account, store: store.member.store }, settings, tool, "public", args);

beforeAll(async () => {
  store = await newStore("margin-floor");
  const url = `https://media.example/${store.storeId}/linen-shirt.webp`;
  await db().execute(sql`
    insert into commerce.media (store_id, kind, url, thumbnail_url, bucket, path, thumbnail_path, file_name, content_type, size_bytes)
    values (${store.storeId}::uuid, 'image', ${url}, ${url.replace(".webp", "-480.webp")}, 'product-media', ${`${store.storeId}/linen-shirt.webp`}, null, 'linen-shirt.webp', 'image/webp', 1000)
  `);
  const made = await run("create_product", {
    title: "Linen shirt",
    prices: { NO: "399" },
    stock: 5,
    pictures: [{ url }],
    manufacturer: "Kaizena Flow Demo AS",
    responsible_person: "Kaizena Flow Demo AB",
  });
  id = String(made.id);
  // A unit cost of 250 NOK: 399 with 25 % VAT is 319.20 net, a margin of about 21.7 %.
  await db().execute(sql`update commerce.product_variants set cost_minor = 25000 where product_id = ${id}::uuid`);
});

afterAll(closeDb);

describe("the margin floor", () => {
  it("measures a price change on the cost, without VAT", async () => {
    const lower = await marginAfterPrices(store.member.store, store.member.account, { product: id, changes: [{ prices: { NO: "330" } }] });
    // 330 is 264 net: (264 − 250) ÷ 264 ≈ 5.3 %.
    expect(lower).toBeCloseTo(5.3, 1);
    expect(await decide("set_prices", { product: id, changes: [{ prices: { NO: "330" } }] })).toMatchObject({ run: false, why: expect.stringContaining("15 %") });
    expect(await decide("set_prices", { product: id, changes: [{ prices: { NO: "420" } }] })).toMatchObject({ run: true });
  });

  it("measures an offer over every active product with a cost", async () => {
    expect(await marginAfterOffer(store.member.store, 10)).toBeNull();
    await run("set_product_status", { product: id, status: "active" });
    expect(await marginAfterOffer(store.member.store, 0)).toBeCloseTo(21.7, 1);
    expect(await decide("create_discount", { code: "SMALL", percent: 5 })).toMatchObject({ run: true });
    expect(await decide("create_discount", { code: "DEEP", percent: 20 })).toMatchObject({ run: false, why: expect.stringContaining("margin") });
    // Free shipping takes nothing off a product's price.
    expect(await decide("create_discount", { code: "SHIP", kind: "free_shipping" })).toMatchObject({ run: true });
  });
});
