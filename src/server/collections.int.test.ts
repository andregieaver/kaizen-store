import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { parseListingParams } from "@/lib/listing-filters";
import { termTextFor } from "@/lib/term-texts";

import { addSwedish, seedProducts } from "./data-test-support";
import { makeStore, ownerOf, type Fixture } from "./invoice-test-fixture";
import type { Membership } from "./auth";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/server", () => ({ connection: async () => {}, after: () => {} }));

const taxonomy = await import("./taxonomy");
const { listGridProducts } = await import("./catalog");
const { listingProducts } = await import("./listing");
const { getStore } = await import("./stores");
const { translationWorklist } = await import("./store-translate");

type Row = Record<string, unknown>;

/**
 * Collections in depth, A1 (wave 6 unit A, D319, `docs/wave-6-catalogue.md` 3.1, 3.2, 3.6): a category's own description, picture and names per
 * language, saved through the term's own save and checked against the store's languages; the owner's order of its products, followed by the
 * term's page and a grid and kept across a product's save; another store's products never placed.
 */

let fx: Fixture;
let other: Fixture;
let owner: Membership;
let products: { id: string; handle: string }[];
let foreign: { id: string }[];
const scopeOf = (f: Fixture) => ({ storeId: f.storeId, contentType: "product" }) as const;
const doc = (text: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });

const ok = <T extends { ok: boolean }>(result: T): Extract<T, { ok: true }> => {
  if (!result.ok) throw new Error(JSON.stringify(result));
  return result as Extract<T, { ok: true }>;
};

beforeAll(async () => {
  fx = await makeStore("collections");
  other = await makeStore("collections-other");
  await addSwedish(fx);
  owner = await ownerOf(fx);
  products = await seedProducts(fx, 3, { prefix: "COLL" });
  foreign = await seedProducts(other, 1, { prefix: "COLX" });
}, 120_000);

afterAll(async () => {
  await closeDb();
});

const termOf = async (id: string) => (await taxonomy.siteTerms(fx.storeId, "product")).find((t) => t.id === id)!;

describe("a category's own page", () => {
  it("keeps a description, a picture and the other languages' name and description, and a page in each language reads its own", async () => {
    const made = ok(
      await taxonomy.createTerm(owner.account, scopeOf(fx), {
        kind: "category",
        name: "Lamper",
        description: doc("Lys til hjemmet."),
        image: { url: "/demo/lamp.webp", thumbnailUrl: null },
        texts: { "sv-SE": { name: "Lampor", description: doc("Ljus för hemmet.") } },
      }),
    );
    const term = await termOf(made.id);
    expect(term.image).toEqual({ url: "/demo/lamp.webp", thumbnailUrl: null });
    expect(termTextFor(term, "sv-SE")).toEqual({ name: "Lampor", description: doc("Ljus för hemmet.") });
    expect(termTextFor(term, "nb-NO").name).toBe("Lamper");
    // A save that sends none of the page keeps it (an older form); one that sends the picture as null removes it.
    ok(await taxonomy.updateTerm(owner.account, scopeOf(fx), made.id, { name: "Lamper", slug: "lamper" }));
    expect((await termOf(made.id)).image).not.toBeNull();
    ok(await taxonomy.updateTerm(owner.account, scopeOf(fx), made.id, { name: "Lamper", slug: "lamper", image: null }));
    expect((await termOf(made.id)).image).toBeNull();
    expect((await termOf(made.id)).description).toEqual(doc("Lys til hjemmet."));
  });

  it("refuses a language the store does not keep, the main language in the other languages, a long description and a page on Kaizena Flow's own terms", async () => {
    const made = ok(await taxonomy.createTerm(owner.account, scopeOf(fx), { kind: "tag", name: "Nytt" }));
    const update = (input: Record<string, unknown>) => taxonomy.updateTerm(owner.account, scopeOf(fx), made.id, { name: "Nytt", slug: "nytt", ...input });
    expect(await update({ texts: { "fr-FR": { name: "Nouveau" } } })).toMatchObject({ ok: false, problems: [expect.stringContaining("fr-FR")] });
    expect(await update({ texts: { "nb-NO": { name: "Nytt" } } })).toMatchObject({ ok: false });
    expect(await update({ description: doc("x".repeat(5001)) })).toMatchObject({ ok: false });
    expect(await update({ image: { url: "javascript:alert(1)", thumbnailUrl: null } })).toMatchObject({ ok: false });
    const platform = { storeId: null, contentType: "page" } as const;
    expect(await taxonomy.createTerm(owner.account, platform, { kind: "category", name: `Guider ${Date.now()}`, description: doc("Om guider.") })).toMatchObject({ ok: false });
  });

  it("is in the translation worklist: its name and description beside its search texts", async () => {
    const made = ok(await taxonomy.createTerm(owner.account, scopeOf(fx), { kind: "category", name: "Bord", description: doc("Bord til stua.") }));
    const store = (await getStore(fx.slug))!;
    const { units } = await translationWorklist({ store }, "sv-SE", ["terms"], "missing", null);
    const unit = units.find((u) => u.id === `term:${made.id}`);
    expect(unit?.items.map((i) => i.key)).toEqual(["name", "body"]);
    // What staff tick is written into the language's texts; the description keeps its formatting, its words replaced run by run.
    const { applyTranslations } = await import("./store-translate");
    const result = await applyTranslations(owner, "sv-SE", [{ unitId: `term:${made.id}`, values: { name: "Bord", body: ["Bord för vardagsrummet."] } }]);
    expect(result).toMatchObject({ ok: true, saved: 1 });
    expect(termTextFor(await termOf(made.id), "sv-SE")).toEqual({ name: "Bord", description: doc("Bord för vardagsrummet.") });
    // A description changed since it was translated is not written over with words for the old one.
    ok(await taxonomy.updateTerm(owner.account, scopeOf(fx), made.id, { name: "Bord", slug: "bord", description: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "To " }, { type: "text", text: "deler", marks: [{ type: "bold" }] }] }] } }));
    const stale = await applyTranslations(owner, "sv-SE", [{ unitId: `term:${made.id}`, values: { body: ["Bord."] } }]);
    expect(stale).toMatchObject({ ok: true, saved: 0 });
  });
});

describe("the owner's order of a category's products", () => {
  let categoryId: string;
  const viewer = { buyer: "private" as const, audienceBoth: false };

  beforeAll(async () => {
    categoryId = ok(await taxonomy.createTerm(owner.account, scopeOf(fx), { kind: "category", name: "Utvalg" })).id;
    for (const p of products) {
      await db().execute(sql`insert into commerce.product_terms (store_id, product_id, term_id) values (${fx.storeId}::uuid, ${p.id}::uuid, ${categoryId}::uuid)`);
    }
  });

  const gridOrder = async () => {
    const store = (await getStore(fx.slug))!;
    const market = store.markets.find((m) => m.code === "NO")!;
    return (await listGridProducts(fx.storeId, market, { categoryIds: [categoryId], tagIds: [], sort: "manual", limit: 48, orderTerm: categoryId })).map((p) => p.id);
  };

  it("lists products as they were added until placed, then in the owner's order, placed ones first; the page's Featured follows it", async () => {
    expect(await gridOrder()).toEqual(products.map((p) => p.id));
    ok(await taxonomy.setTermOrder(owner.account, fx.storeId, categoryId, [products[2].id, products[0].id]));
    expect(await gridOrder()).toEqual([products[2].id, products[0].id, products[1].id]);
    const store = (await getStore(fx.slug))!;
    const market = store.markets.find((m) => m.code === "NO")!;
    const featured = await listingProducts(fx.storeId, market, { categoryIds: [categoryId], orderTerm: categoryId }, parseListingParams({}), viewer);
    expect(featured.map((p) => p.id)).toEqual([products[2].id, products[0].id, products[1].id]);
    expect((await taxonomy.termProducts(fx.storeId, categoryId)).map((p) => [p.id, p.placed])).toEqual([
      [products[2].id, true],
      [products[0].id, true],
      [products[1].id, false],
    ]);
  });

  it("keeps a product's place when the product is saved again", async () => {
    const { getEditorContext, getProductForEdit, saveProduct } = await import("./products");
    const store = (await getStore(fx.slug))!;
    const editor = await getEditorContext(store);
    const input = (await getProductForEdit(store, editor, products[0].id))!;
    expect(input.categories).toContain(categoryId);
    input.translations[0].title = "Seed product 1, renamed";
    expect(await saveProduct(store, editor, products[0].id, input)).toMatchObject({ ok: true });
    expect(await gridOrder()).toEqual([products[2].id, products[0].id, products[1].id]);
  });

  it("never places another store's product, and moves the category's last change for the demo content's removal", async () => {
    const [before] = await db().execute<Row>(sql`select updated_at from commerce.terms where id = ${categoryId}::uuid`);
    ok(await taxonomy.setTermOrder(owner.account, fx.storeId, categoryId, [foreign[0].id, products[1].id]));
    expect(await gridOrder()).toEqual([products[1].id, products[0].id, products[2].id]);
    const [placed] = await db().execute<Row>(sql`select count(*)::int as n from commerce.product_terms where product_id = ${foreign[0].id}::uuid and term_id = ${categoryId}::uuid`);
    expect(placed.n).toBe(0);
    const [after] = await db().execute<Row>(sql`select updated_at from commerce.terms where id = ${categoryId}::uuid`);
    expect(new Date(String(after.updated_at)).getTime()).toBeGreaterThan(new Date(String(before.updated_at)).getTime());
    // Another store's category is not this store's to order.
    const theirs = ok(await taxonomy.createTerm((await ownerOf(other)).account, scopeOf(other), { kind: "category", name: "Deres" }));
    expect(await taxonomy.setTermOrder(owner.account, fx.storeId, theirs.id, [products[0].id])).toMatchObject({ ok: false });
  });
});

describe("a collection filled by rules (A2)", () => {
  const viewer = { buyer: "private" as const, audienceBoth: false };
  let picked: string;
  const marketOf = async () => (await getStore(fx.slug))!.markets.find((m) => m.code === "NO")!;
  const gridOf = async (termId: string) =>
    (await listGridProducts(fx.storeId, await marketOf(), { categoryIds: [termId], tagIds: [], sort: "manual", limit: 48, orderTerm: termId })).map((p) => p.id);

  beforeAll(async () => {
    picked = ok(await taxonomy.createTerm(owner.account, scopeOf(fx), { kind: "category", name: "Plukket" })).id;
    await db().execute(sql`insert into commerce.product_terms (store_id, product_id, term_id) values (${fx.storeId}::uuid, ${products[1].id}::uuid, ${picked}::uuid)`);
  });

  it("lists what its rules hold on its page, in a grid and in the sitemap, newest first, and follows a product's change at once", async () => {
    const made = ok(
      await taxonomy.createTerm(owner.account, scopeOf(fx), {
        kind: "tag",
        name: "Rimelig",
        rules: { match: "any", conditions: [{ kind: "price", max: 10150 }, { kind: "term", termId: picked }] },
      }),
    );
    // Product 1 costs 101 kr in Norway, product 2 is in Plukket by hand; product 3 is neither.
    expect(await gridOf(made.id)).toEqual([products[1].id, products[0].id]);
    const featured = await listingProducts(fx.storeId, await marketOf(), { tagIds: [made.id], orderTerm: made.id }, parseListingParams({}), viewer);
    expect(featured.map((p) => p.id)).toEqual([products[1].id, products[0].id]);
    const { listIndexedTerms } = await import("./seo");
    expect((await listIndexedTerms(fx.storeId)).find((t) => t.slug === "rimelig")?.markets).toEqual(["NO"]);
    // Taken out of Plukket, product 2 leaves the collection with nothing re-run.
    await db().execute(sql`delete from commerce.product_terms where product_id = ${products[1].id}::uuid and term_id = ${picked}::uuid`);
    expect(await gridOf(made.id)).toEqual([products[0].id]);
    await db().execute(sql`insert into commerce.product_terms (store_id, product_id, term_id) values (${fx.storeId}::uuid, ${products[1].id}::uuid, ${picked}::uuid)`);
    // Its panel lists what it holds, and it has no order of the owner's.
    expect((await taxonomy.termProducts(fx.storeId, made.id)).map((p) => p.placed)).toEqual([false, false]);
    expect(await taxonomy.setTermOrder(owner.account, fx.storeId, made.id, [products[0].id])).toMatchObject({ ok: false });
  });

  it("is a choice in the listing's filters like one filled by hand, and choosing it filters to what its rules hold (A3)", async () => {
    const { listingFacets } = await import("./listing");
    const facets = await listingFacets(fx.storeId, await marketOf(), {}, viewer);
    expect(facets.tags.find((t) => t.value === "rimelig")?.count).toBe(2);
    const chosen = await listingProducts(fx.storeId, await marketOf(), {}, parseListingParams({ tag: "rimelig" }), viewer);
    expect(chosen.map((p) => p.id).sort()).toEqual([products[0].id, products[1].id].sort());
  });

  it("counts what it holds as the shop lists it, and each condition alone", async () => {
    const { checkedRules, countRuleMembers } = await import("./term-rules");
    const checked = await checkedRules(fx.storeId, null, { match: "all", conditions: [{ kind: "price", max: 10250 }, { kind: "inStock" }] });
    if (!checked.ok) throw new Error(checked.problems.join(" "));
    // The store's demo products are in stock too: the price alone holds the two seeds under 102,50 kr, both together the same two.
    const count = await countRuleMembers(fx.storeId, checked.rules);
    expect(count.total).toBe(2);
    expect(count.each[0]).toBe(2);
    expect(count.each[1]).toBeGreaterThanOrEqual(3);
  });

  it("is reached by campaigns and codes as its page lists it, the cart and checkout reading the same terms", async () => {
    const { termsOfProducts } = await import("./campaigns");
    const [rimelig] = await db().execute<Row>(sql`select id from commerce.terms where store_id = ${fx.storeId}::uuid and slug = 'rimelig'`);
    const terms = await termsOfProducts(db(), fx.storeId, products.map((p) => p.id));
    expect(terms.get(products[0].id)).toContain(String(rimelig.id));
    expect(terms.get(products[1].id)).toEqual(expect.arrayContaining([picked, String(rimelig.id)]));
    expect(terms.get(products[2].id) ?? []).not.toContain(String(rimelig.id));
  });

  it("keeps only the store's own ids, never itself or another collection filled by rules, and never a product placed in it by hand", async () => {
    const theirs = ok(await taxonomy.createTerm((await ownerOf(other)).account, scopeOf(other), { kind: "category", name: "Fremmed" }));
    // Another store's category alone names nothing of this store's.
    expect(await taxonomy.createTerm(owner.account, scopeOf(fx), { kind: "tag", name: "Fremmede", rules: { conditions: [{ kind: "term", termId: theirs.id }] } })).toMatchObject({
      ok: false,
    });
    // With one of its own beside it, the foreign condition is dropped.
    const kept = ok(
      await taxonomy.createTerm(owner.account, scopeOf(fx), {
        kind: "tag",
        name: "Blandet",
        rules: { conditions: [{ kind: "term", termId: theirs.id }, { kind: "newWithin", days: 30 }] },
      }),
    );
    expect((await termOf(kept.id)).rules?.conditions).toEqual([{ kind: "newWithin", days: 30 }]);
    // A collection filled by rules cannot be named by another's rules, nor can a term another's rules name be filled by rules.
    expect(await taxonomy.createTerm(owner.account, scopeOf(fx), { kind: "tag", name: "Kjede", rules: { conditions: [{ kind: "term", termId: kept.id }] } })).toMatchObject({ ok: false });
    const naming = ok(await taxonomy.createTerm(owner.account, scopeOf(fx), { kind: "tag", name: "Navngir", rules: { conditions: [{ kind: "term", termId: picked }] } }));
    expect(await taxonomy.updateTerm(owner.account, scopeOf(fx), picked, { name: "Plukket", slug: "plukket", rules: { conditions: [{ kind: "inStock" }] } })).toMatchObject({
      ok: false,
      problems: [expect.stringMatching(/is filled by rules that name this one/)],
    });
    // A product's save never places it in one (the editor's stale choice is dropped).
    const { getEditorContext, getProductForEdit, saveProduct } = await import("./products");
    const store = (await getStore(fx.slug))!;
    const editor = await getEditorContext(store);
    const input = (await getProductForEdit(store, editor, products[2].id))!;
    input.tags = [...input.tags, naming.id];
    expect(await saveProduct(store, editor, products[2].id, input)).toMatchObject({ ok: true });
    const [row] = await db().execute<Row>(sql`select count(*)::int as n from commerce.product_terms where term_id = ${naming.id}::uuid`);
    expect(row.n).toBe(0);
  });

  it("takes out the products placed by hand when turned on, and keeps what matched when turned off if asked", async () => {
    const term = ok(await taxonomy.createTerm(owner.account, scopeOf(fx), { kind: "category", name: "Skifter" })).id;
    await db().execute(sql`insert into commerce.product_terms (store_id, product_id, term_id) values (${fx.storeId}::uuid, ${products[2].id}::uuid, ${term}::uuid)`);
    ok(await taxonomy.updateTerm(owner.account, scopeOf(fx), term, { name: "Skifter", slug: "skifter", rules: { conditions: [{ kind: "price", max: 10150 }] } }));
    const placed = async () => (await db().execute<Row>(sql`select product_id from commerce.product_terms where term_id = ${term}::uuid`)).map((r) => String(r.product_id));
    expect(await placed()).toEqual([]);
    expect(await gridOf(term)).toEqual([products[0].id]);
    ok(await taxonomy.updateTerm(owner.account, scopeOf(fx), term, { name: "Skifter", slug: "skifter", rules: null, keepMatches: true }));
    expect(await placed()).toEqual([products[0].id]);
    expect((await termOf(term)).rules).toBeNull();
  });

  it("is read and changed by the AI manager through the categories page's own save, every name found in the store first", async () => {
    const { listCategoriesTool, updateCategoryTool, preflightUpdateCategory } = await import("./category-tools");
    const store = (await getStore(fx.slug))!;
    const ctx = { account: owner.account, store, invalidate: () => {} };
    await expect(preflightUpdateCategory(ctx, { category: "Plukket", rules: { match: "all", conditions: [{ kind: "manufacturer", names: ["Nobody"] }] } })).rejects.toThrow(/No manufacturer/);
    await expect(preflightUpdateCategory(ctx, { category: "Plukket", description: "The best price in Norway, only 3 left!" })).rejects.toThrow(/claims/);
    const made = await updateCategoryTool(ctx, {
      category: "Utvalg",
      description: "Lys til hjemmet.\n\nLaget for lange kvelder.",
    });
    expect(made.done).toMatch(/^Changed the category "Utvalg": set its description/);
    const listed = await listCategoriesTool(ctx, { kind: "tag" });
    expect(listed.categories.find((c) => c.name === "Rimelig")).toMatchObject({ products: 2, filled: expect.stringContaining("priced up to") });
    const auto = await updateCategoryTool(ctx, { category: "Blandet", kind: "tag", rules: { match: "all", conditions: [{ kind: "term", name: "plukket" }] } });
    expect(auto.done).toContain("in category Plukket");
  });
});
