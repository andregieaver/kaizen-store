import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));
vi.mock("./stripe", () => ({ platformStripe: () => ({}), platformPublishableKey: () => "pk_test_x", platformModes: () => ["test"], WEBHOOK_EVENTS: [] }));

const ownerTools = await import("./owner-tools");
const productTools = await import("./product-tools");
const { getEditorContext, getProductForEdit } = await import("./products");
const { newStore } = await import("./inventory-test-support");
const { storeOf } = await import("./product-data");
const { writeProductTextsInput, createProductInput } = await import("@/lib/product-tools");
const { formatMoney } = await import("@/lib/money");

type Row = Record<string, unknown>;
// The answers are read as the model reads them: loose JSON.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Answer = Record<string, any>;

/**
 * The AI manager's catalogue tools (D308, unit A1), run the way the assistant runs them against a real store: a product is made, changed,
 * priced and published through the product editor's own save and read back through the editor's own reader; a draft is changed at once and a
 * live product waits for a yes; what the editor would refuse is refused in its words, before anything is kept or made; another store's product
 * is never found.
 */

let store: Awaited<ReturnType<typeof newStore>>;
let other: Awaited<ReturnType<typeof newStore>>;
const tags: string[] = [];

const ctxOf = (s: typeof store) => ({ account: s.member.account, store: s.member.store, invalidate: (tag: string) => void tags.push(tag) });
const run = (name: string, input: unknown, s = store) => ownerTools.runOwnerTool(ctxOf(s), name, input) as Promise<Answer>;
const preflight = (name: string, input: unknown, s = store) => ownerTools.preflightOwnerTool(ctxOf(s), name, input);
const refusal = async (promise: Promise<unknown>) => {
  try {
    await promise;
    return null;
  } catch (error) {
    return error instanceof ownerTools.OwnerToolError ? error.message : `not a tool refusal: ${String(error)}`;
  }
};
/** The product as the product editor reads it. */
const editorView = async (id: string, s = store) => {
  const product = await getProductForEdit(s.member.store, await getEditorContext(s.member.store), id);
  if (!product) throw new Error("no product");
  return product;
};
const count = async (query: ReturnType<typeof sql>) => Number((await db().execute<Row>(query))[0].n);
/** A picture in the store's media library, as an upload leaves it. */
async function libraryPicture(s: typeof store, name: string): Promise<string> {
  const url = `https://media.example/${s.storeId}/${name}.webp`;
  await db().execute(sql`
    insert into commerce.media (store_id, kind, url, thumbnail_url, bucket, path, thumbnail_path, file_name, content_type, size_bytes)
    values (${s.storeId}::uuid, 'image', ${url}, ${url.replace(".webp", "-480.webp")}, 'product-media', ${`${s.storeId}/${name}.webp`}, null, ${`${name}.webp`}, 'image/webp', 1000)
  `);
  return url;
}

beforeAll(async () => {
  store = await newStore("prodtools");
  other = await newStore("prodtools-other");
  // A store that sells in its three countries and writes in four languages (D178: Countries and Languages on).
  await db().execute(sql`
    update commerce.stores set features = features || array['countries', 'languages', 'currencies'], locales = array['nb-NO', 'sv-SE', 'da-DK', 'en-GB']
    where id = ${store.storeId}::uuid
  `);
  const fresh = await storeOf(store.storeId);
  if (!fresh) throw new Error("the store could not be read again");
  store.member.store = fresh;
}, 120_000);

afterAll(async () => {
  await closeDb();
});

describe("create_product", () => {
  it("makes a draft through the editor's save, with its variants, prices, stock, terms and pictures, read back by the editor", async () => {
    const picture = await libraryPicture(store, "linen-shirt");
    const answer = await run("create_product", {
      title: "Linen shirt",
      description: "A shirt of washed linen.",
      translations: [{ language: "sv", title: "Linneskjorta" }],
      options: [{ name: "Size", values: ["S", "M"] }],
      prices: { NO: "499", se: "549" },
      stock: 4,
      weight_grams: 300,
      categories: ["Shirts"],
      tags: ["linen"],
      pictures: [{ url: picture, alt: "A linen shirt on a hanger" }],
      manufacturer: "Kaizena Flow Demo AS",
    });
    expect(answer.done).toContain('Made the draft "Linen shirt"');
    expect(answer).toMatchObject({ status: "draft", handle: "linen-shirt", admin: `/admin/${store.slug}/products/${answer.id}` });
    const product = await editorView(answer.id);
    expect(product.status).toBe("draft");
    expect(product.translations.find((t) => t.locale === "nb-NO")).toMatchObject({ title: "Linen shirt", description: "A shirt of washed linen." });
    expect(product.translations.find((t) => t.locale === "sv-SE")?.title).toBe("Linneskjorta");
    // The editor reads variants back by SKU.
    expect(product.variants.map((v) => [v.sku, v.options, v.prices, v.stock, v.weightGrams])).toEqual([
      ["LINEN-SHIRT-M", { Size: "M" }, { NO: "499,00", SE: "549,00" }, 4, 300],
      ["LINEN-SHIRT-S", { Size: "S" }, { NO: "499,00", SE: "549,00" }, 4, 300],
    ]);
    expect(product.media).toEqual([{ url: picture, thumbnailUrl: picture.replace(".webp", "-480.webp"), alt: "A linen shirt on a hanger" }]);
    const editor = await getEditorContext(store.member.store);
    expect(product.categories.map((id) => editor.terms.find((t) => t.id === id)?.name)).toEqual(["Shirts"]);
    expect(product.tags.map((id) => editor.terms.find((t) => t.id === id)?.name)).toEqual(["linen"]);
    // Its opening stock is in the history as the AI manager's, for the person; the call is in the activity log under Products.
    const moves = await db().execute<Row>(sql`
      select m.reason, m.source, m.actor_account_id as account_id from commerce.inventory_movements m join commerce.product_variants v on v.id = m.variant_id
      where v.product_id = ${answer.id}::uuid
    `);
    expect(moves.map((m) => [m.reason, m.source, m.account_id])).toEqual([
      ["opening", "ai_manager", store.accountId],
      ["opening", "ai_manager", store.accountId],
    ]);
    const [entry] = await db().execute<Row>(sql`select area from commerce.audit_log where store_id = ${store.storeId}::uuid and action = 'store.assistant.create_product' order by id desc limit 1`);
    expect(entry?.area).toBe("products");
    expect(tags).toContain(`catalog:${store.storeId}`);
    // What it still needs before it can be published, in the editor's words.
    expect(answer.before_publishing).toEqual(["The manufacturer is outside the EU, so add a responsible person established in the EU."]);
  });

  it("takes a free address, says where it is not priced, and is never a live product", async () => {
    const answer = await run("create_product", { title: "Linen shirt", prices: { NO: "299" }, status: "active" });
    expect(answer.handle).toBe("linen-shirt-2");
    expect(answer.status).toBe("draft");
    expect(answer.not_sold_in).toEqual(expect.arrayContaining([expect.stringContaining("(SE, SEK)"), expect.stringContaining("(DK, DKK)")]));
    expect(answer.before_publishing).toContain("Add at least one picture before publishing the product.");
  });

  it("refuses what the editor would refuse, or claims, before it makes anything", async () => {
    const terms = () => count(sql`select count(*)::int as n from commerce.terms where store_id = ${store.storeId}::uuid`);
    const products = () => count(sql`select count(*)::int as n from commerce.products where store_id = ${store.storeId}::uuid`);
    const [beforeTerms, beforeProducts] = [await terms(), await products()];
    expect(await refusal(run("create_product", { title: "Mug", prices: { NO: "abc" }, categories: ["Brand new category"] }))).toContain('"abc" is not a price in NOK');
    expect(await refusal(run("create_product", { title: "Mug", prices: { US: "10" }, categories: ["Brand new category"] }))).toContain('does not sell to "US"');
    expect(await refusal(run("create_product", { title: "Mug", pictures: [{ url: "https://elsewhere.example/a.png" }], categories: ["Brand new category"] }))).toContain(
      "Not in the store's media library",
    );
    expect(await refusal(run("create_product", { title: "The best price mug", description: "Eco-friendly and climate neutral." }))).toContain("Rewrite without claims");
    expect(await refusal(run("create_product", { title: "Mug", options: [{ name: "Size", values: ["S"] }], variants: [{ sku: "A" }, { sku: "a" }] }))).toContain("Two variants have the same SKU");
    expect([await terms(), await products()]).toEqual([beforeTerms, beforeProducts]);
  });

  it("puts a picture made by the store's picture model on it, and makes at most three in a call", async () => {
    const made: string[] = [];
    const makePicture: NonNullable<Parameters<typeof productTools.createProductTool>[2]>["makePicture"] = async (_owner, raw) => {
      const brief = (raw as { brief: string }).brief;
      made.push(brief);
      return { ok: true, picture: { url: `https://media.example/made/${made.length}.webp`, thumbnailUrl: null, width: 1024, height: 1024, alt: brief } };
    };
    const answer = (await productTools.createProductTool(ctxOf(store), createProductInput.parse({ title: "Clay bowl", pictures: [{ make: "A clay bowl on a linen cloth" }] }), {
      makePicture,
    })) as Answer;
    expect(made).toEqual(["A clay bowl on a linen cloth"]);
    expect((await editorView(answer.id)).media).toEqual([{ url: "https://media.example/made/1.webp", thumbnailUrl: null, alt: "A clay bowl on a linen cloth" }]);
    const four = Array.from({ length: 4 }, (_, i) => ({ make: `Bowl number ${i + 1}` }));
    expect(await refusal(productTools.createProductTool(ctxOf(store), createProductInput.parse({ title: "Bowls", pictures: four }), { makePicture }))).toContain("at most 3 pictures");
    expect(made).toHaveLength(1);
  });
});

describe("update_product, set_prices and set_product_status", () => {
  let id: string;

  beforeAll(async () => {
    const picture = await libraryPicture(store, "wool-scarf");
    const answer = await run("create_product", { title: "Wool scarf", prices: { NO: "399" }, stock: 7, pictures: [{ url: picture }], manufacturer: "Kaizena Flow Demo AS" });
    id = answer.id;
  });

  it("changes a draft at once, only the fields given, and leaves stock alone", async () => {
    expect(await ownerTools.gateNeeded(store.member.store, "update_product", { product: id })).toBe(false);
    const answer = await run("update_product", { product: "wool-scarf", title: "Merino scarf", tags: ["winter"], variants: [{ sku: "WOOL-SCARF", prices: { SE: "449" } }] });
    expect(answer.done).toBe('Changed "Merino scarf": the title; WOOL-SCARF: prices; the tags.');
    const product = await editorView(id);
    expect(product.translations.find((t) => t.locale === "nb-NO")?.title).toBe("Merino scarf");
    expect(product.variants[0]).toMatchObject({ sku: "WOOL-SCARF", prices: { NO: "399,00", SE: "449,00" }, stock: 7 });
    expect(await refusal(run("update_product", { product: id, variants: [{ sku: "WOOL-SCARF", stock: 2 }] }))).toContain("set_stock");
    expect(await refusal(run("update_product", { product: id }))).toContain("Nothing to change");
  });

  it("publishes only what the editor would publish, in its words, and waits for a yes", async () => {
    expect(await ownerTools.gateNeeded(store.member.store, "set_product_status", { product: id, status: "active" })).toBe(true);
    expect(await refusal(preflight("set_product_status", { product: id, status: "active" }))).toContain("add a responsible person established in the EU");
    expect(await refusal(run("set_product_status", { product: id, status: "active" }))).toContain("add a responsible person established in the EU");
    await run("update_product", { product: id, responsible_person: "Kaizena Flow Demo AB" });
    await preflight("set_product_status", { product: id, status: "active" });
    const answer = await run("set_product_status", { product: id, status: "active" });
    expect(answer).toMatchObject({ done: '"Merino scarf" is on the site, for sale.', status: "active" });
    expect((await editorView(id)).status).toBe("active");
  });

  it("asks for a yes to change a live product, says what the change does, and prices through the editor's save", async () => {
    expect(await ownerTools.gateNeeded(store.member.store, "set_prices", { product: id })).toBe(true);
    expect(await ownerTools.gateNeeded(store.member.store, "update_product", { product: "merino scarf" })).toBe(true);
    expect(await productTools.productApprovalWords(store.member.store, "set_prices", { product: id, changes: [{ prices: { NO: "429" } }] })).toBe(
      'Change the prices of the live product "Merino scarf": every variant 429 NOK in NO.',
    );
    // Checked before it is kept: a price the editor would refuse is never waiting for a yes.
    expect(await refusal(preflight("set_prices", { product: id, changes: [{ prices: { NO: "abc" } }] }))).toContain("is not a price in NOK");
    expect(await refusal(preflight("set_prices", { product: id, changes: [{ sku: "NOPE", prices: { NO: "1" } }] }))).toContain("WOOL-SCARF");
    const priced = await run("set_prices", { product: id, changes: [{ prices: { NO: "429", SE: "" } }] });
    expect(priced.variants).toEqual([`WOOL-SCARF (Default): ${formatMoney(42900, "NOK", "nb-NO")} in NO`]);
    expect((await editorView(id)).variants[0].prices).toEqual({ NO: "429,00" });
    const [current] = await db().execute<Row>(sql`
      select c.amount_minor from commerce.current_prices c join commerce.product_variants v on v.id = c.variant_id
      where v.product_id = ${id}::uuid and c.market_code = 'NO'
    `);
    expect(Number(current.amount_minor)).toBe(42900);
    // A live product's change in words, from the arguments and the product's own title.
    expect(await productTools.productApprovalWords(store.member.store, "update_product", { product: id, title: "Scarf", categories: ["Winter"] })).toBe(
      'Change the live product "Merino scarf": the title to "Scarf"; the categories to Winter.',
    );
    await run("set_product_status", { product: id, status: "draft" });
    expect((await editorView(id)).status).toBe("draft");
  });

  it("never finds another store's product, and leaves an archived one to archive_product", async () => {
    expect(await refusal(run("update_product", { product: id, title: "Taken" }, other))).toContain(`No product "${id}"`);
    expect(await refusal(run("set_prices", { product: "wool-scarf", changes: [{ prices: { NO: "1" } }] }, other))).toContain('No product "wool-scarf"');
    expect(await ownerTools.gateNeeded(other.member.store, "update_product", { product: id })).toBe(false);
    await run("archive_product", { product: id, archived: true });
    expect(await refusal(run("update_product", { product: id, title: "Back" }))).toContain("archive_product");
    await run("archive_product", { product: id, archived: false });
  });
});

describe("write_product_texts", () => {
  const connection = { textModel: "writer-model" } as never;

  it("writes from the product's own facts, leaves out claims, and saves on a draft", async () => {
    const created = await run("create_product", { title: "Oak board", options: [{ name: "Size", values: ["Small", "Large"] }], categories: ["Kitchen"] });
    const asked: { kind: string; language: string; facts: unknown }[] = [];
    const write: NonNullable<Parameters<typeof productTools.writeProductTextsTool>[2]>["write"] = async (_c, _who, request) => {
      asked.push({ kind: request.kind, language: request.language, facts: request.facts });
      if (request.kind === "write") return { written: { description: "A board of oak for the kitchen." }, model: "m" };
      if (request.kind === "seo") return { written: { seoTitle: "Oak board", seoDescription: "The best price on oak boards." }, model: "m" };
      return { written: { title: `Oak board (${request.language})`, description: `In ${request.language}.` }, model: "m" };
    };
    const answer = (await productTools.writeProductTextsTool(ctxOf(store), writeProductTextsInput.parse({ product: created.id, languages: ["sv"] }), { connection, write })) as Answer;
    expect(asked.map((a) => [a.kind, a.language])).toEqual([
      ["write", "Norwegian Bokmål"],
      ["seo", "Norwegian Bokmål"],
      ["translate", "Swedish"],
    ]);
    // The writer is given the product's own words and names only: never a price or stock.
    expect(asked[0].facts).toEqual({ kind: "goods", title: "Oak board", description: "", seoTitle: "", seoDescription: "", categories: ["Kitchen"], tags: [], options: [{ name: "Size", values: ["Large", "Small"] }] });
    expect(answer.left_out).toEqual([expect.stringContaining("seoDescription")]);
    const product = await editorView(created.id);
    expect(product.translations.find((t) => t.locale === "nb-NO")).toMatchObject({ description: "A board of oak for the kitchen.", seoTitle: "Oak board", seoDescription: "" });
    expect(product.translations.find((t) => t.locale === "sv-SE")).toMatchObject({ title: "Oak board (Swedish)", description: "In Swedish." });
    // Written again only when asked.
    const again = (await productTools.writeProductTextsTool(ctxOf(store), writeProductTextsInput.parse({ product: created.id, texts: ["description"] }), { connection, write })) as Answer;
    expect(again.done).toContain("Nothing to write");
  });

  it("only gives the texts for a live product, and says when there is no text model", async () => {
    const picture = await libraryPicture(store, "oak-spoon");
    const created = await run("create_product", { title: "Oak spoon", prices: { NO: "99" }, pictures: [{ url: picture }], responsible_person: "Kaizena Flow Demo AB" });
    await run("set_product_status", { product: created.id, status: "active" });
    const write: NonNullable<Parameters<typeof productTools.writeProductTextsTool>[2]>["write"] = async () => ({ written: { description: "A spoon carved from oak." }, model: "m" });
    const answer = (await productTools.writeProductTextsTool(ctxOf(store), writeProductTextsInput.parse({ product: created.id, texts: ["description"] }), { connection, write })) as Answer;
    expect(answer.done).toContain("Written, not saved");
    expect(answer.written).toEqual([{ language: "nb-NO", texts: { description: "A spoon carved from oak." } }]);
    expect((await editorView(created.id)).translations.find((t) => t.locale === "nb-NO")?.description).toBe("");
    expect(await refusal(productTools.writeProductTextsTool(ctxOf(store), writeProductTextsInput.parse({ product: created.id }), { connection: null }))).toContain("no AI text model");
  });
});
