import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

import type { Membership } from "./auth";

type Row = Record<string, unknown>;

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {} }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
  headers: async () => new Headers(),
}));

const translate = await import("./store-translate");
const { getStore } = await import("./stores");

/**
 * Translating a whole store (D110): what is missing in a language, and what
 * staff accepted written where the store's own editors write it.
 */

const run = Date.now().toString(36);
let slug: string;
let storeId: string;
let member: Membership;
const asMember = async (): Promise<Membership> => ({ ...member, store: (await getStore(slug))! });

beforeAll(async () => {
  slug = `tr-${run}`;
  const [request] = await db().execute<Row>(sql`
    insert into commerce.access_requests (email, name, store_name) values (${`tr-${run}@example.com`}, 'Kari', 'Oversett') returning id
  `);
  const [store] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${slug}, 'Oversett', null) as id`);
  storeId = String(store.id);
  // Norwegian first, English added: nothing has an English text yet.
  await db().execute(sql`update commerce.stores set locales = array['nb-NO', 'sv-SE', 'da-DK', 'en-GB'] where id = ${storeId}::uuid`);
  const [account] = await db().execute<Row>(sql`select id, email from commerce.accounts where email = ${`tr-${run}@example.com`}`);
  member = { account: { id: String(account.id), email: String(account.email), name: "Kari", platformAdmin: false }, role: "owner", store: (await getStore(slug))! };
});

afterAll(async () => {
  await closeDb();
});

const all = ["products", "menus", "pages"] as const;

describe("the worklist", () => {
  it("finds products, menu links and pages without English, and a language's own is done", async () => {
    const { units, total } = await translate.translationWorklist(await asMember(), "en-GB", all, "missing", null);
    expect(total).toBe(units.length);
    expect(new Set(units.map((u) => u.scope))).toEqual(new Set(["products", "menus", "pages"]));
    const product = units.find((u) => u.scope === "products" && !u.legal)!;
    expect(product.items.map((i) => i.key)).toContain("title");
    // Swedish is done for the products the demo translated.
    const swedish = await translate.translationWorklist(await asMember(), "sv-SE", ["products"], "missing", null);
    expect(swedish.units.length).toBeLessThan(units.filter((u) => u.scope === "products").length);
  });

  it("brings only the first hundred by default, and counts the rest", async () => {
    const work = await translate.translationWorklist(await asMember(), "en-GB", all, "missing", 2);
    expect(work.units).toHaveLength(2);
    expect(work.total).toBeGreaterThan(2);
  });

  it("counts what each language lacks", async () => {
    const coverage = await translate.translationCoverage(await asMember());
    expect(Object.keys(coverage)).toEqual(["sv-SE", "da-DK", "en-GB"]);
    expect(coverage["en-GB"].products).toBeGreaterThan(0);
  });
});

describe("saving what staff accepted", () => {
  it("writes a product's texts, and only the ones that fit", async () => {
    const m = await asMember();
    const { units } = await translate.translationWorklist(m, "en-GB", ["products"], "missing", null);
    const unit = units.find((u) => !u.legal && u.items.some((i) => i.key === "description"))!;
    const id = unit.id.split(":")[1];
    const result = await translate.applyTranslations(m, "en-GB", [
      { unitId: unit.id, values: { title: "A translated title", description: "A translated description", seoTitle: "x".repeat(500), bogus: "not asked for" } },
    ]);
    expect(result).toMatchObject({ ok: true, saved: 1 });
    const [row] = await db().execute<Row>(sql`select title, description, seo_title from commerce.product_translations where product_id = ${id}::uuid and locale = 'en-GB'`);
    expect(row).toMatchObject({ title: "A translated title", description: "A translated description", seo_title: "" });
    // What is done is no longer missing; asking for everything again still finds it.
    const missing = await translate.translationWorklist(m, "en-GB", ["products"], "missing", null);
    expect(missing.units.find((u) => u.id === unit.id)?.items.map((i) => i.key) ?? []).not.toContain("description");
    const again = await translate.translationWorklist(m, "en-GB", ["products"], "all", null);
    expect(again.units.some((u) => u.id === unit.id)).toBe(true);
  });

  it("refuses a language the store does not have, and units it did not ask for", async () => {
    const m = await asMember();
    expect(await translate.applyTranslations(m, "fr-FR", [{ unitId: "menu:x:0", values: { label: "Bonjour" } }])).toMatchObject({ ok: false });
    const result = await translate.applyTranslations(m, "en-GB", [{ unitId: `product:${crypto.randomUUID()}`, values: { title: "Nope" } }]);
    expect(result).toMatchObject({ ok: true, saved: 0 });
  });

  it("writes a menu link's text into the menu, keeping the rest of it", async () => {
    const m = await asMember();
    const { units } = await translate.translationWorklist(m, "en-GB", ["menus"], "missing", null);
    const unit = units[0];
    const [, menuId, index] = unit.id.split(":");
    const before = (await db().execute<Row>(sql`select items from commerce.menus where id = ${menuId}::uuid`))[0].items as { label: Record<string, string>; link: unknown }[];
    expect(await translate.applyTranslations(m, "en-GB", [{ unitId: unit.id, values: { label: "Home" } }])).toMatchObject({ ok: true, saved: 1 });
    const after = (await db().execute<Row>(sql`select items from commerce.menus where id = ${menuId}::uuid`))[0].items as typeof before;
    expect(after[Number(index)].label["en-GB"]).toBe("Home");
    expect(after[Number(index)].label["nb-NO"]).toBe(before[Number(index)].label["nb-NO"]);
    expect(after[Number(index)].link).toEqual(before[Number(index)].link);
    expect(after).toHaveLength(before.length);
  });

  it("writes a page into its draft, and publishes nothing", async () => {
    const m = await asMember();
    const { units } = await translate.translationWorklist(m, "en-GB", ["pages"], "missing", null);
    const unit = units.find((u) => u.items.some((i) => i.key === "title"))!;
    const id = unit.id.split(":")[1];
    const [before] = await db().execute<Row>(sql`select published from commerce.pages where id = ${id}::uuid`);
    const result = await translate.applyTranslations(m, "en-GB", [{ unitId: unit.id, values: { title: "An English title" } }]);
    expect(result).toMatchObject({ ok: true, saved: 1 });
    const [row] = await db().execute<Row>(sql`select draft, published from commerce.pages where id = ${id}::uuid`);
    expect((row.draft as { translations: Record<string, Record<string, string>> }).translations["en-GB"].title).toBe("An English title");
    expect(row.published).toEqual(before.published);
  });
});

describe("legal texts", () => {
  it("are listed apart: safety information, and pages that look like terms or privacy", async () => {
    const m = await asMember();
    const [product] = await db().execute<Row>(sql`select product_id from commerce.product_translations where store_id = ${storeId}::uuid and locale = 'nb-NO' limit 1`);
    await db().execute(sql`update commerce.product_translations set safety_information = 'Ikke for barn under 3 år.' where product_id = ${String(product.product_id)}::uuid and locale = 'nb-NO'`);
    await db().execute(sql`
      insert into commerce.pages (store_id, slug, draft, published)
      values (${storeId}::uuid, 'vilkar', ${JSON.stringify({ title: "Vilkår", slug: "vilkar", thumbnail: null, seo: { title: "", description: "" }, searchEngines: true, aiAssistants: true, categories: [], tags: [], rows: [{ id: "r", type: "row", layout: "1", columns: [{ id: "c", blocks: [{ id: "h", type: "heading", text: "Kjøpsvilkår", level: 1 }] }] }] })}::jsonb, null)
    `);
    const { units } = await translate.translationWorklist(m, "en-GB", all, "missing", null);
    const legal = units.filter((u) => u.legal);
    expect(legal.some((u) => u.scope === "products" && u.items.some((i) => i.key === "safetyInformation"))).toBe(true);
    expect(legal.some((u) => u.scope === "pages" && u.title === "Vilkår")).toBe(true);
    expect(units.filter((u) => !u.legal).every((u) => u.items.every((i) => i.key !== "safetyInformation"))).toBe(true);
  });
});
