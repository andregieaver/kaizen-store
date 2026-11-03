import "server-only";

import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";

import { CATALOGUE_API, MEDIA_KINDS_API } from "@/lib/admin-api-catalogue";
import type { AdminAnswer, ApiRoute } from "@/lib/admin-api-routes";
import { formatPriceInput } from "@/lib/product-input";
import { updateProductInput } from "@/lib/product-tools";
import type { TermKind } from "@/lib/taxonomy";

import { asTool, byVariantId, cursorAt, fail, holds, jsonBody, ok, pageOf, paging, parseBody, productById, readBody, record, sinceWhere, toolCtx, type ApiAnswer } from "./admin-api-kit";
import type { ApiCaller } from "./api-tokens";
import { keepUpload, startUpload } from "./api-uploads";
import { setPrices } from "./price-lists";
import { setProductStatusTool, updateProductTool } from "./product-tools";
import { setArchived } from "./products";
import { createTerm, deleteTerm, updateTerm } from "./taxonomy";
import { col, typedRow, typedRows } from "./typed-rows";

/**
 * The Admin API's catalogue (wave 14 unit C1, D440): categories and tags through the Categories page's writers (`createTerm()`,
 * `updateTerm()`, `deleteTerm()`), a product put in or out of one and its gallery through the product editor's save (`updateProductTool()`),
 * pictures kept by the library's writer (`api-uploads.ts` over `storePicture()`), publishing through `setProductStatusTool()` and archiving
 * through `setArchived()`, both only with `products:publish`, and price lists' fixed prices through `setPrices()`. A product on the site is
 * changed only with `products:publish` (what `update_product` asks the owner's yes for); each change is audited `integration.api_{what}`.
 */

export const CATALOGUE_NAMES = CATALOGUE_API.map((o) => o.name);
type CatalogueName = (typeof CATALOGUE_API)[number]["name"];
export type CatalogueRoute = Extract<ApiRoute, { name: CatalogueName }>;

// ---------------------------------------------------------------------------
// Categories and tags
// ---------------------------------------------------------------------------

const termRow = z.object({
  id: col.uuid,
  kind: z.enum(["category", "tag"]),
  name: col.text,
  slug: col.text,
  parent_id: col.uuid.nullable(),
  ruled: col.bool,
  products: col.int,
  created_at: col.timestamp,
  cursor_at: z.string(),
  updated_at: col.timestamp,
});

type ApiTerm = AdminAnswer<"categories.get">["data"];

const termOut = (row: z.output<typeof termRow>): ApiTerm => ({
  id: row.id,
  kind: row.kind,
  name: row.name,
  slug: row.slug,
  parent_id: row.kind === "category" ? row.parent_id : null,
  filled_by_rules: row.ruled,
  products: row.products,
  created_at: row.created_at,
  updated_at: row.updated_at,
});

function readTerms(storeId: string, kind: TermKind, where: SQL, limit: number) {
  return typedRows(
    termRow,
    sql`
      select t.id, t.kind, t.name, t.slug, t.parent_id, t.rules is not null as ruled, t.created_at, ${cursorAt(sql`t.created_at`)} as cursor_at, t.updated_at,
        (select count(*)::int from commerce.product_terms pt where pt.store_id = t.store_id and pt.term_id = t.id) as products
      from commerce.terms t
      where t.store_id = ${storeId}::uuid and t.content_type = 'product' and t.kind = ${kind} and ${where}
      order by t.created_at desc, t.id desc
      limit ${limit}
    `,
  );
}

async function termById(storeId: string, kind: TermKind, id: string): Promise<ApiTerm> {
  const [row] = await readTerms(storeId, kind, sql`t.id = ${id}::uuid`, 1);
  return row ? termOut(row) : fail("not_found", `No such ${kind} in this store.`);
}

const scopeOf = (caller: ApiCaller) => ({ storeId: caller.member.store.id, contentType: "product" as const });

const termWords = (kind: TermKind) => (kind === "category" ? "category" : "tag");

/** A refusal of the Categories page's writer: one it found gone is a 404, an address taken a 409, the rest a 422. */
function termRefusal(kind: TermKind, problems: string[]): never {
  const text = problems.join(" ");
  if (/no longer exists/.test(text)) return fail("not_found", `No such ${termWords(kind)} in this store.`);
  if (/taken|in use/i.test(text)) return fail("conflict", text);
  return fail("invalid", text);
}

/** Puts a product in a category or tag, or takes it out, through the product editor's save (D440). */
async function placeProduct(caller: ApiCaller, kind: TermKind, termId: string, productId: string, placed: boolean) {
  const storeId = caller.member.store.id;
  const term = await termById(storeId, kind, termId);
  if (placed && term.filled_by_rules) return fail("invalid", `The category "${term.name}" is filled by its rules: a product joins it by meeting them, never by naming it.`);
  const product = await productById(caller, productId);
  if (product.status === "archived") return fail("invalid", "The product is archived. Bring it back first (POST /products/{id}/unarchive).");
  if (product.status === "active" && !holds(caller, "products:publish")) return fail("gated", "The product is on the site: changing it takes a token with products:publish, or the admin.");
  const held = await typedRows(
    z.object({ id: col.uuid, slug: col.text }),
    sql`
      select t.id, t.slug from commerce.product_terms pt join commerce.terms t on t.id = pt.term_id
      where pt.store_id = ${storeId}::uuid and pt.product_id = ${productId}::uuid and t.content_type = 'product' and t.kind = ${kind} and t.rules is null
    `,
  );
  const has = held.some((t) => t.id === termId);
  if (has !== placed) {
    const slugs = placed ? [...held.map((t) => t.slug), term.slug] : held.filter((t) => t.id !== termId).map((t) => t.slug);
    const change = updateProductInput.parse({ product: productId, [kind === "category" ? "categories" : "tags"]: slugs });
    await asTool(() => updateProductTool(toolCtx(caller), change));
    await record(caller, placed ? "product_placed" : "product_unplaced", { kind, term: termId }, { type: "product", id: productId });
  }
  return { term_id: termId, product_id: productId, placed };
}

// ---------------------------------------------------------------------------
// The media library and a product's gallery
// ---------------------------------------------------------------------------

const mediaRow = z.object({
  id: col.uuid,
  kind: z.enum(MEDIA_KINDS_API),
  url: col.text,
  thumbnail_url: col.textOrNull,
  file_name: col.text,
  content_type: col.text,
  size_bytes: col.int,
  width: col.int.nullable(),
  height: col.int.nullable(),
  alt: col.text,
  created_at: col.timestamp,
  cursor_at: z.string(),
  updated_at: col.timestamp,
});

function readMedia(storeId: string, where: SQL, limit: number) {
  return typedRows(
    mediaRow,
    sql`
      select m.id, m.kind, m.url, m.thumbnail_url, m.file_name, m.content_type, m.size_bytes::int as size_bytes, m.width, m.height, coalesce(m.alt, '') as alt, m.created_at, ${cursorAt(sql`m.created_at`)} as cursor_at, m.updated_at
      from commerce.media m where m.store_id = ${storeId}::uuid and ${where}
      order by m.created_at desc, m.id desc limit ${limit}
    `,
  );
}

type Gallery = AdminAnswer<"products.media">["data"];

async function galleryOf(caller: ApiCaller, productId: string): Promise<Gallery> {
  await productById(caller, productId);
  // A gallery item's words are kept per language: the store's main language's, else the first there is.
  const primary = caller.member.store.localization.locales[0] ?? "";
  const rows = await typedRows(
    z.object({ kind: z.enum(MEDIA_KINDS_API), url: col.text, thumbnail_url: col.textOrNull, alt: col.textOrNull, position: col.int, media_id: col.uuid.nullable() }),
    sql`
      select pm.kind, pm.url, pm.thumbnail_url, pm.position,
        (select x.value from jsonb_each_text(case when jsonb_typeof(pm.alt) = 'object' then pm.alt else '{}'::jsonb end) as x(key, value)
          where x.value <> '' order by (x.key = ${primary}) desc, x.key limit 1) as alt,
        (select m.id from commerce.media m where m.store_id = pm.store_id and (m.url = pm.url or m.url = pm.media_url) order by m.created_at limit 1) as media_id
      from commerce.product_media pm where pm.store_id = ${caller.member.store.id}::uuid and pm.product_id = ${productId}::uuid
      order by pm.position, pm.id
    `,
  );
  return rows.map((r, i) => ({ media_id: r.media_id, kind: r.kind, url: r.url, thumbnail_url: r.thumbnail_url, alt: r.alt ?? "", position: i }));
}

/** A change of a product's gallery through the editor's save, held to the rules of a product on the site; answers the gallery after. */
async function changeGallery(caller: ApiCaller, productId: string, change: (pictures: Gallery) => { pictures?: { url: string; alt: string }[]; add?: { url: string; alt?: string }[] }) {
  const product = await productById(caller, productId);
  if (product.status === "archived") return fail("invalid", "The product is archived. Bring it back first (POST /products/{id}/unarchive).");
  if (product.status === "active" && !holds(caller, "products:publish")) return fail("gated", "The product is on the site: changing it takes a token with products:publish, or the admin.");
  const pictures = (await galleryOf(caller, productId)).filter((m) => m.kind === "image");
  const wanted = change(pictures);
  const input = updateProductInput.parse({
    product: productId,
    ...(wanted.pictures && { pictures: wanted.pictures.map((p) => ({ url: p.url, ...(p.alt && { alt: p.alt }) })) }),
    ...(wanted.add && { add_pictures: wanted.add.map((p) => ({ url: p.url, ...(p.alt && { alt: p.alt }) })) }),
  });
  await asTool(() => updateProductTool(toolCtx(caller), input));
  await record(caller, "product_gallery_changed", {}, { type: "product", id: productId });
  return galleryOf(caller, productId);
}

/** A picture of the store's library by its id. */
async function libraryPicture(storeId: string, id: string) {
  const [row] = await readMedia(storeId, sql`m.id = ${id}::uuid`, 1);
  if (!row) return fail("not_found", "No such picture in this store's media library.");
  if (row.kind !== "image") return fail("invalid", "Only a picture can be added to a product's gallery over the API; videos and 3D models are added in the admin.");
  return row;
}

// ---------------------------------------------------------------------------
// The routes
// ---------------------------------------------------------------------------

export async function answerCatalogue(caller: ApiCaller, route: CatalogueRoute, request: Request): Promise<ApiAnswer> {
  const storeId = caller.member.store.id;
  const params = new URL(request.url).searchParams;
  switch (route.name) {
    case "categories.list":
    case "tags.list": {
      const kind: TermKind = route.name === "categories.list" ? "category" : "tag";
      const page = paging(params, sql`t.created_at`, sql`t.id`);
      const rows = await readTerms(storeId, kind, sql`${page.where} and ${sinceWhere(params, sql`t.updated_at`)}`, page.limit + 1);
      return ok(route.name, pageOf(page, rows, termOut));
    }
    case "categories.get":
    case "tags.get":
      return ok(route.name, { data: await termById(storeId, route.name === "categories.get" ? "category" : "tag", route.id) });
    case "categories.create":
    case "tags.create": {
      const kind: TermKind = route.name === "categories.create" ? "category" : "tag";
      const input = route.name === "categories.create" ? await readBody("categories.create", request) : { ...(await readBody("tags.create", request)), parent_id: null };
      const made = await createTerm(caller.member.account, scopeOf(caller), { kind, name: input.name, slug: input.slug ?? "", parentId: input.parent_id ?? null });
      if (!made.ok) return termRefusal(kind, made.problems);
      await record(caller, `${kind}_created`, {}, { type: kind, id: made.id });
      return ok(route.name, { data: await termById(storeId, kind, made.id) }, 201);
    }
    case "categories.update":
    case "tags.update": {
      const kind: TermKind = route.name === "categories.update" ? "category" : "tag";
      const before = await termById(storeId, kind, route.id);
      const raw = await jsonBody(request);
      const input = route.name === "categories.update" ? parseBody("categories.update", raw) : { ...parseBody("tags.update", raw), parent_id: undefined };
      // What the change leaves out stays as it is: the Categories page's writer takes the whole of name, address and parent.
      const changed = await updateTerm(caller.member.account, scopeOf(caller), route.id, {
        name: input.name ?? before.name,
        slug: input.slug ?? before.slug,
        parentId: input.parent_id === undefined ? before.parent_id : input.parent_id,
      });
      if (!changed.ok) return termRefusal(kind, changed.problems);
      await record(caller, `${kind}_updated`, {}, { type: kind, id: route.id });
      return ok(route.name, { data: await termById(storeId, kind, route.id) });
    }
    case "categories.delete":
    case "tags.delete": {
      const kind: TermKind = route.name === "categories.delete" ? "category" : "tag";
      await termById(storeId, kind, route.id);
      const gone = await deleteTerm(caller.member.account, scopeOf(caller), route.id);
      if (!gone.ok) return termRefusal(kind, gone.problems);
      await record(caller, `${kind}_deleted`, {}, { type: kind, id: route.id });
      return ok(route.name, { data: { id: route.id, deleted: true } });
    }
    case "categories.add_product":
    case "tags.add_product": {
      const kind: TermKind = route.name === "categories.add_product" ? "category" : "tag";
      const { product_id } = await readBody(route.name, request);
      return ok(route.name, { data: await placeProduct(caller, kind, route.id, product_id, true) }, 201);
    }
    case "categories.remove_product":
    case "tags.remove_product":
      return ok(route.name, { data: await placeProduct(caller, route.name === "categories.remove_product" ? "category" : "tag", route.id, route.product_id, false) });
    case "media.upload": {
      const input = await readBody(route.name, request);
      const started = await startUpload({ storeId, tokenId: caller.token.id }, { contentType: input.content_type, sizeBytes: input.size_bytes });
      if (!started.ok) return fail(started.code, started.problem);
      await record(caller, "upload_started", { bytes: input.size_bytes });
      return ok(
        route.name,
        { data: { upload_id: started.id, upload_url: started.url, method: "PUT", headers: { "Content-Type": input.content_type }, expires_at: started.expiresAt } },
        201,
      );
    }
    case "media.create": {
      const input = await readBody(route.name, request);
      const kept = await keepUpload({ storeId, tokenId: caller.token.id, accountId: caller.member.account.id }, { uploadId: input.upload_id, fileName: input.file_name, alt: input.alt });
      if (!kept.ok) return fail(kept.code, kept.problem);
      await record(caller, "media_kept", {}, { type: "media", id: kept.mediaId });
      const [row] = await readMedia(storeId, sql`m.id = ${kept.mediaId}::uuid`, 1);
      return ok(route.name, { data: row ?? fail("failed", "The picture was kept but could not be read back.") }, 201);
    }
    case "media.list": {
      const kind = params.get("kind");
      if (kind && !(MEDIA_KINDS_API as readonly string[]).includes(kind)) return fail("invalid", `kind is one of ${MEDIA_KINDS_API.join(", ")}.`);
      const page = paging(params, sql`m.created_at`, sql`m.id`);
      const rows = await readMedia(storeId, sql`${page.where} and ${sinceWhere(params, sql`m.updated_at`)} and ${kind ? sql`m.kind = ${kind}` : sql`true`}`, page.limit + 1);
      const out = ({ cursor_at, ...r }: (typeof rows)[number]) => {
        void cursor_at;
        return r;
      };
      return ok(route.name, pageOf(page, rows, out));
    }
    case "products.media":
      return ok(route.name, { data: await galleryOf(caller, route.id) });
    case "products.media_add": {
      const input = await readBody(route.name, request);
      const picture = await libraryPicture(storeId, input.media_id);
      const data = await changeGallery(caller, route.id, (pictures) => {
        if (pictures.some((p) => p.media_id === picture.id)) return fail("conflict", "The picture is in the product's gallery already.");
        return { add: [{ url: picture.url, alt: input.alt || picture.alt }] };
      });
      return ok(route.name, { data }, 201);
    }
    case "products.media_order": {
      const input = await readBody(route.name, request);
      const data = await changeGallery(caller, route.id, (pictures) => {
        const byId = new Map(pictures.flatMap((p) => (p.media_id ? [[p.media_id, p] as const] : [])));
        const named = new Set(input.media_ids);
        if (named.size !== input.media_ids.length || named.size !== pictures.length || ![...named].every((id) => byId.has(id))) {
          return fail("invalid", "Name each of the product's pictures once, by its library id (GET /products/{id}/media).");
        }
        return { pictures: input.media_ids.map((id) => ({ url: byId.get(id)!.url, alt: byId.get(id)!.alt })) };
      });
      return ok(route.name, { data });
    }
    case "products.media_remove": {
      const data = await changeGallery(caller, route.id, (pictures) => {
        if (!pictures.some((p) => p.media_id === route.media_id)) return fail("not_found", "That picture is not in the product's gallery.");
        return { pictures: pictures.filter((p) => p.media_id !== route.media_id).map((p) => ({ url: p.url, alt: p.alt })) };
      });
      return ok(route.name, { data });
    }
    case "products.publish":
    case "products.unpublish": {
      const product = await productById(caller, route.id);
      await readBody(route.name, request);
      const status = route.name === "products.publish" ? "active" : "draft";
      if (product.status === "archived") return fail("invalid", "The product is archived. Bring it back first (POST /products/{id}/unarchive).");
      if (product.status !== status) {
        await asTool(() => setProductStatusTool(toolCtx(caller), { product: route.id, status }));
        await record(caller, status === "active" ? "product_published" : "product_unpublished", {}, { type: "product", id: route.id });
      }
      return ok(route.name, { data: await productById(caller, route.id) });
    }
    case "products.archive":
    case "products.unarchive": {
      const product = await productById(caller, route.id);
      await readBody(route.name, request);
      const archive = route.name === "products.archive";
      if ((product.status === "archived") === archive) return fail("conflict", archive ? "The product is archived already." : "The product is not archived.");
      if (!(await setArchived(caller.member.store, route.id, archive, caller.member.account))) return fail("not_found", "No such product in this store.");
      await record(caller, archive ? "product_archived" : "product_unarchived", {}, { type: "product", id: route.id });
      return ok(route.name, { data: await productById(caller, route.id) });
    }
    case "price_lists.list": {
      const rows = await typedRows(
        z.object({
          id: col.uuid,
          name: col.text,
          percent: col.int.nullable(),
          active: col.bool,
          exclusive: col.bool,
          prices: col.int,
          groups: col.int,
          companies: col.int,
          updated_at: col.timestamp,
        }),
        sql`
          select l.id, l.name, l.percent, l.active, l.exclusive, l.updated_at,
            (select count(*)::int from commerce.price_list_prices pp where pp.store_id = l.store_id and pp.list_id = l.id) as prices,
            (select count(*)::int from commerce.price_list_assignments a where a.store_id = l.store_id and a.list_id = l.id and a.tier_id is not null) as groups,
            (select count(*)::int from commerce.price_list_assignments a where a.store_id = l.store_id and a.list_id = l.id and a.company_id is not null) as companies
          from commerce.price_lists l
          where l.store_id = ${storeId}::uuid and ${sinceWhere(params, sql`greatest(l.updated_at, (select max(pp.updated_at) from commerce.price_list_prices pp where pp.store_id = l.store_id and pp.list_id = l.id))`)}
          order by lower(l.name), l.id
        `,
      );
      return ok(route.name, { data: rows });
    }
    case "price_lists.prices": {
      await priceListExists(storeId, route.id);
      const key = sql`md5(pp.variant_id::text || pp.currency)::uuid`;
      const page = paging(params, sql`pp.updated_at`, key);
      const rows = await typedRows(
        // The row's key for the cursor: its variant and currency hashed into the shape of an id (a variant has a price per currency).
        z.object({ id: z.string(), created_at: col.timestamp, cursor_at: z.string(), variant_id: col.uuid, product_id: col.uuid, sku: col.text, currency: col.currency, amount_minor: col.minor }),
        sql`
          select ${key} as id, pp.updated_at as created_at, ${cursorAt(sql`pp.updated_at`)} as cursor_at, pp.variant_id, v.product_id, coalesce(v.sku, '') as sku, pp.currency, pp.amount_minor
          from commerce.price_list_prices pp join commerce.product_variants v on v.store_id = pp.store_id and v.id = pp.variant_id
          where pp.store_id = ${storeId}::uuid and pp.list_id = ${route.id}::uuid and ${page.where} and ${sinceWhere(params, sql`pp.updated_at`)}
          order by pp.updated_at desc, ${key} desc
          limit ${page.limit + 1}
        `,
      );
      return ok(
        route.name,
        pageOf(page, rows, (r) => ({ variant_id: r.variant_id, product_id: r.product_id, sku: r.sku, currency: r.currency, amount_minor: r.amount_minor, updated_at: r.created_at })),
      );
    }
    case "price_lists.set_prices": {
      await priceListExists(storeId, route.id);
      const input = await readBody(route.name, request);
      const rows = await byVariantId(storeId, input.rows);
      // The page's own writer takes amounts as typed in each currency: the API's minor units are written as the page would show them.
      const saved = await setPrices(caller.member, route.id, rows.map((r) => ({ variantId: r.variant_id, currency: r.currency, amount: r.amount_minor === null ? "" : formatPriceInput(r.amount_minor, r.currency) })));
      if (!saved.ok) return fail("invalid", saved.problems.join(" "));
      const set = rows.filter((r) => r.amount_minor !== null).length;
      await record(caller, "price_list_prices_set", { set, removed: rows.length - set }, { type: "price_list", id: route.id });
      return ok(route.name, { data: { set, removed: rows.length - set } });
    }
  }
}

async function priceListExists(storeId: string, id: string): Promise<void> {
  const found = await typedRow(z.object({ id: col.uuid }), sql`select id from commerce.price_lists where store_id = ${storeId}::uuid and id = ${id}::uuid`);
  if (!found) fail("not_found", "No such price list in this store.");
}
