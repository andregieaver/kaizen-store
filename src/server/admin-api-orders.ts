import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { ORDERS_API } from "@/lib/admin-api-orders";
import type { AdminAnswer, AdminBody, ApiRoute } from "@/lib/admin-api-routes";
import { formFromDraft, inputFromForm, type EditorLine, type EditorState } from "@/lib/draft-editor";
import { formatPercentBps, parsePercentBps } from "@/lib/draft-input";
import { DRAFT_STATUSES } from "@/lib/draft-status";
import { normaliseTag, TAG_PROBLEM_TEXT } from "@/lib/order-tags";
import { formatPriceInput, parsePrice } from "@/lib/product-input";
import { RETURN_KINDS, RETURN_STATUSES } from "@/lib/return-status";
import { DRAFT_PROBLEMS, draftProblemText } from "@/lib/draft-order";

import { cursorAt, fail, ok, pageOf, paging, readBody, record, sinceWhere, type ApiAnswer } from "./admin-api-kit";
import type { ApiCaller } from "./api-tokens";
import { createDraft, getDraft, previewDraft, saveDraft, sendDraft, type DraftView } from "./draft-orders";
import { addOrderNote, cancelUnpaidByStaff, getOrderAdmin, refundOrder } from "./order-admin";
import { staffActor } from "./order-actor";
import { changeOrderTags } from "./order-tags";
import { declineQuote } from "./quote-requests";
import type { Refused } from "./return-errors";
import { approveReturn, declineReturn, markReceived } from "./returns";
import { sendCancelled, sendRefunded } from "./shopper-emails";
import { col, typedRows } from "./typed-rows";

/**
 * The Admin API's orders (wave 14 unit C2, D440): drafts and requests for a quote through the draft editor's own functions (`createDraft()`,
 * `saveDraft()` over the editor's state, `sendDraft()`, `declineQuote()`), refunds only through `refundOrder()` with `orders:refund`, a note
 * through `addOrderNote()`, tags through `changeOrderTags()`, an unpaid order cancelled by `cancelUnpaidByStaff()`, and a return's decisions
 * and arrival through the returns page's own steps (`approveReturn()`, `declineReturn()`, `markReceived()`). As the token's maker; each change
 * audited `integration.api_{what}` beside what the screens' functions audit themselves.
 */

export const ORDERS_NAMES = ORDERS_API.map((o) => o.name);
type OrdersName = (typeof ORDERS_API)[number]["name"];
export type OrdersRoute = Extract<ApiRoute, { name: OrdersName }>;

const actorOf = (caller: ApiCaller) => staffActor(caller.member.account.id);

// ---------------------------------------------------------------------------
// Drafts
// ---------------------------------------------------------------------------

type ApiDraft = AdminAnswer<"drafts.get">["data"];

const addressOut = (a: Record<string, string | null>) => ({
  name: a.name ?? "",
  line1: a.line1 ?? "",
  line2: a.line2 ?? "",
  postal_code: a.postalCode ?? "",
  city: a.city ?? "",
  country: a.country ?? "",
});

async function draftOut(storeId: string, id: string): Promise<ApiDraft | null> {
  const preview = await previewDraft(storeId, id);
  const draft: DraftView | null = preview?.draft ?? (await getDraft(storeId, id));
  if (!draft) return null;
  const money = (text: string | null) => (text ? parsePrice(text, draft.currency) : null);
  return {
    id: draft.id,
    number: draft.number,
    status: draft.status,
    source: draft.source,
    quote: draft.source === "quote" && draft.status === "open" ? (draft.quoteDeclinedAt ? "declined" : "requested") : null,
    version: draft.version,
    market: draft.marketCode,
    currency: draft.currency,
    customer_id: draft.customerId,
    email: draft.email,
    phone: draft.phone,
    shipping_address: addressOut(draft.shippingAddress),
    billing_address: addressOut(draft.billingAddress),
    company_name: draft.companyName,
    organisation_number: draft.organisationNumber,
    note_to_buyer: draft.noteToBuyer,
    internal_note: draft.internalNote,
    request_note: draft.requestNote,
    tags: draft.tags,
    discount: draft.discount
      ? {
          kind: draft.discount.kind,
          percent: draft.discount.kind === "percent" ? (parsePercentBps(draft.discount.value) ?? 0) / 100 : null,
          amount_minor: draft.discount.kind === "amount" ? money(draft.discount.value) : null,
          label: draft.discount.label,
        }
      : null,
    shipping: { kind: draft.shipping.kind, amount_minor: draft.shipping.kind === "custom" ? money(draft.shipping.price) : null },
    lines: draft.lines.map((l) => ({
      id: l.id,
      kind: l.kind,
      variant_id: l.variantId,
      sku: l.sku,
      title: l.title,
      quantity: l.quantity,
      unit_price_minor: l.unitPriceMinor,
      list_price_minor: l.listPriceMinor,
      custom_price: l.customPrice,
      price_requested: l.priceRequested,
      vat_category: l.vatCategory,
    })),
    total_minor: preview?.summary?.totalMinor ?? null,
    blocking: draft.status === "open" ? [...new Set((preview?.blocking ?? []).map((p) => draftProblemText(p.code, DRAFT_PROBLEMS)))] : [],
    order_id: draft.orderId,
    sent_at: draft.sentAt,
    expires_at: draft.expiresAt,
    created_at: draft.createdAt,
    updated_at: draft.updatedAt,
  };
}

const draftOrFail = async (storeId: string, id: string) => (await draftOut(storeId, id)) ?? fail("not_found", "No such draft order in this store.");

/** A market of the store by its code, as the editor names it (its own country's view). */
function marketSlug(caller: ApiCaller, code: string): string {
  const markets = caller.member.store.keptMarkets;
  const found = markets.find((m) => m.code === code && m.currency === m.nativeCurrency) ?? markets.find((m) => m.code === code);
  return found ? found.slug : fail("invalid", `market: the store does not sell in ${code}.`);
}

type DraftChange = Omit<AdminBody<"drafts.update">, "version" | "market" | "prices">;

/** The editor's state with the API's changes laid over it: what a change leaves out stays as the draft has it. */
async function changedForm(caller: ApiCaller, form: EditorState, currency: string, change: DraftChange): Promise<EditorState> {
  const typed = (minorUnits: number) => formatPriceInput(minorUnits, currency);
  const address = (was: EditorState["shippingAddress"], given: NonNullable<DraftChange["shipping_address"]>) => ({
    name: given.name ?? was.name,
    line1: given.line1 ?? was.line1,
    line2: given.line2 ?? was.line2,
    postalCode: given.postal_code ?? was.postalCode,
    city: given.city ?? was.city,
    country: given.country ?? was.country,
  });
  const next: EditorState = { ...form };
  if (change.customer_id !== undefined) next.customerId = change.customer_id;
  if (change.email !== undefined) next.email = change.email ?? "";
  if (change.phone !== undefined) next.phone = change.phone ?? "";
  if (change.shipping_address) next.shippingAddress = address(form.shippingAddress, change.shipping_address);
  if (change.billing_address) next.billingAddress = address(form.billingAddress, change.billing_address);
  if (change.company_name !== undefined) next.companyName = change.company_name ?? "";
  if (change.organisation_number !== undefined) next.organisationNumber = change.organisation_number ?? "";
  if (change.note_to_buyer !== undefined) next.noteToBuyer = change.note_to_buyer ?? "";
  if (change.internal_note !== undefined) next.internalNote = change.internal_note ?? "";
  if (change.tags) next.tags = change.tags;
  if (change.discount !== undefined) {
    next.discount = change.discount
      ? {
          kind: change.discount.kind,
          value: change.discount.kind === "percent" ? formatPercentBps(Math.round((change.discount.percent ?? 0) * 100)) : typed(change.discount.amount_minor ?? 0),
          label: change.discount.label,
        }
      : null;
  }
  if (change.shipping) next.shipping = { kind: change.shipping.kind, price: change.shipping.kind === "custom" ? typed(change.shipping.amount_minor ?? 0) : "" };
  if (change.lines) {
    const skus = [...new Set(change.lines.flatMap((l) => (l.sku ? [l.sku] : [])))];
    const bySku = new Map<string, string>();
    if (skus.length > 0) {
      const found = await typedRows(
        z.object({ id: col.uuid, sku: col.text }),
        sql`select id, sku from commerce.product_variants where store_id = ${caller.member.store.id}::uuid and sku = any(${`{${skus.map((s) => `"${s.replace(/["\\]/g, "\\$&")}"`).join(",")}}`}::text[])`,
      );
      for (const row of found) bySku.set(row.sku, row.id);
      const missing = skus.filter((s) => !bySku.has(s));
      if (missing.length > 0) fail("invalid", `No variant with the SKU ${missing.slice(0, 5).join(", ")} in this store.`);
    }
    next.lines = change.lines.map((l, i): EditorLine => {
      const kept = l.id ? form.lines.find((had) => had.key === l.id) : undefined;
      if (l.id && !kept) return fail("invalid", `lines.${i}.id: the draft has no such line.`);
      const variantId = l.variant_id ?? (l.sku ? bySku.get(l.sku)! : (kept?.variantId ?? null));
      const custom = !variantId && (kept ? kept.kind === "custom" : true);
      const price = l.unit_price_minor === undefined ? (kept?.price ?? "") : l.unit_price_minor === null ? "" : typed(l.unit_price_minor);
      return {
        key: kept?.key ?? `api-${i}`,
        kind: custom ? "custom" : "goods",
        variantId: custom ? null : variantId,
        title: custom ? (l.title ?? kept?.title ?? "") : (kept?.title ?? ""),
        sku: kept?.sku ?? l.sku ?? "",
        quantity: l.quantity,
        price,
        vatCategory: custom ? (l.vat_category ?? kept?.vatCategory ?? "") : "",
        listPrice: kept?.listPrice ?? null,
      };
    });
  }
  return next;
}

/** A refusal of the draft editor's save, in the API's words. */
function saveRefusal(result: Extract<Awaited<ReturnType<typeof saveDraft>>, { ok: false }>): never {
  if (result.problem === "not_found") return fail("not_found", "No such draft order in this store.");
  if (result.problem === "not_open") return fail("conflict", "The draft is not open: only an open draft is changed.");
  if (result.problem === "conflict") return fail("conflict", "The draft was changed since that version: read it again.");
  if (result.problem === "market") return fail("invalid", "market: the store does not sell there.");
  return fail("invalid", (result.fields ?? []).map((f) => `${f.field}: ${f.message}`).join(" ") || "The draft is not valid.");
}

async function saveChange(caller: ApiCaller, id: string, change: AdminBody<"drafts.update">): Promise<void> {
  const storeId = caller.member.store.id;
  const draft = (await getDraft(storeId, id)) ?? fail("not_found", "No such draft order in this store.");
  if (draft.status !== "open") return fail("conflict", "The draft is not open: only an open draft is changed.");
  if (change.version !== undefined && change.version !== draft.version) return fail("conflict", "The draft was changed since that version: read it again.");
  const { version: _v, market, prices, ...fields } = change;
  void _v;
  let form = await changedForm(caller, formFromDraft(draft), draft.currency, fields);
  if (market) form = { ...form, marketSlug: marketSlug(caller, market) };
  if (prices) {
    // As the AI manager's set_draft_prices (D437): each line of a SKU takes its price; the other lines keep theirs.
    const missing = prices.filter((p) => !form.lines.some((l) => l.kind === "goods" && l.sku.toLowerCase() === p.sku.toLowerCase()));
    if (missing.length > 0) return fail("invalid", `The draft has no line ${missing.map((p) => p.sku).join(", ")}.`);
    form = {
      ...form,
      lines: form.lines.map((line) => {
        const given = prices.find((p) => line.kind === "goods" && line.sku.toLowerCase() === p.sku.toLowerCase());
        return given ? { ...line, price: given.unit_price_minor === null ? "" : formatPriceInput(given.unit_price_minor, draft.currency) } : line;
      }),
    };
  }
  const saved = await saveDraft(storeId, actorOf(caller), id, inputFromForm(form, draft.version));
  if (!saved.ok) saveRefusal(saved);
}

// ---------------------------------------------------------------------------
// Returns, refunds and notes
// ---------------------------------------------------------------------------

const returnRow = z.object({
  id: col.uuid,
  number: col.textOrNull,
  kind: z.enum(RETURN_KINDS),
  status: z.enum(RETURN_STATUSES),
  order_id: col.uuid,
  order_number: col.text,
  currency: col.currency,
  reason: col.textOrNull,
  refund_recorded: col.bool,
  refund_minor: col.minor.nullable(),
  refunded_at: col.timestampOrNull,
  created_at: col.timestamp,
  cursor_at: z.string(),
  approved_at: col.timestampOrNull,
  received_at: col.timestampOrNull,
  closed_at: col.timestampOrNull,
  updated_at: col.timestamp,
  lines: z.array(
    z.object({
      order_line_id: z.string(),
      sku: z.string(),
      title: z.string(),
      quantity: z.number(),
      decision: z.enum(["accept", "decline"]),
      condition: z.enum(["as_new", "opened", "used", "damaged"]).nullable(),
      restock: z.boolean(),
    }),
  ),
});

function readReturns(storeId: string, where: ReturnType<typeof sql>, limit: number) {
  return typedRows(
    returnRow,
    sql`
      select r.id, r.number, r.kind, r.status::text as status, r.order_id, o.number as order_number, trim(o.currency) as currency, r.reason,
        r.refunded_at is not null as refund_recorded, r.refund_minor, r.refunded_at,
        r.created_at, ${cursorAt(sql`r.created_at`)} as cursor_at, r.approved_at, r.received_at, r.closed_at, r.updated_at,
        coalesce((select json_agg(json_build_object('order_line_id', l.order_line_id, 'sku', ol.sku, 'title', ol.title, 'quantity', l.quantity,
            'decision', l.decision, 'condition', l.condition, 'restock', l.restock) order by ol.title, l.order_line_id)
          from commerce.return_lines l join commerce.order_lines ol on ol.store_id = l.store_id and ol.id = l.order_line_id
          where l.store_id = r.store_id and l.return_id = r.id), '[]'::json) as lines
      from commerce.returns r join commerce.orders o on o.store_id = r.store_id and o.id = r.order_id
      where r.store_id = ${storeId}::uuid and ${where}
      order by r.created_at desc, r.id desc
      limit ${limit}
    `,
  );
}

const returnOut = (r: z.output<typeof returnRow>): AdminAnswer<"returns.get">["data"] => ({
  id: r.id,
  number: r.number ?? "",
  kind: r.kind,
  status: r.status,
  order_id: r.order_id,
  order_number: r.order_number,
  currency: r.currency,
  reason: r.reason,
  lines: r.lines,
  refund: { recorded: r.refund_recorded, amount_minor: r.refund_minor, at: r.refunded_at },
  created_at: r.created_at,
  approved_at: r.approved_at,
  received_at: r.received_at,
  closed_at: r.closed_at,
  updated_at: r.updated_at,
});

async function returnById(storeId: string, id: string) {
  const [row] = await readReturns(storeId, sql`r.id = ${id}::uuid`, 1);
  return row ? returnOut(row) : fail("not_found", "No such return in this store.");
}

/** A refusal of the returns page's step: one it found gone is a 404, one the return's state refuses a 409, the rest a 422. */
function returnRefusal(done: Refused): never {
  if (done.code === "not_found") return fail("not_found", "No such return in this store.");
  if (done.code === "invalid") return fail("invalid", done.problem);
  return fail("conflict", done.problem);
}

async function orderExists(storeId: string, id: string): Promise<{ copied: boolean }> {
  const [row] = await typedRows(z.object({ copied: col.bool }), sql`select copied_from is not null as copied from commerce.orders where store_id = ${storeId}::uuid and id = ${id}::uuid`);
  return row ?? fail("not_found", "No such order in this store.");
}

const notesOf = (storeId: string, orderId: string) =>
  typedRows(
    z.object({ note: col.text, by: col.text, created_at: col.timestamp }),
    sql`
      select coalesce(e.data ->> 'note', '') as note, coalesce(e.data ->> 'by', '') as by, e.created_at
      from commerce.order_events e where e.store_id = ${storeId}::uuid and e.order_id = ${orderId}::uuid and e.type = 'note.added'
      order by e.created_at desc, e.id desc
    `,
  );

// ---------------------------------------------------------------------------
// The routes
// ---------------------------------------------------------------------------

export async function answerOrders(caller: ApiCaller, route: OrdersRoute, request: Request): Promise<ApiAnswer> {
  const storeId = caller.member.store.id;
  const params = new URL(request.url).searchParams;
  switch (route.name) {
    case "drafts.list": {
      const status = params.get("status");
      if (status && !(DRAFT_STATUSES as readonly string[]).includes(status)) return fail("invalid", `status is one of ${DRAFT_STATUSES.join(", ")}.`);
      const page = paging(params, sql`d.created_at`, sql`d.id`);
      const rows = await typedRows(
        z.object({ id: col.uuid, created_at: col.timestamp, cursor_at: z.string() }),
        sql`
          select d.id, d.created_at, ${cursorAt(sql`d.created_at`)} as cursor_at from commerce.draft_orders d
          where d.store_id = ${storeId}::uuid and ${page.where} and ${sinceWhere(params, sql`d.updated_at`)}
            and ${status ? sql`d.status = ${status}` : sql`true`} and ${params.get("quotes") === "true" ? sql`d.source = 'quote'` : sql`true`}
          order by d.created_at desc, d.id desc
          limit ${page.limit + 1}
        `,
      );
      const drafts = await Promise.all(rows.slice(0, page.limit).map((r) => draftOut(storeId, r.id)));
      return ok(route.name, { data: drafts.flatMap((d) => (d ? [d] : [])), next: page.next(rows) });
    }
    case "drafts.get":
      return ok(route.name, { data: await draftOrFail(storeId, route.id) });
    case "drafts.create": {
      const { market, ...fields } = await readBody(route.name, request);
      const made = await createDraft(storeId, actorOf(caller), market ? { marketSlug: marketSlug(caller, market) } : {});
      if (!made.ok) return made.problem === "market" ? fail("invalid", "market: the store does not sell there.") : fail("conflict", "The store has 500 open drafts: send or delete some first.");
      if (Object.values(fields).some((v) => v !== undefined)) {
        try {
          await saveChange(caller, made.draft.id, fields);
        } catch (error) {
          // Nothing half made: a draft whose details were refused goes again.
          const { deleteDraft } = await import("./draft-orders");
          await deleteDraft(storeId, actorOf(caller), made.draft.id);
          throw error;
        }
      }
      await record(caller, "draft_created", {}, { type: "draft_order", id: made.draft.id });
      return ok(route.name, { data: await draftOrFail(storeId, made.draft.id) }, 201);
    }
    case "drafts.update": {
      const change = await readBody(route.name, request);
      await saveChange(caller, route.id, change);
      await record(caller, "draft_changed", {}, { type: "draft_order", id: route.id });
      return ok(route.name, { data: await draftOrFail(storeId, route.id) });
    }
    case "drafts.send": {
      const input = await readBody(route.name, request);
      const draft = (await getDraft(storeId, route.id)) ?? fail("not_found", "No such draft order in this store.");
      const sent = await sendDraft(storeId, actorOf(caller), route.id, { version: input.version ?? draft.version, validDays: input.valid_days, createLink: input.create_link });
      if (!sent.ok) {
        if (sent.problem === "not_found") return fail("not_found", "No such draft order in this store.");
        if (sent.problem === "invalid") return fail("invalid", "The send is not valid.");
        if (sent.problem === "problems") return fail("invalid", [...new Set((sent.problems ?? []).filter((p) => p.blocking).map((p) => draftProblemText(p.code, DRAFT_PROBLEMS)))].join(" ") || "The draft cannot be sent yet.");
        const words: Record<string, string> = {
          not_open: "The draft is not open: it was sent or ended.",
          conflict: "The draft was changed since that version: read it again.",
          closed: "The store is not open, so nothing is sent.",
          payments_off: "The store takes no payments in that market, so no pay link can be sent.",
          limit: "The store has sent as many pay links as it may this hour. Try again later.",
          market: "The store no longer sells in the draft's market.",
        };
        return fail("conflict", words[sent.problem] ?? "The draft cannot be sent now.");
      }
      await record(caller, "draft_sent", { link: input.create_link }, { type: "draft_order", id: route.id });
      return ok(route.name, {
        data: { draft: await draftOrFail(storeId, route.id), order_id: sent.orderId, order_number: sent.number, expires_at: sent.expiresAt, link: sent.link, emailed: sent.emailed },
      });
    }
    case "drafts.decline": {
      const { reply } = await readBody(route.name, request);
      const declined = await declineQuote(storeId, actorOf(caller), route.id, reply);
      if (!declined.ok) {
        if (declined.problem === "not_found") return fail("not_found", "No such draft order in this store.");
        if (declined.problem === "reply") return fail("invalid", `reply: ${declined.reply === "too_many_lines" ? "too many lines; keep it short." : declined.reply === "too_long" ? "too long; keep it short." : "write the reply the customer gets."}`);
        return fail("conflict", declined.problem === "not_quote" ? "This draft is not a request for a quote." : declined.problem === "declined" ? "The request is already declined." : "The request is not open.");
      }
      await record(caller, "quote_declined", {}, { type: "draft_order", id: route.id });
      return ok(route.name, { data: await draftOrFail(storeId, route.id) });
    }
    case "orders.refunds": {
      await orderExists(storeId, route.id);
      const rows = await typedRows(
        z.object({ id: col.uuid, order_id: col.uuid, amount_minor: col.minor, currency: col.currency, status: col.text, kind: col.text, restocked: col.bool, created_at: col.timestamp }),
        sql`
          select r.id, p.order_id, r.amount_minor, trim(p.currency) as currency, r.status::text as status, coalesce(r.kind::text, 'refund') as kind, coalesce(jsonb_typeof(r.restocked) = 'array' and jsonb_array_length(r.restocked) > 0, false) as restocked, r.created_at
          from commerce.refunds r join commerce.payments p on p.store_id = r.store_id and p.id = r.payment_id
          where r.store_id = ${storeId}::uuid and p.order_id = ${route.id}::uuid
          order by r.created_at desc, r.id desc
        `,
      );
      return ok(route.name, { data: rows });
    }
    case "orders.refund": {
      const order = (await getOrderAdmin(storeId, route.id)) ?? fail("not_found", "No such order in this store.");
      if (order.copied) return fail("gated", "This order is history copied from another store, so it is read-only.");
      const input = await readBody(route.name, request);
      // The refund is the admin's own (`refundOrder()`): through the payments it was taken by, or store credit; units back where they came from.
      const outcome = await refundOrder(
        storeId,
        route.id,
        {
          amountMinor: input.amount_minor,
          reason: input.reason,
          restock: input.restock.map((r) => ({ lineId: r.line_id, quantity: r.quantity, locationId: r.location_id ?? null })),
          notSent: input.not_sent,
          toCredit: input.to_store_credit,
        },
        caller.member.account.id,
      );
      if (!outcome.ok) return fail("invalid", outcome.problem);
      if (!outcome.credit && input.notify && input.amount_minor > 0 && outcome.refundId) await sendRefunded(storeId, route.id, outcome.refundId, input.amount_minor);
      await record(caller, "order_refunded", { amount: input.amount_minor, credit: input.to_store_credit }, { type: "order", id: route.id });
      return ok(
        route.name,
        {
          data: {
            refund_ids: outcome.refundIds ?? (outcome.refundId ? [outcome.refundId] : []),
            amount_minor: outcome.amountMinor,
            status: outcome.status ?? null,
            closed_units: outcome.closedUnits ?? 0,
            // The card's code goes only to the customer, by email: never answered here.
            store_credit: outcome.credit ? { card_id: outcome.credit.cardId, amount_minor: outcome.credit.amountMinor, emailed: outcome.credit.emailed } : null,
          },
        },
        201,
      );
    }
    case "orders.cancel": {
      const input = await readBody(route.name, request);
      const cancelled = await cancelUnpaidByStaff(storeId, route.id, input.reason, caller.member.account.id);
      if (!cancelled.ok) {
        const words = {
          not_found: () => fail("not_found", "No such order in this store."),
          copied: () => fail("gated", "This order is history copied from another store, so it is read-only."),
          not_unpaid: () => fail("conflict", "Only an order waiting for payment is cancelled here: a paid order is refunded (orders:refund)."),
          paid: () => fail("conflict", "The customer has just paid this order: refund it instead."),
          processing: () => fail("conflict", "A payment for this order is being processed: wait for it before cancelling."),
        };
        return words[cancelled.refused]();
      }
      if (input.notify) await sendCancelled(storeId, route.id, 0, { unpaid: true });
      await record(caller, "order_cancelled", { notified: input.notify }, { type: "order", id: route.id });
      return ok(route.name, { data: { id: route.id, status: "cancelled" } });
    }
    case "orders.notes":
      await orderExists(storeId, route.id);
      return ok(route.name, { data: await notesOf(storeId, route.id) });
    case "orders.note": {
      const found = await orderExists(storeId, route.id);
      if (found.copied) return fail("gated", "This order is history copied from another store, so it is read-only.");
      const { note } = await readBody(route.name, request);
      // Written by the token, named as the token: the history shows where the note came from.
      await addOrderNote(storeId, route.id, note, `API: ${caller.token.name}`);
      await record(caller, "order_noted", {}, { type: "order", id: route.id });
      const [made] = await notesOf(storeId, route.id);
      return ok(route.name, { data: made }, 201);
    }
    case "orders.tag":
    case "orders.untag": {
      await orderExists(storeId, route.id);
      const words = route.name === "orders.tag" ? (await readBody("orders.tag", request)).tag : route.tag;
      const tag = normaliseTag(words);
      if (!tag.ok) return fail("invalid", `tag: ${TAG_PROBLEM_TEXT[tag.problem]}`);
      const change = route.name === "orders.tag" ? { add: [tag.tag] } : { remove: [tag.tag] };
      const changed = await changeOrderTags(storeId, route.id, change, actorOf(caller));
      if (!changed.ok) return fail("not_found", "No such order in this store.");
      if (changed.change.refused.length > 0) return fail("conflict", "The order has 250 tags: take one off first.");
      if (route.name === "orders.untag" && changed.change.removed.length === 0) return fail("not_found", "The order has no such tag.");
      await record(caller, route.name === "orders.tag" ? "order_tagged" : "order_untagged", {}, { type: "order", id: route.id });
      return ok(route.name, { data: { tags: changed.tags.map((t) => t.label) } }, route.name === "orders.tag" ? 201 : 200);
    }
    case "returns.list": {
      const status = params.get("status");
      const kind = params.get("kind");
      if (status && !(RETURN_STATUSES as readonly string[]).includes(status)) return fail("invalid", `status is one of ${RETURN_STATUSES.join(", ")}.`);
      if (kind && !(RETURN_KINDS as readonly string[]).includes(kind)) return fail("invalid", `kind is one of ${RETURN_KINDS.join(", ")}.`);
      const page = paging(params, sql`r.created_at`, sql`r.id`);
      const rows = await readReturns(
        storeId,
        sql`${page.where} and ${sinceWhere(params, sql`r.updated_at`)} and ${status ? sql`r.status::text = ${status}` : sql`true`} and ${kind ? sql`r.kind = ${kind}` : sql`true`}`,
        page.limit + 1,
      );
      return ok(route.name, pageOf(page, rows, returnOut));
    }
    case "returns.get":
      return ok(route.name, { data: await returnById(storeId, route.id) });
    case "returns.approve":
    case "returns.decline":
    case "returns.receive": {
      await returnById(storeId, route.id);
      const accountId = caller.member.account.id;
      let done;
      if (route.name === "returns.approve") {
        const input = await readBody("returns.approve", request);
        done = await approveReturn(storeId, { returnId: route.id, instructions: input.instructions ?? null, labelUrl: input.label_url || null, note: input.note ?? null }, accountId);
      } else if (route.name === "returns.decline") {
        done = await declineReturn(storeId, { returnId: route.id, reason: (await readBody("returns.decline", request)).reason }, accountId);
      } else {
        done = await markReceived(storeId, { returnId: route.id, on: (await readBody("returns.receive", request)).on ?? null }, accountId);
      }
      if (!done.ok) return returnRefusal(done);
      await record(caller, `return_${route.name.split(".")[1]}`, {}, { type: "return", id: route.id });
      return ok(route.name, { data: await returnById(storeId, route.id) });
    }
  }
}
