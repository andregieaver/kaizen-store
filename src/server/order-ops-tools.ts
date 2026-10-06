import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { findClaims } from "@/lib/claims";
import { draftProblemText } from "@/lib/draft-order";
import { DRAFT_STATUS_LABELS } from "@/lib/draft-status";
import { formatMoney } from "@/lib/money";
import { BULK_REQUEST_TEXT } from "@/lib/order-bulk";
import { PAY_CELL_LABELS, SHIP_CELL_LABELS } from "@/lib/order-list-row";
import type { ArchiveOrdersInput, CreateDraftOrderInput, ListDraftOrdersInput, ListOrdersInput, SendDraftOrderInput, TagOrdersInput } from "@/lib/order-ops-tools";
import { batchAnswer, listOrdersAddress, sendDraftSummary } from "@/lib/order-ops-tools";
import { parsePercentBps } from "@/lib/draft-input";

import { staffActor } from "./order-actor";
import { runBulk, type BulkOutcome } from "./order-bulk";
import { createDraft, deleteDraft, getDraft, listDrafts, previewDraft, saveDraft, sendDraft, type DraftPreview } from "./draft-orders";
import { listOrdersPage, resolveOrderList } from "./order-list";
import { OwnerToolError } from "./owner-tool-error";
import { getCheckoutInfo } from "./orders";
import type { Account } from "./auth";
import type { Store } from "./stores";

type Row = Record<string, unknown>;

/**
 * The AI manager's order tools (wave 3, run 2, D173, `docs/wave-3-orders.md` 2.6 and 5.5): the widened `list_orders`, `tag_orders`, `archive_orders`, `list_draft_orders`,
 * `create_draft_order` and `send_draft_order`. Every one answers from the functions the Orders page itself uses (`listOrdersPage()`, `runBulk()`, `listDrafts()`,
 * `previewDraft()`, `sendDraft()`), so a number is the store's, written with `formatMoney` and never worked out by the model. A draft is only ever MADE here (nothing sent, no number used,
 * no stock held): sending is gated (`send`) and checked again when approved. There is NO tool that records a payment, takes money outside Kaizen, deletes a draft or refunds.
 * Words that reach a customer (the discount's name) pass `findClaims()`. A person whose data was erased is never named, found by name, or shown tags.
 */

type Ctx = { account: Account; store: Store };

const fail = (message: string): never => {
  throw new OwnerToolError(message);
};

const localeOf = (store: Store) => store.markets[0]?.locale ?? "en";
const money = (store: Store, minor: number, currency: string, locale?: string) => formatMoney(minor, currency, locale ?? localeOf(store));
const adminLink = (store: Store, path: string) => `/admin/${store.slug}${path}`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---------------------------------------------------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------------------------------------------------

/** The Orders page's own list, as the model reads it. A search finds archived orders and never an erased person by name or email (the one query, `orderListWhere()`). */
export async function listOrdersTool({ store }: Ctx, input: ListOrdersInput) {
  const { params, context, ignored } = await resolveOrderList(store.id, listOrdersAddress(input));
  const page = await listOrdersPage(store.id, params, context, input.limit);
  return {
    count: page.count,
    ...(page.capped ? { more_than_counted: true } : {}),
    orders: page.rows.map((o) => ({
      number: o.number,
      status: o.status,
      customer: o.erased ? "(personal data removed or restricted)" : (o.name ?? o.email),
      ...(o.erased || !o.email ? {} : { email: o.email }),
      placed: o.placedAt,
      total: money(store, o.totalMinor, o.currency),
      payment: PAY_CELL_LABELS[o.pay],
      fulfilment: SHIP_CELL_LABELS[o.ship],
      items: o.items,
      country: o.marketCode,
      ...(o.erased || o.tags.length === 0 ? {} : { tags: o.tags.map((t) => t.label) }),
      ...(o.archived ? { archived: true } : {}),
      ...(o.gift ? { gift: true } : {}),
      ...(o.source === "draft" ? { staff_made: true, ...(o.draftNumber ? { draft: o.draftNumber } : {}) } : {}),
      // History copied from another store (D129): read-only, and in no sales figure.
      ...(o.copied ? { copied_history: true } : {}),
    })),
    ...(page.nextCursor ? { next: page.nextCursor, next_note: "Pass `next` as `after`, with the same filters and the same limit, for the next page." } : {}),
    ...(ignored.length > 0 ? { ignored_filters: ignored } : {}),
  };
}

export async function listDraftOrdersTool({ store }: Ctx, input: ListDraftOrdersInput) {
  const page = await listDrafts(store.id, { status: input.status === "all" ? null : input.status, pageSize: input.limit });
  return {
    count: page.rows.length,
    open_drafts: page.openCount,
    drafts: page.rows.map((d) => ({
      number: d.number,
      status: DRAFT_STATUS_LABELS[d.status],
      customer: d.customer ?? d.email,
      ...(d.email && d.customer ? { email: d.email } : {}),
      total: d.totalMinor === null ? null : money(store, d.totalMinor, d.currency),
      lines: d.lineCount,
      ...(d.orderNumber ? { order: d.orderNumber } : {}),
      ...(d.status === "sent" && d.expiresAt ? { link_ends: d.expiresAt } : {}),
      admin: adminLink(store, `/orders/drafts/${d.id}`),
    })),
    ...(page.nextCursor ? { more: true, note: "There are more drafts than this; narrow with status or open the Draft orders page." } : {}),
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Tags and the archive: the page's own bulk engine, for a handful of orders
// ---------------------------------------------------------------------------------------------------------------------

/** The orders a call names, by number or id, the store's only: the ids found, and the references that are nothing of this store's (told as "not found", never anything else). */
async function resolveRefs(store: Store, refs: readonly string[]): Promise<{ ids: string[]; missing: string[] }> {
  const ids: string[] = [];
  const missing: string[] = [];
  const seen = new Set<string>();
  for (const raw of refs) {
    const ref = raw.trim().replace(/^#/, "");
    if (seen.has(ref.toLowerCase())) continue;
    seen.add(ref.toLowerCase());
    const [row] = await db().execute<Row>(sql`
      select id from commerce.orders
      where store_id = ${store.id}::uuid and ${UUID.test(ref) ? sql`id = ${ref.toLowerCase()}::uuid` : sql`number = ${ref}`}
    `);
    if (row) ids.push(String(row.id));
    else missing.push(raw);
  }
  return { ids, missing };
}

const problemOf = (outcome: Extract<BulkOutcome, { ok: false }>) => BULK_REQUEST_TEXT[outcome.problem];

export async function tagOrdersTool({ account, store }: Ctx, input: TagOrdersInput) {
  if (input.add.length === 0 && input.remove.length === 0) return fail("Say which tags to add or remove.");
  const { ids, missing } = await resolveRefs(store, input.orders);
  if (ids.length === 0) return fail(`No such ${input.orders.length === 1 ? "order" : "orders"} in this store: ${input.orders.join(", ")}.`);
  const actor = staffActor(account.id);
  const steps: { verb: string; result: Extract<BulkOutcome, { ok: true }>["result"] }[] = [];
  for (const [action, tags, verb] of [["add_tags", input.add, "Tagged"], ["remove_tags", input.remove, "Took tags off"]] as const) {
    if (tags.length === 0) continue;
    const outcome = await runBulk(store.id, actor, { action, selection: { kind: "ids", ids }, tags });
    if (!outcome.ok) return fail(problemOf(outcome));
    steps.push({ verb, result: outcome.result });
  }
  return {
    ...(steps.length === 1 ? batchAnswer(steps[0].verb, steps[0].result) : { done: steps.map((s) => batchAnswer(s.verb, s.result).done).join(" "), not_done: steps.flatMap((s) => batchAnswer(s.verb, s.result).not_done) }),
    ...(missing.length > 0 ? { not_found: missing } : {}),
  };
}

export async function archiveOrdersTool({ account, store }: Ctx, input: ArchiveOrdersInput) {
  const { ids, missing } = await resolveRefs(store, input.orders);
  if (ids.length === 0) return fail(`No such ${input.orders.length === 1 ? "order" : "orders"} in this store: ${input.orders.join(", ")}.`);
  const outcome = await runBulk(store.id, staffActor(account.id), { action: input.archived ? "archive" : "unarchive", selection: { kind: "ids", ids } });
  if (!outcome.ok) return fail(problemOf(outcome));
  return { ...batchAnswer(input.archived ? "Archived" : "Brought back", outcome.result), ...(missing.length > 0 ? { not_found: missing } : {}) };
}

// ---------------------------------------------------------------------------------------------------------------------
// Draft orders: make one, send one
// ---------------------------------------------------------------------------------------------------------------------

/** What a draft is, as the store prices it, for the model to repeat: amounts in the draft's own currency and the market's language, the problems in words. */
function draftAnswer(store: Store, preview: DraftPreview) {
  const { draft, summary, market } = preview;
  const locale = market?.locale ?? localeOf(store);
  const m = (minor: number) => money(store, minor, draft.currency, locale);
  const blocking = preview.blocking.map((p) => draftProblemText(p.code));
  const notes = preview.problems.filter((p) => !p.blocking).map((p) => draftProblemText(p.code));
  return {
    draft: draft.number,
    status: DRAFT_STATUS_LABELS[draft.status],
    market: market ? `${market.name} (${market.currency})` : draft.marketSlug,
    customer: draft.email,
    ...(summary
      ? {
          lines: summary.lines.map((l) => ({ title: l.title, sku: l.sku, quantity: l.quantity, price_each: m(l.unitPriceMinor), total: m(l.totalMinor) })),
          subtotal: m(summary.subtotalMinor),
          ...(summary.staffDiscountMinor > 0 ? { discount: { name: summary.staffDiscountLabel, off: m(summary.staffDiscountMinor) } } : {}),
          shipping: m(summary.shippingMinor),
          vat: m(summary.taxMinor),
          total: m(summary.totalMinor),
          prices: "As the customer will pay them, VAT included.",
        }
      : {}),
    ...(blocking.length > 0 ? { cannot_be_sent_yet: blocking } : { can_be_sent: true }),
    ...(notes.length > 0 ? { notes } : {}),
    admin: adminLink(store, `/orders/drafts/${draft.id}`),
  };
}

export async function createDraftOrderTool({ account, store }: Ctx, input: CreateDraftOrderInput) {
  if ((input.discount_percent === undefined) !== (input.discount_label === undefined)) return fail("A discount needs both its percent and the name the customer sees.");
  if (input.discount_label) {
    // The name reaches the customer on the pay page and the invoice: it passes the claims filter like every text written for a customer (D76).
    const claims = findClaims(input.discount_label);
    if (claims.length > 0) return fail(`The discount's name cannot say "${claims[0].phrase}". Use a plain name such as Loyal customer.`);
  }
  if (input.discount_percent !== undefined && parsePercentBps(input.discount_percent) === null) return fail(`"${input.discount_percent}" is not a percent from 0.01 to 100.`);

  // The SKUs are the store's own goods, found before anything is made, so a mistake leaves no draft behind.
  const lines: { variantId: string; quantity: number }[] = [];
  for (const line of input.lines) {
    const rows = await db().execute<Row>(sql`
      select v.id from commerce.product_variants v
      where v.store_id = ${store.id}::uuid and v.active and v.delivery = 'physical' and lower(v.sku) = lower(${line.sku})
      limit 2
    `);
    if (rows.length === 0) return fail(`No shipped variant with the SKU ${line.sku}. Use list_products or get_product for SKUs; services, bookings and downloads are added on the draft's page.`);
    if (rows.length > 1) return fail(`More than one variant has the SKU ${line.sku}: add it on the draft's page.`);
    lines.push({ variantId: String(rows[0].id), quantity: line.quantity });
  }

  const actor = staffActor(account.id);
  const made = await createDraft(store.id, actor, input.market ? { marketSlug: input.market } : {});
  if (!made.ok) return fail(made.problem === "market" ? `The store has no market ${input.market ?? ""}. Its markets are ${store.markets.map((m) => m.slug).join(", ")}.` : "The store has 500 open drafts. Delete or send one first.");
  const draft = made.draft;
  const saved = await saveDraft(store.id, actor, draft.id, {
    version: draft.version,
    marketSlug: draft.marketSlug,
    email: input.email,
    lines: lines.map((l) => ({ kind: "goods", variantId: l.variantId, quantity: l.quantity })),
    discount: input.discount_percent ? { kind: "percent", value: input.discount_percent, label: input.discount_label } : null,
  });
  if (!saved.ok) {
    // Nothing is kept of a draft that could not be written (it is still empty and the owner never saw it).
    await deleteDraft(store.id, actor, draft.id);
    const why = saved.fields?.map((f) => f.message).join(" ") || saved.problem;
    return fail(`The draft could not be written: ${why}`);
  }
  const preview = await previewDraft(store.id, draft.id);
  if (!preview) return fail("The draft was written but could not be read back. Open the Draft orders page.");
  return {
    ...draftAnswer(store, preview),
    done: `Draft ${draft.number} is written. Nothing has been sent, no order number is used and no stock is held.`,
    next: "Add the shipping address (and anything else) on the draft's page, then send it with send_draft_order, which needs the owner's yes.",
  };
}

/** A draft by its number (D-12) or id, the store's only. */
async function findDraft(store: Store, ref: string): Promise<{ id: string; number: string }> {
  const clean = ref.trim();
  const [row] = await db().execute<Row>(sql`
    select id, number from commerce.draft_orders
    where store_id = ${store.id}::uuid and ${UUID.test(clean) ? sql`id = ${clean.toLowerCase()}::uuid` : sql`upper(number) = upper(${clean})`}
  `);
  if (!row) return fail(`No draft order ${ref} in this store. Use list_draft_orders to find it.`);
  return { id: String(row.id), number: String(row.number) };
}

/**
 * Checked before a send is kept for approval, and again when it runs: the draft is open, it has no blocking problem (an email, a shipping address, goods for sale and in stock, a total above 0), the store is
 * open and takes payments. The owner is never asked to approve a send the store would refuse.
 */
export async function preflightSendDraft({ store }: Ctx, input: SendDraftOrderInput): Promise<void> {
  const found = await findDraft(store, input.draft);
  const preview = await previewDraft(store.id, found.id);
  if (!preview) return fail(`No draft order ${input.draft} in this store.`);
  const status = preview.draft.status;
  if (status !== "open") return fail(`Draft ${found.number} is ${DRAFT_STATUS_LABELS[status].toLowerCase()}, not open: only an open draft can be sent. A sent, expired or cancelled draft is reopened on its page.`);
  if (preview.blocking.length > 0) return fail(`Draft ${found.number} cannot be sent yet: ${preview.blocking.map((p) => draftProblemText(p.code)).join(" ")}`);
  const [open] = await db().execute<Row>(sql`select commerce.store_is_active(${store.id}::uuid) as open`);
  if (!open?.open) return fail("The store is not open, so a draft cannot be sent.");
  const info = await getCheckoutInfo(store.id, preview.draft.marketCode);
  if (!info.paymentsOn) return fail("Payments are off for this store, so a draft cannot be sent.");
}

export async function sendDraftOrderTool(ctx: Ctx, input: SendDraftOrderInput) {
  await preflightSendDraft(ctx, input);
  const { store, account } = ctx;
  const found = await findDraft(store, input.draft);
  const draft = await getDraft(store.id, found.id);
  if (!draft) return fail(`No draft order ${input.draft} in this store.`);
  // What the owner said yes to is the draft AS SHOWN: the version kept with the approval is the one sent, so a draft edited while the question waited is refused (`conflict`), never sent in its new form.
  const sent = await sendDraft(store.id, staffActor(account.id), found.id, { version: input.approved_version ?? draft.version, validDays: input.valid_days, createLink: false });
  if (!sent.ok) {
    if (sent.problems && sent.problems.length > 0) return fail(`Draft ${found.number} cannot be sent: ${sent.problems.map((p) => draftProblemText(p.code)).join(" ")}`);
    const words: Record<string, string> = {
      not_found: "The draft is gone.",
      not_open: "The draft is not open any more.",
      conflict: "The draft was changed after the owner was asked, so it was not sent. Look at it again and ask once more.",
      invalid: "The days the link works must be from 1 to 30.",
      closed: "The store is not open, so a draft cannot be sent.",
      payments_off: "Payments are off for this store, so a draft cannot be sent.",
      limit: "This store has sent its limit of pay links for the hour. Try again later.",
      market: "The draft's market is gone.",
      problems: "The draft has problems: open it.",
    };
    return fail(words[sent.problem] ?? "The draft could not be sent.");
  }
  const emailWords: Record<string, string> = {
    sent: `The pay link was emailed to ${draft.email ?? "the customer"}.`,
    logged: "Email is not set up for this store, so the pay link was only recorded: open the draft and use Send again once it is.",
    failed: "The order was made but the email could not be sent: open the draft and press Send again.",
    duplicate: "The same email had just been sent.",
    suppressed: "The address does not receive emails from the store, so the pay link was not sent: open the draft to share the link another way.",
  };
  return {
    done: `Draft ${found.number} was sent: order ${sent.number} was made and its goods are held until ${sent.expiresAt}. ${sent.emailed ? emailWords[sent.emailed] : ""}`.trim(),
    order: sent.number,
    link_ends: sent.expiresAt,
    admin: adminLink(store, `/orders/${sent.orderId}`),
  };
}

/**
 * What the owner is asked to say yes to, written from the draft itself (its customer, lines and total as the store prices it now) and not from the model's words. Falls back to
 * the pure summary when the draft cannot be found or priced.
 */
export async function draftApprovalSummary(store: Store, args: Record<string, unknown>): Promise<string | null> {
  return (await draftApprovalDetails(store, args))?.summary ?? null;
}

/**
 * The summary the owner is asked about AND the version of the draft it describes, read from one preview: the approval keeps the version (`approved_version`), and the send refuses when the draft has changed
 * since, so the owner's yes is for what they were shown.
 */
export async function draftApprovalDetails(store: Store, args: Record<string, unknown>): Promise<{ summary: string; version: number } | null> {
  const ref = String(args.draft ?? "");
  const validDays = typeof args.valid_days === "number" ? args.valid_days : null;
  try {
    const found = await findDraft(store, ref);
    const preview = await previewDraft(store.id, found.id);
    if (!preview?.summary) return null;
    const m = (minor: number) => money(store, minor, preview.draft.currency, preview.market?.locale);
    const goods = preview.summary.lines.map((l) => `${l.quantity} × ${l.title}`).join(", ");
    return {
      summary: `${sendDraftSummary(found.number, validDays)} Customer: ${preview.draft.email ?? "no email yet"}. ${goods}. Total ${m(preview.summary.totalMinor)}, VAT included.`,
      version: preview.draft.version,
    };
  } catch {
    return null;
  }
}
