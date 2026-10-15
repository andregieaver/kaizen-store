import "server-only";

import { createHash, randomBytes } from "node:crypto";

import { sql } from "drizzle-orm";

import { db, type Db } from "@/db/client";
import { adjustmentOf } from "@/lib/credit-allocation";
import { checkCash } from "@/lib/cash-limits";
import { lineWithdrawal } from "@/lib/checkout";
import type { RecordedSnapshot, TermsMode } from "@/lib/checkout-terms";
import type { DraftPricing } from "@/lib/draft-order";
import {
  EXCHANGE_PROBLEMS,
  creditStillHolds,
  exchangeBlock,
  exchangeDeadline,
  exchangeOutcome,
  isExchangeStatus,
  priceExchange,
  type ExchangeBlock,
  type ExchangeChannel,
  type ExchangeOutcome,
  type ExchangeProblem,
  type ExchangeProblemCode,
  type ExchangeShippingKind,
  type ExchangeStatus,
} from "@/lib/exchange";
import { exchangeAgreementInput, exchangeBuilderInput, exchangeWishInput } from "@/lib/exchange-input";
import {
  EXCHANGE_SENDS_PER_DAY,
  EXCHANGE_SETTLE_HOLD_MINUTES,
  EXCHANGE_TOKEN_KEEP_DAYS,
  EXCHANGE_WISH_KEEP_MONTHS,
} from "@/lib/exchange-limits";
import { shownOptions, t } from "@/lib/i18n";
import { shown, type Market } from "@/lib/markets";
import { MANUAL_RECEIVED_DAYS_MAX } from "@/lib/order-limits";
import { marketPath, storeSiteUrl } from "@/lib/paths";
import { GENERAL_TAX_CODE, variantLabel } from "@/lib/product-input";
import { splitRefund } from "@/lib/refund-split";
import type { WorkingRow } from "@/lib/return-refund";
import { shownMeasureFromColumns } from "@/lib/unit-price-rules";
import type { ShownMeasure } from "@/lib/unit-price";

import { audit, type Membership } from "./auth";
import { recordTermsSnapshotsForOrder } from "./checkout-terms";
import { linkOrderToCustomer } from "./customers";
import { cashLimitInCurrency } from "./draft-orders";
import { settleOrderSessions } from "./draft-sessions";
import { refundOrder, type RefundOutcome } from "./order-admin";
import { staffActor, writeOrderEvent, type OrderActor } from "./order-actor";
import { marketOfOrder } from "./order-edits";
import { allocateStock, insertOrder, insertOrderLine, reserveStock } from "./order-insert";
import { mayRecordOutsidePayment } from "./order-settings";
import { getCheckoutInfo } from "./orders";
import { previewRefund } from "./returns";
import { getReturnSettings } from "./return-settings";
import { NOTHING_SENT_SQL } from "./return-sql";
import { getCheckoutAccount } from "./settings";
import { sendOrderConfirmation, type EmailStore } from "./shopper-emails";
import { uuidList } from "./sql-arrays";
import { decideTax, loadTaxFacts, type TaxOutcome } from "./tax-treatment";

type Row = Record<string, unknown>;
type Runner = Pick<Db, "execute">;
type Tx = Parameters<Parameters<ReturnType<typeof db>["transaction"]>[0]>[0];

/**
 * Exchanges (wave 3, D239, `docs/wave-3-exchanges.md` 2.2, 4.2 to 4.6): the server side. An exchange is a D153 return whose credit pays a new order.
 *
 * - **Preview** (`previewExchange()`) prices replacements with `priceExchange()` (over `priceDraft()`, the checkout's own `decideTax()`) in the original order's market
 *   view, against the credit `C`, which is ONLY `previewRefund()`'s amount for the return (`refundFor()`): nothing about the exchange enters it.
 * - **Propose** (`proposeExchange()`) freezes the replacements as shown, a token (only its SHA-256 kept) and an end (capped by a withdrawal's legal refund
 *   deadline, `exchangeDeadline()`), and emails the order's own address. The customer confirms on `/account/exchange/{token}` (`exchange-pay.ts`); staff may record
 *   an agreement for a VOLUNTARY return only (the database refuses it for a withdrawal, CRD Art. 13(1)).
 * - **Process** (`processExchange()`), offered where the refund would be: step (a), one transaction under the original order's, the return's and the exchange's
 *   locks, makes the exchange order through `insertOrder()` (`source = 'exchange'`, numbered by D141's sequence) and only then holds its stock; step (b)
 *   (`settleExchange()`) moves the credit as a transfer refund on the original order and an `exchange` payment on the new one (no Stripe call), refunds the
 *   remainder through `refundOrder()` (its `exchangeId` option) or waits for the difference (a pay link, or recorded as paid outside Kaizen), and completes the
 *   order with `commerce.complete_exchange_order()`. Stripe is never called inside a transaction that allocates stock.
 *
 * Every query names the store; every write is guarded by the database's own rules (`exchanges_rules`), whose refusals are mapped to the codes of
 * `EXCHANGE_PROBLEMS`. The action layer asks `requirePermission()` first and passes the account; nothing here trusts a caller's store.
 */

// ---------------------------------------------------------------------------------------------------------------------
// Results and refusals
// ---------------------------------------------------------------------------------------------------------------------

/** Codes beyond `EXCHANGE_PROBLEMS` this module answers, with their words (staff's English). */
export const EXCHANGE_REFUSALS = {
  not_found: "That exchange no longer exists.",
  invalid: "Check the details and try again.",
  open: "This return already has an exchange being processed. Settle or cancel it first.",
  lifecycle: "The exchange is not in a state that allows this.",
  expired: "The proposal has ended. Propose the exchange again.",
  sends_limit: "This exchange has been sent 5 times today. Try again tomorrow, or copy the link.",
  busy: "A refund of this return is being made right now. Reload the page in a moment.",
  not_received: "The store refunds when the goods are back or on their way: mark them as on their way or received first.",
  not_allowed: "Only the owner can record a payment taken outside Kaizena Flow, unless the owner has allowed staff to.",
  processing: "A payment for this exchange is being processed. Wait for it before changing the exchange.",
  paid: "The customer has paid: the exchange is settled.",
  received_on: "The day the money was received is not in the future and not more than a few weeks back.",
  cash_limit: "Cash above this country's limit is not recorded. Choose another payment method.",
  refund_failed: "The refund did not go through, so nothing was settled. Try again, or cancel the exchange and refund instead.",
  no_email: "The order has no email address to send the proposal to. Create a link to share instead.",
  nothing_to_pay: "There is nothing to pay for this exchange.",
  wish_off: "Exchanges are not offered for this return.",
  wish_made: "A wish was sent for this return already.",
  transfer_short: "The original order has less left to refund than the credit: refund instead.",
  link_withdrawal:
    "A withdrawal's exchange is confirmed only by the customer, so its proposal goes by email to the order's own address: no link to share is made for it.",
  email_changed:
    "The order's email address was changed after the withdrawal, so its exchange cannot be proposed: only the address the customer gave can confirm it. Refund instead.",
} as const;
export type ExchangeRefusalCode = ExchangeProblemCode | keyof typeof EXCHANGE_REFUSALS;

export type Refused = { ok: false; problem: ExchangeRefusalCode; message: string; problems?: ExchangeProblem[] };

const refuse = (problem: ExchangeRefusalCode, message?: string, problems?: ExchangeProblem[]): Refused => ({
  ok: false,
  problem,
  message: message ?? (problem in EXCHANGE_REFUSALS ? EXCHANGE_REFUSALS[problem as keyof typeof EXCHANGE_REFUSALS] : EXCHANGE_PROBLEMS[problem as ExchangeProblemCode]),
  ...(problems ? { problems } : {}),
});

/** A refusal the database raised (`exchange.copied: …`, `order_exchange.state: …`), as a code staff read words for; null for any other error. */
export function exchangeRefusalOf(error: unknown): Refused | null {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const cause = (error as { cause?: { message?: string } } | null)?.cause?.message ?? "";
  const text = `${message} ${cause}`;
  if (/return_exchange_pending/.test(text)) return refuse("open");
  if (/exchanges_open_key|return_exchanges_open_key/.test(text)) return refuse("open");
  const m = /\b(?:exchange|order_exchange|refund_exchange|payment_exchange|exchange_line)\.(\w+)/.exec(text);
  if (!m) return null;
  const code = m[1];
  if (code in EXCHANGE_PROBLEMS) return refuse(code as ExchangeProblemCode);
  if (code === "withdrawal_needs_customer") return refuse("lifecycle", "A withdrawal's refund goes another way only on the customer's own confirmation: send them the proposal.");
  if (code === "limit") return refuse("limit");
  return refuse("lifecycle");
}

async function guarded<T>(work: () => Promise<T>): Promise<T | Refused> {
  try {
    return await work();
  } catch (error) {
    const refused = exchangeRefusalOf(error);
    if (refused) return refused;
    throw error;
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------------------------------------------------

/** A new exchange token: 32 random bytes, base64url (43 characters); only its SHA-256 (base64url, 43 characters) is kept. */
export function newExchangeToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashExchangeToken(token) };
}
export const hashExchangeToken = (token: string): string => createHash("sha256").update(token).digest("base64url");
export const EXCHANGE_TOKEN = /^[A-Za-z0-9_-]{43}$/;

/** The page a customer opens: `/s/{store}/{market}/account/exchange/{token}`, on the store's own address. */
export function exchangeLinkFor(store: Pick<EmailStore, "slug">, marketSlug: string, token: string): string {
  return `${storeSiteUrl(store.slug)}${marketPath(store.slug, marketSlug, `/account/exchange/${token}`)}`;
}

// ---------------------------------------------------------------------------------------------------------------------
// Reading an exchange
// ---------------------------------------------------------------------------------------------------------------------

export type ExchangeAddress = { name: string; street: string; postalCode: string; city: string; country: string; phone?: string | null };

export type ExchangeLineView = {
  n: number;
  variantId: string;
  sku: string;
  title: string;
  quantity: number;
  listPriceMinor: number;
  unitPriceMinor: number;
  totalMinor: number;
};

export type ExchangeView = {
  id: string;
  seq: number;
  status: ExchangeStatus;
  returnId: string;
  returnNumber: string;
  returnKind: "withdrawal" | "return";
  /** The original order. */
  orderId: string;
  orderNumber: string;
  currency: string;
  marketSlug: string;
  shippingKind: ExchangeShippingKind;
  shippingMinor: number;
  deliveryAddress: ExchangeAddress | null;
  /** `C`, `T` and `Δ` as proposed. */
  creditMinor: number;
  totalMinor: number;
  differenceMinor: number;
  /** `C` and `Δ` worked out again when the exchange was processed. */
  creditAtProcessingMinor: number | null;
  differenceAtProcessingMinor: number | null;
  /** What the exchange comes to now: at processing once processed, else as proposed. */
  outcome: ExchangeOutcome;
  expiresAt: string | null;
  confirmedAt: string | null;
  confirmedBy: "customer" | "staff" | null;
  confirmedChannel: ExchangeChannel | null;
  exchangeOrderId: string | null;
  exchangeOrderNumber: string | null;
  exchangeOrderStatus: string | null;
  remainderRefundId: string | null;
  madeBy: string;
  createdAt: string;
  processedAt: string | null;
  settledAt: string | null;
  endedAt: string | null;
  lines: ExchangeLineView[];
  /** The terms the customer was shown when they confirmed (the snapshots' references). */
  terms: { mode: TermsMode; locale: string; snapshots: RecordedSnapshot[] } | null;
};

const iso = (value: unknown) => (value ? new Date(String(value)).toISOString() : null);
const num = (value: unknown) => (value === null || value === undefined ? null : Number(value));

function addressOf(value: unknown): ExchangeAddress | null {
  const a = (value ?? {}) as Partial<ExchangeAddress>;
  if (!a.street && !a.name) return null;
  return {
    name: String(a.name ?? ""),
    street: String(a.street ?? ""),
    postalCode: String(a.postalCode ?? ""),
    city: String(a.city ?? ""),
    country: String(a.country ?? ""),
    ...(a.phone ? { phone: String(a.phone) } : {}),
  };
}

function termsOf(value: unknown): ExchangeView["terms"] {
  if (!Array.isArray(value) || value.length === 0) return null;
  const first = value[0] as { mode?: string; locale?: string };
  const snapshots = (value as Record<string, unknown>[]).map((s) => ({
    role: s.role as RecordedSnapshot["role"],
    snapshotId: String(s.snapshotId),
    hash: String(s.hash),
    title: String(s.title ?? ""),
  }));
  return { mode: first.mode === "checkbox" ? "checkbox" : "link", locale: String(first.locale ?? ""), snapshots };
}

const EXCHANGE_SELECT = sql`
  select x.*, r.number as return_number, r.kind as return_kind, o.number as order_number,
    xo.number as exchange_order_number, xo.status::text as exchange_order_status
  from commerce.return_exchanges x
  join commerce.returns r on r.store_id = x.store_id and r.id = x.return_id
  join commerce.orders o on o.store_id = x.store_id and o.id = x.order_id
  left join commerce.orders xo on xo.store_id = x.store_id and xo.id = x.exchange_order_id
`;

async function linesOf(runner: Runner, storeId: string, exchangeIds: readonly string[]): Promise<Map<string, ExchangeLineView[]>> {
  const out = new Map<string, ExchangeLineView[]>();
  if (exchangeIds.length === 0) return out;
  const rows = await runner.execute<Row>(sql`
    select exchange_id, n, variant_id, sku, title, quantity, list_price_minor, unit_price_minor from commerce.return_exchange_lines
    where store_id = ${storeId}::uuid and exchange_id = any(${uuidList(exchangeIds)}) order by exchange_id, n
  `);
  for (const l of rows) {
    const list = out.get(String(l.exchange_id)) ?? [];
    list.push({
      n: Number(l.n),
      variantId: String(l.variant_id),
      sku: String(l.sku),
      title: String(l.title),
      quantity: Number(l.quantity),
      listPriceMinor: Number(l.list_price_minor),
      unitPriceMinor: Number(l.unit_price_minor),
      totalMinor: Number(l.unit_price_minor) * Number(l.quantity),
    });
    out.set(String(l.exchange_id), list);
  }
  return out;
}

function viewOf(row: Row, lines: ExchangeLineView[]): ExchangeView {
  const credit = Number(row.credit_minor);
  const total = Number(row.total_minor);
  const creditAt = num(row.credit_at_processing);
  const status = isExchangeStatus(row.status) ? row.status : "cancelled";
  return {
    id: String(row.id),
    seq: Number(row.seq),
    status,
    returnId: String(row.return_id),
    returnNumber: String(row.return_number),
    returnKind: row.return_kind === "withdrawal" ? "withdrawal" : "return",
    orderId: String(row.order_id),
    orderNumber: String(row.order_number),
    currency: String(row.currency).trim(),
    marketSlug: String(row.market_slug),
    shippingKind: (["free", "standard", "set"].includes(String(row.shipping_kind)) ? row.shipping_kind : "free") as ExchangeShippingKind,
    shippingMinor: Number(row.shipping_minor),
    deliveryAddress: addressOf(row.delivery_address),
    creditMinor: credit,
    totalMinor: total,
    differenceMinor: Number(row.difference_minor),
    creditAtProcessingMinor: creditAt,
    differenceAtProcessingMinor: num(row.difference_at_processing),
    outcome: exchangeOutcome(creditAt ?? credit, total),
    expiresAt: iso(row.expires_at),
    confirmedAt: iso(row.confirmed_at),
    confirmedBy: row.confirmed_by === "customer" || row.confirmed_by === "staff" ? row.confirmed_by : null,
    confirmedChannel: row.confirmed_channel ? (String(row.confirmed_channel) as ExchangeChannel) : null,
    exchangeOrderId: row.exchange_order_id ? String(row.exchange_order_id) : null,
    exchangeOrderNumber: row.exchange_order_number ? String(row.exchange_order_number) : null,
    exchangeOrderStatus: row.exchange_order_status ? String(row.exchange_order_status) : null,
    remainderRefundId: row.refund_id ? String(row.refund_id) : null,
    madeBy: String(row.made_by),
    createdAt: new Date(String(row.created_at)).toISOString(),
    processedAt: iso(row.processed_at),
    settledAt: iso(row.settled_at),
    endedAt: iso(row.ended_at),
    lines,
    terms: termsOf(row.terms),
  };
}

const isUuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

/** One exchange of the store, with its replacements; null when it is not this store's. */
export async function exchangeView(storeId: string, exchangeId: string, runner: Runner = db()): Promise<ExchangeView | null> {
  if (!isUuid(storeId) || !isUuid(exchangeId)) return null;
  const [row] = await runner.execute<Row>(sql`${EXCHANGE_SELECT} where x.store_id = ${storeId}::uuid and x.id = ${exchangeId}::uuid`);
  if (!row) return null;
  return viewOf(row, (await linesOf(runner, storeId, [exchangeId])).get(exchangeId) ?? []);
}

/** Every exchange of a return, newest first (the return's page shows the open one and the history). */
export async function exchangesOfReturn(storeId: string, returnId: string): Promise<ExchangeView[]> {
  if (!isUuid(storeId) || !isUuid(returnId)) return [];
  const rows = await db().execute<Row>(sql`${EXCHANGE_SELECT} where x.store_id = ${storeId}::uuid and x.return_id = ${returnId}::uuid order by x.seq desc`);
  const lines = await linesOf(db(), storeId, rows.map((r) => String(r.id)));
  return rows.map((r) => viewOf(r, lines.get(String(r.id)) ?? []));
}

/** The return's exchange that is still alive (draft, proposed, confirmed or processed), or null. */
export async function openExchangeOf(storeId: string, returnId: string): Promise<ExchangeView | null> {
  return (await exchangesOfReturn(storeId, returnId)).find((x) => ["draft", "proposed", "confirmed", "processed"].includes(x.status)) ?? null;
}

/** The exchange an order was made for (an exchange order's page), or null. */
export async function exchangeOfOrder(storeId: string, orderId: string): Promise<ExchangeView | null> {
  if (!isUuid(storeId) || !isUuid(orderId)) return null;
  const [row] = await db().execute<Row>(sql`select exchange_id from commerce.orders where store_id = ${storeId}::uuid and id = ${orderId}::uuid`);
  return row?.exchange_id ? exchangeView(storeId, String(row.exchange_id)) : null;
}

// ---------------------------------------------------------------------------------------------------------------------
// Which returns can be exchanged (4.3)
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Why the return cannot be exchanged now, or null: the database's reasons (`commerce.exchange_block()`, the same order as `exchangeBlock()`), then the code's
 * (the proposal limit, an original paid in another Stripe mode than the store is in, an original that cannot be refunded through Kaizen).
 */
export async function exchangeBlockFor(storeId: string, returnId: string, options: { claimedOk?: boolean; runner?: Runner } = {}): Promise<ExchangeBlock | null> {
  if (!isUuid(storeId) || !isUuid(returnId)) return "ended";
  const runner = options.runner ?? db();
  const [row] = await runner.execute<Row>(sql`
    select commerce.exchange_block(r.id, ${options.claimedOk ?? false}) as block,
      (select count(*)::int from commerce.return_exchanges x where x.store_id = r.store_id and x.return_id = r.id) as proposals,
      (select a.mode from commerce.payments p join commerce.connected_accounts a on a.store_id = p.store_id and a.account_id = p.provider_account
        where p.store_id = r.store_id and p.order_id = r.order_id and p.provider = 'stripe' and p.status = 'captured' order by p.created_at limit 1) as paid_mode,
      exists (select 1 from commerce.payments p left join commerce.connected_accounts a on a.store_id = p.store_id and a.account_id = p.provider_account
        where p.store_id = r.store_id and p.order_id = r.order_id and p.status = 'captured'
          and (p.provider = 'manual' or (p.provider = 'stripe' and a.mode is not null))) as refundable
    from commerce.returns r where r.store_id = ${storeId}::uuid and r.id = ${returnId}::uuid
  `);
  if (!row) return "ended";
  if (row.block) return String(row.block) as ExchangeBlock;
  const account = row.paid_mode ? await getCheckoutAccount(storeId) : null;
  return exchangeBlock({
    settingOn: true,
    copied: false,
    host: false,
    vatKind: "standard",
    subscription: false,
    weeklyBox: false,
    booking: false,
    allGoods: true,
    restricted: false,
    storeOpen: true,
    shopOn: true,
    returnStatus: "approved",
    refunded: false,
    editPending: false,
    proposals: Number(row.proposals),
    testModeMismatch: Boolean(row.paid_mode && account && account.mode !== row.paid_mode),
    // The credit moves as a refund of the original's own payments: one Kaizen cannot refund (paid at the venue, or before Connect) is not exchanged.
    paymentsNeeded: true,
    paymentsOn: Boolean(row.refundable),
  });
}

/** Words for a block reason. */
export const exchangeBlockText = (block: ExchangeBlock): string => EXCHANGE_PROBLEMS[block];

// ---------------------------------------------------------------------------------------------------------------------
// Pricing (4.2): the one place, for the preview, the proposal and processing
// ---------------------------------------------------------------------------------------------------------------------

/** What a replacement needs of its variant, read for the order's market view. */
type VariantFacts = {
  variantId: string;
  sku: string;
  title: string;
  /** Product and variant active, goods that are shipped, not a host's, not sold only by subscription, priced in the market. */
  sellable: boolean;
  goods: boolean;
  listMinor: number | null;
  rate: number;
  taxCode: string;
  withdrawalExclusion: string;
  costMinor: number | null;
  measure: ShownMeasure | null;
  policy: "continue" | "deny";
  backorderDays: number | null;
  inStock: number;
};

async function variantFacts(runner: Runner, storeId: string, market: Market, variantIds: readonly string[]): Promise<Map<string, VariantFacts>> {
  const out = new Map<string, VariantFacts>();
  const ids = [...new Set(variantIds)].filter(isUuid);
  if (ids.length === 0) return out;
  const rows = await runner.execute<Row>(sql`
    select v.id, v.sku, v.options, v.delivery, v.active, v.cost_minor, v.measure_amount, v.measure_unit, v.measure_base, v.stock_policy, v.backorder_days,
      p.status, p.kind, p.host_id, p.subscription_only, p.withdrawal_exclusion, coalesce(v.tax_code, p.tax_code) as tax_code,
      commerce.vat_rate(${market.code}, p.vat_category) as vat_rate, cp.amount_minor,
      coalesce(tl.title, tf.title, p.handle) as title, coalesce(va.in_stock, 0) as in_stock
    from commerce.product_variants v
    join commerce.products p on p.store_id = v.store_id and p.id = v.product_id
    left join commerce.product_translations tl on tl.product_id = p.id and tl.locale = ${market.locale}
    left join lateral (select title from commerce.product_translations where product_id = p.id order by locale limit 1) tf on true
    left join commerce.current_prices cp on cp.variant_id = v.id and cp.market_code = ${market.code}
    left join commerce.variant_availability va on va.store_id = v.store_id and va.variant_id = v.id
    where v.store_id = ${storeId}::uuid and v.id = any(${uuidList(ids)})
  `);
  const messages = t(market.lang);
  for (const row of rows) {
    const options = (row.options ?? {}) as Record<string, string>;
    const title = Object.keys(options).length > 0 ? `${row.title} (${variantLabel(shownOptions(messages, options))})` : String(row.title);
    const goods = row.kind === "goods" && row.delivery === "physical";
    out.set(String(row.id), {
      variantId: String(row.id),
      sku: String(row.sku),
      title: [...title].slice(0, 200).join(""),
      goods,
      sellable: goods && row.status === "active" && Boolean(row.active) && !row.host_id && !row.subscription_only && row.amount_minor !== null,
      listMinor: row.amount_minor === null ? null : shown(market, Number(row.amount_minor)),
      rate: Number(row.vat_rate ?? 0),
      taxCode: String(row.tax_code ?? GENERAL_TAX_CODE),
      withdrawalExclusion: String(row.withdrawal_exclusion ?? "none"),
      costMinor: row.cost_minor === null || row.cost_minor === undefined ? null : Number(row.cost_minor),
      measure: shownMeasureFromColumns(row.measure_amount, row.measure_unit, row.measure_base, market.code),
      policy: row.stock_policy === "continue" ? "continue" : "deny",
      backorderDays: row.backorder_days === null || row.backorder_days === undefined ? null : Number(row.backorder_days),
      inStock: Number(row.in_stock ?? 0),
    });
  }
  return out;
}

export type ExchangeLineInputRaw = { variantId: string; quantity: number; unitPriceMinor: number };
export type ExchangeShippingRaw = { kind: "free" } | { kind: "standard" } | { kind: "set"; amountMinor: number };

/** A replacement as the preview shows it: priced, and what the stock would do (nothing is held until processing). */
export type ExchangePreviewLine = {
  variantId: string;
  title: string;
  sku: string;
  quantity: number;
  listPriceMinor: number | null;
  unitPriceMinor: number;
  totalMinor: number;
  taxMinor: number;
  rate: number;
  measure: ShownMeasure | null;
  stock: { state: "in_stock" | "backorder" | "short"; inStock: number; backorderDays: number | null };
};

type Priced = {
  pricing: DraftPricing<TaxOutcome>;
  totalMinor: number;
  outcome: ExchangeOutcome;
  problems: ExchangeProblem[];
  lines: ExchangePreviewLine[];
  facts: Map<string, VariantFacts>;
};

/** Prices replacements in the market view against the credit: `priceExchange()` with the variants' list prices as shown and `decideTax()` of the day. */
async function priceReplacements(
  runner: Runner,
  storeId: string,
  market: Market,
  lines: readonly ExchangeLineInputRaw[],
  shipping: ExchangeShippingRaw,
  creditMinor: number,
): Promise<Priced> {
  const facts = await variantFacts(runner, storeId, market, lines.map((l) => l.variantId));
  const [rate] = await runner.execute<Row>(sql`select amount_minor, free_over_minor from commerce.shipping_rates where store_id = ${storeId}::uuid and market_code = ${market.code}`);
  const flat = rate ? { amountMinor: shown(market, Number(rate.amount_minor)), freeOverMinor: rate.free_over_minor === null ? null : shown(market, Number(rate.free_over_minor)) } : null;
  const taxFacts = await loadTaxFacts(runner, { storeId, market, cartId: null });
  const result = priceExchange(
    {
      lines: lines.map((l, i) => {
        const f = facts.get(l.variantId);
        return {
          key: `${i}`,
          quantity: l.quantity,
          listPriceMinor: f?.sellable ? f.listMinor : null,
          unitPriceMinor: l.unitPriceMinor,
          rate: f?.rate ?? 0,
          goods: f ? f.goods : true,
        };
      }),
      shipping: shipping.kind === "standard" ? { kind: "standard", rate: flat } : shipping,
      currency: market.currency,
      creditMinor,
    },
    (basket) => decideTax(taxFacts, basket),
  );
  // Units each variant has free now, shared by the lines of the same variant in order.
  const left = new Map([...facts].map(([id, f]) => [id, Math.max(0, f.inStock)]));
  const priced = new Map(result.pricing.lines.map((l) => [l.key, l]));
  const view: ExchangePreviewLine[] = lines.map((l, i) => {
    const f = facts.get(l.variantId);
    const p = priced.get(`${i}`);
    const free = left.get(l.variantId) ?? 0;
    left.set(l.variantId, Math.max(0, free - l.quantity));
    const state = free >= l.quantity ? "in_stock" : f?.policy === "continue" && f.backorderDays ? "backorder" : "short";
    return {
      variantId: l.variantId,
      title: f?.title ?? "",
      sku: f?.sku ?? "",
      quantity: l.quantity,
      listPriceMinor: f?.sellable ? f.listMinor : null,
      unitPriceMinor: l.unitPriceMinor,
      totalMinor: p?.totalMinor ?? l.unitPriceMinor * l.quantity,
      taxMinor: p?.taxMinor ?? 0,
      rate: p?.rate ?? f?.rate ?? 0,
      measure: f?.measure ?? null,
      stock: { state, inStock: f?.inStock ?? 0, backorderDays: f?.backorderDays ?? null },
    };
  });
  // A replacement total of 0 is not an exchange (refund instead): `priceDraft()` says so when there are lines.
  const problems = [...result.problems];
  if (result.pricing.lines.length > 0 && result.totalMinor <= 0 && !problems.some((p) => p.code === "total_zero")) problems.push({ code: "total_zero" });
  return { pricing: result.pricing, totalMinor: Math.max(0, result.totalMinor), outcome: result.outcome, problems, lines: view, facts };
}

// ---------------------------------------------------------------------------------------------------------------------
// The credit (4.2 point 5)
// ---------------------------------------------------------------------------------------------------------------------

export type ExchangeCredit = {
  /** `C`: `refundFor()`'s amount for the return as it stands (`previewRefund()`), never adjusted by the exchange. */
  amountMinor: number;
  working: WorkingRow[];
  /** The inspection is recorded: the credit will not change any more by it. */
  final: boolean;
  /** The return shipping taken off (a label the shopper pays for, D153/4.8). */
  returnShippingMinor: number;
};

/** The return's credit, worked out as its refund would be. */
export async function creditOf(storeId: string, returnId: string): Promise<ExchangeCredit | null> {
  const preview = await previewRefund(storeId, returnId);
  if (!preview) return null;
  const [ret] = await db().execute<Row>(sql`select status::text as status from commerce.returns where store_id = ${storeId}::uuid and id = ${returnId}::uuid`);
  return {
    amountMinor: preview.refund.amountMinor,
    working: preview.refund.working,
    final: ret?.status === "inspected",
    returnShippingMinor: preview.refund.returnShippingMinor,
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// The preview (2.2 "The summary")
// ---------------------------------------------------------------------------------------------------------------------

export type ExchangePreview = {
  ok: boolean;
  /** Why the return cannot be exchanged at all (the card says it in words), or null. */
  block: ExchangeBlock | null;
  problems: ExchangeProblem[];
  currency: string;
  marketSlug: string | null;
  credit: ExchangeCredit | null;
  lines: ExchangePreviewLine[];
  subtotalMinor: number;
  shippingMinor: number;
  taxMinor: number;
  totalMinor: number;
  vatPerRate: { rate: number; taxMinor: number }[];
  outcome: ExchangeOutcome | null;
};

type ReturnRow = { id: string; orderId: string; kind: "withdrawal" | "return"; status: string; refundDeadline: Date | null; number: string };

async function loadReturn(runner: Runner, storeId: string, returnId: string, lock = false): Promise<ReturnRow | null> {
  if (!isUuid(storeId) || !isUuid(returnId)) return null;
  const [r] = await runner.execute<Row>(
    lock
      ? sql`select id, order_id, kind, status::text as status, refund_deadline, number from commerce.returns where store_id = ${storeId}::uuid and id = ${returnId}::uuid for update`
      : sql`select id, order_id, kind, status::text as status, refund_deadline, number from commerce.returns where store_id = ${storeId}::uuid and id = ${returnId}::uuid`,
  );
  if (!r) return null;
  return {
    id: String(r.id),
    orderId: String(r.order_id),
    kind: r.kind === "withdrawal" ? "withdrawal" : "return",
    status: String(r.status),
    refundDeadline: r.refund_deadline ? new Date(String(r.refund_deadline)) : null,
    number: String(r.number),
  };
}

const MARKET_GONE: ExchangeProblem = { code: "not_offered" };

/**
 * What the builder shows (the server's summary; the browser never adds anything up): the credit with its working, the replacements priced, `T`, VAT per rate,
 * the outcome (refund due, even, to pay) and what the stock would do. The same pricing `proposeExchange()` freezes and `processExchange()` checks against.
 */
export async function previewExchange(storeId: string, returnId: string, raw: unknown): Promise<ExchangePreview | Refused> {
  const ret = await loadReturn(db(), storeId, returnId);
  if (!ret) return refuse("not_found");
  const parsed = exchangeBuilderInput.safeParse(raw);
  const block = await exchangeBlockFor(storeId, returnId);
  const credit = await creditOf(storeId, returnId);
  const view = await marketOfOrder(storeId, ret.orderId);
  const empty = (problems: ExchangeProblem[]): ExchangePreview => ({
    ok: false,
    block,
    problems,
    currency: view?.market.currency ?? "",
    marketSlug: view?.market.slug ?? null,
    credit,
    lines: [],
    subtotalMinor: 0,
    shippingMinor: 0,
    taxMinor: 0,
    totalMinor: 0,
    vatPerRate: [],
    outcome: null,
  });
  if (!parsed.success) return empty([{ code: "no_lines" }]);
  if (!view || !credit) return empty([MARKET_GONE]);
  const input = parsed.data;
  const priced = await priceReplacements(db(), storeId, view.market, input.lines, input.shipping, credit.amountMinor);
  const problems = [...priced.problems];
  if (input.deliveryAddress.country.toUpperCase() !== view.market.code.toUpperCase()) problems.push({ code: "address_country" });
  return {
    ok: problems.length === 0 && block === null,
    block,
    problems,
    currency: view.market.currency,
    marketSlug: view.market.slug,
    credit,
    lines: priced.lines,
    subtotalMinor: priced.pricing.subtotalMinor,
    shippingMinor: priced.pricing.shippingMinor,
    taxMinor: priced.pricing.taxMinor,
    totalMinor: priced.totalMinor,
    vatPerRate: priced.pricing.vatPerRate.map((r) => ({ rate: r.rate, taxMinor: r.taxMinor })),
    outcome: priced.outcome,
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Drafts and proposals
// ---------------------------------------------------------------------------------------------------------------------

export type ProposeResult =
  | {
      ok: true;
      exchange: ExchangeView;
      /** The link to share, shown once (only its hash is kept): set when staff asked for a link instead of an email. */
      link: string | null;
      emailed: "sent" | "logged" | "failed" | "duplicate" | "suppressed" | null;
    }
  | Refused;

/** Writes the proposal's numbers and replacements. Inside the caller's transaction, under the exchange context-free rules (a draft or a new proposal). */
async function writeLines(tx: Tx, storeId: string, exchangeId: string, priced: Priced, lines: readonly ExchangeLineInputRaw[]) {
  for (const [i, l] of lines.entries()) {
    const f = priced.facts.get(l.variantId)!;
    await tx.execute(sql`
      insert into commerce.return_exchange_lines (store_id, exchange_id, n, variant_id, sku, title, quantity, list_price_minor, unit_price_minor)
      values (${storeId}::uuid, ${exchangeId}::uuid, ${i + 1}, ${l.variantId}::uuid, ${f.sku}, ${f.title}, ${l.quantity}, ${f.listMinor ?? l.unitPriceMinor}, ${l.unitPriceMinor})
    `);
  }
}

type Prepared = { ret: ReturnRow; market: Market; store: EmailStore; credit: ExchangeCredit; priced: Priced; input: ReturnType<typeof exchangeBuilderInput.parse> };

/** Checks and prices a builder's input for a return: everything a draft or a proposal needs before it is written. */
async function prepare(storeId: string, returnId: string, raw: unknown): Promise<Prepared | Refused> {
  const parsed = exchangeBuilderInput.safeParse(raw);
  if (!parsed.success) return refuse("invalid", parsed.error.issues[0]?.message);
  const ret = await loadReturn(db(), storeId, returnId);
  if (!ret) return refuse("not_found");
  const block = await exchangeBlockFor(storeId, returnId);
  if (block) return refuse(block);
  const view = await marketOfOrder(storeId, ret.orderId);
  const credit = await creditOf(storeId, returnId);
  if (!view || !credit) return refuse("not_offered");
  const input = parsed.data;
  if (input.deliveryAddress.country.toUpperCase() !== view.market.code.toUpperCase()) return refuse("address_country");
  const priced = await priceReplacements(db(), storeId, view.market, input.lines, input.shipping, credit.amountMinor);
  if (priced.problems.length > 0) return refuse(priced.problems[0].code, undefined, priced.problems);
  return { ret, market: view.market, store: view.store, credit, priced, input };
}

const addressJson = (a: Prepared["input"]["deliveryAddress"]) =>
  JSON.stringify({ name: a.name, street: a.street, postalCode: a.postalCode, city: a.city, country: a.country.toUpperCase(), ...(a.phone ? { phone: a.phone } : {}) });

/**
 * *Save* in the builder: keeps the replacements as a draft (no token, no email, nothing held), replacing the return's open draft if it has one. A proposal
 * that is out with the customer is not touched: it is withdrawn and proposed again.
 */
export async function saveExchangeDraft(storeId: string, actor: OrderActor, returnId: string, raw: unknown): Promise<{ ok: true; exchange: ExchangeView } | Refused> {
  const prep = await prepare(storeId, returnId, raw);
  if (!("ret" in prep)) return prep;
  if (!actor.accountId) return refuse("not_allowed");
  const { ret, market, credit, priced, input } = prep;
  const done = await guarded(() =>
    db().transaction(async (tx) => {
      await loadReturn(tx, storeId, ret.id, true);
      const [open] = await tx.execute<Row>(sql`
        select id, status from commerce.return_exchanges where store_id = ${storeId}::uuid and return_id = ${ret.id}::uuid
          and status in ('draft', 'proposed', 'confirmed', 'processed') for update
      `);
      if (open && open.status !== "draft") return refuse("open", "This return has a proposal out with the customer. Withdraw it to change the replacements.");
      let id: string;
      if (open) {
        id = String(open.id);
        await tx.execute(sql`delete from commerce.return_exchange_lines where store_id = ${storeId}::uuid and exchange_id = ${id}::uuid`);
        await tx.execute(sql`
          update commerce.return_exchanges set shipping_kind = ${input.shipping.kind}, shipping_minor = ${priced.pricing.shippingMinor},
            delivery_address = ${addressJson(input.deliveryAddress)}::jsonb, credit_minor = ${credit.amountMinor}, total_minor = ${priced.totalMinor},
            difference_minor = ${priced.totalMinor - credit.amountMinor}
          where store_id = ${storeId}::uuid and id = ${id}::uuid
        `);
      } else {
        const [row] = await tx.execute<Row>(sql`
          insert into commerce.return_exchanges (store_id, return_id, order_id, seq, status, currency, market_slug, shipping_kind, shipping_minor, delivery_address,
            credit_minor, total_minor, difference_minor, made_by)
          values (${storeId}::uuid, ${ret.id}::uuid, ${ret.orderId}::uuid, 0, 'draft', ${market.currency}, ${market.slug}, ${input.shipping.kind}, ${priced.pricing.shippingMinor},
            ${addressJson(input.deliveryAddress)}::jsonb, ${credit.amountMinor}, ${priced.totalMinor}, ${priced.totalMinor - credit.amountMinor}, ${actor.accountId}::uuid)
          returning id
        `);
        id = String(row.id);
      }
      await writeLines(tx, storeId, id, priced, input.lines);
      return { ok: true as const, id };
    }),
  );
  if (!done.ok) return done;
  return { ok: true, exchange: (await exchangeView(storeId, done.id))! };
}

/**
 * Whether staff changed the order's email address after the return was made (`order.edited` naming `email`, `updateOrderContact()`): a withdrawal's proposal
 * then goes to an address the customer did not give, and anyone reading it could press Confirm as the customer (CRD Art. 13(1); D239 review). Refused.
 */
async function emailChangedSinceReturn(storeId: string, returnId: string): Promise<boolean> {
  const [row] = await db().execute<Row>(sql`
    select exists (
      select 1 from commerce.returns r
      join commerce.order_events e on e.store_id = r.store_id and e.order_id = r.order_id
      where r.store_id = ${storeId}::uuid and r.id = ${returnId}::uuid
        and e.type = 'order.edited' and coalesce(e.data -> 'fields', '[]'::jsonb) ? 'email' and e.created_at > r.created_at
    ) as changed
  `);
  return Boolean(row?.changed);
}

/**
 * *Send to the customer* (or *Create a link to share*): the replacements are priced again and frozen as shown, with a new token and an end (`EXCHANGE_PROPOSAL_DAYS`,
 * capped at the store day before a withdrawal's refund deadline; refused when that is less than a day away). The return's open draft becomes the proposal; an
 * open proposal (proposed or confirmed, not yet processed) is withdrawn first in the same transaction, so the customer confirms what they are shown now. The
 * email goes to the order's own address only, after the commit.
 */
export async function proposeExchange(
  storeId: string,
  actor: OrderActor,
  returnId: string,
  raw: unknown,
  options: { createLink?: boolean; now?: Date } = {},
): Promise<ProposeResult> {
  const prep = await prepare(storeId, returnId, raw);
  if (!("ret" in prep)) return prep;
  if (!actor.accountId) return refuse("not_allowed");
  const { ret, market, store, credit, priced, input } = prep;
  // A withdrawal's refund goes another way only on the customer's own press (CRD Art. 13(1), review finding): a link shown to staff would let staff press it
  // and have it recorded as the customer's. The proposal reaches the customer only by the email to the order's own address.
  if (options.createLink && ret.kind === "withdrawal") return refuse("link_withdrawal");
  if (ret.kind === "withdrawal" && (await emailChangedSinceReturn(storeId, returnId))) return refuse("email_changed");
  const [zone] = await db().execute<Row>(sql`select time_zone from commerce.stores where id = ${storeId}::uuid`);
  const end = exchangeDeadline({ kind: ret.kind, step: "proposal", now: options.now ?? new Date(), refundDeadline: ret.refundDeadline, timeZone: String(zone?.time_zone ?? "Europe/Oslo") });
  if (!end.ok) return refuse("deadline_near");
  const { token, hash } = newExchangeToken();
  const done = await guarded(() =>
    db().transaction(async (tx) => {
      await loadReturn(tx, storeId, ret.id, true);
      const [open] = await tx.execute<Row>(sql`
        select id, status from commerce.return_exchanges where store_id = ${storeId}::uuid and return_id = ${ret.id}::uuid
          and status in ('draft', 'proposed', 'confirmed', 'processed') for update
      `);
      if (open?.status === "processed") return refuse("open");
      if (open && open.status !== "draft") {
        await tx.execute(sql`update commerce.return_exchanges set status = 'cancelled' where store_id = ${storeId}::uuid and id = ${String(open.id)}::uuid`);
        await writeOrderEvent(tx, storeId, ret.orderId, "return.exchange_cancelled", { returnId: ret.id, exchange: String(open.id), replaced: true, by: actor.accountId }, "staff");
      }
      let id: string;
      if (open?.status === "draft") {
        id = String(open.id);
        await tx.execute(sql`delete from commerce.return_exchange_lines where store_id = ${storeId}::uuid and exchange_id = ${id}::uuid`);
        await tx.execute(sql`
          update commerce.return_exchanges set shipping_kind = ${input.shipping.kind}, shipping_minor = ${priced.pricing.shippingMinor},
            delivery_address = ${addressJson(input.deliveryAddress)}::jsonb, credit_minor = ${credit.amountMinor}, total_minor = ${priced.totalMinor},
            difference_minor = ${priced.totalMinor - credit.amountMinor}
          where store_id = ${storeId}::uuid and id = ${id}::uuid
        `);
        await writeLines(tx, storeId, id, priced, input.lines);
        await tx.execute(sql`
          update commerce.return_exchanges set status = 'proposed', token_hash = ${hash}, expires_at = ${end.expiresAt.toISOString()}::timestamptz
          where store_id = ${storeId}::uuid and id = ${id}::uuid
        `);
      } else {
        const [row] = await tx.execute<Row>(sql`
          insert into commerce.return_exchanges (store_id, return_id, order_id, seq, status, currency, market_slug, shipping_kind, shipping_minor, delivery_address,
            credit_minor, total_minor, difference_minor, token_hash, expires_at, made_by)
          values (${storeId}::uuid, ${ret.id}::uuid, ${ret.orderId}::uuid, 0, 'proposed', ${market.currency}, ${market.slug}, ${input.shipping.kind}, ${priced.pricing.shippingMinor},
            ${addressJson(input.deliveryAddress)}::jsonb, ${credit.amountMinor}, ${priced.totalMinor}, ${priced.totalMinor - credit.amountMinor},
            ${hash}, ${end.expiresAt.toISOString()}::timestamptz, ${actor.accountId}::uuid)
          returning id
        `);
        id = String(row.id);
        await writeLines(tx, storeId, id, priced, input.lines);
      }
      await writeOrderEvent(
        tx,
        storeId,
        ret.orderId,
        "return.exchange_proposed",
        { returnId: ret.id, number: ret.number, exchange: id, creditMinor: credit.amountMinor, totalMinor: priced.totalMinor, differenceMinor: priced.totalMinor - credit.amountMinor, by: actor.accountId },
        "staff",
      );
      return { ok: true as const, id };
    }),
  );
  if (!done.ok) return done;
  await audit(actor.accountId, storeId, "return.exchange_proposed", { returnId: ret.id, exchange: done.id, creditMinor: credit.amountMinor, totalMinor: priced.totalMinor, share: Boolean(options.createLink) }, { target: { type: "return", id: ret.id } });
  const exchange = (await exchangeView(storeId, done.id))!;
  if (options.createLink) return { ok: true, exchange, link: exchangeLinkFor(store, market.slug, token), emailed: null };
  const { sendExchangeProposed } = await import("./exchange-emails");
  const emailed = await sendExchangeProposed(storeId, done.id, token, 0).catch(() => "failed" as const);
  return { ok: true, exchange, link: null, emailed };
}

/** One send of an exchange's link today (`chat_usage` bucket `exchange:send:{id}`, one row a day). */
async function takeSend(storeId: string, exchangeId: string): Promise<{ ok: boolean; n: number }> {
  const [row] = await db().execute<Row>(sql`
    insert into commerce.chat_usage (store_id, bucket, "window", count)
    values (${storeId}::uuid, ${`exchange:send:${exchangeId}`}, date_trunc('day', now()), 1)
    on conflict (store_id, bucket, "window") do update set count = commerce.chat_usage.count + 1
    returning count
  `);
  const n = Number(row?.count ?? 0);
  return { ok: n <= EXCHANGE_SENDS_PER_DAY, n };
}

/**
 * *Send again* (or *Create a link to share*) for a proposal out with the customer, or for the pay step of a processed exchange: a NEW token replaces the old
 * (the earlier link is dead), the end is unchanged. At most `EXCHANGE_SENDS_PER_DAY` a day.
 */
export async function resendExchange(storeId: string, actor: OrderActor, exchangeId: string, options: { createLink?: boolean } = {}): Promise<{ ok: true; link: string | null; emailed: string | null } | Refused> {
  const x = await exchangeView(storeId, exchangeId);
  if (!x) return refuse("not_found");
  if (!["proposed", "confirmed", "processed"].includes(x.status)) return refuse("lifecycle");
  if (x.status === "processed" && x.outcome.toPayMinor <= 0) return refuse("nothing_to_pay");
  if (x.expiresAt && new Date(x.expiresAt).getTime() <= Date.now()) return refuse("expired");
  // Not for a withdrawal's proposal waiting for the customer's confirmation (see proposeExchange()); the pay step's link may be shared.
  if (options.createLink && x.returnKind === "withdrawal" && x.status === "proposed") return refuse("link_withdrawal");
  if (x.returnKind === "withdrawal" && x.status === "proposed" && (await emailChangedSinceReturn(storeId, x.returnId))) return refuse("email_changed");
  const taken = await takeSend(storeId, exchangeId);
  if (!taken.ok) return refuse("sends_limit");
  const { token, hash } = newExchangeToken();
  const rows = await db().execute<Row>(sql`
    update commerce.return_exchanges set token_hash = ${hash}
    where store_id = ${storeId}::uuid and id = ${exchangeId}::uuid and status in ('proposed', 'confirmed', 'processed') returning id
  `);
  if (rows.length === 0) return refuse("lifecycle");
  await audit(actor.accountId, storeId, "return.exchange_proposed", { returnId: x.returnId, exchange: exchangeId, again: true, share: Boolean(options.createLink) }, { target: { type: "return", id: x.returnId } });
  const view = await marketOfOrder(storeId, x.orderId);
  const link = view ? exchangeLinkFor(view.store, x.marketSlug, token) : null;
  if (options.createLink) return { ok: true, link, emailed: null };
  const { sendExchangeProposed, sendExchangeToPay } = await import("./exchange-emails");
  const emailed =
    x.status === "processed"
      ? await sendExchangeToPay(storeId, exchangeId, token, taken.n).catch(() => "failed" as const)
      : await sendExchangeProposed(storeId, exchangeId, token, taken.n).catch(() => "failed" as const);
  return { ok: true, link: null, emailed };
}

/** *Withdraw the proposal*: a draft, a proposal or a confirmed exchange that is not processed ends `cancelled`; the customer's page says it no longer works. */
export async function withdrawProposal(storeId: string, actor: OrderActor, exchangeId: string): Promise<{ ok: true } | Refused> {
  const x = await exchangeView(storeId, exchangeId);
  if (!x) return refuse("not_found");
  if (!["draft", "proposed", "confirmed"].includes(x.status)) return refuse(x.status === "processed" ? "open" : "lifecycle");
  const done = await guarded(() =>
    db().transaction(async (tx) => {
      const rows = await tx.execute<Row>(sql`
        update commerce.return_exchanges set status = 'cancelled' where store_id = ${storeId}::uuid and id = ${exchangeId}::uuid and status in ('draft', 'proposed', 'confirmed') returning id
      `);
      if (rows.length === 0) return refuse("lifecycle");
      await writeOrderEvent(tx, storeId, x.orderId, "return.exchange_cancelled", { returnId: x.returnId, exchange: exchangeId, by: actor.accountId }, "staff");
      return { ok: true as const };
    }),
  );
  if (done.ok) await audit(actor.accountId, storeId, "return.exchange_cancelled", { returnId: x.returnId, exchange: exchangeId }, { target: { type: "return", id: x.returnId } });
  return done;
}

/**
 * *Record the customer's agreement* (a VOLUNTARY return only; the database refuses it for a withdrawal, `exchange.withdrawal_needs_customer`): how it came,
 * the store day and a note (kept only in the history event's `data.note`, which the erasure removes). It confirms the proposal as the customer's press would.
 */
export async function recordExchangeAgreement(storeId: string, actor: OrderActor, exchangeId: string, raw: unknown): Promise<{ ok: true } | Refused> {
  const parsed = exchangeAgreementInput.safeParse(raw);
  if (!parsed.success) return refuse("invalid", parsed.error.issues[0]?.message);
  const x = await exchangeView(storeId, exchangeId);
  if (!x) return refuse("not_found");
  if (x.returnKind === "withdrawal") return refuse("lifecycle", "A withdrawal's refund goes another way only on the customer's own confirmation: send them the proposal.");
  if (x.status !== "proposed") return refuse("lifecycle");
  if (x.expiresAt && new Date(x.expiresAt).getTime() <= Date.now()) return refuse("expired");
  const data = parsed.data;
  const done = await guarded(() =>
    db().transaction(async (tx) => {
      const rows = await tx.execute<Row>(sql`
        update commerce.return_exchanges set status = 'confirmed', confirmed_by = 'staff', confirmed_channel = ${data.channel}
        where store_id = ${storeId}::uuid and id = ${exchangeId}::uuid and status = 'proposed' returning id
      `);
      if (rows.length === 0) return refuse("lifecycle");
      await writeOrderEvent(
        tx,
        storeId,
        x.orderId,
        "return.exchange_confirmed",
        { returnId: x.returnId, exchange: exchangeId, by: actor.accountId, confirmedBy: "staff", channel: data.channel, day: data.day, ...(data.note ? { note: data.note } : {}) },
        "staff",
      );
      return { ok: true as const };
    }),
  );
  if (done.ok) await audit(actor.accountId, storeId, "return.exchange_agreement_recorded", { returnId: x.returnId, exchange: exchangeId, channel: data.channel }, { target: { type: "return", id: x.returnId } });
  return done;
}

// ---------------------------------------------------------------------------------------------------------------------
// The customer's wish (2.1)
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Whether the return's status page offers the wish field (D239 2.1): a return found by its own token among the store's, with no wish yet and no exchange
 * proposed or under way, that can be exchanged now (`exchangeBlockFor()`: the store's setting, the order, the return open and not refunded).
 */
export async function wishOfferedFor(storeId: string, returnToken: string): Promise<boolean> {
  if (!isUuid(storeId) || !/^[0-9a-f]{32,128}$/.test(returnToken)) return false;
  const [ret] = await db().execute<Row>(sql`
    select r.id, r.exchange_wish_at,
      exists (select 1 from commerce.return_exchanges x where x.store_id = r.store_id and x.return_id = r.id and x.status in ('proposed', 'confirmed', 'processed', 'settled')) as proposed
    from commerce.returns r where r.store_id = ${storeId}::uuid and r.public_token = ${returnToken}
  `);
  if (!ret || ret.exchange_wish_at || ret.proposed) return false;
  return (await exchangeBlockFor(storeId, String(ret.id))) === null;
}

/**
 * The customer asks for an exchange on the return's status page (found by the return's own token, among the store's returns): the wish is kept once
 * (`returns.exchange_wish_at`, `exchange_wish_note`, a plain text the same check as the browser's cleans) and the store's contact address hears of it once.
 * A wish is not an agreement: nothing is applied from it. Offered only while the return can be exchanged. `atRequest` is the voluntary return request
 * form's own field (D239 2.1: beside its reason): the return was just made and is still `requested`, which is the one block a wish made with it ignores.
 */
export async function recordExchangeWish(storeId: string, returnToken: string, raw: unknown, options: { atRequest?: boolean } = {}): Promise<{ ok: true } | Refused> {
  const parsed = exchangeWishInput.safeParse(raw);
  if (!parsed.success) return refuse("invalid", parsed.error.issues[0]?.message);
  if (!/^[0-9a-f]{32,128}$/.test(returnToken)) return refuse("not_found");
  const [ret] = await db().execute<Row>(sql`select id, exchange_wish_at from commerce.returns where store_id = ${storeId}::uuid and public_token = ${returnToken}`);
  if (!ret) return refuse("not_found");
  if (ret.exchange_wish_at) return refuse("wish_made");
  const block = await exchangeBlockFor(storeId, String(ret.id));
  if (block && !(options.atRequest && block === "requested")) return refuse("wish_off");
  // `exchange_block()` answers `requested` before the checks after it, so a wish made with a request asks those itself: every accepted line physical goods
  // of a product, and no change to the order waiting for payment (`exchange_block()`'s order; the refund cannot be recorded on a request just made).
  if (block === "requested") {
    const [later] = await db().execute<Row>(sql`
      select exists (
          select 1 from commerce.return_lines rl join commerce.order_lines ol on ol.store_id = rl.store_id and ol.id = rl.order_line_id
          where rl.store_id = ${storeId}::uuid and rl.return_id = ${String(ret.id)}::uuid and rl.decision = 'accept' and (ol.delivery <> 'physical' or ol.variant_id is null)
        ) or exists (
          select 1 from commerce.order_edits e join commerce.returns r on r.store_id = e.store_id and r.order_id = e.order_id
          where r.store_id = ${storeId}::uuid and r.id = ${String(ret.id)}::uuid and e.status = 'awaiting_payment'
        ) as blocked
    `);
    if (later?.blocked) return refuse("wish_off");
  }
  const rows = await db().execute<Row>(sql`
    update commerce.returns set exchange_wish_at = now(), exchange_wish_note = ${parsed.data.note}
    where store_id = ${storeId}::uuid and id = ${String(ret.id)}::uuid and exchange_wish_at is null returning order_id
  `);
  if (rows.length === 0) return refuse("wish_made");
  await writeOrderEvent(db(), storeId, String(rows[0].order_id), "return.exchange_wished", { returnId: String(ret.id) }, "customer");
  const { sendExchangeWished } = await import("./exchange-emails");
  await sendExchangeWished(storeId, String(ret.id)).catch(() => null);
  return { ok: true };
}

// ---------------------------------------------------------------------------------------------------------------------
// Processing (4.4 step a)
// ---------------------------------------------------------------------------------------------------------------------

export type ProcessResult =
  | {
      ok: true;
      exchange: ExchangeView;
      orderId: string;
      orderNumber: string;
      /** `settled` (Δ ≤ 0, settled at once), `waiting` (Δ > 0: the pay step is out), or `refund_failed` (the order is made and waits; *Try again*). */
      state: "settled" | "waiting" | "refund_failed";
      message?: string;
      emailed?: string | null;
    }
  | Refused;

/**
 * *Process the exchange*, offered where *Refund* would be (`actionsFor()`). Step (a) in one transaction under the original order's, the return's and the
 * exchange's locks: the exchange is confirmed and its end not passed; the return can still be exchanged; the refund is not held for goods not yet back (D153's
 * `refund_when`); the credit is worked out again (`credit_changed` when the customer would pay more than they confirmed); the refund is claimed; the
 * replacements are allocated (`stock_short` when one stops at zero) and the order made through `insertOrder()` (`source = 'exchange'`, the next number of the
 * store's sequence) with its lines and its stock held (to the pay step's end, or `EXCHANGE_SETTLE_HOLD_MINUTES` when it settles at once). Nothing is written
 * on a refusal. Then, with Δ ≤ 0, step (b) at once (`settleExchange()`); with Δ > 0, the customer is emailed the pay step.
 */
export async function processExchange(storeId: string, actor: OrderActor, exchangeId: string, options: { now?: Date } = {}): Promise<ProcessResult> {
  const x = await exchangeView(storeId, exchangeId);
  if (!x) return refuse("not_found");
  if (x.status === "processed") return settleAgain(storeId, actor, x);
  if (x.status !== "confirmed") return refuse(x.status === "proposed" ? "not_confirmed" : "lifecycle");
  const now = options.now ?? new Date();
  if (x.expiresAt && new Date(x.expiresAt).getTime() <= now.getTime()) return refuse("expired");
  if (!actor.accountId) return refuse("not_allowed");
  const ret = await loadReturn(db(), storeId, x.returnId);
  if (!ret) return refuse("not_found");
  // The refund is offered from in transit on when the store withholds until the goods are back (Art. 13(3)): the exchange waits as the refund would.
  const [{ refundWhen }, [sent]] = await Promise.all([
    getReturnSettings(storeId),
    db().execute<Row>(sql`select ${NOTHING_SENT_SQL} as nothing_sent from commerce.returns r where r.store_id = ${storeId}::uuid and r.id = ${x.returnId}::uuid`),
  ]);
  const hold = { holds: refundWhen === "received" && !sent?.nothing_sent };
  if (hold?.holds && !["in_transit", "received", "inspected"].includes(ret.status)) return refuse("not_received");
  const block = await exchangeBlockFor(storeId, x.returnId);
  if (block) return refuse(block);
  const credit = await creditOf(storeId, x.returnId);
  const view = await marketOfOrder(storeId, x.orderId);
  if (!credit || !view) return refuse("not_offered");
  const outcome = exchangeOutcome(credit.amountMinor, x.totalMinor);
  if (!creditStillHolds(x.differenceMinor, outcome.differenceMinor)) return refuse("credit_changed");
  const [zone] = await db().execute<Row>(sql`select time_zone from commerce.stores where id = ${storeId}::uuid`);
  const payEnd = exchangeDeadline({ kind: ret.kind, step: "pay", now, refundDeadline: ret.refundDeadline, timeZone: String(zone?.time_zone ?? "Europe/Oslo") });
  if (outcome.toPayMinor > 0 && !payEnd.ok) return refuse("deadline_near");
  const holdUntil: { at: Date } | { minutes: number } = outcome.toPayMinor > 0 && payEnd.ok ? { at: payEnd.expiresAt } : { minutes: EXCHANGE_SETTLE_HOLD_MINUTES };
  const lines = x.lines.map((l) => ({ variantId: l.variantId, quantity: l.quantity, unitPriceMinor: l.unitPriceMinor }));
  const shipping: ExchangeShippingRaw = x.shippingKind === "set" ? { kind: "set", amountMinor: x.shippingMinor } : x.shippingKind === "standard" ? { kind: "standard" } : { kind: "free" };

  const made = await guarded(() =>
    db().transaction(async (tx) => {
      // A refusal inside is thrown, so the claim and anything else written roll back with it.
      const stop = (refused: Refused): never => {
        throw new RolledBack(refused);
      };
      await tx.execute(sql`select set_config('kaizen.exchange', ${exchangeId}, true)`);
      const [original] = await tx.execute<Row>(sql`select * from commerce.orders where store_id = ${storeId}::uuid and id = ${x.orderId}::uuid for update`);
      await loadReturn(tx, storeId, x.returnId, true);
      const [locked] = await tx.execute<Row>(sql`select status, expires_at from commerce.return_exchanges where store_id = ${storeId}::uuid and id = ${exchangeId}::uuid for update`);
      if (!original || locked?.status !== "confirmed") return stop(refuse("lifecycle"));
      // The refund's claim (D153): no other member's refund is under way, and none can start while this exchange is processed (the database's rule).
      const claimed = await tx.execute<Row>(sql`
        update commerce.returns set refund_claimed_at = now()
        where store_id = ${storeId}::uuid and id = ${x.returnId}::uuid and refund_minor is null
          and (refund_claimed_at is null or refund_claimed_at < now() - interval '2 minutes') returning id
      `);
      if (claimed.length === 0) return stop(refuse("busy"));
      // Priced again in the transaction, with the prices frozen on the proposal and the VAT of the day: what the order is made of.
      const priced = await priceReplacements(tx, storeId, view.market, lines, shipping, credit.amountMinor);
      if (priced.problems.length > 0) return stop(refuse(priced.problems[0].code, undefined, priced.problems));
      if (priced.totalMinor !== x.totalMinor) return stop(refuse("credit_changed", "The replacements' total has changed since the proposal. Propose the exchange again."));
      const facts = priced.facts;
      const keeps = [...new Set(lines.filter((l) => facts.get(l.variantId)?.policy === "continue").map((l) => l.variantId))];
      const plan = await allocateStock(tx, storeId, lines.map((l) => ({ variantId: l.variantId, quantity: l.quantity, policy: facts.get(l.variantId)?.policy ?? "deny" })), keeps);
      if (!plan.ok) return stop(refuse("stock_short"));
      const behind = new Map(plan.behind);
      const tax = priced.pricing.tax!;
      const [rules] = await tx.execute<Row>(sql`select who_pays_return from commerce.return_settings where store_id = ${storeId}::uuid`);
      const [rate] = await tx.execute<Row>(sql`select amount_minor, free_over_minor from commerce.shipping_rates where store_id = ${storeId}::uuid and market_code = ${view.market.code}`);
      const goodsTotal = lines.reduce((sum, l) => sum + l.unitPriceMinor * l.quantity, 0);
      // The cheapest standard delivery (D153's `standard_shipping_minor`): the market's flat rate on these goods, as checkout judges it; none for a free exchange shipping.
      const standard = x.shippingKind === "free" ? 0 : rate ? (rate.free_over_minor !== null && goodsTotal >= shown(view.market, Number(rate.free_over_minor)) ? 0 : shown(view.market, Number(rate.amount_minor))) : null;
      const address = (x.deliveryAddress ?? {}) as ExchangeAddress;
      const { orderId, number } = await insertOrder(tx, {
        storeId,
        marketCode: String(original.market_code),
        currency: String(original.currency).trim(),
        locale: String(original.locale),
        email: String(original.email ?? ""),
        subtotalMinor: priced.pricing.subtotalMinor,
        shippingMinor: priced.pricing.shippingMinor,
        discountMinor: priced.pricing.discountMinor,
        taxMinor: priced.pricing.taxMinor,
        totalMinor: priced.pricing.totalMinor,
        billingAddress: (original.billing_address ?? {}) as Record<string, unknown>,
        shippingAddress: { name: address.name, line1: address.street, postalCode: address.postalCode, city: address.city, country: address.country, ...(address.phone ? { phone: address.phone } : {}) },
        customerId: original.customer_id ? String(original.customer_id) : null,
        companyName: original.company_name ? String(original.company_name) : null,
        organisationNumber: original.organisation_number ? String(original.organisation_number) : null,
        returnCostPayer: rules?.who_pays_return === "store" ? "store" : "shopper",
        standardShippingMinor: standard,
        vatKind: tax.decision.kind,
        vatReliefMinor: tax.reliefMinor,
        shippingTaxRate: tax.shippingRate,
        vatTreatment: tax.treatment,
        exchange: { id: exchangeId, madeBy: actor.accountId! },
      });
      const pricedLines = new Map(priced.pricing.lines.map((l) => [l.key, l]));
      for (const [i, l] of lines.entries()) {
        const f = facts.get(l.variantId)!;
        const p = pricedLines.get(`${i}`)!;
        const left = behind.get(l.variantId) ?? 0;
        const backordered = Math.min(left, l.quantity);
        behind.set(l.variantId, left - backordered);
        await insertOrderLine(tx, storeId, orderId, {
          variantId: l.variantId,
          sku: f.sku,
          title: x.lines[i].title,
          quantity: l.quantity,
          unitPriceMinor: l.unitPriceMinor,
          discountMinor: p.discountMinor,
          totalMinor: p.totalMinor,
          taxMinor: p.taxMinor,
          taxRate: p.rate,
          taxCode: f.taxCode,
          withdrawalExclusion: lineWithdrawal("physical", f.withdrawalExclusion),
          delivery: "physical",
          unitCostMinor: f.costMinor,
          vatReliefMinor: p.reliefMinor,
          measure: f.measure ? { amount: f.measure.amount, unit: f.measure.unit, base: f.measure.base } : null,
          backorderQuantity: backordered,
          backorderDays: backordered > 0 && f.backorderDays ? f.backorderDays : null,
          listPriceMinor: x.lines[i].listPriceMinor,
        });
      }
      await reserveStock(tx, storeId, orderId, plan.holds, holdUntil);
      await tx.execute(sql`
        update commerce.return_exchanges set status = 'processed', exchange_order_id = ${orderId}::uuid,
          credit_at_processing = ${credit.amountMinor}, difference_at_processing = ${outcome.differenceMinor},
          expires_at = ${outcome.toPayMinor > 0 && payEnd.ok ? payEnd.expiresAt.toISOString() : null}::timestamptz
        where store_id = ${storeId}::uuid and id = ${exchangeId}::uuid
      `);
      await writeOrderEvent(tx, storeId, orderId, "order.placed", { exchange: exchangeId, return: x.returnNumber, returnId: x.returnId }, "staff");
      await writeOrderEvent(
        tx,
        storeId,
        x.orderId,
        "return.exchange_processed",
        { returnId: x.returnId, number: x.returnNumber, exchange: exchangeId, order: number, orderId, creditMinor: credit.amountMinor, totalMinor: x.totalMinor, differenceMinor: outcome.differenceMinor, by: actor.accountId },
        "staff",
      );
      return { ok: true as const, orderId, number };
    }),
  ).catch((error: unknown) => {
    if (error instanceof RolledBack) return error.refused;
    throw error;
  });
  if (!made.ok) {
    // A refusal wrote nothing: the claim went with the rolled-back transaction.
    return made;
  }
  // The terms the customer was shown when they confirmed, tied to their new order (D158's record, kept from the exchange page).
  if (x.terms) await recordTermsSnapshotsForOrder(db(), storeId, made.orderId, x.terms).catch(() => false);
  await audit(actor.accountId, storeId, "return.exchange_processed", { returnId: x.returnId, exchange: exchangeId, orderId: made.orderId, creditMinor: credit.amountMinor, totalMinor: x.totalMinor }, { target: { type: "return", id: x.returnId } });

  if (outcome.toPayMinor > 0) {
    const { token, hash } = newExchangeToken();
    await db().execute(sql`update commerce.return_exchanges set token_hash = ${hash} where store_id = ${storeId}::uuid and id = ${exchangeId}::uuid and status = 'processed'`);
    const { sendExchangeToPay } = await import("./exchange-emails");
    const emailed = await sendExchangeToPay(storeId, exchangeId, token, 0).catch(() => "failed" as const);
    return { ok: true, exchange: (await exchangeView(storeId, exchangeId))!, orderId: made.orderId, orderNumber: made.number, state: "waiting", emailed };
  }
  const settled = await settleExchange(storeId, exchangeId, { accountId: actor.accountId });
  const after = (await exchangeView(storeId, exchangeId))!;
  if (!settled.ok) return { ok: true, exchange: after, orderId: made.orderId, orderNumber: made.number, state: "refund_failed", message: settled.message };
  return { ok: true, exchange: after, orderId: made.orderId, orderNumber: made.number, state: "settled" };
}

/** *Try again* on a processed exchange that settles at once (Δ ≤ 0) whose refund failed: step (b) again. One with a difference to pay waits for it. */
async function settleAgain(storeId: string, actor: OrderActor, x: ExchangeView): Promise<ProcessResult> {
  if (!x.exchangeOrderId || !x.exchangeOrderNumber) return refuse("lifecycle");
  if (x.outcome.toPayMinor > 0) return { ok: true, exchange: x, orderId: x.exchangeOrderId, orderNumber: x.exchangeOrderNumber, state: "waiting" };
  const settled = await settleExchange(storeId, x.id, { accountId: actor.accountId });
  const after = (await exchangeView(storeId, x.id))!;
  if (!settled.ok) return { ok: true, exchange: after, orderId: x.exchangeOrderId, orderNumber: x.exchangeOrderNumber, state: "refund_failed", message: settled.message };
  return { ok: true, exchange: after, orderId: x.exchangeOrderId, orderNumber: x.exchangeOrderNumber, state: "settled" };
}

// ---------------------------------------------------------------------------------------------------------------------
// Settling (4.4 step b)
// ---------------------------------------------------------------------------------------------------------------------

/** How the difference of an exchange with Δ > 0 was paid, for `settleExchange()`. */
type Difference =
  | { kind: "capture"; paymentId: string }
  | { kind: "manual"; method: "cash" | "bank_transfer" | "other"; receivedOn: string | null; recordedBy: string; reference: string };

export type SettleResult = { ok: true; already?: boolean } | Refused;

/**
 * Step (b): in ONE transaction (the one that records the remainder's refund, when there is one) the transfer `min(C, T)` is written as refund rows of the
 * original order's captured payments (`kind = 'transfer'`, no Stripe call, split over them the Stripe one first) with their `exchange` payments on the new
 * order; the difference's payment is captured or recorded; the return's refund is recorded (`refund_minor = C`, the working, `outcome = 'exchanged'`, the claim
 * released; closed when it was inspected); `commerce.complete_exchange_order()` pays the order (its stock drawn, its invoice issued) and settles the exchange.
 * The remainder `C − T` goes back through `refundOrder()` with the exchange (Stripe first, its idempotency key `exchange-refund:{exchange}:{failures}`), and the
 * returned units go back in stock as inspected. A refund Stripe reports failed settles nothing (`exchange.refund_failed`). Settling twice is a no-op. The
 * emails follow the commit: `return.exchanged` and the new order's confirmation; `return.refunded` and `order.refunded` are not sent.
 */
export async function settleExchange(storeId: string, exchangeId: string, options: { accountId: string | null; difference?: Difference }): Promise<SettleResult> {
  const x = await exchangeView(storeId, exchangeId);
  if (!x) return refuse("not_found");
  if (x.status === "settled") return { ok: true, already: true };
  if (x.status !== "processed" || !x.exchangeOrderId || x.creditAtProcessingMinor === null) return refuse("lifecycle");
  const credit = x.creditAtProcessingMinor;
  const [order] = await db().execute<Row>(sql`select total_minor, currency, status::text as status from commerce.orders where store_id = ${storeId}::uuid and id = ${x.exchangeOrderId}::uuid`);
  if (!order || order.status !== "pending_payment") return refuse("lifecycle");
  const total = Number(order.total_minor);
  const outcome = exchangeOutcome(credit, total);
  if (outcome.toPayMinor > 0 && !options.difference) return refuse("nothing_to_pay", "The difference has not been paid yet.");
  const preview = await previewRefund(storeId, x.returnId);
  if (!preview) return refuse("not_found");
  const refund = preview.refund;
  // The returned units go back to stock as inspected (the lines staff marked as going back), never more than is left to put back.
  const lines = await db().execute<Row>(sql`
    select rl.order_line_id, rl.quantity from commerce.return_lines rl
    where rl.store_id = ${storeId}::uuid and rl.return_id = ${x.returnId}::uuid and rl.decision = 'accept' and rl.restock
  `);
  const restock = lines.map((l) => ({ lineId: String(l.order_line_id), quantity: Number(l.quantity) }));
  const reason = `Exchange for return ${x.returnNumber}`;
  let settledHere = false;

  const write = async (tx: Tx, remainderId: string | null) => {
    await tx.execute(sql`select set_config('kaizen.exchange', ${exchangeId}, true)`);
    const [locked] = await tx.execute<Row>(sql`select status from commerce.return_exchanges where store_id = ${storeId}::uuid and id = ${exchangeId}::uuid for update`);
    if (locked?.status !== "processed") return;
    // The transfer, split over the original's captured payments (Stripe's first, then money taken outside), each part a refund row with its exchange payment.
    const payments = await tx.execute<Row>(sql`
      select p.id, p.provider, p.currency,
        p.amount_minor - coalesce((select sum(r.amount_minor) from commerce.refunds r where r.store_id = p.store_id and r.payment_id = p.id and r.status::text <> 'failed'), 0) as left_minor
      from commerce.payments p
      where p.store_id = ${storeId}::uuid and p.order_id = ${x.orderId}::uuid and p.status = 'captured' and p.provider in ('stripe', 'manual')
      order by (p.provider <> 'stripe'), p.created_at, p.id
    `);
    const parts = splitRefund(payments.map((p) => ({ id: String(p.id), provider: p.provider === "manual" ? "manual" : "stripe", leftMinor: Number(p.left_minor) })), outcome.transferMinor);
    if (parts === null) throw new TransferShort();
    const transfers: string[] = [];
    for (const part of parts) {
      const currency = String(payments.find((p) => String(p.id) === part.paymentId)?.currency ?? x.currency).trim();
      const [rf] = await tx.execute<Row>(sql`
        insert into commerce.refunds (store_id, payment_id, amount_minor, reason, status, kind, exchange_id, created_by)
        values (${storeId}::uuid, ${part.paymentId}::uuid, ${part.amountMinor}, ${reason}, 'succeeded', 'transfer', ${exchangeId}::uuid, ${options.accountId}::uuid)
        returning id
      `);
      transfers.push(String(rf.id));
      await tx.execute(sql`
        insert into commerce.payments (store_id, order_id, provider, provider_reference, amount_minor, currency, status, kaizen_fee_minor, exchange_id, transfer_refund_id)
        values (${storeId}::uuid, ${x.exchangeOrderId}::uuid, 'exchange', ${`exchange:${String(rf.id)}`}, ${part.amountMinor}, ${currency}, 'captured', 0, ${exchangeId}::uuid, ${String(rf.id)}::uuid)
      `);
    }
    if (transfers.length > 0) {
      await tx.execute(sql`update commerce.return_exchanges set transfer_refund_id = coalesce(transfer_refund_id, ${transfers[0]}::uuid) where store_id = ${storeId}::uuid and id = ${exchangeId}::uuid`);
    }
    const diff = options.difference;
    if (diff?.kind === "capture") {
      await tx.execute(sql`update commerce.payments set status = 'captured', updated_at = now() where store_id = ${storeId}::uuid and id = ${diff.paymentId}::uuid and exchange_id = ${exchangeId}::uuid`);
    } else if (diff?.kind === "manual") {
      await tx.execute(sql`
        insert into commerce.payments (store_id, order_id, provider, provider_reference, amount_minor, currency, status, kaizen_fee_minor, method, recorded_by, received_on, exchange_id)
        values (${storeId}::uuid, ${x.exchangeOrderId}::uuid, 'manual', ${diff.reference}, ${outcome.toPayMinor}, ${x.currency}, 'captured', 0, ${diff.method}, ${diff.recordedBy}::uuid, ${diff.receivedOn}::date, ${exchangeId}::uuid)
      `);
      await writeOrderEvent(tx, storeId, x.exchangeOrderId!, "order.paid_outside", { method: diff.method, exchange: exchangeId, ...(diff.receivedOn ? { receivedOn: diff.receivedOn } : {}) }, "staff");
    }
    // The return's refund is the credit; its working is the one its credit note reads (D159), with the difference to C as an adjustment.
    const working = {
      lines: refund.lines.filter((l) => l.returnQuantity > 0).map((l) => ({ lineId: l.lineId, quantity: l.returnQuantity, valueMinor: l.valueMinor, deductionMinor: l.deductionMinor })),
      deliveryMinor: Math.min(refund.shippingRefundMinor, credit),
      returnShippingMinor: refund.returnShippingMinor,
      amountMinor: credit,
      outside: false,
    };
    const refundWorking = { ...working, adjustmentMinor: adjustmentOf(working) };
    await tx.execute(sql`
      update commerce.returns set refund_id = ${remainderId}::uuid, refund_minor = ${credit}, refund_computed_minor = ${refund.amountMinor},
        refund_outside = false, return_shipping_minor = ${refund.returnShippingMinor}, shipping_refund_minor = ${working.deliveryMinor},
        refund_working = ${JSON.stringify(refundWorking)}::jsonb, refund_claimed_at = null, outcome = 'exchanged'
      where store_id = ${storeId}::uuid and id = ${x.returnId}::uuid
    `);
    await tx.execute(sql`update commerce.returns set status = 'closed' where store_id = ${storeId}::uuid and id = ${x.returnId}::uuid and status::text = 'inspected'`);
    await tx.execute(sql`select commerce.complete_exchange_order(${exchangeId}::uuid)`);
    await writeOrderEvent(
      tx,
      storeId,
      x.orderId,
      "return.refunded",
      { returnId: x.returnId, number: x.returnNumber, exchange: exchangeId, amountMinor: credit, transferMinor: outcome.transferMinor, refundMinor: outcome.refundMinor, refundId: remainderId, by: options.accountId },
      "staff",
    );
    await writeOrderEvent(tx, storeId, x.exchangeOrderId!, "order.paid", { exchange: exchangeId, transferMinor: outcome.transferMinor, paidMinor: outcome.toPayMinor }, "system");
    settledHere = true;
  };

  let result: RefundOutcome | null = null;
  try {
    if (outcome.refundMinor > 0 || restock.length > 0) {
      const [failedBefore] = await db().execute<Row>(sql`
        select count(*)::int as n from commerce.order_events
        where store_id = ${storeId}::uuid and order_id = ${x.orderId}::uuid and type = 'exchange.refund_failed' and data ->> 'exchange' = ${exchangeId}
      `);
      result = await refundOrder(storeId, x.orderId, { amountMinor: outcome.refundMinor, reason, restock }, options.accountId, {
        idempotencyKey: `exchange-refund:${exchangeId}:${Number(failedBefore?.n ?? 0)}`,
        returnId: x.returnId,
        exchangeId,
        eventData: { returnId: x.returnId, returnNumber: x.returnNumber, exchange: exchangeId },
        // The returned units go back only with the settlement (review finding): never on a refund Stripe reported failed (Try again would put them back
        // twice), and never when another call settled the exchange first (the row is locked here, as `write()` locks it, and must still be `processed`).
        restockIf: async (tx, status) => {
          if (status === "failed") return false;
          const [locked] = await tx.execute<Row>(sql`select status from commerce.return_exchanges where store_id = ${storeId}::uuid and id = ${exchangeId}::uuid for update`);
          return locked?.status === "processed";
        },
        inTransaction: async (tx, out) => {
          if (out.status === "failed") return;
          await write(tx, outcome.refundMinor > 0 ? out.refundId || null : null);
        },
      });
    } else {
      await db().transaction((tx) => write(tx, null));
    }
  } catch (error) {
    if (error instanceof TransferShort) return refuse("transfer_short");
    const refused = exchangeRefusalOf(error);
    if (refused) return refused;
    throw error;
  }
  if (result && !result.ok) {
    await writeOrderEvent(db(), storeId, x.orderId, "exchange.refund_failed", { exchange: exchangeId, returnId: x.returnId }, "system");
    return refuse("refund_failed", result.problem);
  }
  if (!settledHere) {
    const again = await exchangeView(storeId, exchangeId);
    if (again?.status === "settled") return { ok: true, already: true };
    await writeOrderEvent(db(), storeId, x.orderId, "exchange.refund_failed", { exchange: exchangeId, returnId: x.returnId }, "system");
    return refuse("refund_failed");
  }
  await linkOrderToCustomer(storeId, x.exchangeOrderId).catch(() => null);
  await sendOrderConfirmation(storeId, x.exchangeOrderId).catch(() => null);
  const { sendExchanged } = await import("./exchange-emails");
  await sendExchanged(storeId, exchangeId).catch(() => null);
  return { ok: true };
}

/** A refusal found inside a transaction that already wrote something: thrown so it all rolls back, then answered. */
class RolledBack extends Error {
  constructor(readonly refused: Refused) {
    super(refused.problem);
  }
}

/** The original order had less left to refund than the transfer needs (a refund outside the exchange took it meanwhile). */
class TransferShort extends Error {}

// ---------------------------------------------------------------------------------------------------------------------
// The difference: the pay link's payment, money taken outside Kaizen, a late payment
// ---------------------------------------------------------------------------------------------------------------------

export type ExchangePaymentOutcome = "settled" | "already" | "refunded" | "not_exchange" | "failed";

/**
 * A completed Stripe session of an exchange's difference (`applySession()` branches here on `payments.exchange_id`, and never calls `complete_order_payment()`
 * for it): the payment row is captured and step (b) settles the exchange. A payment for an exchange that can no longer settle (cancelled or expired while
 * Stripe was processing) is captured and refunded in full at once from itself (2.8), event `exchange.payment_refunded`.
 */
export async function completeExchangePayment(storeId: string, sessionId: string): Promise<ExchangePaymentOutcome> {
  const [payment] = await db().execute<Row>(sql`
    select id, order_id, exchange_id, status, amount_minor from commerce.payments where store_id = ${storeId}::uuid and provider = 'stripe' and provider_reference = ${sessionId}
  `);
  if (!payment?.exchange_id) return "not_exchange";
  const exchangeId = String(payment.exchange_id);
  const paymentId = String(payment.id);
  const x = await exchangeView(storeId, exchangeId);
  if (!x) return "not_exchange";
  if (x.status === "settled") {
    const [mine] = await db().execute<Row>(sql`select status from commerce.payments where store_id = ${storeId}::uuid and id = ${paymentId}::uuid`);
    if (mine?.status === "captured") return "already";
  }
  if (x.status === "processed") {
    const settled = await settleExchange(storeId, exchangeId, { accountId: null, difference: { kind: "capture", paymentId } });
    if (settled.ok) return settled.already ? "already" : "settled";
  }
  // The money arrived for an exchange that cannot settle: captured and given back in full, from this payment (the exchange order's).
  await db().execute(sql`update commerce.payments set status = 'captured', updated_at = now() where store_id = ${storeId}::uuid and id = ${paymentId}::uuid and status <> 'captured'`);
  const [done] = await db().execute<Row>(sql`select 1 from commerce.refunds where store_id = ${storeId}::uuid and payment_id = ${paymentId}::uuid and status::text <> 'failed'`);
  if (done) return "refunded";
  const back = await refundOrder(
    storeId,
    String(payment.order_id),
    { amountMinor: Number(payment.amount_minor), reason: "The exchange ended before the payment arrived", restock: [] },
    null,
    {
      paymentId,
      exchangeId,
      idempotencyKey: `exchange-late:${paymentId}`,
      eventData: { exchange: exchangeId, late: true },
      inTransaction: async (tx, out) => {
        await writeOrderEvent(tx, storeId, String(payment.order_id), "exchange.payment_refunded", { exchange: exchangeId, refund: out.refundId, amount: Number(payment.amount_minor) }, "system");
      },
    },
  );
  if (!back.ok) {
    console.error("[exchanges] a late payment for an exchange could not be refunded", { storeId, exchangeId });
    return "failed";
  }
  const { sendRefunded } = await import("./shopper-emails");
  await sendRefunded(storeId, String(payment.order_id), back.refundId, back.amountMinor).catch(() => null);
  return "refunded";
}

/** A Stripe session of an exchange's difference that expired or failed: only its payment row is marked (the exchange job decides what becomes of the order). */
export async function markExchangeSessionEnded(storeId: string, sessionId: string, status: "cancelled" | "failed"): Promise<boolean> {
  const rows = await db().execute<Row>(sql`
    update commerce.payments set status = ${status}, updated_at = now()
    where store_id = ${storeId}::uuid and provider = 'stripe' and provider_reference = ${sessionId} and exchange_id is not null and status = 'pending'
    returning id
  `);
  return rows.length > 0;
}

export type PaidOutsideInput = { method: "cash" | "bank_transfer" | "other"; receivedOn?: string | null; reference?: string | null };

/**
 * *Record as paid outside Kaizen* for a processed exchange with a difference to pay: the owner, or staff when the owner allowed it (D173's rule); cash above the
 * country's ceiling refused (`cash-limits.ts`). The exchange's Stripe sessions are closed first (one found paid settles the exchange; one processing waits), then
 * step (b) settles with a `manual` payment of the difference.
 */
export async function recordExchangePaidOutside(
  member: Pick<Membership, "account" | "store" | "role" | "kind" | "permissions">,
  exchangeId: string,
  input: PaidOutsideInput,
): Promise<{ ok: true; cashWarning?: boolean } | Refused> {
  const storeId = member.store.id;
  if (!["cash", "bank_transfer", "other"].includes(input.method)) return refuse("invalid");
  if (!(await mayRecordOutsidePayment(member))) return refuse("not_allowed");
  const x = await exchangeView(storeId, exchangeId);
  if (!x) return refuse("not_found");
  if (x.status === "settled") return refuse("paid");
  if (x.status !== "processed" || !x.exchangeOrderId) return refuse("lifecycle");
  if (x.outcome.toPayMinor <= 0) return refuse("nothing_to_pay");
  if (input.receivedOn) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.receivedOn)) return refuse("received_on");
    const [day] = await db().execute<Row>(sql`
      select commerce.store_day(${storeId}::uuid, now())::text as today, (commerce.store_day(${storeId}::uuid, now()) - ${MANUAL_RECEIVED_DAYS_MAX}::int)::text as earliest
    `);
    if (input.receivedOn > String(day?.today) || input.receivedOn < String(day?.earliest)) return refuse("received_on");
  }
  let cashWarning = false;
  if (input.method === "cash") {
    const [m] = await db().execute<Row>(sql`select market_code from commerce.orders where store_id = ${storeId}::uuid and id = ${x.exchangeOrderId}::uuid`);
    const code = String(m?.market_code ?? "").trim();
    const check = checkCash(code, x.outcome.toPayMinor, x.currency, await cashLimitInCurrency(storeId, code, x.currency));
    if (check.kind === "refuse") return refuse("cash_limit");
    if (check.kind === "warn") cashWarning = true;
  }
  const sessions = await settleOrderSessions(storeId, x.exchangeOrderId);
  if (sessions === "paid") return refuse("paid");
  if (sessions === "processing") return refuse("processing");
  const settled = await settleExchange(storeId, exchangeId, {
    accountId: member.account.id,
    difference: { kind: "manual", method: input.method, receivedOn: input.receivedOn ?? null, recordedBy: member.account.id, reference: `manual_${crypto.randomUUID()}` },
  });
  if (!settled.ok) return settled;
  await audit(member.account.id, storeId, "return.exchange_paid_outside", { returnId: x.returnId, exchange: exchangeId, method: input.method, amountMinor: x.outcome.toPayMinor, currency: x.currency }, { target: { type: "return", id: x.returnId } });
  return { ok: true, ...(cashWarning ? { cashWarning } : {}) };
}

// ---------------------------------------------------------------------------------------------------------------------
// Ending an exchange: staff, the job, a closure
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Ends an open exchange (`cancelled` by staff or a closure, `expired` by the job). A processed one has its order's Stripe sessions closed first (a session found
 * paid settles it instead: `paid`; one processing: `processing`), then, in one transaction, its order is cancelled (`cancel_unpaid_order()`: stock released, the
 * number kept), the exchange ended and the return's claim released, so the return is refunded as usual. Returns what happened.
 */
async function endExchange(
  storeId: string,
  exchangeId: string,
  to: "cancelled" | "expired",
  actor: OrderActor,
): Promise<{ ok: true; lapsed: boolean } | Refused> {
  const x = await exchangeView(storeId, exchangeId);
  if (!x) return refuse("not_found");
  if (!["draft", "proposed", "confirmed", "processed"].includes(x.status)) return refuse(x.status === "settled" ? "paid" : "lifecycle");
  if (x.status === "processed" && x.exchangeOrderId) {
    const sessions = await settleOrderSessions(storeId, x.exchangeOrderId);
    if (sessions === "paid") return refuse("paid");
    if (sessions === "processing") return refuse("processing");
  }
  const done = await guarded(() =>
    db().transaction(async (tx) => {
      if (x.exchangeOrderId) await tx.execute(sql`select id from commerce.orders where store_id = ${storeId}::uuid and id = ${x.exchangeOrderId}::uuid for update`);
      const [locked] = await tx.execute<Row>(sql`select status from commerce.return_exchanges where store_id = ${storeId}::uuid and id = ${exchangeId}::uuid for update`);
      const status = String(locked?.status ?? "");
      if (!["draft", "proposed", "confirmed", "processed"].includes(status)) return refuse("lifecycle");
      const target = status === "draft" ? "cancelled" : to;
      if (status === "processed" && x.exchangeOrderId) {
        const [o] = await tx.execute<Row>(sql`select status::text as status from commerce.orders where store_id = ${storeId}::uuid and id = ${x.exchangeOrderId}::uuid`);
        if (o?.status !== "pending_payment" && o?.status !== "cancelled") return refuse("paid");
        if (o?.status === "pending_payment") await tx.execute(sql`select commerce.cancel_unpaid_order(${x.exchangeOrderId}::uuid, ${`exchange ${to}`})`);
        await tx.execute(sql`
          update commerce.returns set refund_claimed_at = null where store_id = ${storeId}::uuid and id = ${x.returnId}::uuid and refund_minor is null
        `);
      }
      await tx.execute(sql`update commerce.return_exchanges set status = ${target} where store_id = ${storeId}::uuid and id = ${exchangeId}::uuid`);
      await writeOrderEvent(
        tx,
        storeId,
        x.orderId,
        to === "expired" ? "return.exchange_expired" : "return.exchange_cancelled",
        { returnId: x.returnId, exchange: exchangeId, from: status, ...(actor.accountId ? { by: actor.accountId } : {}) },
        actor.kind,
      );
      return { ok: true as const, lapsed: status === "confirmed" || status === "processed" };
    }),
  );
  return done;
}

/**
 * *Cancel the exchange and refund instead* (or *Withdraw the proposal* of a processed one): ends the exchange as `endExchange()` does. The ordinary refund is
 * then offered on the return as before; a customer who had confirmed is told their exchange did not go through.
 */
export async function cancelExchange(storeId: string, actor: OrderActor, exchangeId: string): Promise<{ ok: true } | Refused> {
  const x = await exchangeView(storeId, exchangeId);
  const done = await endExchange(storeId, exchangeId, "cancelled", actor);
  if (!done.ok) return done;
  if (x) await audit(actor.accountId, storeId, "return.exchange_cancelled", { returnId: x.returnId, exchange: exchangeId, from: x.status }, { target: { type: "return", id: x.returnId } });
  if (done.lapsed) {
    const { sendExchangeLapsed } = await import("./exchange-emails");
    await sendExchangeLapsed(storeId, exchangeId).catch(() => null);
  }
  return { ok: true };
}

export type ExpireExchangesRun = { expired: number; waiting: number; paid: number; failed: number };

/**
 * The five-minute job (`runReturnJobs()`): an exchange whose proposal or pay step passed its end is expired (a processed one after its Stripe sessions are
 * closed: one found paid settles instead, one processing waits); the customer who had confirmed is emailed that it did not go through. Per exchange, never
 * throwing; a store that is not open is left to its closure.
 */
export async function expireExchanges(now: Date = new Date(), options: { limit?: number } = {}): Promise<ExpireExchangesRun> {
  const run: ExpireExchangesRun = { expired: 0, waiting: 0, paid: 0, failed: 0 };
  const due = await db().execute<Row>(sql`
    select x.store_id, x.id from commerce.return_exchanges x
    where x.status in ('proposed', 'confirmed', 'processed') and x.expires_at <= ${now.toISOString()}::timestamptz and commerce.store_is_active(x.store_id)
    order by x.expires_at limit ${options.limit ?? 100}
  `);
  for (const row of due) {
    const storeId = String(row.store_id);
    const id = String(row.id);
    try {
      const done = await endExchange(storeId, id, "expired", { accountId: null, kind: "system" });
      if (done.ok) {
        run.expired += 1;
        if (done.lapsed) {
          const { sendExchangeLapsed } = await import("./exchange-emails");
          await sendExchangeLapsed(storeId, id).catch(() => null);
        }
      } else if (done.problem === "paid") run.paid += 1;
      else if (done.problem === "processing") run.waiting += 1;
      else run.failed += 1;
    } catch (error) {
      run.failed += 1;
      console.error("[exchanges] an exchange could not be expired", id, error);
    }
  }
  return run;
}

/** A store being closed (D171): every open exchange ends `cancelled` (its order cancelled, its stock released); the customers are refunded as usual by staff. */
export async function cancelExchangesForClosure(storeId: string, accountId: string | null): Promise<{ cancelled: number; left: number }> {
  const open = await db().execute<Row>(sql`
    select id from commerce.return_exchanges where store_id = ${storeId}::uuid and status in ('draft', 'proposed', 'confirmed', 'processed')
  `);
  let cancelled = 0;
  for (const row of open) {
    const done = await endExchange(storeId, String(row.id), "cancelled", accountId ? staffActor(accountId) : { accountId: null, kind: "system" }).catch(() => null);
    if (done?.ok) cancelled += 1;
  }
  return { cancelled, left: open.length - cancelled };
}

/** Open exchanges of a store (the closure screen's warning; never a blocker). */
export async function openExchangeCount(storeId: string): Promise<number> {
  const [row] = await db().execute<Row>(sql`
    select count(*)::int as n from commerce.return_exchanges where store_id = ${storeId}::uuid and status in ('proposed', 'confirmed', 'processed')
  `);
  return Number(row?.n ?? 0);
}

// ---------------------------------------------------------------------------------------------------------------------
// Retention (3.6): application code, never a DELETE in a SQL function
// ---------------------------------------------------------------------------------------------------------------------

/** Clears an ended exchange's token hash `EXCHANGE_TOKEN_KEEP_DAYS` after it ended (or was settled). */
export async function pruneExchangeTokens(now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - EXCHANGE_TOKEN_KEEP_DAYS * 86_400_000).toISOString();
  const rows = await db().execute<Row>(sql`
    update commerce.return_exchanges set token_hash = null
    where token_hash is not null and status in ('settled', 'declined_by_customer', 'cancelled', 'expired', 'superseded')
      and coalesce(ended_at, settled_at) < ${cutoff}::timestamptz
    returning id
  `);
  return rows.length;
}

/** Blanks the customer's exchange wish `EXCHANGE_WISH_KEEP_MONTHS` after the return ended (the wish is otherwise kept as made). */
export async function pruneExchangeWishes(now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now);
  cutoff.setUTCMonth(cutoff.getUTCMonth() - EXCHANGE_WISH_KEEP_MONTHS);
  return db().transaction(async (tx) => {
    // The return's rules keep a wish as it was made; only the anonymising may blank it, as it blanks the other notes.
    await tx.execute(sql`select set_config('commerce.anonymising', 'on', true)`);
    const rows = await tx.execute<Row>(sql`
      update commerce.returns set exchange_wish_note = '[removed]'
      where exchange_wish_note is not null and exchange_wish_note <> '[removed]' and exchange_wish_note <> ''
        and status::text in ('closed', 'declined', 'cancelled') and coalesce(closed_at, updated_at) < ${cutoff.toISOString()}::timestamptz
      returning id
    `);
    await tx.execute(sql`select set_config('commerce.anonymising', '', true)`);
    return rows.length;
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// For the pay page (exchange-pay.ts)
// ---------------------------------------------------------------------------------------------------------------------

/** The exchange behind a token, within this store: null for any token that is not the current one of one of its exchanges. */
export async function exchangeIdForToken(storeId: string, token: string): Promise<string | null> {
  if (!EXCHANGE_TOKEN.test(token) || !isUuid(storeId)) return null;
  const [row] = await db().execute<Row>(sql`select id from commerce.return_exchanges where store_id = ${storeId}::uuid and token_hash = ${hashExchangeToken(token)}`);
  return row ? String(row.id) : null;
}

/** Whether the store takes card payments in the order's market now (for the pay step). */
export async function paymentsOnFor(storeId: string, marketCode: string): Promise<boolean> {
  return (await getCheckoutInfo(storeId, marketCode)).paymentsOn;
}
