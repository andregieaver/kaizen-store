import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { newPageContent, type ContentGridBlock, type PageContent } from "@/lib/page-content";
import { newBlock } from "@/lib/page-rows";

import { seedProducts } from "./data-test-support";
import { makeStore, ownerOf, type Fixture } from "./invoice-test-fixture";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/server", () => ({ connection: async () => {}, after: () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));

const { savePage, findPublishedPage } = await import("./pages");
const { gridData } = await import("./content-grid");
const { getEditorContext, getProductForEdit, saveProduct } = await import("./products");
const { getProduct } = await import("./catalog");
const { getStore } = await import("./stores");
const { saveStoreMenu } = await import("./menus");
const { countryTextCounts } = await import("./store-translate");
const { menuLabel } = await import("@/lib/navigation");

type Row = Record<string, unknown>;

/**
 * Each country's own content (wave 7 unit D1, D338, `docs/wave-7-storefront.md` D): a page or article limited to some of the store's countries is
 * saved with the store's own countries only and left out of a content grid elsewhere; a product's description for one country is written by
 * `saveProduct()`, shown in that country's product page over its language's and copied with the store; a menu label for one country is kept on
 * save and read by `menuLabel()` there; and the translation page counts them.
 */

let fx: Fixture;
let product: { id: string; handle: string };
const run = Date.now().toString(36);

beforeAll(async () => {
  fx = await makeStore("country-content");
  [product] = await seedProducts(fx, 1, { prefix: "CC", variants: 1 });
}, 120_000);

afterAll(async () => {
  await closeDb();
});

const page = (title: string, slug: string, markets?: string[]): PageContent => ({ ...newPageContent(), title, slug, markets });

describe("a page for some countries", () => {
  it("keeps only the store's own countries, and none when it is every one", async () => {
    const { account } = await ownerOf(fx);
    const some = await savePage(account, fx.storeId, null, page("Bare Sverige", `sverige-${run}`, ["SE", "ZZ"]), { publish: true });
    expect(some).toMatchObject({ ok: true });
    const found = await findPublishedPage(fx.storeId, `sverige-${run}`);
    expect(found && "page" in found && found.page.content.markets).toEqual(["SE"]);
    const countries = (await db().execute<Row>(sql`select code from commerce.markets where store_id = ${fx.storeId}::uuid`)).map((r) => String(r.code));
    const every = await savePage(account, fx.storeId, null, page("Overalt", `overalt-${run}`, countries), { publish: true });
    expect(every).toMatchObject({ ok: true });
    const all = await findPublishedPage(fx.storeId, `overalt-${run}`);
    expect(all && "page" in all && all.page.content.markets).toBeUndefined();
  });

  it("is listed by a content grid of pages in its countries only", async () => {
    const block = { ...(newBlock("contentGrid", () => "g1") as ContentGridBlock), source: { type: "pages" as const }, limit: 48 };
    const listed = async (market: string) => (await gridData(block, { pageId: null, owner: fx.storeId, market })).items.map((i) => i.title);
    expect(await listed("SE")).toContain("Bare Sverige");
    expect(await listed("NO")).not.toContain("Bare Sverige");
    expect(await listed("NO")).toContain("Overalt");
  });
});

describe("a product's description for one country", () => {
  const editorOf = async () => {
    const store = (await getStore(fx.slug))!;
    return { store, editor: await getEditorContext(store) };
  };

  it("is saved by saveProduct(), refused for a country the store does not sell to, and shown there over its language's", async () => {
    const { store, editor } = await editorOf();
    const read = (await getProductForEdit(store, editor, product.id))!;
    // Sold in Sweden too, so its product page is there.
    const input = { ...read, variants: read.variants.map((v) => ({ ...v, prices: { ...v.prices, SE: "149,00" } })) };
    const locale = editor.locales[0];
    expect(await saveProduct(store, editor, product.id, { ...input, countryTexts: [{ market: "ZZ", locale, description: "x" }] })).toMatchObject({ ok: false });
    const saved = await saveProduct(store, editor, product.id, { ...input, countryTexts: [{ market: "SE", locale, description: "Bare for Sverige." }] });
    expect(saved).toMatchObject({ ok: true });
    expect((await getProductForEdit(store, editor, product.id))!.countryTexts).toEqual([{ market: "SE", locale, description: "Bare for Sverige." }]);
    // Sweden in the store's main language shows its own; Norway in it shows the language's.
    const se = store.markets.find((m) => m.code === "SE")!;
    const no = store.markets.find((m) => m.code === "NO")!;
    const inSweden = await getProduct(fx.storeId, { ...se, locale }, product.handle);
    const inNorway = await getProduct(fx.storeId, { ...no, locale }, product.handle);
    expect(inSweden?.description).toBe("Bare for Sverige.");
    expect(inNorway?.description).not.toBe("Bare for Sverige.");
    // Sweden in its own language, which the product is not written in: the description falls back to the main language, and so does
    // the country's own (the text the editor wrote).
    const swedish = se.ownLocale;
    expect(swedish).not.toBe(locale);
    expect((await getProduct(fx.storeId, { ...se, locale: swedish }, product.handle))?.description).toBe("Bare for Sverige.");
  });

  it("is kept by a save that leaves it out, and taken away by an empty text", async () => {
    const { store, editor } = await editorOf();
    const input = (await getProductForEdit(store, editor, product.id))!;
    const rest = { ...input };
    delete rest.countryTexts;
    expect(await saveProduct(store, editor, product.id, rest)).toMatchObject({ ok: true });
    expect((await getProductForEdit(store, editor, product.id))!.countryTexts).toHaveLength(1);
    expect(await saveProduct(store, editor, product.id, { ...input, countryTexts: [{ ...input.countryTexts![0], description: "  " }] })).toMatchObject({ ok: true });
    expect((await getProductForEdit(store, editor, product.id))!.countryTexts).toEqual([]);
  });

  it("is copied with the store, and one store never reads another's", async () => {
    const { store, editor } = await editorOf();
    const input = (await getProductForEdit(store, editor, product.id))!;
    await saveProduct(store, editor, product.id, { ...input, countryTexts: [{ market: "SE", locale: editor.locales[0], description: "Kopiert." }] });
    const [cloned] = await db().execute<Row>(sql`select commerce.clone_store(${fx.storeId}::uuid, ${`${fx.slug}-copy`}, 'Copy', ${fx.ownerId}::uuid) as id`);
    const rows = await db().execute<Row>(sql`select market_code, description from commerce.product_market_texts where store_id = ${String(cloned.id)}::uuid`);
    expect(rows.map((r) => [String(r.market_code), String(r.description)])).toEqual([["SE", "Kopiert."]]);
    // The copy's text belongs to the copy's own product, not this store's.
    const [own] = await db().execute<Row>(sql`
      select count(*)::int as n from commerce.product_market_texts t join commerce.products p on p.id = t.product_id
      where t.store_id = ${String(cloned.id)}::uuid and p.store_id <> t.store_id`);
    expect(Number(own.n)).toBe(0);
  });
});

describe("a menu label for one country", () => {
  it("is kept on save for the store's countries only, read first in that country, and counted on the translation page", async () => {
    const member = await ownerOf(fx);
    const store = member.store;
    const se = store.keptMarkets.find((m) => m.code === "SE")!;
    const label = { [store.localization.keptLocales[0]]: "Butikk", [`${se.ownLocale}@SE`]: "Affär", "xx-XX@ZZ": "Nei" };
    const saved = await saveStoreMenu(member, null, { name: `Meny ${run}`, items: [{ label, link: { kind: "products" }, depth: 0 }] });
    expect(saved).toMatchObject({ ok: true });
    const [menu] = await db().execute<Row>(sql`select items from commerce.menus where store_id = ${fx.storeId}::uuid and name = ${`Meny ${run}`}`);
    const item = (menu.items as { label: Record<string, string>; link: { kind: "products" } }[])[0];
    expect(Object.keys(item.label).sort()).toEqual([store.localization.keptLocales[0], `${se.ownLocale}@SE`].sort());
    const builtIn = { home: "Hjem", account: "Konto", cart: "Kurv" };
    expect(menuLabel({ ...item, link: item.link }, se.ownLocale, builtIn, undefined, "SE")).toBe("Affär");
    expect(menuLabel({ ...item, link: item.link }, store.localization.keptLocales[0], builtIn, undefined, "NO")).toBe("Butikk");
    const counts = await countryTextCounts(member);
    expect(counts.find((c) => c.locale === se.ownLocale)?.menus).toBe(1);
  });
});
