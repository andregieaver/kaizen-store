import { z } from "zod";

import { PAGE_DEFAULT, PAGE_MAX, type ApiErrorCode, type ApiMethod, type ApiScope } from "./admin-api";
import type { PermissionKey } from "./permission-keys";
import { PRODUCT_KINDS } from "./product-input";
import type { FeatureId } from "./store-features";

/**
 * What every entry of the Admin API's registry (`ADMIN_API`, D438) is made of, and the shapes its answers share: an id, a time, money,
 * pages and the `updated_after` of every list (D440). The registry's parts (`admin-api-routes.ts` and the slices of wave 14 unit C) are
 * written with these, so an entry is described the same way wherever it lives. Pure.
 */

/** An id as the API gives and takes it: 32 hex digits in the 8-4-4-4-12 form. */
export const id = z.guid();
export const when = z.iso.datetime({ offset: true });
export const currency = z.string().regex(/^[A-Z]{3}$/).describe("An ISO 4217 code, such as NOK or EUR.");
export const minor = z.int().describe("An amount in minor units of the currency (øre, cents), VAT included where the store's prices are.");
export const marketCode = z.string().describe("A market, by its code (the country's ISO 3166-1 code, such as NO).");

/** The cursor of the next page, or null on the last. */
export const next = z.string().nullable().describe("The cursor of the next page, given as `?after=`; null on the last page.");
export const one = <T extends z.ZodType>(item: T) => z.object({ data: item });
export const page = <T extends z.ZodType>(item: T) => z.object({ data: z.array(item), next });
export const all = <T extends z.ZodType>(item: T) => z.object({ data: z.array(item) });

/** The query every list takes: a page, and what changed since a time (D440, for incremental sync). */
export const paging = {
  limit: z.int().min(1).max(PAGE_MAX).optional().describe(`Rows a page holds, at most ${PAGE_MAX}; ${PAGE_DEFAULT} when left out. A larger number gives ${PAGE_MAX}.`),
  after: z.string().max(200).optional().describe("The `next` cursor of the page before; the first page when left out."),
};

/** Only what changed after a time (D440): with each answer's `updated_at`, a sync asks for what changed since its last run. */
export const since = {
  updated_after: when.optional().describe("Only what was made or changed after this time (ISO 8601 with its offset), for incremental sync."),
};

export const byId = z.object({ id: id.describe("The thing's id in this store.") });
export const madeId = one(z.object({ id }));
export const deleted = one(z.object({ id, deleted: z.literal(true) }));
/** The body of an action that needs nothing more (publish, cancel, send): an empty object, or none. */
export const nothing = z.object({}).describe("Nothing: send `{}` or no body.");

// Products, which the catalogue's operations answer too ---------------------

export const PRODUCT_STATES = ["draft", "active", "archived"] as const;

export const apiProduct = z.object({
  id,
  handle: z.string().describe("Its web address after /p/."),
  title: z.string().describe("Its title in the store's main language."),
  status: z.enum(PRODUCT_STATES).describe("draft: off the site. active: on the site, for sale. archived: put away."),
  kind: z.enum(PRODUCT_KINDS),
  created_at: when,
  updated_at: when,
  variants: z.array(
    z.object({
      id,
      sku: z.string().nullable(),
      active: z.boolean(),
      options: z.record(z.string(), z.string()).nullable().describe("The variant's value of each option, such as { \"Size\": \"M\" }."),
      prices: z
        .array(z.object({ market: marketCode, currency, amount_minor: minor }))
        .describe("The price kept for each market, in the market's own currency, VAT included."),
    }),
  ),
});

/** What an operation is, before its zod is known. */
export type Shape = {
  name: string;
  method: ApiMethod;
  /** After `/api/admin/v1`, each `{name}` a path parameter. */
  path: string;
  scope: ApiScope;
  /**
   * The staff permission (D158) the screen it goes through asks for: the token's maker must hold it in the store now, as the admin asks it of
   * a person (`memberCan()`, so a store that is not open refuses what changes it).
   */
  permission: PermissionKey;
  /** The store feature (D178) it stands behind: off, the operation answers `feature_off`. */
  feature?: FeatureId;
  /** A line, for lists and the reference's headings. */
  summary: string;
  /** What it does and answers, in plain words. */
  description: string;
  /** The resource it belongs to, the reference's section. */
  tag: string;
  params?: z.ZodObject;
  query?: z.ZodObject;
  body?: z.ZodType;
  response: z.ZodType;
  /** The status of a success: 201 for what is made. */
  status: 200 | 201;
  /** What it can answer besides success; every operation also answers `unauthorized`, `forbidden`, `rate_limited` and `failed`. */
  errors: readonly ApiErrorCode[];
};

export const op = <const S extends Shape>(shape: S): S => shape;
