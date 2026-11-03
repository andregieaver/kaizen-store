import "server-only";

import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { isUuid } from "@/lib/admin-api";
import { ADMIN_API_BY_NAME, bodyProblems, ORDER_STATES, type AdminAnswer, type ApiRoute } from "@/lib/admin-api-routes";
import { DISCOUNT_KINDS } from "@/lib/discounts";

import { answerCatalogue, CATALOGUE_NAMES, type CatalogueRoute } from "./admin-api-catalogue";
import { answerCustomers, CUSTOMERS_NAMES, type CustomersRoute } from "./admin-api-customers";
import { answerOrders, ORDERS_NAMES, type OrdersRoute } from "./admin-api-orders";
import {
  asTool,
  fail,
  holds,
  jsonBody,
  ok,
  byVariantId,
  paging,
  productById,
  productOut,
  readBody,
  readProducts,
  record,
  sinceWhere,
  cursorAt,
  toolCtx,
  type ApiAnswer,
} from "./admin-api-kit";
import type { ApiCaller } from "./api-tokens";
import { deleteCheckoutField, deleteCheckoutRule, listCheckoutFields, listCheckoutRules, saveCheckoutField, saveCheckoutRule, switchCheckoutField, switchCheckoutRule } from "./checkout-rules";
import { saveDiscount } from "./discounts";
import { documentUbl } from "./einvoices";
import { adjustStock } from "./inventory";
import { log } from "./log";
import { getOrderAdmin, markSent, sendRefusalText } from "./order-admin";
import { createProductTool, findProduct, updateProductTool } from "./product-tools";
import { addTag, removeTag } from "./segments";
import { sendShipped } from "./shopper-emails";
import { col, typedRows } from "./typed-rows";

export { ApiError, decodeCursor, encodeCursor, type ApiAnswer } from "./admin-api-kit";

/**
 * The Admin API's handlers (wave 9 unit B, D355): each route reads the store's own data or changes it only through the function its screen
 * uses (`createProductTool()`/`updateProductTool()` over `saveProduct()`, `adjustStock()` with source `api`, `markSent()` and `sendShipped()`,
 * `addTag()`/`removeTag()`, `saveDiscount()`), as the token's maker, and every change is audited `integration.api_{what}` with the token's
 * name. A live product is not changed here (publishing and changing what shoppers see are the owner's, in the admin); a copied order is
 * read-only. Lists are pages under a cursor of the last row's time and id.
 *
 * The contract (D438): every body is read with its operation's zod in `ADMIN_API` (`readBody()`) before a screen's own checks, and every
 * answer is built as the operation's `AdminAnswer` and checked against its `response` on the way out; an answer of another shape is logged
 * (`admin_api.answer_shape`, the paths only) and still sent, so a drift is found without a caller being refused.
 */

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

type ApiOrder = AdminAnswer<"orders.get">["data"];

/**
 * When an order last changed (D440): placed, or its timeline's latest entry (paid, sent, refunded, edited, noted, …), a parcel or a tag; what
 * `updated_after` reads and each answer's `updated_at` says. `o` is the order's row.
 */
export const ORDER_UPDATED = sql`greatest(o.placed_at,
  (select max(e.created_at) from commerce.order_events e where e.store_id = o.store_id and e.order_id = o.id),
  (select max(s.created_at) from commerce.shipments s where s.store_id = o.store_id and s.order_id = o.id),
  (select max(t.created_at) from commerce.order_tags t where t.store_id = o.store_id and t.order_id = o.id))`;

async function orderUpdatedAt(storeId: string, id: string): Promise<string> {
  const [row] = await typedRows(z.object({ at: col.timestamp }), sql`select ${ORDER_UPDATED} as at from commerce.orders o where o.store_id = ${storeId}::uuid and o.id = ${id}::uuid`);
  return row.at;
}

export async function orderOut(storeId: string, id: string): Promise<ApiOrder | null> {
  const order = await getOrderAdmin(storeId, id);
  if (!order) return null;
  const toSend = new Map(order.fulfilment.lines.map((line) => [line.lineId, line.toSend]));
  const address = (a: typeof order.shippingAddress) => ({
    name: a.name ?? "",
    line1: a.line1 ?? "",
    line2: a.line2 ?? "",
    postal_code: a.postalCode ?? "",
    city: a.city ?? "",
    country: a.country ?? "",
    phone: a.phone ?? "",
  });
  return {
    id: order.id,
    number: order.number,
    status: order.status,
    fulfilment: order.fulfilment.state,
    copied: order.copied,
    placed_at: order.placedAt,
    market: order.marketCode,
    currency: order.currency,
    email: order.email,
    subtotal_minor: order.subtotalMinor,
    shipping_minor: order.shippingMinor,
    tax_minor: order.taxMinor,
    total_minor: order.totalMinor,
    paid_minor: order.paidMinor,
    refunded_minor: order.refundedMinor,
    shipping_address: address(order.shippingAddress),
    billing_address: address(order.billingAddress),
    lines: order.lines.map((line) => ({
      id: line.id,
      variant_id: line.variantId,
      sku: line.sku,
      title: line.title,
      quantity: line.quantity,
      unit_price_minor: line.unitPriceMinor,
      total_minor: line.totalMinor,
      delivery: line.delivery,
      to_send: toSend.get(line.id) ?? 0,
    })),
    shipments: order.shipments
      .filter((s) => !s.undone)
      .map((s) => ({ id: s.id, carrier: s.carrier, tracking_number: s.trackingNumber, tracking_url: s.trackingUrl, created_at: s.createdAt, lines: s.lines.map((l) => ({ line_id: l.lineId, quantity: l.quantity })) })),
    tags: order.tags.map((t) => t.label),
    updated_at: await orderUpdatedAt(storeId, order.id),
  };
}

/** The ids of a store's rows changed after `?updated_after=`, from a `select id … where store_id = …` of a table with `updated_at`; null when it is not asked. */
async function changedSince(params: URLSearchParams, rows: SQL): Promise<Set<string> | null> {
  if (!params.get("updated_after")) return null;
  const found = await typedRows(z.object({ id: col.uuid }), sql`select r.id from (${rows} and ${sinceWhere(params, sql`updated_at`)}) r`);
  return new Set(found.map((r) => r.id));
}

// ---------------------------------------------------------------------------
// Inventory
// ---------------------------------------------------------------------------

async function levelsNow(storeId: string, rows: { variant_id: string; location_id: string }[]): Promise<Map<string, number>> {
  const found = await typedRows(
    z.object({ variant_id: col.uuid, location_id: col.uuid, on_hand: col.int }),
    sql`
      select variant_id, location_id, on_hand from commerce.inventory_levels
      where store_id = ${storeId}::uuid and (variant_id, location_id) in (${sql.join(rows.map((r) => sql`(${r.variant_id}::uuid, ${r.location_id}::uuid)`), sql`, `)})
    `,
  );
  return new Map(found.map((row) => [`${row.variant_id}|${row.location_id}`, row.on_hand]));
}

const stockAnswer = (result: Awaited<ReturnType<typeof adjustStock>>): AdminAnswer<"inventory.adjust">["data"] =>
  result.ok
    ? {
        written: result.written,
        unchanged: result.unchanged,
        conflicts: result.conflicts,
        refused: result.refused,
        failed: result.failed,
        rows: result.rows.map((r) => ({ variant_id: r.variantId, location_id: r.locationId, outcome: r.outcome, before: r.before, after: r.after, problem: r.problem })),
      }
    : fail("invalid", result.problems.join(" "));

// ---------------------------------------------------------------------------
// The routes
// ---------------------------------------------------------------------------

/**
 * Answers one route for a caller whose token holds its scope, and checks the answer against its operation's `response` (D438): an answer
 * of another shape is logged with where it differs (never a value) and sent as it is.
 */
export async function runApiRoute(caller: ApiCaller, route: ApiRoute, request: Request): Promise<ApiAnswer> {
  const answer = await answerRoute(caller, route, request);
  const checked = ADMIN_API_BY_NAME[route.name].response.safeParse(answer.body);
  if (!checked.success) {
    const at = [...new Set(checked.error.issues.map((i) => i.path.map((p) => (typeof p === "number" ? "#" : String(p))).join(".")))].slice(0, 5);
    log("error", "admin_api.answer_shape", { storeId: caller.member.store.id, route: route.name, at: at.join(" ") });
  }
  return answer;
}

const isCatalogue = (route: ApiRoute): route is CatalogueRoute => (CATALOGUE_NAMES as readonly string[]).includes(route.name);
const isOrders = (route: ApiRoute): route is OrdersRoute => (ORDERS_NAMES as readonly string[]).includes(route.name);
const isCustomers = (route: ApiRoute): route is CustomersRoute => (CUSTOMERS_NAMES as readonly string[]).includes(route.name);
/** The operations of unit A and before, answered here; each slice of wave 14 unit C answers its own (D440). */
type CoreRoute = Exclude<ApiRoute, CatalogueRoute | OrdersRoute | CustomersRoute>;

async function answerRoute(caller: ApiCaller, route: ApiRoute, request: Request): Promise<ApiAnswer> {
  if (isCatalogue(route)) return answerCatalogue(caller, route, request);
  if (isOrders(route)) return answerOrders(caller, route, request);
  if (isCustomers(route)) return answerCustomers(caller, route, request);
  return answerCore(caller, route as CoreRoute, request);
}

async function answerCore(caller: ApiCaller, route: CoreRoute, request: Request): Promise<ApiAnswer> {
  const storeId = caller.member.store.id;
  const params = new URL(request.url).searchParams;
  switch (route.name) {
    case "products.list": {
      const page = paging(params, sql`p.created_at`, sql`p.id`);
      const status = params.get("status");
      const statusWhere = status === "draft" || status === "active" || status === "archived" ? sql`p.status = ${status}::commerce.product_status` : sql`true`;
      const rows = await readProducts(storeId, sql`${page.where} and ${statusWhere} and ${sinceWhere(params, sql`p.updated_at`)}`, page.limit + 1);
      return ok(route.name, { data: rows.slice(0, page.limit).map(productOut), next: page.next(rows) });
    }
    case "products.get":
      return ok(route.name, { data: await productById(caller, route.id) });
    case "products.create": {
      const input = await readBody(route.name, request);
      // Pictures are made or found only in the admin's own library: the API takes none.
      const made = await asTool(() => createProductTool(toolCtx(caller), { ...input, pictures: [] }));
      const id = (made as { id?: string }).id ?? fail("failed", "The product was saved but could not be read back.");
      await record(caller, "product_created", {}, { type: "product", id });
      return ok(route.name, { data: await productById(caller, id) }, 201);
    }
    case "products.update": {
      const found = await asTool(() => findProduct(caller.member.store, route.id));
      // Changing what shoppers see is the owner's, in the admin (a gated change for the AI manager too).
      // Changing what shoppers see takes `products:publish` (D440): what the AI manager asks the owner's yes for.
      if (found.status === "active" && !holds(caller, "products:publish")) return fail("gated", "A live product is changed only by a token with products:publish, or in the admin.");
      const raw = await jsonBody(request);
      if (raw.status !== undefined) return fail("gated", "A product's status changes with POST /products/{id}/publish, /unpublish or /archive (products:publish), or in the admin.");
      const parsed = ADMIN_API_BY_NAME[route.name].body.safeParse(raw);
      if (!parsed.success) return fail("invalid", bodyProblems(parsed.error.issues).join(" "));
      await asTool(() => updateProductTool(toolCtx(caller), { ...parsed.data, product: route.id, pictures: undefined, add_pictures: undefined }));
      await record(caller, "product_updated", {}, { type: "product", id: route.id });
      return ok(route.name, { data: await productById(caller, route.id) });
    }
    case "inventory.locations": {
      const rows = await typedRows(
        z.object({ id: col.uuid, name: col.text, country: col.textOrNull, active: col.bool, priority: col.int }),
        sql`select id, name, country, active, priority from commerce.inventory_locations where store_id = ${storeId}::uuid order by priority, name, id`,
      );
      return ok(route.name, { data: rows });
    }
    case "inventory.levels": {
      const variant = params.get("variant_id");
      const location = params.get("location_id");
      if ((variant && !isUuid(variant)) || (location && !isUuid(location))) return fail("invalid", "variant_id and location_id are ids.");
      const page = paging(params, sql`l.updated_at`, sql`l.variant_id`);
      const rows = await typedRows(
        z.object({ id: col.uuid, created_at: col.timestamp, cursor_at: z.string(), location_id: col.uuid, sku: col.textOrNull, on_hand: col.int, available: z.number().nullable(), can_buy: z.boolean().nullable() }),
        sql`
          select l.variant_id as id, l.updated_at as created_at, ${cursorAt(sql`l.updated_at`)} as cursor_at, l.location_id, v.sku, l.on_hand, va.raw_available as available, va.can_buy
          from commerce.inventory_levels l
          join commerce.product_variants v on v.id = l.variant_id
          left join commerce.variant_availability va on va.variant_id = l.variant_id
          where l.store_id = ${storeId}::uuid and ${page.where} and ${sinceWhere(params, sql`l.updated_at`)}
            and ${variant ? sql`l.variant_id = ${variant}::uuid` : sql`true`} and ${location ? sql`l.location_id = ${location}::uuid` : sql`true`}
          order by l.updated_at desc, l.variant_id desc, l.location_id
          limit ${page.limit + 1}
        `,
      );
      const data = rows.slice(0, page.limit).map((r) => ({ variant_id: r.id, location_id: r.location_id, sku: r.sku, on_hand: r.on_hand, available: r.available, can_buy: r.can_buy, updated_at: r.created_at }));
      return ok(route.name, { data, next: page.next(rows) });
    }
    case "inventory.adjust": {
      const input = await readBody(route.name, request);
      const wanted = await byVariantId(storeId, input.rows);
      const now = await levelsNow(storeId, wanted);
      // Relative: worked out from the level under the row lock; a level that moved since it was read here is read again once.
      const run = (levels: Map<string, number>, rows: typeof wanted) =>
        adjustStock(
          caller.member,
          { reason: input.reason, note: input.note, rows: rows.map((r) => ({ variantId: r.variant_id, locationId: r.location_id, mode: "adjust", value: r.delta, was: levels.get(`${r.variant_id}|${r.location_id}`) ?? 0 })) },
          "api",
        );
      let result = await run(now, wanted);
      if (result.ok && result.conflicts > 0) {
        const again = wanted.filter((r) => result.ok && result.rows.some((x) => x.outcome === "conflict" && x.variantId === r.variant_id && x.locationId === r.location_id));
        const retried = await run(await levelsNow(storeId, again), again);
        if (retried.ok) {
          const settled = new Map(retried.rows.map((r) => [`${r.variantId}|${r.locationId}`, r]));
          const rows = result.rows.map((r) => settled.get(`${r.variantId}|${r.locationId}`) ?? r);
          const count = (o: string) => rows.filter((r) => r.outcome === o).length;
          result = { ok: true, rows, written: count("written"), unchanged: count("unchanged"), conflicts: count("conflict"), refused: count("refused"), failed: count("failed") };
        }
      }
      const answer = stockAnswer(result);
      await record(caller, "stock_adjusted", { rows: input.rows.length, written: answer.written });
      return ok(route.name, { data: answer });
    }
    case "inventory.set": {
      const input = await readBody(route.name, request);
      const wanted = await byVariantId(storeId, input.rows);
      const now = await levelsNow(storeId, wanted);
      // `compare` is the level the caller counted against: a level that moved since is a conflict, never overwritten.
      const result = await adjustStock(
        caller.member,
        {
          reason: input.reason,
          note: input.note,
          rows: wanted.map((r) => ({ variantId: r.variant_id, locationId: r.location_id, mode: "set", value: r.on_hand, was: r.compare ?? now.get(`${r.variant_id}|${r.location_id}`) ?? 0 })),
        },
        "api",
      );
      const answer = stockAnswer(result);
      await record(caller, "stock_set", { rows: input.rows.length, written: answer.written });
      return ok(route.name, { data: answer });
    }
    case "orders.list": {
      const page = paging(params, sql`o.placed_at`, sql`o.id`);
      const status = params.get("status");
      if (status && !(ORDER_STATES as readonly string[]).includes(status)) return fail("invalid", `status is one of ${ORDER_STATES.join(", ")}.`);
      const toFulfil = params.get("unfulfilled") === "true";
      const rows = await typedRows(
        z.object({ id: col.uuid, created_at: col.timestamp, cursor_at: z.string() }),
        sql`
          select o.id, o.placed_at as created_at, ${cursorAt(sql`o.placed_at`)} as cursor_at from commerce.orders o
          where o.store_id = ${storeId}::uuid and o.copied_from is null and ${page.where} and ${sinceWhere(params, ORDER_UPDATED)}
            and ${status ? sql`o.status = ${status}` : sql`true`}
            and ${toFulfil ? sql`o.status = 'paid' and exists (select 1 from commerce.order_lines l where l.order_id = o.id and commerce.line_to_send(l.id) > 0)` : sql`true`}
          order by o.placed_at desc, o.id desc
          limit ${page.limit + 1}
        `,
      );
      const data = await Promise.all(rows.slice(0, page.limit).map((row) => orderOut(storeId, row.id)));
      return ok(route.name, { data: data.flatMap((order) => (order ? [order] : [])), next: page.next(rows) });
    }
    case "orders.get":
      return ok(route.name, { data: (await orderOut(storeId, route.id)) ?? fail("not_found", "No such order in this store.") });
    case "invoices.ubl":
    case "credit_notes.ubl": {
      const out = await documentUbl(storeId, route.name === "invoices.ubl" ? "invoice" : "credit_note", route.id);
      if (!out) return fail("not_found", "No such document in this store.");
      if (!out.ok) return fail("invalid", `This document cannot be made as EN 16931: ${out.problems.join(", ")}.`);
      return ok(route.name, { data: { file_name: out.fileName, content_type: "application/xml", xml: out.xml } });
    }
    case "orders.fulfil": {
      const order = await getOrderAdmin(storeId, route.id);
      if (!order) return fail("not_found", "No such order in this store.");
      if (order.copied) return fail("gated", "This order is history copied from another store, so it is read-only.");
      const input = await readBody(route.name, request);
      const sent = await markSent(
        storeId,
        route.id,
        { carrier: input.carrier, trackingNumber: input.tracking_number, trackingUrl: input.tracking_url || null },
        caller.member.account.id,
        null,
        { lines: input.lines?.map((l) => ({ lineId: l.line_id, quantity: l.quantity })) ?? null },
      );
      if (!sent.ok) return fail("conflict", sendRefusalText(sent.reason));
      const units = sent.shipment.lines.reduce((sum, line) => sum + line.quantity, 0);
      await record(caller, "order_fulfilled", { shipment: sent.shipment.id, units, left: sent.left }, { type: "order", id: route.id });
      // The parcel's email goes as the admin's does, unless the caller says not to.
      if (input.notify) await sendShipped(storeId, route.id, sent.shipment);
      return ok(route.name, { data: (await orderOut(storeId, route.id)) ?? fail("not_found", "No such order in this store.") }, 201);
    }
    case "customers.list":
    case "customers.get": {
      const page = paging(params, sql`c.created_at`, sql`c.id`);
      const rows = await typedRows(
        z.object({
          id: col.uuid,
          email: col.text,
          name: col.textOrNull,
          phone: col.textOrNull,
          created_at: col.timestamp,
          verified: col.bool,
          tags: z.array(z.string()),
          updated_at: col.timestamp,
          cursor_at: z.string(),
        }),
        sql`
          select c.id, c.email, c.name, c.phone, c.created_at, ${cursorAt(sql`c.created_at`)} as cursor_at, c.updated_at, c.email_verified_at is not null as verified,
            coalesce((select array_agg(t.label order by t.label) from commerce.customer_tags t where t.store_id = c.store_id and t.email = lower(c.email)), '{}') as tags
          from commerce.customers c
          where c.store_id = ${storeId}::uuid and c.copied_from is null
            and ${route.name === "customers.get" ? sql`c.id = ${route.id}::uuid` : sql`${page.where} and ${sinceWhere(params, sql`c.updated_at`)}`}
            and ${route.name === "customers.list" && params.get("email") ? sql`lower(c.email) = lower(${params.get("email")!.trim()})` : sql`true`}
          order by c.created_at desc, c.id desc
          limit ${route.name === "customers.get" ? 1 : page.limit + 1}
        `,
      );
      const out = (r: (typeof rows)[number]): AdminAnswer<"customers.get">["data"] => ({
        id: r.id,
        email: r.email,
        name: r.name ?? "",
        phone: r.phone ?? "",
        email_verified: r.verified,
        tags: r.tags,
        created_at: r.created_at,
        updated_at: r.updated_at,
      });
      if (route.name === "customers.get") return ok(route.name, { data: rows[0] ? out(rows[0]) : fail("not_found", "No such customer in this store.") });
      return ok(route.name, { data: rows.slice(0, page.limit).map(out), next: page.next(rows) });
    }
    case "customers.tag":
    case "customers.untag": {
      const [customer] = await typedRows(
        z.object({ email: col.text }),
        sql`select email from commerce.customers where store_id = ${storeId}::uuid and id = ${route.id}::uuid and copied_from is null`,
      );
      if (!customer) return fail("not_found", "No such customer in this store.");
      if (route.name === "customers.untag") {
        const removed = await removeTag(storeId, caller.member.account.id, customer.email, route.tag);
        if (!removed) return fail("not_found", "The customer has no such tag.");
        await record(caller, "customer_untagged", {}, { type: "customer", id: route.id });
        return ok(route.name, { data: { removed: true } });
      }
      const { tag } = await readBody(route.name, request);
      const added = await addTag(storeId, caller.member.account.id, customer.email, tag);
      if (!added.ok) return fail("invalid", added.problem);
      await record(caller, "customer_tagged", {}, { type: "customer", id: route.id });
      return ok(route.name, { data: { added: true } }, 201);
    }
    case "discounts.list": {
      const page = paging(params, sql`d.created_at`, sql`d.id`);
      const rows = await typedRows(
        z.object({
          id: col.uuid,
          code: col.text,
          kind: z.enum(DISCOUNT_KINDS),
          percent: z.number().nullable(),
          amounts: z.record(z.string(), z.number()).nullable(),
          active: col.bool,
          starts_at: col.timestampOrNull,
          ends_at: col.timestampOrNull,
          usage_limit: z.number().nullable(),
          created_at: col.timestamp,
          updated_at: col.timestamp,
          cursor_at: z.string(),
        }),
        sql`
          select d.id, d.code, d.kind, d.percent, d.amounts, d.active, d.starts_at, d.ends_at, d.usage_limit, d.created_at, d.updated_at, ${cursorAt(sql`d.created_at`)} as cursor_at
          from commerce.discount_codes d where d.store_id = ${storeId}::uuid and ${page.where} and ${sinceWhere(params, sql`d.updated_at`)}
          order by d.created_at desc, d.id desc limit ${page.limit + 1}
        `,
      );
      const out = ({ amounts, cursor_at, ...r }: (typeof rows)[number]) => {
        void cursor_at;
        return { ...r, amounts_minor: amounts ?? {} };
      };
      return ok(route.name, { data: rows.slice(0, page.limit).map(out), next: page.next(rows) });
    }
    case "discounts.create": {
      const input = await readBody(route.name, request);
      // The admin's own form: amounts per market as typed in its currency, the rest as the form sends it; its own checks run after the API's.
      const saved = await saveDiscount(caller.member, null, {
        code: input.code,
        kind: input.kind,
        percent: input.percent,
        amounts: input.amounts,
        minSubtotals: input.min_subtotals,
        startsAt: input.starts_at ?? null,
        endsAt: input.ends_at ?? null,
        usageLimit: input.usage_limit ?? null,
        oncePerCustomer: input.once_per_customer === true,
        active: input.active !== false,
      });
      if (!saved.ok) return fail("invalid", saved.problems.join(" "));
      if (!saved.id) return fail("failed", "The code was saved but could not be read back.");
      await record(caller, "discount_created", {}, { type: "discount", id: saved.id });
      return ok(route.name, { data: { id: saved.id } }, 201);
    }
    // Checkout rules and questions (D399): through the Shipping page's own writers, which audit each change in the token holder's name.
    case "checkout.rules": {
      const changed = await changedSince(params, sql`select id from commerce.checkout_rules where store_id = ${storeId}::uuid`);
      const rules = (await listCheckoutRules(storeId)).filter((r) => !changed || changed.has(r.id));
      return ok(route.name, { data: rules.map(({ skips, ...rule }) => ({ ...rule, skipped: skips })) });
    }
    case "checkout.fields": {
      const changed = await changedSince(params, sql`select id from commerce.checkout_fields where store_id = ${storeId}::uuid`);
      return ok(route.name, { data: (await listCheckoutFields(db(), storeId)).filter((f) => !changed || changed.has(f.id)) });
    }
    case "checkout.rule_create": {
      const input = await readBody(route.name, request);
      const saved = await saveCheckoutRule(caller.member, null, input);
      if (!saved.ok) return fail("invalid", saved.problems.join(" "));
      await record(caller, "checkout_rule_made", {}, { type: "checkout_rule", id: saved.id });
      return ok(route.name, { data: { id: saved.id } }, 201);
    }
    case "checkout.field_create": {
      const input = await readBody(route.name, request);
      const saved = await saveCheckoutField(caller.member, null, input);
      if (!saved.ok) return fail("invalid", saved.problems.join(" "));
      await record(caller, "checkout_field_made", {}, { type: "checkout_field", id: saved.id });
      return ok(route.name, { data: { id: saved.id } }, 201);
    }
    case "checkout.rule_update":
    case "checkout.field_update": {
      const rule = route.name === "checkout.rule_update";
      const { enabled, ...rest } = rule ? await readBody("checkout.rule_update", request) : await readBody("checkout.field_update", request);
      // A body of `enabled` alone switches it; anything else is the whole rule or question as made, its switch kept unless given.
      if (Object.keys(rest).length > 0) {
        const saved = rule ? await saveCheckoutRule(caller.member, route.id, rest) : await saveCheckoutField(caller.member, route.id, rest);
        if (!saved.ok) return saved.problems.some((p) => / is gone\.$/.test(p)) ? fail("not_found", saved.problems.join(" ")) : fail("invalid", saved.problems.join(" "));
      } else if (enabled === undefined) return fail("invalid", "Send the changes, or `enabled`.");
      if (typeof enabled === "boolean") {
        if (rule) {
          if (!(await switchCheckoutRule(caller.member, route.id, enabled))) return fail("not_found", "No such checkout rule in this store.");
        } else {
          const exists = (await listCheckoutFields(db(), storeId)).some((f) => f.id === route.id);
          if (!exists) return fail("not_found", "No such checkout question in this store.");
          await switchCheckoutField(caller.member, route.id, enabled);
        }
      }
      await record(caller, rule ? "checkout_rule_changed" : "checkout_field_changed", { enabled: enabled ?? null }, { type: rule ? "checkout_rule" : "checkout_field", id: route.id });
      return ok(route.name, { data: { id: route.id } });
    }
    case "checkout.rule_delete":
    case "checkout.field_delete": {
      const rule = route.name === "checkout.rule_delete";
      const exists = rule ? (await listCheckoutRules(storeId)).some((r) => r.id === route.id) : (await listCheckoutFields(db(), storeId)).some((f) => f.id === route.id);
      if (!exists) return fail("not_found", rule ? "No such checkout rule in this store." : "No such checkout question in this store.");
      if (rule) await deleteCheckoutRule(caller.member, route.id);
      else await deleteCheckoutField(caller.member, route.id);
      await record(caller, rule ? "checkout_rule_deleted" : "checkout_field_deleted", {}, { type: rule ? "checkout_rule" : "checkout_field", id: route.id });
      return ok(route.name, { data: { id: route.id, deleted: true } });
    }
  }
}
