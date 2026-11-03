import "server-only";

import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";

import { isUuid, pageSize, type ApiErrorCode, type ApiScope } from "@/lib/admin-api";
import { ADMIN_API_BY_NAME, bodyProblems, PRODUCT_STATES, type AdminAnswer, type AdminApiName, type AdminBody } from "@/lib/admin-api-routes";
import { grants } from "@/lib/admin-api";
import { PRODUCT_KINDS } from "@/lib/product-input";

import type { ApiCaller } from "./api-tokens";
import { audit } from "./auth";
import { OwnerToolError } from "./owner-tool-error";
import { col, typedRows } from "./typed-rows";

/**
 * What every handler of the Admin API shares (D355, D438, D440): its refusal (`ApiError`), an answer built as its operation says, pages
 * under a cursor with `updated_after`, the body read with the operation's zod, the audit entry in the token's name, and the products as the
 * answers give them. `admin-api.ts` and each slice's handlers (`admin-api-catalogue.ts`, …) are written with these.
 */

export class ApiError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export const fail = (code: ApiErrorCode, message: string): never => {
  throw new ApiError(code, message);
};

export type ApiAnswer = { status: number; body: unknown };

/** An operation's answer, built as its registry entry says it is. */
export const ok = <N extends AdminApiName>(_name: N, body: AdminAnswer<N>, status = 200): ApiAnswer => ({ status, body });

/** A cursor: the last row's time and id, so the next page starts after it whatever is added meanwhile. */
export function encodeCursor(at: string, id: string): string {
  return Buffer.from(`${at}|${id}`, "utf8").toString("base64url");
}

/** A cursor's time as it was written: to the microsecond when the list gave one (`cursorAt()`), else as a time Date reads. */
const EXACT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{1,6}Z$/;

export function decodeCursor(value: string | null): { at: string; id: string } | null {
  if (!value || value.length > 200) return null;
  const [at, id] = Buffer.from(value, "base64url").toString("utf8").split("|");
  if (!at || !isUuid(id) || Number.isNaN(Date.parse(at))) return null;
  return { at: EXACT.test(at) ? at : new Date(at).toISOString(), id };
}

/**
 * A row's time to the microsecond, as text, for its page's cursor (D440): rows made in one statement share a time a millisecond cannot tell
 * apart, so a cursor of milliseconds would skip the rest of them on the next page.
 */
export const cursorAt = (column: SQL) => sql`to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

const instant = z.iso.datetime({ offset: true });

/**
 * `?updated_after=` (D440): only rows made or changed after the time, by the column that says when (`updated` an expression of the row's own
 * columns); `true` when it is left out, a 422 when it is not a time with its offset.
 */
export function sinceWhere(params: URLSearchParams, updated: SQL): SQL {
  const raw = params.get("updated_after");
  if (raw === null || raw === "") return sql`true`;
  if (!instant.safeParse(raw).success) return fail("invalid", "updated_after is a time in ISO 8601 with its offset, such as 2026-11-03T12:00:00Z.");
  return sql`${updated} > ${new Date(raw).toISOString()}::timestamptz`;
}

/** A page of rows ordered newest first by `created_at, id`: the condition for rows after the cursor, and the answer's `next`. */
export function paging(params: URLSearchParams, column: SQL, idColumn: SQL) {
  const limit = pageSize(params.get("limit"));
  const raw = params.get("after");
  const after = decodeCursor(raw);
  if (raw && !after) fail("invalid", "The cursor in after is not one this API gave.");
  const where = after ? sql`(${column}, ${idColumn}) < (${after.at}::timestamptz, ${after.id}::uuid)` : sql`true`;
  const next = <R extends { id: string; created_at: string; cursor_at?: string | null }>(rows: R[]) =>
    rows.length > limit ? encodeCursor(rows[limit - 1].cursor_at ?? rows[limit - 1].created_at, rows[limit - 1].id) : null;
  return { limit, where, next };
}

/** Rows of a page made and answered: the first `limit`, and the cursor after them. */
export const pageOf = <R extends { id: string; created_at: string; cursor_at?: string | null }, T>(page: ReturnType<typeof paging>, rows: R[], out: (row: R) => T) => ({
  data: rows.slice(0, page.limit).map(out),
  next: page.next(rows),
});

export const record = (caller: ApiCaller, what: string, details: Record<string, unknown>, target?: { type: string; id: string }) =>
  audit(caller.member.account.id, caller.member.store.id, `integration.api_${what}`, { token: caller.token.name, ...details }, target ? { target } : {});

export async function jsonBody(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (text.length > 1_000_000) fail("invalid", "The body is larger than 1 MB.");
  if (!text.trim()) return {};
  try {
    const value = JSON.parse(text) as unknown;
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : fail("invalid", "The body is a JSON object.");
  } catch {
    return fail("invalid", "The body is not JSON.");
  }
}

/** A body already read, checked with its operation's zod: a 422 in the API's own words before any screen's check runs. */
export function parseBody<N extends AdminApiName>(name: N, raw: unknown): AdminBody<N> {
  const op = ADMIN_API_BY_NAME[name] as { body?: z.ZodType };
  if (!op.body) return fail("failed", `${name} takes no body.`);
  const parsed = op.body.safeParse(raw);
  if (!parsed.success) return fail("invalid", bodyProblems(parsed.error.issues).join(" "));
  return parsed.data as AdminBody<N>;
}

/** The body of a write, read with its operation's zod. */
export async function readBody<N extends AdminApiName>(name: N, request: Request): Promise<AdminBody<N>> {
  return parseBody(name, await jsonBody(request));
}

/** A refusal from the screens' functions, as a 422 with their own words. */
export async function asTool<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof OwnerToolError) return fail("invalid", error.message);
    throw error;
  }
}

/** The owner tools' context, as the token's maker. */
export const toolCtx = (caller: ApiCaller) => ({ account: caller.member.account, store: caller.member.store, invalidate: () => {} });

/** Whether the token holds a scope beyond the one its route needs (`products:publish` for a product on the site, D440). */
export const holds = (caller: ApiCaller, scope: ApiScope): boolean => grants(caller.token.scopes, scope);

/** A list's rows and a refusal the screens' functions answer as problems. */
export const problems = (result: { ok: true } | { ok: false; problems: string[] }, code: ApiErrorCode = "invalid"): void => {
  if (!result.ok) fail(code, result.problems.join(" "));
};

/** The rows with every variant named by its id: a SKU the store does not have is refused before anything is written. */
export async function byVariantId<R extends { variant_id?: string; sku?: string }>(storeId: string, rows: R[]): Promise<(R & { variant_id: string })[]> {
  const skus = [...new Set(rows.flatMap((r) => (r.sku ? [r.sku] : [])))];
  const found =
    skus.length === 0
      ? []
      : await typedRows(
          z.object({ id: col.uuid, sku: col.text }),
          sql`select id, sku from commerce.product_variants where store_id = ${storeId}::uuid and sku in (${sql.join(skus.map((s) => sql`${s}`), sql`, `)})`,
        );
  const ids = new Map(found.map((row) => [row.sku, row.id]));
  const missing = skus.filter((s) => !ids.has(s));
  if (missing.length > 0) fail("invalid", `No variant with the SKU ${missing.slice(0, 5).join(", ")} in this store.`);
  return rows.map((row) => ({ ...row, variant_id: row.variant_id ?? ids.get(row.sku!)! }));
}

// ---------------------------------------------------------------------------
// Products, as the answers give them
// ---------------------------------------------------------------------------

const productRow = z.object({
  id: col.uuid,
  handle: col.text,
  status: z.enum(PRODUCT_STATES),
  kind: z.enum(PRODUCT_KINDS),
  title: col.textOrNull,
  created_at: col.timestamp,
  cursor_at: z.string(),
  updated_at: col.timestamp,
  variants: z.array(
    z.object({
      id: z.string(),
      sku: z.string().nullable(),
      active: z.boolean(),
      options: z.record(z.string(), z.string()).nullable(),
      prices: z.array(z.object({ market: z.string(), currency: z.string(), amount_minor: z.number() })),
    }),
  ),
});

export async function readProducts(storeId: string, where: SQL, limit: number) {
  // Prices as the admin keeps them (`kept_prices`: every current price, VAT included), per market in its own currency.
  return typedRows(
    productRow,
    sql`
      select p.id, p.handle, p.status::text as status, p.kind, p.created_at, ${cursorAt(sql`p.created_at`)} as cursor_at, p.updated_at,
        (select t.title from commerce.product_translations t where t.product_id = p.id
          order by (t.locale = (select m.default_locale from commerce.markets m join commerce.stores s on s.id = m.store_id
            where s.id = p.store_id and m.active order by (m.code = s.country) desc nulls last, m.created_at limit 1)) desc, t.locale limit 1) as title,
        coalesce((select json_agg(json_build_object('id', v.id, 'sku', v.sku, 'active', v.active, 'options', v.options,
            'prices', coalesce((select json_agg(json_build_object('market', kp.market_code, 'currency', trim(kp.currency), 'amount_minor', kp.amount_minor) order by kp.market_code)
              from commerce.kept_prices kp where kp.variant_id = v.id), '[]'::json)) order by v.created_at, v.id)
          from commerce.product_variants v where v.product_id = p.id), '[]'::json) as variants
      from commerce.products p
      where p.store_id = ${storeId}::uuid and ${where}
      order by p.created_at desc, p.id desc
      limit ${limit}
    `,
  );
}

export const productOut = (row: z.output<typeof productRow>): AdminAnswer<"products.get">["data"] => ({
  id: row.id,
  handle: row.handle,
  title: row.title ?? "",
  status: row.status,
  kind: row.kind,
  created_at: row.created_at,
  updated_at: row.updated_at,
  variants: row.variants,
});

export async function productById(caller: ApiCaller, id: string) {
  const [row] = await readProducts(caller.member.store.id, sql`p.id = ${id}::uuid`, 1);
  return row ? productOut(row) : fail("not_found", "No such product in this store.");
}
