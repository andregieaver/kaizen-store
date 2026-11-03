import { z } from "zod";

import { all, apiProduct, byId, currency, deleted, id, minor, nothing, one, op, page, paging, since, when } from "./admin-api-shapes";
import { ALT_MAX } from "./page-content";
import { PRICE_ROWS_MAX } from "./price-lists";
import { MAX_MEDIA } from "./product-input";
import { TERM_NAME_MAX } from "./taxonomy";

/**
 * The Admin API's catalogue (wave 14 unit C1, D440, `docs/wave-14-developer-platform.md` C1): categories and tags and a product's place in
 * them, the media library's uploads and a product's gallery, with `products:manage`; publishing and archiving, renaming or deleting a
 * category or tag, a product on the site and price lists' fixed prices (D321) with the power `products:publish` (what `update_product`,
 * `update_category` and `set_price_list_prices` ask the owner's yes for). Entries of `ADMIN_API`; their handlers are `src/server/admin-api-catalogue.ts`.
 * Pure.
 */

// Categories and tags (D50) ------------------------------------------------------

export const TERM_KINDS_API = ["category", "tag"] as const;

export const apiTerm = z.object({
  id,
  kind: z.enum(TERM_KINDS_API),
  name: z.string().describe("Its name, as the store shows it."),
  slug: z.string().describe("Its web address after /c/ (a category) or /t/ (a tag)."),
  parent_id: id.nullable().describe("A category's parent category; null at the top and for every tag."),
  filled_by_rules: z.boolean().describe("A category filled by its rules (D319): its products are what the rules match, never placed by hand."),
  products: z.int().describe("Products placed in it by hand."),
  created_at: when,
  updated_at: when,
});

const termName = z.string().trim().min(1, "Give it a name.").max(TERM_NAME_MAX).describe(`Its name, at most ${TERM_NAME_MAX} characters.`);
const termSlug = z.string().trim().max(100).describe("Its web address: lowercase letters, digits and hyphens; made from the name when left out or empty.");

export const categoryCreateBody = z.object({
  name: termName,
  slug: termSlug.optional(),
  parent_id: z.guid().nullable().optional().describe("The parent category; at the top when left out."),
});
export const tagCreateBody = z.object({ name: termName, slug: termSlug.optional() });

/** What a change names is changed; the rest stays (its search texts, page and rules are the admin's). */
export const categoryUpdateBody = z
  .object({ name: termName.optional(), slug: termSlug.optional(), parent_id: z.guid().nullable().optional() })
  .refine((b) => Object.keys(b).length > 0, "Send what changes: name, slug or parent_id.");
export const tagUpdateBody = z
  .object({ name: termName.optional(), slug: termSlug.optional() })
  .refine((b) => Object.keys(b).length > 0, "Send what changes: name or slug.");

export const termProductBody = z.object({ product_id: z.guid().describe("The product to put in.") });
const placement = one(
  z.object({
    term_id: id,
    product_id: id,
    placed: z.boolean().describe("Whether the product is in it now."),
  }),
);
const termProductParams = byId.extend({ product_id: id.describe("The product.") });

// The media library (D88, D213) and a product's gallery ----------------------------

/** What an upload may be: the pictures the library keeps, before the server shrinks them as the admin's browser does. */
export const UPLOAD_TYPES = ["image/jpeg", "image/png", "image/webp", "image/avif"] as const;
/**
 * The most bytes an uploaded picture may have before it is shrunk (the library keeps at most 4 MB once shrunk): the `api-uploads` bucket's
 * own limit (migration `20261103201100_api_review`), so Storage refuses a larger file before Kaizena Flow reads it.
 */
export const UPLOAD_MAX_BYTES = 20 * 1024 * 1024;
/** The most pixels a picture may have (D440 review): one larger is refused before it is decoded to be shrunk. */
export const UPLOAD_MAX_PIXELS = 50_000_000;
/** How long an upload address can be used. */
export const UPLOAD_SECONDS = 2 * 60 * 60;

export const uploadBody = z.object({
  content_type: z.enum(UPLOAD_TYPES).describe("The picture's type: JPEG, PNG, WebP or AVIF."),
  size_bytes: z.int().min(1).max(UPLOAD_MAX_BYTES).describe(`Its size in bytes, at most ${UPLOAD_MAX_BYTES / 1024 / 1024} MB.`),
});

export const apiUpload = z.object({
  upload_id: id.describe("Give it to `POST /media` once the file is sent."),
  upload_url: z
    .string()
    .nullable()
    .describe("A one-time address: PUT the file's bytes there with the same Content-Type, once. Answered once: a replay of the request (the same Idempotency-Key) answers null."),
  method: z.literal("PUT"),
  headers: z.record(z.string(), z.string()).describe("The headers to send with the PUT."),
  expires_at: when.describe("The address and the upload id end then."),
});

export const MEDIA_KINDS_API = ["image", "video", "model"] as const;

export const apiMedia = z.object({
  id,
  kind: z.enum(MEDIA_KINDS_API).describe("image, video or model (3D)."),
  url: z.string(),
  thumbnail_url: z.string().nullable().describe("A small copy, 480 pixels wide, for a picture."),
  file_name: z.string(),
  content_type: z.string(),
  size_bytes: z.int(),
  width: z.int().nullable(),
  height: z.int().nullable(),
  alt: z.string().describe("Its words for people who cannot see it, in the store's main language."),
  created_at: when,
  updated_at: when,
});

export const mediaBody = z.object({
  upload_id: z.guid().describe("The upload whose file was sent (`POST /media/uploads`)."),
  file_name: z.string().trim().min(1).max(255).optional().describe("The name the library shows; `picture` when left out."),
  alt: z.string().trim().max(ALT_MAX).optional().describe("Words for people who cannot see it; the store's AI writes them when left out."),
});

export const apiGalleryItem = z.object({
  media_id: id.nullable().describe("The library item (`GET /media`); null for a file the library does not hold."),
  kind: z.enum(MEDIA_KINDS_API),
  url: z.string(),
  thumbnail_url: z.string().nullable(),
  alt: z.string(),
  position: z.int().describe("Its place in the gallery: 0 is the main picture."),
});

const gallery = all(apiGalleryItem);

export const galleryAddBody = z.object({
  media_id: z.guid().describe("A picture of the store's media library."),
  alt: z.string().trim().max(ALT_MAX).optional().describe("Its words in the product's gallery; the library's, else the product's title, when left out."),
});
export const galleryOrderBody = z.object({
  media_ids: z
    .array(z.guid())
    .min(1)
    .max(MAX_MEDIA)
    .describe("The gallery's pictures, by library id, in the order they should have; the first is the main one. Videos and 3D models keep their places after them."),
});

// Price lists (D321) ------------------------------------------------------------------

export const apiPriceList = z.object({
  id,
  name: z.string(),
  percent: z.int().nullable().describe("A percentage off every price it reaches; null for a list of fixed prices only."),
  active: z.boolean(),
  exclusive: z.boolean().describe("Its buyers see only the products it prices."),
  prices: z.int().describe("Fixed prices it holds."),
  groups: z.int().describe("Customer groups it is for."),
  companies: z.int().describe("Companies it is for."),
  updated_at: when,
});

export const apiListPrice = z.object({
  variant_id: id,
  product_id: id,
  sku: z.string(),
  currency,
  amount_minor: minor,
  updated_at: when,
});

export const listPricesBody = z.object({
  rows: z
    .array(
      z
        .object({
          variant_id: z.guid().optional().describe("The variant, by its id."),
          sku: z.string().trim().min(1).max(64).optional().describe("The variant, by its SKU."),
          currency: z.string().regex(/^[A-Z]{3}$/).describe("One of the store's markets' currencies."),
          amount_minor: z.int().min(0).max(100_000_000_00).nullable().describe("The fixed price in minor units, VAT included as the store's prices are; null takes it away."),
        })
        .refine((row) => Boolean(row.variant_id) !== Boolean(row.sku), "Name each row's variant by variant_id or by sku, not both."),
    )
    .min(1)
    .max(PRICE_ROWS_MAX),
});

// ---------------------------------------------------------------------------
// The operations
// ---------------------------------------------------------------------------

const termList = (kind: "category" | "tag") =>
  `The store's product ${kind === "category" ? "categories" : "tags"}, newest first, each with how many products are placed in it by hand.`;

export const CATALOGUE_API = [
  // Categories
  op({
    name: "categories.list",
    method: "GET",
    path: "/categories",
    scope: "products:read",
    permission: "products:read",
    tag: "Categories and tags",
    summary: "List categories",
    description: termList("category"),
    query: z.object({ ...paging, ...since }),
    response: page(apiTerm),
    status: 200,
    errors: ["invalid"],
  }),
  op({
    name: "categories.get",
    method: "GET",
    path: "/categories/{id}",
    scope: "products:read",
    permission: "products:read",
    tag: "Categories and tags",
    summary: "Get a category",
    description: "One product category.",
    params: byId,
    response: one(apiTerm),
    status: 200,
    errors: ["not_found"],
  }),
  op({
    name: "categories.create",
    method: "POST",
    path: "/categories",
    scope: "products:manage",
    permission: "products:write",
    tag: "Categories and tags",
    summary: "Create a category",
    description: "Makes a product category through the Categories page's own writer, with its address made free if it is taken.",
    body: categoryCreateBody,
    response: one(apiTerm),
    status: 201,
    errors: ["invalid", "conflict"],
  }),
  op({
    name: "categories.update",
    method: "PATCH",
    path: "/categories/{id}",
    scope: "products:publish",
    permission: "products:write",
    tag: "Categories and tags",
    summary: "Change a category",
    description: "Renames, re-addresses or moves a category; a changed address leaves a redirect from the old one, as on the page.",
    params: byId,
    body: categoryUpdateBody,
    response: one(apiTerm),
    status: 200,
    errors: ["not_found", "invalid"],
  }),
  op({
    name: "categories.delete",
    method: "DELETE",
    path: "/categories/{id}",
    scope: "products:publish",
    permission: "products:write",
    tag: "Categories and tags",
    summary: "Delete a category",
    description: "Deletes the category; its subcategories move up to its parent and its products leave it.",
    params: byId,
    response: deleted,
    status: 200,
    errors: ["not_found"],
  }),
  op({
    name: "categories.add_product",
    method: "POST",
    path: "/categories/{id}/products",
    scope: "products:manage",
    permission: "products:write",
    tag: "Categories and tags",
    summary: "Put a product in a category",
    description:
      "Puts the product in the category through the product editor's save. A product on the site is changed only with `products:publish` (else `gated`); a category filled by rules takes no product by hand.",
    params: byId,
    body: termProductBody,
    response: placement,
    status: 201,
    errors: ["not_found", "invalid", "gated", "conflict"],
  }),
  op({
    name: "categories.remove_product",
    method: "DELETE",
    path: "/categories/{id}/products/{product_id}",
    scope: "products:manage",
    permission: "products:write",
    tag: "Categories and tags",
    summary: "Take a product out of a category",
    description: "Takes the product out of the category through the product editor's save; a product on the site only with `products:publish`.",
    params: termProductParams,
    response: placement,
    status: 200,
    errors: ["not_found", "invalid", "gated"],
  }),
  // Tags
  op({
    name: "tags.list",
    method: "GET",
    path: "/tags",
    scope: "products:read",
    permission: "products:read",
    tag: "Categories and tags",
    summary: "List tags",
    description: termList("tag"),
    query: z.object({ ...paging, ...since }),
    response: page(apiTerm),
    status: 200,
    errors: ["invalid"],
  }),
  op({
    name: "tags.get",
    method: "GET",
    path: "/tags/{id}",
    scope: "products:read",
    permission: "products:read",
    tag: "Categories and tags",
    summary: "Get a tag",
    description: "One product tag.",
    params: byId,
    response: one(apiTerm),
    status: 200,
    errors: ["not_found"],
  }),
  op({
    name: "tags.create",
    method: "POST",
    path: "/tags",
    scope: "products:manage",
    permission: "products:write",
    tag: "Categories and tags",
    summary: "Create a tag",
    description: "Makes a product tag through the Categories page's own writer.",
    body: tagCreateBody,
    response: one(apiTerm),
    status: 201,
    errors: ["invalid", "conflict"],
  }),
  op({
    name: "tags.update",
    method: "PATCH",
    path: "/tags/{id}",
    scope: "products:publish",
    permission: "products:write",
    tag: "Categories and tags",
    summary: "Change a tag",
    description: "Renames or re-addresses a tag; a changed address leaves a redirect from the old one.",
    params: byId,
    body: tagUpdateBody,
    response: one(apiTerm),
    status: 200,
    errors: ["not_found", "invalid"],
  }),
  op({
    name: "tags.delete",
    method: "DELETE",
    path: "/tags/{id}",
    scope: "products:publish",
    permission: "products:write",
    tag: "Categories and tags",
    summary: "Delete a tag",
    description: "Deletes the tag; its products lose it.",
    params: byId,
    response: deleted,
    status: 200,
    errors: ["not_found"],
  }),
  op({
    name: "tags.add_product",
    method: "POST",
    path: "/tags/{id}/products",
    scope: "products:manage",
    permission: "products:write",
    tag: "Categories and tags",
    summary: "Tag a product",
    description: "Gives the product the tag through the product editor's save; a product on the site only with `products:publish`.",
    params: byId,
    body: termProductBody,
    response: placement,
    status: 201,
    errors: ["not_found", "invalid", "gated", "conflict"],
  }),
  op({
    name: "tags.remove_product",
    method: "DELETE",
    path: "/tags/{id}/products/{product_id}",
    scope: "products:manage",
    permission: "products:write",
    tag: "Categories and tags",
    summary: "Take a tag off a product",
    description: "Takes the tag off the product through the product editor's save; a product on the site only with `products:publish`.",
    params: termProductParams,
    response: placement,
    status: 200,
    errors: ["not_found", "invalid", "gated"],
  }),
  // The media library and a product's gallery
  op({
    name: "media.upload",
    method: "POST",
    path: "/media/uploads",
    scope: "products:manage",
    permission: "products:write",
    tag: "Media",
    summary: "Start an upload",
    description: `Gives a one-time address to PUT a picture to, for ${UPLOAD_SECONDS / 3600} hours. The file is checked and kept only by \`POST /media\`, as the media library checks an upload: its type read from its bytes, shrunk as the admin's browser shrinks pictures (WebP, at most 1600 pixels wide, a 480-pixel copy), counted against the store's storage.`,
    body: uploadBody,
    response: one(apiUpload),
    status: 201,
    errors: ["invalid", "conflict"],
  }),
  op({
    name: "media.create",
    method: "POST",
    path: "/media",
    scope: "products:manage",
    permission: "products:write",
    tag: "Media",
    summary: "Keep an uploaded picture",
    description: "Checks the file sent to an upload's address and keeps it in the store's media library, once: an upload id is used up by its first success.",
    body: mediaBody,
    response: one(apiMedia),
    status: 201,
    errors: ["invalid", "conflict"],
  }),
  op({
    name: "media.list",
    method: "GET",
    path: "/media",
    scope: "products:read",
    permission: "products:read",
    tag: "Media",
    summary: "List the media library",
    description: "The store's pictures, videos and 3D models, newest first.",
    query: z.object({ ...paging, ...since, kind: z.enum(MEDIA_KINDS_API).optional().describe("Only this kind.") }),
    response: page(apiMedia),
    status: 200,
    errors: ["invalid"],
  }),
  op({
    name: "products.media",
    method: "GET",
    path: "/products/{id}/media",
    scope: "products:read",
    permission: "products:read",
    tag: "Media",
    summary: "Get a product's gallery",
    description: "The product's pictures, videos and 3D models in their order, the first the main one.",
    params: byId,
    response: gallery,
    status: 200,
    errors: ["not_found"],
  }),
  op({
    name: "products.media_add",
    method: "POST",
    path: "/products/{id}/media",
    scope: "products:manage",
    permission: "products:write",
    tag: "Media",
    summary: "Add a picture to a product",
    description:
      "Adds a library picture after the product's pictures, through the product editor's save. A product on the site only with `products:publish` (else `gated`). Answers the gallery as it is now.",
    params: byId,
    body: galleryAddBody,
    response: gallery,
    status: 201,
    errors: ["not_found", "invalid", "gated", "conflict"],
  }),
  op({
    name: "products.media_order",
    method: "PATCH",
    path: "/products/{id}/media",
    scope: "products:manage",
    permission: "products:write",
    tag: "Media",
    summary: "Order a product's pictures",
    description: "Puts the product's pictures in the order given (each of them named once); a product on the site only with `products:publish`.",
    params: byId,
    body: galleryOrderBody,
    response: gallery,
    status: 200,
    errors: ["not_found", "invalid", "gated"],
  }),
  op({
    name: "products.media_remove",
    method: "DELETE",
    path: "/products/{id}/media/{media_id}",
    scope: "products:manage",
    permission: "products:write",
    tag: "Media",
    summary: "Take a picture off a product",
    description: "Takes the picture out of the product's gallery (it stays in the library); a product on the site only with `products:publish`.",
    params: byId.extend({ media_id: id.describe("The library picture.") }),
    response: gallery,
    status: 200,
    errors: ["not_found", "gated"],
  }),
  // Publishing (D440: what update_product asks a yes for)
  op({
    name: "products.publish",
    method: "POST",
    path: "/products/{id}/publish",
    scope: "products:publish",
    permission: "products:write",
    tag: "Products",
    summary: "Publish a product",
    description: "Puts a draft on the site, for sale, checked as the editor checks a product it publishes (prices, safety contacts, words). Answers the product.",
    params: byId,
    body: nothing,
    response: one(apiProduct),
    status: 200,
    errors: ["not_found", "invalid", "conflict"],
  }),
  op({
    name: "products.unpublish",
    method: "POST",
    path: "/products/{id}/unpublish",
    scope: "products:publish",
    permission: "products:write",
    tag: "Products",
    summary: "Take a product off the site",
    description: "Makes a product on the site a draft again; nothing else changes.",
    params: byId,
    body: nothing,
    response: one(apiProduct),
    status: 200,
    errors: ["not_found", "invalid", "conflict"],
  }),
  op({
    name: "products.archive",
    method: "POST",
    path: "/products/{id}/archive",
    scope: "products:publish",
    permission: "products:write",
    tag: "Products",
    summary: "Archive a product",
    description: "Puts the product away, off the site and out of the admin's lists; `product.archived` is sent to endpoints that take it.",
    params: byId,
    body: nothing,
    response: one(apiProduct),
    status: 200,
    errors: ["not_found", "invalid", "conflict"],
  }),
  op({
    name: "products.unarchive",
    method: "POST",
    path: "/products/{id}/unarchive",
    scope: "products:publish",
    permission: "products:write",
    tag: "Products",
    summary: "Bring an archived product back",
    description: "Brings an archived product back as a draft, to publish again.",
    params: byId,
    body: nothing,
    response: one(apiProduct),
    status: 200,
    errors: ["not_found", "invalid", "conflict"],
  }),
  // Price lists (D321)
  op({
    name: "price_lists.list",
    method: "GET",
    path: "/price-lists",
    scope: "products:read",
    permission: "customers:read",
    feature: "shop",
    tag: "Price lists",
    summary: "List price lists",
    description: "The store's price lists for customer groups and companies (D321), A to Z, each with how many fixed prices and buyers it has.",
    query: z.object(since),
    response: all(apiPriceList),
    status: 200,
    errors: ["invalid"],
  }),
  op({
    name: "price_lists.prices",
    method: "GET",
    path: "/price-lists/{id}/prices",
    scope: "products:read",
    permission: "customers:read",
    feature: "shop",
    tag: "Price lists",
    summary: "List a price list's prices",
    description: "The list's fixed prices per variant and currency, in minor units, the most recently changed first.",
    params: byId,
    query: z.object({ ...paging, ...since }),
    response: page(apiListPrice),
    status: 200,
    errors: ["not_found", "invalid"],
  }),
  op({
    name: "price_lists.set_prices",
    method: "POST",
    path: "/price-lists/{id}/prices",
    scope: "products:publish",
    permission: "customers:write",
    feature: "shop",
    tag: "Price lists",
    summary: "Set a price list's prices",
    description:
      "Sets fixed prices through the price list page's own writer: each row's amount for its variant and currency (one of the store's markets'), null taking it away. Every row is checked before anything is written.",
    params: byId,
    body: listPricesBody,
    response: one(z.object({ set: z.int(), removed: z.int() })),
    status: 200,
    errors: ["not_found", "invalid", "conflict"],
  }),
] as const;
