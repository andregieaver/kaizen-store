import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { normaliseEmail } from "@/lib/email-address";
import { renderEmail, type EmailBlock } from "@/lib/email-layout";
import { looksAutomated } from "@/lib/forms";
import { shownOptions, t } from "@/lib/i18n";
import { shown, type Market } from "@/lib/markets";
import { DRAFT_LINE_TITLE_COLUMN_MAX, DRAFTS_OPEN_MAX } from "@/lib/order-limits";
import { ORDER_AUDIT_ACTIONS } from "@/lib/order-ops-events";
import { variantLabel } from "@/lib/product-input";
import { quoteFieldsOf } from "@/lib/product-question";
import {
  DEFAULT_QUOTE_FIELDS,
  QUOTE_LINES_MAX,
  QUOTES_PER_STORE_DAY,
  checkQuoteReply,
  checkQuoteRequest,
  isQuoteMode,
  quotableLine,
  quoteOffered,
  quoteRequestPlace,
  type QuoteFields,
  type QuoteMode,
  type QuoteProblems,
} from "@/lib/quotes";

import { audit } from "./auth";
import { getBuyer } from "./b2b";
import { getCart } from "./cart";
import { getCustomer } from "./customers";
import { sendEmail, type SendOutcome } from "./email";
import { VISITOR_HOURLY } from "./forms";
import { log } from "./log";
import type { OrderActor } from "./order-actor";
import { lockedOut } from "./private-mode";
import { findProductPart } from "./product-questions";
import { offeredTo } from "./product-conditions";
import { emailContext, emailFooter } from "./shopper-emails";
import { resolveSellingShop } from "./shop";
import { sendQuoteRequestedAlert } from "./staff-alerts";
import type { Store } from "./stores";
import { col, typedRow, typedRows } from "./typed-rows";
import { uuidList } from "./sql-arrays";

/**
 * Request a quote (D431, `src/lib/quotes.ts` for the rules): a shopper's request from a product's page or from the cart becomes a draft order of
 * source `quote` (D173), in the market view they asked from, with the lines at the market's list price as shown and a product priced on request
 * without one (`price_requested`, priced by staff before the draft can be sent). The shopper's name, email, phone, company and note are the
 * draft's; a signed-in customer's request is theirs (`customer_id`). Staff who get new orders are emailed and pushed; the shopper gets a receipt
 * in their language. Staff send it as a quote with the draft editor's *Send quote* (`sendDraft()`, the pay link worded as a quote) or decline it
 * here with a short reply. Spam is held as forms hold it (D93): a hidden field and the time taken, `VISITOR_HOURLY` sends a visitor may make to
 * the store's forms in an hour (`form_submissions`, kind `quote`), and `QUOTES_PER_STORE_DAY` requests a store takes in a day.
 */

// ---------------------------------------------------------------------------------------------------------------------
// Who may ask
// ---------------------------------------------------------------------------------------------------------------------

/** The store's setting (`order_settings.quote_requests`); `off` while the store never saved one. */
export async function quoteMode(storeId: string): Promise<QuoteMode> {
  const row = await typedRow(z.object({ quote_requests: col.text }), sql`select quote_requests from commerce.order_settings where store_id = ${storeId}::uuid`);
  return row && isQuoteMode(row.quote_requests) ? row.quote_requests : "off";
}

/**
 * Whether this request's shopper buys for a business (D431's `business`): the store sells only to businesses or they chose Business (D63,
 * `getBuyer()`), or they are signed in and belong to a company account or a customer group (D108). Read per request.
 */
export async function buysForBusiness(store: Pick<Store, "id" | "audience">): Promise<boolean> {
  if ((await getBuyer(store)) === "business") return true;
  const customer = await getCustomer(store.id);
  if (!customer) return false;
  const row = await typedRow(
    z.object({ member: col.bool }),
    sql`select (company_id is not null or tier_id is not null) as member from commerce.customers where store_id = ${store.id}::uuid and id = ${customer.id}::uuid`,
  );
  return row?.member ?? false;
}

/** Whether the shopper of this request is offered Request a quote on products that show their price (the buy part, the cart). */
export async function quotesOfferedHere(store: Pick<Store, "id" | "audience">): Promise<boolean> {
  const mode = await quoteMode(store.id);
  if (mode === "off") return false;
  return quoteOffered(mode, { business: mode === "business" ? await buysForBusiness(store) : false });
}

/** What the request form starts with for a signed-in customer (D365): their own details, never another's. */
export async function quotePrefill(storeId: string): Promise<{ name: string; email: string; phone: string; company: string }> {
  const customer = await getCustomer(storeId);
  return customer
    ? { name: customer.name, email: customer.email, phone: customer.phone, company: customer.companyName }
    : { name: "", email: "", phone: "", company: "" };
}

// ---------------------------------------------------------------------------------------------------------------------
// Asking
// ---------------------------------------------------------------------------------------------------------------------

export type QuoteResponse = { ok: true } | { ok: false; problems?: QuoteProblems; error?: "busy" | "failed" | "not_offered" };

const VARIANT_ROW = z.object({
  id: col.uuid,
  sku: col.text,
  options: z.record(z.string(), z.string()).nullable(),
  title: col.text,
  amount_minor: col.minorOrNull,
  price_on_request: col.bool,
  sellable: col.bool,
});

/**
 * A shopper's request (`/api/quotes`): checked, counted, and made into a draft of source `quote`. `visitor` is the daily hash of their address
 * (`formVisitor()`). Never throws: a failure after the draft is made (an email, a push) is logged, and the request stands.
 */
export async function requestQuote(raw: unknown, visitor: string, path = "/"): Promise<{ status: number; body: QuoteResponse }> {
  const where = quoteRequestPlace(raw);
  if (!where) return { status: 400, body: { ok: false, error: "failed" } };
  const shop = await resolveSellingShop(where.store, where.market);
  if (!shop || (await lockedOut(shop.store))) return { status: 404, body: { ok: false, error: "not_offered" } };
  const { store, market } = shop;

  // A product layout's form (the question part set to *Request a quote*) asks the fields its owner chose.
  let fields: QuoteFields = DEFAULT_QUOTE_FIELDS;
  if (where.block) {
    const part = await findProductPart(store.id, where.block);
    if (!part || part.questionKind !== "quote") return { status: 404, body: { ok: false, error: "not_offered" } };
    fields = quoteFieldsOf(part);
  }
  const checked = checkQuoteRequest(raw, fields);
  if (!checked) return { status: 400, body: { ok: false, error: "failed" } };
  if (!checked.ok) return { status: 422, body: { ok: false, problems: checked.problems } };
  const request = checked.value;
  // A robot is told it worked, and nothing is made.
  if (looksAutomated(request)) return { status: 200, body: { ok: true } };
  if (await overLimit(store.id, visitor)) return { status: 429, body: { ok: false, error: "busy" } };

  const customer = await getCustomer(store.id);
  const wanted = request.from === "cart" ? await cartLines(store.id, market, customer?.id ?? null) : request.lines;
  if (wanted.length === 0) return { status: 422, body: { ok: false, problems: { lines: "required" } } };
  const variants = await typedRows(
    VARIANT_ROW,
    sql`
      select v.id, v.sku, v.options, coalesce(tl.title, tf.title, p.handle) as title, cp.amount_minor, p.price_on_request,
        (p.status = 'active' and v.active and p.kind = 'goods' and v.delivery = 'physical' and p.host_id is null and not p.subscription_only
          and cp.amount_minor is not null and ${offeredTo(customer?.id ?? null)}
          and commerce.market_offered(p.store_id, ${market.code}, ${market.currency})
          and not commerce.line_unregistered(v.store_id, ${market.code}, v.id)) as sellable
      from commerce.product_variants v
      join commerce.products p on p.store_id = v.store_id and p.id = v.product_id
      left join commerce.product_translations tl on tl.product_id = p.id and tl.locale = ${market.locale}
      left join lateral (select title from commerce.product_translations where product_id = p.id order by locale limit 1) tf on true
      left join commerce.current_prices cp on cp.variant_id = v.id and cp.market_code = ${market.code}
      where v.store_id = ${store.id}::uuid and v.id = any(${uuidList(wanted.map((w) => w.variantId))})
    `,
  );
  const byId = new Map(variants.map((v) => [v.id, v]));
  const offered = await quotesOfferedHere(store);
  // Every line must be one a draft can sell (D173), and the shopper must be offered a quote of it: a product priced on request always is.
  for (const line of wanted) {
    const v = byId.get(line.variantId);
    if (!v || !v.sellable || !(v.price_on_request || offered)) return { status: 403, body: { ok: false, error: "not_offered" } };
  }

  const m = t(market.lang);
  const made = await db().transaction(async (tx) => {
    // The store's settings row is the lock of the open count, the day's count and the counter, as `createDraft()` takes it.
    await tx.execute(sql`insert into commerce.order_settings (store_id) values (${store.id}::uuid) on conflict (store_id) do nothing`);
    await tx.execute(sql`select 1 from commerce.order_settings where store_id = ${store.id}::uuid for update`);
    const counts = await typedRow(
      z.object({ open: col.int, today: col.int }),
      sql`
        select count(*) filter (where status = 'open')::int as open,
          count(*) filter (where source = 'quote' and created_at > now() - interval '1 day')::int as today
        from commerce.draft_orders where store_id = ${store.id}::uuid
      `,
      tx,
    );
    if (!counts || counts.open >= DRAFTS_OPEN_MAX || counts.today >= QUOTES_PER_STORE_DAY) return null;
    const draft = await typedRow(
      z.object({ id: col.uuid, number: col.text }),
      sql`
        insert into commerce.draft_orders (store_id, number, market_code, market_slug, currency, locale, source, customer_id, email, phone,
          shipping_address, company_name, request_note)
        values (${store.id}::uuid, commerce.next_draft_number(${store.id}::uuid), ${market.code}, ${market.slug}, ${market.currency}, ${market.locale}, 'quote',
          ${customer?.id ?? null}::uuid, ${normaliseEmail(request.email)}, ${request.phone},
          ${JSON.stringify(request.name ? { name: request.name } : {})}::jsonb, ${request.company}, ${request.note})
        returning id, number
      `,
      tx,
    );
    if (!draft) return null;
    for (const [position, line] of wanted.slice(0, QUOTE_LINES_MAX).entries()) {
      const v = byId.get(line.variantId)!;
      const options = v.options ?? {};
      const title = Object.keys(options).length > 0 ? `${v.title} (${variantLabel(shownOptions(m, options))})` : v.title;
      const list = shown(market, v.amount_minor ?? 0);
      await tx.execute(sql`
        insert into commerce.draft_order_lines (store_id, draft_id, position, variant_id, title, sku, quantity, unit_price_minor, list_price_minor, delivery, price_requested)
        values (${store.id}::uuid, ${draft.id}::uuid, ${position}, ${v.id}::uuid, ${[...title].slice(0, DRAFT_LINE_TITLE_COLUMN_MAX).join("")}, ${v.sku},
          ${line.quantity}, ${v.price_on_request ? 0 : list}, ${list}, 'physical', ${v.price_on_request})
      `);
    }
    await tx.execute(sql`
      insert into commerce.form_submissions (store_id, block_id, kind, visitor, status, path, locale)
      values (${store.id}::uuid, ${request.block ?? "quote"}, 'quote', ${visitor}, 'sent', ${safePath(path)}, ${market.lang})
    `);
    return draft;
  });
  if (!made) return { status: 429, body: { ok: false, error: "busy" } };
  log("info", "quote.requested", { storeId: store.id, draftId: made.id, lines: wanted.length });
  await afterRequest(store.id, made.id);
  return { status: 200, body: { ok: true } };
}

const safePath = (path: string) => (path.startsWith("/") && !path.startsWith("//") && path.length <= 500 ? path : "/");

/** Whether the visitor has sent all they may to the store's forms in the last hour (`VISITOR_HOURLY`, D93). */
async function overLimit(storeId: string, visitor: string): Promise<boolean> {
  const row = await typedRow(
    z.object({ n: col.int }),
    sql`select count(*)::int as n from commerce.form_submissions where store_id = ${storeId}::uuid and visitor = ${visitor} and created_at > now() - interval '1 hour'`,
  );
  return (row?.n ?? 0) >= VISITOR_HOURLY;
}

/** The cart's lines a quote can be asked for (goods sent by post, bought once), read from the shopper's own cart, never from what the browser sent. */
async function cartLines(storeId: string, market: Market, customerId: string | null): Promise<{ variantId: string; quantity: number }[]> {
  const cart = await getCart({ storeId, market }, { customerId });
  if (cart.lines.some((line) => !quotableLine(line))) return [];
  return cart.lines.map((line) => ({ variantId: line.variantId, quantity: line.quantity }));
}

/** The staff's alert and push, and the shopper's receipt: each logged on failure, none undoing the request. */
async function afterRequest(storeId: string, draftId: string) {
  try {
    await sendQuoteRequestedAlert(storeId, draftId);
  } catch (error) {
    log("error", "quote.alert_failed", { storeId, draftId }, error);
  }
  try {
    await (await import("./push")).sendQuotePush(storeId, draftId);
  } catch (error) {
    log("error", "quote.push_failed", { storeId, draftId }, error);
  }
  try {
    await sendQuoteReceipt(storeId, draftId);
  } catch (error) {
    log("error", "quote.receipt_failed", { storeId, draftId }, error);
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// The shopper's emails
// ---------------------------------------------------------------------------------------------------------------------

const DRAFT_ROW = z.object({ number: col.text, email: col.textOrNull, locale: col.text, market_code: col.text, currency: col.currency, source: col.text });

async function draftForEmail(storeId: string, draftId: string) {
  const draft = await typedRow(
    DRAFT_ROW,
    sql`select number, email, locale, market_code, currency, source from commerce.draft_orders where store_id = ${storeId}::uuid and id = ${draftId}::uuid`,
  );
  if (!draft || draft.source !== "quote" || !draft.email) return null;
  const ctx = await emailContext(storeId, draft.market_code.trim(), draft.locale, draft.currency);
  if (!ctx) return null;
  const lines = await typedRows(
    z.object({ title: col.text, quantity: col.int }),
    sql`select title, quantity from commerce.draft_order_lines where store_id = ${storeId}::uuid and draft_id = ${draftId}::uuid order by position, id`,
  );
  return { draft, ctx, lines };
}

/**
 * The receipt of a request (`quote.received`), to the address the shopper typed, in the language they asked in: what they asked about, from the
 * catalogue. Nothing they typed is in it (as a form's confirmation, D93): the address is anyone's, so a note in it would let a stranger send their
 * words to it from the store. The note stays on the draft for staff.
 */
export async function sendQuoteReceipt(storeId: string, draftId: string, send: typeof sendEmail = sendEmail): Promise<SendOutcome> {
  const found = await draftForEmail(storeId, draftId);
  if (!found) return "failed";
  const { draft, ctx, lines } = found;
  const { store, text } = ctx;
  const w = text.quote;
  const blocks: EmailBlock[] = [
    { type: "heading", text: w.receivedHeading },
    { type: "paragraph", text: w.receivedIntro(store.name) },
    { type: "paragraph", text: `${w.linesHeading}:` },
    { type: "lines", rows: lines.map((l) => ({ label: `${l.quantity} × ${l.title}`, value: "" })) },
    { type: "paragraph", text: w.notYou },
  ];
  const email = renderEmail({ subject: w.receivedSubject(store.name), preview: w.receivedIntro(store.name), blocks, footer: emailFooter(store, text), lang: ctx.lang });
  return send({ storeId, kind: "quote.received", to: draft.email!, email, fromName: store.name, replyTo: store.details.contactEmail, idempotencyKey: `quote-received:${draftId}` });
}

// ---------------------------------------------------------------------------------------------------------------------
// Declining
// ---------------------------------------------------------------------------------------------------------------------

export type DeclineResult =
  | { ok: true; emailed: SendOutcome | null }
  | { ok: false; problem: "not_found" | "not_quote" | "not_open" | "declined" }
  | { ok: false; problem: "reply"; reply: "required" | "too_long" | "too_many_lines" };

/**
 * Declines a request for a quote with a short reply (`orders:write`): only an open request not declined yet; the reply is emailed to the shopper
 * (`quote.declined`) and kept with the draft, which is never sent and goes 30 days later (`pruneDraftOrders()`). Audited without the reply.
 */
export async function declineQuote(storeId: string, actor: OrderActor, draftId: string, reply: unknown, send: typeof sendEmail = sendEmail): Promise<DeclineResult> {
  const checked = checkQuoteReply(reply);
  if (!checked.ok) return { ok: false, problem: "reply", reply: checked.problem };
  if (!/^[0-9a-f-]{36}$/i.test(draftId)) return { ok: false, problem: "not_found" };
  const done = await db().transaction(async (tx): Promise<"not_found" | "not_quote" | "not_open" | "declined" | "ok"> => {
    const row = await typedRow(
      z.object({ source: col.text, status: col.text, declined: col.bool }),
      sql`select source, status, quote_declined_at is not null as declined from commerce.draft_orders where store_id = ${storeId}::uuid and id = ${draftId}::uuid for update`,
      tx,
    );
    if (!row) return "not_found";
    if (row.source !== "quote") return "not_quote";
    if (row.status !== "open") return "not_open";
    if (row.declined) return "declined";
    await tx.execute(sql`
      update commerce.draft_orders set quote_declined_at = now(), quote_reply = ${checked.value}, version = version + 1, updated_at = now()
      where store_id = ${storeId}::uuid and id = ${draftId}::uuid
    `);
    return "ok";
  });
  if (done !== "ok") return { ok: false, problem: done };
  await audit(actor.accountId, storeId, ORDER_AUDIT_ACTIONS.quoteDeclined, {}, { target: { type: "draft_order", id: draftId } });
  let emailed: SendOutcome | null = null;
  try {
    emailed = await sendQuoteDeclined(storeId, draftId, checked.value, send);
  } catch (error) {
    log("error", "quote.decline_email_failed", { storeId, draftId }, error);
    emailed = "failed";
  }
  return { ok: true, emailed };
}

async function sendQuoteDeclined(storeId: string, draftId: string, reply: string, send: typeof sendEmail): Promise<SendOutcome | null> {
  const found = await draftForEmail(storeId, draftId);
  if (!found) return null;
  const { draft, ctx, lines } = found;
  const { store, text } = ctx;
  const w = text.quote;
  const blocks: EmailBlock[] = [
    { type: "heading", text: w.declinedHeading },
    { type: "paragraph", text: w.declinedIntro(store.name) },
    { type: "paragraph", text: `${w.replyHeading}:\n${reply}` },
    { type: "paragraph", text: `${w.linesHeading}:` },
    { type: "lines", rows: lines.map((l) => ({ label: `${l.quantity} × ${l.title}`, value: "" })) },
  ];
  const email = renderEmail({ subject: w.declinedSubject(store.name), preview: w.declinedIntro(store.name), blocks, footer: emailFooter(store, text), lang: ctx.lang });
  return send({ storeId, kind: "quote.declined", to: draft.email!, email, fromName: store.name, replyTo: store.details.contactEmail, idempotencyKey: `quote-declined:${draftId}` });
}

/** How many requests wait for staff: open, not declined (the drafts list's chip). */
export async function quoteRequestsWaiting(storeId: string): Promise<number> {
  const row = await typedRow(
    z.object({ n: col.int }),
    sql`select count(*)::int as n from commerce.draft_orders where store_id = ${storeId}::uuid and source = 'quote' and status = 'open' and quote_declined_at is null`,
  );
  return row?.n ?? 0;
}
