import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { findClaims } from "@/lib/claims";
import { parsePrice, productProblems, type ProductInput } from "@/lib/product-input";
import { largestPriceChange } from "@/lib/autopilot-autonomy";
import {
  MADE_PICTURES_MAX,
  factsOf,
  languageWord,
  mergeProduct,
  notPricedIn,
  pricesAsChange,
  productApprovalSummary,
  textJobs,
  toProductInput,
  variantLines,
  type CreateProductInput,
  type PictureArgs,
  type Resolved,
  type SetPricesInput,
  type SetProductStatusInput,
  type ToolStore,
  type UpdateProductInput,
  type WriteProductTextsInput,
} from "@/lib/product-tools";
import { writtenFindings, type WrittenText } from "@/lib/product-writing";
import { slugify } from "@/lib/slug";
import type { Term } from "@/lib/taxonomy";

import { aiFor, AiError, type AiConnection } from "./ai";
import type { Account } from "./auth";
import { catalogTag } from "./catalog";
import { libraryFilesByUrl } from "./media-library";
import { OwnerToolError } from "./owner-tool-error";
import { makeSitePicture } from "./picture-maker";
import { suggestProductText } from "./product-writer";
import { emptyProduct, getEditorContext, getProductForEdit, saveProduct, type EditorContext, type StockMode } from "./products";
import type { Store } from "./stores";
import { createTerm, termsTag } from "./taxonomy";

type Row = Record<string, unknown>;

/**
 * The AI manager's catalogue tools (D308, unit A1, `docs/ai-autopilot.md` 3): making and changing products as the product editor does. Every
 * product is saved by `saveProduct()` (the editor's checks in the editor's words, prices through `commerce.set_price` with their history, a
 * new variant's stock as an opening movement, the activity log with the person's account), from `ProductInput` built by the pure conversion
 * in `src/lib/product-tools.ts`. A product is read back with `getProductForEdit()`, the screen's own reader, so a change is laid over what is
 * there and nothing the call does not name is touched; an existing variant's stock is never written from here (set_stock keeps its history).
 *
 * New products are drafts. A change to a draft runs at once (an archived product is refused: archive_product brings it back); a change to a live one waits for the owner's yes
 * (`GATED_WHEN_LIVE`, `productGateNeeded()`), checked first by `preflightProductTool()` so nothing that would be refused is ever waiting.
 * Words written for shoppers pass the claims filter (`findClaims()`); texts written by the D76 writer come from the product's own facts.
 */

type Ctx = { account: Account; store: Store; invalidate: (tag: string) => void };

/** What the tools reach outside the database for, replaceable in tests: the picture model and the text writer. */
export type ProductToolDeps = {
  makePicture?: typeof makeSitePicture;
  connection?: AiConnection | null;
  write?: typeof suggestProductText;
};

const fail = (message: string): never => {
  throw new OwnerToolError(message);
};

const adminLink = (store: Store, id: string) => `/admin/${store.slug}/products/${id}`;

/** What the conversion needs of the store, from the editor's own context. */
export const toolStoreOf = (editor: EditorContext): ToolStore => ({
  locales: editor.locales,
  primaryLocale: editor.primaryLocale,
  markets: editor.markets.map((m) => ({ code: m.code, currency: m.currency, name: m.name })),
  operators: editor.operators.map((o) => ({ id: o.id, name: o.name, country: o.country })),
});

type Found = { id: string; status: "draft" | "active" | "archived"; title: string };

/** A product of the store by its id, handle or title; another store's is never found. */
export async function findProduct(store: Store, ref: string): Promise<Found> {
  const byId = /^[0-9a-f-]{36}$/i.test(ref);
  const rows = await db().execute<Row>(sql`
    select p.id, p.handle, p.status,
      coalesce((select t.title from commerce.product_translations t where t.product_id = p.id and t.title <> ''
        order by t.locale = ${store.localization.locales[0] ?? ""} desc, t.locale limit 1), p.handle) as title
    from commerce.products p
    where p.store_id = ${store.id}::uuid
      and ${byId ? sql`p.id = ${ref}::uuid` : sql`(p.handle = ${ref} or exists (select 1 from commerce.product_translations t where t.product_id = p.id and lower(t.title) = lower(${ref})))`}
    limit 3
  `);
  if (rows.length === 0) return fail(`No product "${ref}" in this store. Use list_products to find it.`);
  if (rows.length > 1) return fail(`Several products match "${ref}": ${rows.map((r) => r.handle).join(", ")}. Name one by its handle.`);
  return { id: String(rows[0].id), status: rows[0].status as Found["status"], title: String(rows[0].title) };
}

/** A web address no other product of the store has: the one asked for, else with -2, -3… after it. */
async function freeHandle(store: Store, wanted: string, own: string | null): Promise<string> {
  const base = slugify(wanted) || "product";
  const rows = await db().execute<Row>(sql`
    select handle from commerce.products
    where store_id = ${store.id}::uuid and (handle = ${base} or handle like ${`${base}-%`}) ${own ? sql`and id <> ${own}::uuid` : sql``}
  `);
  const taken = new Set(rows.map((r) => String(r.handle)));
  if (!taken.has(base)) return base;
  for (let n = 2; n < 1000; n++) {
    const next = `${base.slice(0, 75)}-${n}`;
    if (!taken.has(next)) return next;
  }
  return fail(`The web address "${base}" is taken. Give the product another.`);
}

/** Every product category or tag named, by id: the store's own by name or address, the rest made now (unless `make` is off, for a dry run). */
async function termIds(ctx: Ctx, terms: readonly Term[], kind: "category" | "tag", names: readonly string[], make: boolean): Promise<string[]> {
  const ids: string[] = [];
  const scope = { storeId: ctx.store.id, contentType: "product" } as const;
  for (const name of names) {
    const wanted = name.trim().toLowerCase();
    const found = terms.find((t) => t.kind === kind && (t.name.toLowerCase() === wanted || t.slug === slugify(name)));
    if (found?.rules) return fail(`The ${kind} "${found.name}" is filled by its rules: a product joins it by meeting them, never by naming it.`);
    if (found) {
      ids.push(found.id);
      continue;
    }
    if (!make) continue;
    const made = await createTerm(ctx.account, scope, { kind, name: name.trim() });
    if (!made.ok) return fail(`The ${kind} "${name}" could not be made: ${made.problems.join(" ")}`);
    ctx.invalidate(termsTag(scope));
    ids.push(made.id);
  }
  return [...new Set(ids)];
}

/**
 * The pictures as the editor keeps them: a library picture by its address (the store's own library only), or one the picture model makes now
 * in the site's look (D283), kept in the library. Made pictures are only made when `make` is on, after everything else was checked.
 */
async function pictures(ctx: Ctx, given: readonly PictureArgs[], title: string, make: boolean, deps: ProductToolDeps): Promise<ProductInput["media"]> {
  const urls = given.flatMap((p) => ("url" in p ? [p.url] : []));
  const library = await libraryFilesByUrl(ctx.store.id, urls);
  const missing = urls.filter((url) => !library.has(url));
  if (missing.length > 0) return fail(`Not in the store's media library: ${missing.join(", ")}. Use a picture from the library, or describe one to make (make).`);
  const toMake = given.filter((p) => "make" in p).length;
  if (toMake > MADE_PICTURES_MAX) return fail(`Make at most ${MADE_PICTURES_MAX} pictures in one call; add more with update_product's add_pictures.`);
  const media: ProductInput["media"] = [];
  for (const picture of given) {
    if ("url" in picture) {
      const file = library.get(picture.url)!;
      media.push({ url: file.url, thumbnailUrl: file.thumbnailUrl, alt: picture.alt || title });
      continue;
    }
    if (!make) continue;
    const made = await (deps.makePicture ?? makeSitePicture)({ store: ctx.store, accountId: ctx.account.id }, { brief: picture.make, shape: picture.shape, follow: true });
    if (!made.ok) return fail(made.problem);
    media.push({ url: made.picture.url, thumbnailUrl: made.picture.thumbnailUrl, alt: made.picture.alt });
  }
  return media;
}

/** The EU's member states, for the safety contacts a live product needs (`productProblems()`). */
async function euCountries(): Promise<Set<string>> {
  const rows = await db().execute<Row>(sql`select code from commerce.countries where in_eu`);
  return new Set(rows.map((r) => String(r.code)));
}

/** What the editor would say of the product, as a draft or as it would be published. */
async function problemsOf(input: ProductInput, editor: EditorContext, status: "draft" | "active"): Promise<string[]> {
  return productProblems(
    { ...input, status },
    {
      markets: editor.markets,
      mainCurrency: editor.mainCurrency,
      primaryLocale: editor.primaryLocale,
      operatorCountries: Object.fromEntries(editor.operators.map((o) => [o.id, o.country])),
      euCountries: await euCountries(),
    },
  );
}

/** Every text a call would write for shoppers, for the claims filter. */
type ShopperWords = { title?: string; description?: string; seo_title?: string; seo_description?: string; excerpt?: string; translations?: ShopperWords[] };

function shopperTexts(args: ShopperWords): string[] {
  return [
    args.title,
    args.description,
    args.seo_title,
    args.seo_description,
    args.excerpt,
    ...(args.translations ?? []).flatMap((t) => [t.title, t.description, t.seo_title, t.seo_description, t.excerpt]),
  ].filter((t): t is string => typeof t === "string" && t !== "");
}

function claimsFail(texts: string[]): void {
  const claims = [...new Set(texts.flatMap((text) => findClaims(text).map((c) => c.phrase)))];
  if (claims.length > 0) fail(`Rewrite without claims the store cannot back: ${claims.join(", ")}.`);
}

/**
 * The stock each variant had when read, so a save leaves it alone (`StockMode`): a sale paid since stays paid. A new variant's first stock is an
 * opening movement the history says the AI manager made, for the person.
 */
const loadedStock = (ctx: Ctx, stored: ProductInput | null): StockMode => ({
  loaded: new Map((stored?.variants ?? []).flatMap((v) => (v.id ? [[v.id, v.stock] as const] : []))),
  source: "ai_manager",
  accountId: ctx.account.id,
});

/** Saves through the editor's own save, as the person, and refreshes the catalogue. */
async function save(ctx: Ctx, editor: EditorContext, productId: string | null, input: ProductInput, stockMode?: StockMode): Promise<string> {
  const saved = await saveProduct(ctx.store, editor, productId, input, undefined, undefined, { id: ctx.account.id }, stockMode);
  if (!saved.ok) return fail(saved.problems.join(" "));
  ctx.invalidate(catalogTag(ctx.store.id));
  return saved.productId;
}

/** The product as saved, in a few lines for the model: its variants and prices, where it is not sold, what publishing still needs. */
async function answerFor(ctx: Ctx, productId: string, done: string, extra: Record<string, unknown> = {}) {
  const editor = await getEditorContext(ctx.store);
  const product = await getProductForEdit(ctx.store, editor, productId);
  if (!product) return fail("The product was saved but could not be read again.");
  const markets = toolStoreOf(editor).markets;
  const unpriced = notPricedIn(product, markets);
  const status = product.status;
  const missing = status === "draft" ? await problemsOf(product, editor, "active") : [];
  return {
    done,
    id: productId,
    handle: product.handle,
    status,
    variants: variantLines(product, markets, editor.primaryLocale),
    prices: editor.audience === "businesses" ? "Without VAT, as the store's editor takes them (it sells only to businesses)." : "With VAT, as shoppers pay.",
    ...(unpriced.length > 0 && { not_sold_in: unpriced, note: "Not priced in these countries, so it is not sold there until it is (set_prices)." }),
    ...(status === "draft" && {
      before_publishing: missing.length > 0 ? missing : "Nothing: it can be published with set_product_status.",
    }),
    ...extra,
    admin: adminLink(ctx.store, productId),
  };
}

/** `create_product`: a new draft of physical goods, made as the editor makes one. */
export async function createProductTool(ctx: Ctx, args: CreateProductInput, deps: ProductToolDeps = {}) {
  claimsFail(shopperTexts(args));
  const editor = await getEditorContext(ctx.store);
  const store = toolStoreOf(editor);
  const handle = await freeHandle(ctx.store, args.handle ?? args.title, null);
  // Checked with what is known first, so nothing is made (a category, a picture) for a product that would be refused.
  const dry = toProductInput(args, emptyProduct(editor), store, { handle, media: await pictures(ctx, args.pictures, args.title, false, deps) });
  if (!dry.ok) return fail(dry.problems.join(" "));
  const problems = await problemsOf(dry.input, editor, "draft");
  if (problems.length > 0) return fail(problems.join(" "));
  const resolved: Resolved = {
    handle,
    categories: await termIds(ctx, editor.terms, "category", args.categories, true),
    tags: await termIds(ctx, editor.terms, "tag", args.tags, true),
    media: await pictures(ctx, args.pictures, args.title, true, deps),
  };
  const fresh = resolved.categories!.length + resolved.tags!.length > 0 ? await getEditorContext(ctx.store) : editor;
  const made = toProductInput(args, emptyProduct(fresh), store, resolved);
  if (!made.ok) return fail(made.problems.join(" "));
  const id = await save(ctx, fresh, null, made.input, loadedStock(ctx, null));
  return answerFor(ctx, id, `Made the draft "${args.title}". It is not on the site until it is published.`);
}

/** What a change resolves to without doing anything (no category, picture or address made), for the check before it is kept for a yes. */
async function dryChange(ctx: Ctx, change: UpdateProductInput): Promise<{ found: Found; editor: EditorContext; stored: ProductInput & { archived: boolean } }> {
  const found = await findProduct(ctx.store, change.product);
  const editor = await getEditorContext(ctx.store);
  const stored = await getProductForEdit(ctx.store, editor, found.id);
  if (!stored) return fail(`No product "${change.product}" in this store.`);
  // Saving an archived product would bring it back as a draft: that is archive_product's to do, on the owner's yes.
  if (stored.archived) return fail(`"${found.title}" is archived. Put it back with archive_product first.`);
  return { found, editor, stored };
}

/** Lays a change over the stored product and saves it whole; `make` off only checks it (the gate's preflight). */
async function applyChange(ctx: Ctx, change: UpdateProductInput, { make, deps }: { make: boolean; deps: ProductToolDeps }) {
  claimsFail(shopperTexts(change));
  const { found, editor, stored } = await dryChange(ctx, change);
  const store = toolStoreOf(editor);
  const title = change.title ?? found.title;
  const resolved: Resolved = {
    ...(change.handle !== undefined && { handle: await freeHandle(ctx.store, change.handle, found.id) }),
    ...(change.categories && { categories: await termIds(ctx, editor.terms, "category", change.categories, make) }),
    ...(change.tags && { tags: await termIds(ctx, editor.terms, "tag", change.tags, make) }),
    ...(change.pictures && { media: await pictures(ctx, change.pictures, title, make, deps) }),
    ...(change.add_pictures && { addMedia: await pictures(ctx, change.add_pictures, title, make, deps) }),
  };
  const fresh = make && (change.categories || change.tags) ? await getEditorContext(ctx.store) : editor;
  const merged = mergeProduct(stored, change, store, resolved);
  if (!merged.ok) return fail(merged.problems.join(" "));
  const problems = await problemsOf(merged.input, fresh, merged.input.status);
  if (problems.length > 0) return fail(problems.join(" "));
  if (!make) return null;
  const { archived: _archived, ...input } = merged.input as ProductInput & { archived?: boolean };
  void _archived;
  const id = await save(ctx, fresh, found.id, input, loadedStock(ctx, stored));
  return answerFor(ctx, id, `Changed "${title}": ${merged.changed.join("; ")}.`);
}

/** `update_product`: the fields given, laid over the product as the editor reads it. */
export const updateProductTool = (ctx: Ctx, change: UpdateProductInput, deps: ProductToolDeps = {}) => applyChange(ctx, change, { make: true, deps });

/** `set_prices`: prices of variants per country, as a change of those variants only. */
export async function setPricesTool(ctx: Ctx, input: SetPricesInput) {
  const { stored } = await dryChange(ctx, { product: input.product });
  const change = pricesAsChange(input.product, input, stored);
  if (!change.ok) return fail(change.problems.join(" "));
  return applyChange(ctx, change.change, { make: true, deps: {} });
}

/** `set_product_status`: on the site (checked as the editor checks a product it publishes) or off it as a draft. */
export async function setProductStatusTool(ctx: Ctx, { product, status }: SetProductStatusInput) {
  const { found, editor, stored } = await dryChange(ctx, { product });
  if (stored.status === status) return { done: `"${found.title}" is ${status === "active" ? "on the site already" : "a draft already"}.`, admin: adminLink(ctx.store, found.id) };
  const { archived: _archived, ...input } = stored;
  void _archived;
  const id = await save(ctx, editor, found.id, { ...input, status }, loadedStock(ctx, stored));
  return answerFor(ctx, id, status === "active" ? `"${found.title}" is on the site, for sale.` : `"${found.title}" is off the site, kept as a draft.`);
}

/**
 * `write_product_texts`: the D76 writer (feature `product_writer`) writes from the product's own facts; what the claims filter finds is left
 * out and named. On a product shoppers do not see the texts are saved at once; on a live one they are only given, for update_product (which
 * waits for the owner's yes with the words in it).
 */
export async function writeProductTextsTool(ctx: Ctx, args: WriteProductTextsInput, deps: ProductToolDeps = {}) {
  const { found, editor, stored } = await dryChange(ctx, { product: args.product });
  const store = toolStoreOf(editor);
  const planned = textJobs(stored, args, store);
  if (!planned.ok) return fail(planned.problems.join(" "));
  if (planned.jobs.length === 0) return { done: "Nothing to write: those texts are there. Ask with rewrite to write them again.", admin: adminLink(ctx.store, found.id) };
  const connection =
    deps.connection !== undefined ? deps.connection : await aiFor(ctx.store.id, { feature: "product_writer", accountId: ctx.account.id });
  if (!connection?.textModel) return fail("The store has no AI text model. Choose one under Settings, AI, to write texts.");
  const termNames = {
    categories: editor.terms.filter((t) => stored.categories.includes(t.id)).map((t) => t.name),
    tags: editor.terms.filter((t) => stored.tags.includes(t.id)).map((t) => t.name),
  };
  let translations = stored.translations;
  const written: { language: string; texts: WrittenText }[] = [];
  const left: string[] = [];
  for (const job of planned.jobs) {
    const facts = factsOf({ ...stored, translations }, store.primaryLocale, termNames);
    let answer: WrittenText;
    try {
      ({ written: answer } = await (deps.write ?? suggestProductText)(
        connection,
        { accountId: ctx.account.id, storeId: ctx.store.id, productId: found.id },
        { kind: job.kind, language: languageWord(job.locale), fromLanguage: languageWord(store.primaryLocale), facts },
      ));
    } catch (error) {
      if (error instanceof AiError) return fail(`The AI could not write the texts: ${error.message}`);
      throw error;
    }
    const findings = writtenFindings(answer);
    const kept: WrittenText = Object.fromEntries(Object.entries(answer).filter(([field]) => !findings[field as keyof WrittenText]));
    for (const [field, claims] of Object.entries(findings)) left.push(`${job.locale} ${field}: ${claims!.map((c) => c.phrase).join(", ")}`);
    if (Object.keys(kept).length === 0) continue;
    written.push({ language: job.locale, texts: kept });
    const blank = { locale: job.locale, title: "", description: "", safetyInformation: "", seoTitle: "", seoDescription: "", excerpt: "" };
    const current = translations.find((t) => t.locale === job.locale) ?? blank;
    const next = { ...current, ...kept };
    translations = translations.some((t) => t.locale === job.locale) ? translations.map((t) => (t.locale === job.locale ? next : t)) : [...translations, next];
  }
  const leftOut = left.length > 0 ? { left_out: left, why: "The claims filter found these; they were not used." } : {};
  if (written.length === 0) return fail(`Nothing could be used: ${left.join("; ")}.`);
  if (stored.status === "active") {
    return {
      done: "Written, not saved: the product is on the site, so changing its words needs the owner's yes. Put them on it with update_product.",
      written,
      ...leftOut,
      admin: adminLink(ctx.store, found.id),
    };
  }
  const { archived: _archived, ...input } = stored;
  void _archived;
  const id = await save(ctx, editor, found.id, { ...input, translations }, loadedStock(ctx, stored));
  return answerFor(ctx, id, `Wrote and saved ${written.map((w) => `${w.language} ${Object.keys(w.texts).join(", ")}`).join("; ")} on "${found.title}".`, { written, ...leftOut });
}

/** Whether a tool gated only while the product is live (`GATED_WHEN_LIVE`) needs the owner's yes for this call: the product is on the site. A draft is changed at once, and an archived one is refused by the tool. */
export async function productGateNeeded(store: Store, raw: Record<string, unknown>): Promise<boolean> {
  const ref = typeof raw.product === "string" ? raw.product : "";
  if (!ref) return false;
  try {
    return (await findProduct(store, ref)).status === "active";
  } catch (error) {
    // No such product: run it, and let the tool say so.
    if (error instanceof OwnerToolError) return false;
    throw error;
  }
}

/** Checks a gated product call before it is kept for a yes, so the owner is never asked to approve what would be refused. */
export async function preflightProductTool(ctx: Ctx, name: string, input: Record<string, unknown>): Promise<void> {
  if (name === "update_product") {
    await applyChange(ctx, input as UpdateProductInput, { make: false, deps: {} });
    return;
  }
  if (name === "set_prices") {
    const prices = input as SetPricesInput;
    const { stored } = await dryChange(ctx, { product: prices.product });
    const change = pricesAsChange(prices.product, prices, stored);
    if (!change.ok) return fail(change.problems.join(" "));
    await applyChange(ctx, change.change, { make: false, deps: {} });
    return;
  }
  if (name === "set_product_status") {
    const { product, status } = input as SetProductStatusInput;
    const { found, editor, stored } = await dryChange(ctx, { product });
    if (status === "active") {
      const problems = await problemsOf(stored, editor, "active");
      if (problems.length > 0) return fail(`"${found.title}" cannot be published yet: ${problems.join(" ")}`);
    }
  }
}

/**
 * How far a `set_prices` call moves any price, in percent of the price now (D309: the autopilot's price budget), read from the editor's own
 * product and the store's currencies; null when it cannot be measured (an unknown product, SKU or price).
 */
export async function priceChangePercent(store: Store, account: Account, input: SetPricesInput): Promise<number | null> {
  try {
    const { stored, editor } = await dryChange({ account, store, invalidate: () => {} }, { product: input.product });
    const change = pricesAsChange(input.product, input, stored);
    if (!change.ok) return null;
    const currency = new Map(editor.markets.map((m) => [m.code, m.currency]));
    return largestPriceChange(
      stored.variants.map((v) => ({ sku: v.sku, prices: v.prices })),
      (change.change.variants ?? []).map((v) => ({ sku: v.sku ?? "", prices: v.prices ?? {} })),
      (market) => currency.get(market) ?? null,
      parsePrice,
    );
  } catch {
    return null;
  }
}

/** A gated product call in words from its arguments and the product's own title and currencies, for the approval. */
export async function productApprovalWords(store: Store, tool: string, args: Record<string, unknown>): Promise<string | null> {
  if (typeof args.product !== "string") return null;
  try {
    const found = await findProduct(store, args.product);
    return productApprovalSummary(tool, args, found.title, store.markets.map((m) => ({ code: m.code, currency: m.currency, name: m.name })));
  } catch {
    return null;
  }
}
