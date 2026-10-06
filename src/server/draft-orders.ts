import "server-only";

import { createHash, randomBytes } from "node:crypto";

import { sql } from "drizzle-orm";

import { db, type Db } from "@/db/client";
import { organisationNumber } from "@/lib/b2b";
import { lineWithdrawal } from "@/lib/checkout";
import {
  DEFAULT_DISCOUNT_LABEL,
  blockingProblems,
  draftProblems,
  hasCustomPrice,
  priceDraft,
  problemOf,
  rateShipping,
  repriceForMarket,
  type DraftLineInput as PricedLineInput,
  type DraftPricing,
  type DraftProblem,
} from "@/lib/draft-order";
import { draftInput, draftPaidOutsideInput, draftSendInput, formatPercentBps, parsePercentBps, type DraftAddress, type DraftInput } from "@/lib/draft-input";
import { canReopenDraft, draftPruneCutoffs, isDraftDeletable, type DraftStatus } from "@/lib/draft-status";
import { shownOptions, t } from "@/lib/i18n";
import { conversionFor } from "@/lib/localization";
import { findMarket, shown, type Market } from "@/lib/markets";
import { cashRuleOf, checkCash } from "@/lib/cash-limits";
import { DRAFTS_OPEN_MAX, DRAFT_LINE_TITLE_COLUMN_MAX, DRAFT_PAID_OUTSIDE_VALID_DAYS, DRAFT_SENDS_PER_DAY, DRAFT_SENDS_PER_HOUR_STORE, MANUAL_RECEIVED_DAYS_MAX } from "@/lib/order-limits";
import { marketPath, storeSiteUrl } from "@/lib/paths";
import { ORDER_AUDIT_ACTIONS, ORDER_OPS_EVENTS } from "@/lib/order-ops-events";
import { tagsOf } from "@/lib/order-tags";
import { GENERAL_TAX_CODE, formatPriceInput, parsePrice, variantLabel } from "@/lib/product-input";
import { shownMeasureFromColumns } from "@/lib/unit-price-rules";
import type { ShownMeasure } from "@/lib/unit-price";

import { audit, type Membership } from "./auth";
import { sendOrderConfirmation, storeById, type EmailStore } from "./shopper-emails";
import { linkOrderToCustomer } from "./customers";
import { allocateStock, insertOrder, insertOrderLine, reserveStock, type StockHold } from "./order-insert";
import { staffActor, writeOrderEvent, type OrderActor } from "./order-actor";
import { changeOrderTags } from "./order-tags";
import { getOrderSettings, mayRecordOutsidePayment } from "./order-settings";
import { getCheckoutInfo } from "./orders";
import { settleOrderSessions } from "./draft-sessions";
import { decideTax, loadTaxFacts, type TaxOutcome } from "./tax-treatment";
import { uuidList } from "./sql-arrays";

type Row = Record<string, unknown>;
type Runner = Pick<Db, "execute">;

/**
 * Draft orders (wave 3, run 2, D173, `docs/wave-3-orders.md` 2.4 and 4.5): a staff-made, editable quote that becomes a REAL order when it is sent. While `open` a draft holds no stock and uses no number;
 * *Send* (`placeDraftOrder()`, in one transaction) makes the order `pending_payment` through the one shared insert (`order-insert.ts`: numbered from D141's gap-free sequence, `source = 'draft'`), holds
 * the stock until the draft's expiry, copies the tags to the order and marks the draft `sent`; the buyer pays through the pay link (`draft-pay.ts`), staff record a payment taken outside Kaizen
 * (`markDraftPaidOutside()`), and `expireDrafts()` cancels the order of a link nobody paid, which keeps its number (no gap). The pricing is `priceDraft()` (pure, `src/lib/draft-order.ts`) over the checkout's own
 * building blocks (`decideTax()`, `basketShipping()`, `allocateStock()`); campaigns, codes, credits, group discounts and VAT-number checks do not apply to a draft. Every statement names the store.
 *
 * A draft's `version` is raised by every save and every send: a save of an old version is refused (two staff at once). Only the hash of the pay token is kept, the token is returned once.
 */

// ---------------------------------------------------------------------------------------------------------------------
// What a draft is, as the editor sees it
// ---------------------------------------------------------------------------------------------------------------------

export type DraftLineView = {
  id: string;
  position: number;
  kind: "goods" | "custom";
  variantId: string | null;
  title: string;
  sku: string;
  quantity: number;
  /** The price charged for one unit, VAT included, in the draft's currency. */
  unitPriceMinor: number;
  /** The market's list price as shown when the line was added or last saved; null for a custom item. */
  listPriceMinor: number | null;
  /** A price staff typed instead of the list price (never a "was" price anywhere a buyer looks). */
  customPrice: boolean;
  vatCategory: string | null;
  delivery: "physical" | "service";
};

export type DraftView = {
  id: string;
  number: string;
  status: DraftStatus;
  version: number;
  marketCode: string;
  marketSlug: string;
  currency: string;
  locale: string;
  customerId: string | null;
  email: string | null;
  phone: string | null;
  shippingAddress: DraftAddress;
  billingAddress: DraftAddress;
  companyName: string | null;
  organisationNumber: string | null;
  noteToBuyer: string | null;
  internalNote: string | null;
  /** Tag labels, carried to the order when the draft is sent. */
  tags: string[];
  /** In the form the editor types: a percent ("10,5") or an amount in major units; with the label the buyer sees. */
  discount: { kind: "percent" | "amount"; value: string; label: string } | null;
  shipping: { kind: "rate" | "free" | "custom"; price: string | null };
  validDays: number | null;
  orderId: string | null;
  sentAt: string | null;
  expiresAt: string | null;
  paidAt: string | null;
  /** A pay link is live (its hash is kept); the link itself is never kept. */
  linkLive: boolean;
  paySendsToday: number;
  createdAt: string;
  updatedAt: string;
  lines: DraftLineView[];
};

const ADDRESS_KEYS = ["name", "line1", "line2", "postalCode", "city", "country"] as const;
const addressOf = (value: unknown): DraftAddress => {
  const raw = (value ?? {}) as Record<string, unknown>;
  const out = Object.fromEntries(ADDRESS_KEYS.map((key) => [key, typeof raw[key] === "string" && String(raw[key]).trim() !== "" ? String(raw[key]) : null]));
  return out as DraftAddress;
};
const addressJson = (address: DraftAddress): Record<string, string> =>
  Object.fromEntries(Object.entries(address).filter(([, v]) => typeof v === "string" && v !== "")) as Record<string, string>;

function lineOf(row: Row): DraftLineView {
  const list = row.list_price_minor === null || row.list_price_minor === undefined ? null : Number(row.list_price_minor);
  const unit = Number(row.unit_price_minor);
  return {
    id: String(row.id),
    position: Number(row.position),
    kind: row.variant_id ? "goods" : "custom",
    variantId: row.variant_id ? String(row.variant_id) : null,
    title: String(row.title),
    sku: String(row.sku),
    quantity: Number(row.quantity),
    unitPriceMinor: unit,
    listPriceMinor: list,
    customPrice: hasCustomPrice({ kind: row.variant_id ? "goods" : "custom", unitPriceMinor: unit, listPriceMinor: list }),
    vatCategory: row.vat_category ? String(row.vat_category) : null,
    delivery: row.delivery === "service" ? "service" : "physical",
  };
}

function viewOf(row: Row, lines: Row[]): DraftView {
  const currency = String(row.currency).trim();
  const kind = row.discount_kind === "percent" || row.discount_kind === "amount" ? row.discount_kind : null;
  return {
    id: String(row.id),
    number: String(row.number),
    status: row.status as DraftStatus,
    version: Number(row.version),
    marketCode: String(row.market_code).trim(),
    marketSlug: String(row.market_slug),
    currency,
    locale: String(row.locale),
    customerId: row.customer_id ? String(row.customer_id) : null,
    email: row.email ? String(row.email) : null,
    phone: row.phone ? String(row.phone) : null,
    shippingAddress: addressOf(row.shipping_address),
    billingAddress: addressOf(row.billing_address),
    companyName: row.company_name ? String(row.company_name) : null,
    organisationNumber: row.organisation_number ? String(row.organisation_number) : null,
    noteToBuyer: row.note_to_buyer ? String(row.note_to_buyer) : null,
    internalNote: row.internal_note ? String(row.internal_note) : null,
    tags: ((row.tags ?? []) as unknown[]).map(String),
    discount: kind
      ? { kind, value: kind === "percent" ? formatPercentBps(Number(row.discount_value)) : formatPriceInput(Number(row.discount_value), currency), label: String(row.discount_label) }
      : null,
    shipping: {
      kind: row.shipping_kind === "free" || row.shipping_kind === "custom" ? row.shipping_kind : "rate",
      price: row.shipping_minor === null || row.shipping_minor === undefined ? null : formatPriceInput(Number(row.shipping_minor), currency),
    },
    validDays: row.valid_days === null || row.valid_days === undefined ? null : Number(row.valid_days),
    orderId: row.order_id ? String(row.order_id) : null,
    sentAt: row.sent_at ? new Date(String(row.sent_at)).toISOString() : null,
    expiresAt: row.expires_at ? new Date(String(row.expires_at)).toISOString() : null,
    paidAt: row.paid_at ? new Date(String(row.paid_at)).toISOString() : null,
    linkLive: Boolean(row.pay_token_hash),
    paySendsToday: Number(row.pay_sends_today ?? 0),
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
    lines: lines.map(lineOf),
  };
}

const LINE_COLUMNS = sql`id, position, variant_id, title, sku, quantity, unit_price_minor, list_price_minor, vat_category, delivery`;

/** One of the store's drafts with its lines; null for an id that is not this store's. */
export async function getDraft(storeId: string, draftId: string, runner: Runner = db(), { lock = false }: { lock?: boolean } = {}): Promise<DraftView | null> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(draftId)) return null;
  const [row] = await runner.execute<Row>(sql`
    select * from commerce.draft_orders where store_id = ${storeId}::uuid and id = ${draftId}::uuid ${lock ? sql`for update` : sql``}
  `);
  if (!row) return null;
  const lines = await runner.execute<Row>(sql`
    select ${LINE_COLUMNS} from commerce.draft_order_lines where store_id = ${storeId}::uuid and draft_id = ${draftId}::uuid order by position, id
  `);
  return viewOf(row, lines);
}

export type DraftListRow = {
  id: string;
  number: string;
  status: DraftStatus;
  customer: string | null;
  email: string | null;
  currency: string;
  /** What the draft totals now, worked out from its lines as saved (the same function that prices the order); null when it cannot be (no lines, a market that went). */
  totalMinor: number | null;
  orderId: string | null;
  orderNumber: string | null;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
  lineCount: number;
};

export type DraftListPage = { rows: DraftListRow[]; nextCursor: string | null; openCount: number };

const encodeDraftCursor = (createdAt: string, id: string) => Buffer.from(JSON.stringify([createdAt, id])).toString("base64url");
function decodeDraftCursor(cursor: string | null | undefined): { createdAt: string; id: string } | null {
  if (!cursor || !/^[A-Za-z0-9_-]{1,300}$/.test(cursor)) return null;
  try {
    const [createdAt, id] = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as [unknown, unknown];
    if (typeof createdAt !== "string" || typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id) || Number.isNaN(new Date(createdAt).getTime())) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}

/** The store's drafts, newest first, 50 a page (keyset), optionally of one status. */
export async function listDrafts(storeId: string, options: { status?: DraftStatus | null; after?: string | null; pageSize?: number } = {}): Promise<DraftListPage> {
  const pageSize = options.pageSize ?? 50;
  const cursor = decodeDraftCursor(options.after);
  const rows = await db().execute<Row>(sql`
    select d.id, d.number, d.status, d.email, d.currency, d.order_id, d.expires_at, d.created_at, d.created_at::text as created_key, d.updated_at,
      (select name from commerce.customers c where c.store_id = d.store_id and c.id = d.customer_id) as customer_name,
      (select count(*)::int from commerce.draft_order_lines l where l.store_id = d.store_id and l.draft_id = d.id) as line_count,
      o.number as order_number, o.total_minor as order_total
    from commerce.draft_orders d
    left join commerce.orders o on o.store_id = d.store_id and o.id = d.order_id
    where d.store_id = ${storeId}::uuid
      ${options.status ? sql`and d.status = ${options.status}` : sql``}
      ${cursor ? sql`and (d.created_at, d.id) < (${cursor.createdAt}::timestamptz, ${cursor.id}::uuid)` : sql``}
    order by d.created_at desc, d.id desc
    limit ${pageSize + 1}
  `);
  const page = rows.slice(0, pageSize);
  const [open] = await db().execute<Row>(sql`select count(*)::int as n from commerce.draft_orders where store_id = ${storeId}::uuid and status = 'open'`);
  const items: DraftListRow[] = [];
  for (const row of page) {
    let total: number | null = row.order_total === null || row.order_total === undefined ? null : Number(row.order_total);
    // A draft that has not been sent has no order to read a total from: it is priced from its lines as saved.
    if (total === null && Number(row.line_count) > 0 && row.status === "open") {
      const computed = await computeDraft(db(), storeId, String(row.id)).catch(() => null);
      total = computed?.pricing?.ok || computed?.pricing?.totalMinor ? (computed?.pricing?.totalMinor ?? null) : null;
    }
    items.push({
      id: String(row.id),
      number: String(row.number),
      status: row.status as DraftStatus,
      customer: row.customer_name ? String(row.customer_name) : null,
      email: row.email ? String(row.email) : null,
      currency: String(row.currency).trim(),
      totalMinor: total,
      orderId: row.order_id ? String(row.order_id) : null,
      orderNumber: row.order_number ? String(row.order_number) : null,
      expiresAt: row.expires_at ? new Date(String(row.expires_at)).toISOString() : null,
      createdAt: new Date(String(row.created_at)).toISOString(),
      updatedAt: new Date(String(row.updated_at)).toISOString(),
      lineCount: Number(row.line_count),
    });
  }
  const last = page[page.length - 1];
  return { rows: items, nextCursor: rows.length > pageSize && last ? encodeDraftCursor(String(last.created_key), String(last.id)) : null, openCount: Number(open?.n ?? 0) };
}

// ---------------------------------------------------------------------------------------------------------------------
// The market of a draft, and its variants
// ---------------------------------------------------------------------------------------------------------------------

async function marketOf(store: EmailStore, slug: string): Promise<Market | null> {
  return findMarket(store.markets, slug, { locales: store.localization.locales, conversion: (from, to) => conversionFor(store.localization, from, to) });
}

/** What a goods line needs of its variant, read for the draft's market. */
type VariantFacts = {
  variantId: string;
  productId: string;
  sku: string;
  title: string;
  options: Record<string, string>;
  /** Product active, variant active, goods that are shipped, not a host's, sold in the market. */
  sellable: boolean;
  /** The market's list price as shown (`shown()`), null when the variant has no price there. */
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
  if (variantIds.length === 0) return out;
  const rows = await runner.execute<Row>(sql`
    select v.id, v.sku, v.options, v.delivery, v.active, v.cost_minor, v.measure_amount, v.measure_unit, v.measure_base, v.stock_policy, v.backorder_days,
      p.id as product_id, p.status, p.kind, p.host_id, p.subscription_only, p.withdrawal_exclusion, coalesce(v.tax_code, p.tax_code) as tax_code,
      commerce.vat_rate(${market.code}, p.vat_category) as vat_rate, cp.amount_minor,
      coalesce(tl.title, tf.title, p.handle) as title, coalesce(va.in_stock, 0) as in_stock
    from commerce.product_variants v
    join commerce.products p on p.store_id = v.store_id and p.id = v.product_id
    left join commerce.product_translations tl on tl.product_id = p.id and tl.locale = ${market.locale}
    left join lateral (select title from commerce.product_translations where product_id = p.id order by locale limit 1) tf on true
    left join commerce.current_prices cp on cp.variant_id = v.id and cp.market_code = ${market.code}
    left join commerce.variant_availability va on va.store_id = v.store_id and va.variant_id = v.id
    where v.store_id = ${storeId}::uuid and v.id = any(${uuidList(variantIds)})
  `);
  const messages = t(market.lang);
  for (const row of rows) {
    const options = (row.options ?? {}) as Record<string, string>;
    const title = Object.keys(options).length > 0 ? `${row.title} (${variantLabel(shownOptions(messages, options))})` : String(row.title);
    out.set(String(row.id), {
      variantId: String(row.id),
      productId: String(row.product_id),
      sku: String(row.sku),
      title: [...title].slice(0, DRAFT_LINE_TITLE_COLUMN_MAX).join(""),
      options,
      sellable:
        row.status === "active" && Boolean(row.active) && row.kind === "goods" && row.delivery === "physical" && !row.host_id && !row.subscription_only && row.amount_minor !== null,
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

// ---------------------------------------------------------------------------------------------------------------------
// Pricing a draft: the one place
// ---------------------------------------------------------------------------------------------------------------------

/** One line as the summary shows it: what the order line will carry. */
export type DraftSummaryLine = {
  id: string;
  title: string;
  sku: string;
  quantity: number;
  unitPriceMinor: number;
  listPriceMinor: number | null;
  customPrice: boolean;
  goodsMinor: number;
  staffDiscountMinor: number;
  totalMinor: number;
  taxMinor: number;
  rate: number;
  /** What is in one unit (D160), so the editor can show the price per kg or litre with `unitPriceShown()`; null for a custom item and for goods with no content. */
  measure: ShownMeasure | null;
  /** The market's list price now, when it differs from the one saved on a line that is at its list price (the line needs a save to take it). */
  currentListMinor: number | null;
  /** Units beyond stock, when the variant keeps selling on backorder, and the days the buyer is told. */
  backorder: { units: number; days: number } | null;
};

export type DraftSummary = {
  lines: DraftSummaryLine[];
  subtotalMinor: number;
  shippingMinor: number;
  staffDiscountMinor: number;
  staffDiscountLabel: string | null;
  taxMinor: number;
  totalMinor: number;
  vatPerRate: { rate: number; taxMinor: number; goodsMinor: number }[];
  currency: string;
};

export type DraftComputation = {
  draft: DraftView;
  store: EmailStore;
  market: Market | null;
  pricing: DraftPricing<TaxOutcome> | null;
  summary: DraftSummary | null;
  problems: DraftProblem[];
  /** Catalogue lines at their list price whose list price has moved since the line was saved: a send is refused until the draft is saved again. */
  stale: string[];
  variants: Map<string, VariantFacts>;
  /** Units beyond stock per variant, as `allocateStock()` would give them (only filled by a send). */
  ships: boolean;
};

/**
 * Prices a draft from what is saved: its lines at the prices saved on them, the staff discount, the shipping choice, the VAT through the checkout's own `decideTax()`. Reads only (it holds no stock and uses
 * no number). The problems are the pure ones of `priceDraft()` and `draftProblems()` and what only the database knows (a variant gone, the stock, the market). Called by the editor's preview, by the list, by
 * `placeDraftOrder()` inside its transaction (so what is sent is what was priced) and by the AI manager.
 */
export async function computeDraft(runner: Runner, storeId: string, draftId: string): Promise<DraftComputation | null> {
  const draft = await getDraft(storeId, draftId, runner);
  if (!draft) return null;
  const store = await storeById(storeId);
  if (!store) return null;
  const market = await marketOf(store, draft.marketSlug);
  const problems: DraftProblem[] = [];
  const empty = (): DraftComputation => ({ draft, store, market, pricing: null, summary: null, problems, stale: [], variants: new Map(), ships: false });
  if (!market) {
    problems.push(problemOf("market_gone"));
    return empty();
  }
  const variants = await variantFacts(runner, storeId, market, draft.lines.flatMap((l) => (l.variantId ? [l.variantId] : [])));
  const stale: string[] = [];
  const pricedLines: PricedLineInput[] = [];
  for (const line of draft.lines) {
    if (line.kind === "goods") {
      const facts = variants.get(line.variantId!);
      if (!facts || !facts.sellable) problems.push(problemOf("variant_unavailable", line.id));
      // At its list price and the list price has moved: the line needs a save to take it.
      if (facts?.listMinor != null && !line.customPrice && facts.listMinor !== line.unitPriceMinor) stale.push(line.id);
      pricedLines.push({ key: line.id, kind: "goods", unitPriceMinor: line.unitPriceMinor, quantity: line.quantity, rate: facts?.rate ?? 0, physical: true });
    } else {
      const [vat] = await runner.execute<Row>(sql`select commerce.vat_rate(${market.code}, ${line.vatCategory}) as rate`);
      pricedLines.push({ key: line.id, kind: "custom", unitPriceMinor: line.unitPriceMinor, quantity: line.quantity, rate: Number(vat?.rate ?? 0), physical: false });
    }
  }
  const ships = pricedLines.some((l) => l.physical);
  const [rate] = await runner.execute<Row>(sql`select amount_minor, free_over_minor from commerce.shipping_rates where store_id = ${storeId}::uuid and market_code = ${market.code}`);
  const flat = rate ? { amountMinor: shown(market, Number(rate.amount_minor)), freeOverMinor: rate.free_over_minor === null ? null : shown(market, Number(rate.free_over_minor)) } : null;
  const facts = await loadTaxFacts(runner, { storeId, market, cartId: null });
  const discount = draft.discount
    ? draft.discount.kind === "percent"
      ? { kind: "percent" as const, bps: parsePercentBps(draft.discount.value) ?? 0, label: draft.discount.label }
      : { kind: "amount" as const, minor: parsePrice(draft.discount.value, draft.currency) ?? 0, label: draft.discount.label }
    : null;
  const pricing = priceDraft(
    {
      lines: pricedLines,
      discount,
      shipping:
        draft.shipping.kind === "custom"
          ? { kind: "custom", amountMinor: parsePrice(draft.shipping.price ?? "", draft.currency) ?? -1 }
          : draft.shipping.kind === "free"
            ? { kind: "free" }
            : { kind: "rate", rate: flat },
      currency: market.currency,
    },
    (basket) => decideTax(facts, basket),
  );
  problems.push(...pricing.problems);
  problems.push(
    ...draftProblems({
      email: draft.email,
      shippingAddress: draft.shippingAddress as Record<string, unknown>,
      ships,
      marketCode: market.code,
      customItems: draft.lines.some((l) => l.kind === "custom"),
      business: Boolean(draft.companyName && draft.companyName.trim() !== ""),
    }),
  );

  // Stock: the draft holds none while it is open, so it only warns; a send allocates for real.
  const wanted = new Map<string, number>();
  for (const line of draft.lines) if (line.variantId) wanted.set(line.variantId, (wanted.get(line.variantId) ?? 0) + line.quantity);
  const behind = new Map<string, number>();
  for (const [variantId, quantity] of wanted) {
    const f = variants.get(variantId);
    if (!f || !f.sellable) continue;
    const short = Math.max(0, quantity - Math.max(0, f.inStock));
    if (short === 0) continue;
    if (f.policy === "continue" && f.backorderDays) behind.set(variantId, short);
    else {
      for (const line of draft.lines) if (line.variantId === variantId) problems.push(problemOf("stock_short", line.id));
    }
  }
  const backorderOf = new Map<string, { units: number; days: number }>();
  const left = new Map(behind);
  for (const line of draft.lines) {
    if (!line.variantId) continue;
    const units = left.get(line.variantId) ?? 0;
    const give = Math.min(units, line.quantity);
    if (give > 0) {
      backorderOf.set(line.id, { units: give, days: variants.get(line.variantId)?.backorderDays ?? 0 });
      problems.push(problemOf("backorder", line.id));
      left.set(line.variantId, units - give);
    }
  }
  const priced = new Map(pricing.lines.map((l) => [l.key, l]));
  const summary: DraftSummary | null =
    pricing.lines.length === 0
      ? null
      : {
          currency: draft.currency,
          lines: draft.lines.map((line) => {
            const p = priced.get(line.id)!;
            const f = line.variantId ? variants.get(line.variantId) : undefined;
            return {
              id: line.id,
              title: line.title,
              sku: line.sku,
              quantity: line.quantity,
              unitPriceMinor: line.unitPriceMinor,
              listPriceMinor: line.listPriceMinor,
              customPrice: line.customPrice,
              goodsMinor: p.goodsMinor,
              staffDiscountMinor: p.staffDiscountMinor,
              totalMinor: p.totalMinor,
              taxMinor: p.taxMinor,
              rate: p.rate,
              measure: f?.measure ?? null,
              currentListMinor: stale.includes(line.id) ? (f?.listMinor ?? null) : null,
              backorder: backorderOf.get(line.id) ?? null,
            };
          }),
          subtotalMinor: pricing.subtotalMinor,
          shippingMinor: pricing.shippingMinor,
          staffDiscountMinor: pricing.staffDiscountMinor,
          staffDiscountLabel: pricing.staffDiscountLabel,
          taxMinor: pricing.taxMinor,
          totalMinor: pricing.totalMinor,
          vatPerRate: pricing.vatPerRate.map((r) => ({ rate: r.rate, taxMinor: r.taxMinor, goodsMinor: "goodsMinor" in r ? Number((r as { goodsMinor: number }).goodsMinor) : 0 })),
        };
  for (const id of stale) problems.push(problemOf("price_changed", id));
  return { draft, store, market, pricing, summary, problems, stale, variants, ships };
}

/** What the editor shows beside the draft: the summary and the problems in code form (the words are `draftProblemText()`). The same pricing the send uses. */
export type DraftPreview = {
  draft: DraftView;
  summary: DraftSummary | null;
  problems: DraftProblem[];
  /** A send would be refused for these (the blocking ones, and a list price that moved). */
  blocking: DraftProblem[];
  market: { slug: string; code: string; currency: string; locale: string; lang: string; name: string } | null;
};

export async function previewDraft(storeId: string, draftId: string): Promise<DraftPreview | null> {
  const computed = await computeDraft(db(), storeId, draftId);
  if (!computed) return null;
  const market = computed.market;
  return {
    draft: computed.draft,
    summary: computed.summary,
    problems: computed.problems,
    blocking: [...blockingProblems(computed.problems), ...computed.stale.map((key) => ({ code: "price_changed" as const, key, blocking: true }))],
    market: market ? { slug: market.slug, code: market.code, currency: market.currency, locale: market.locale, lang: market.lang, name: market.name } : null,
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Making and saving a draft
// ---------------------------------------------------------------------------------------------------------------------

export type DraftFieldProblem = { field: string; message: string };

export type CreateDraftResult = { ok: true; draft: DraftView } | { ok: false; problem: "too_many_open_drafts" | "market" };

/** Makes an empty draft in a market (the store's own market view unless one is given). Refused at 500 open drafts. */
export async function createDraft(storeId: string, actor: OrderActor, options: { marketSlug?: string } = {}): Promise<CreateDraftResult> {
  const store = await storeById(storeId);
  if (!store) return { ok: false, problem: "market" };
  const market = options.marketSlug ? await marketOf(store, options.marketSlug) : store.markets[0];
  if (!market) return { ok: false, problem: "market" };
  const id = await db().transaction(async (tx) => {
    // The store's settings row is the lock of the open count and of the counter: two staff making a draft at once take turns.
    await tx.execute(sql`insert into commerce.order_settings (store_id) values (${storeId}::uuid) on conflict (store_id) do nothing`);
    await tx.execute(sql`select 1 from commerce.order_settings where store_id = ${storeId}::uuid for update`);
    const [open] = await tx.execute<Row>(sql`select count(*)::int as n from commerce.draft_orders where store_id = ${storeId}::uuid and status = 'open'`);
    if (Number(open?.n ?? 0) >= DRAFTS_OPEN_MAX) return null;
    const [row] = await tx.execute<Row>(sql`
      insert into commerce.draft_orders (store_id, number, market_code, market_slug, currency, locale, created_by)
      values (${storeId}::uuid, commerce.next_draft_number(${storeId}::uuid), ${market.code}, ${market.slug}, ${market.currency}, ${market.locale}, ${actor.accountId}::uuid)
      returning id
    `);
    return String(row.id);
  });
  if (!id) return { ok: false, problem: "too_many_open_drafts" };
  await audit(actor.accountId, storeId, ORDER_AUDIT_ACTIONS.draftCreated, {}, { target: { type: "draft_order", id } });
  return { ok: true, draft: (await getDraft(storeId, id))! };
}

export type SaveDraftResult =
  | {
      ok: true;
      draft: DraftView;
      /** The market was changed: the catalogue lines at their list price that took the new market's, the lines whose typed price stayed as typed (now in the new currency), and lines the new market does not sell. */
      marketChange: { changed: { lineId: string; from: number; to: number }[]; kept: string[]; unavailable: string[] } | null;
    }
  | { ok: false; problem: "not_found" | "not_open" | "conflict" | "market" | "invalid"; fields?: DraftFieldProblem[] };

/**
 * Saves the editor's whole draft (`draftInput`, validated again here: the browser's check is a convenience). Needs the version the editor loaded. The catalogue lines are read again: a line with no typed price
 * is at the market's list price as shown now, a typed price is the price charged (VAT included, the draft's currency, 0 or more); a custom item has its own title, price and VAT category. Changing the market
 * re-prices the list-priced lines at the new market's and says which. Nothing is held and no number is used.
 */
export async function saveDraft(storeId: string, actor: OrderActor, draftId: string, raw: unknown): Promise<SaveDraftResult> {
  const parsed = draftInput.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, problem: "invalid", fields: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })) };
  }
  const input: DraftInput = parsed.data;
  const store = await storeById(storeId);
  const market = store ? await marketOf(store, input.marketSlug) : null;
  if (!store || !market) return { ok: false, problem: "market" };
  const fields: DraftFieldProblem[] = [];
  const problem = (field: string, message: string) => void fields.push({ field, message });

  // Tags, the discount, the shipping price and the company, checked as the checkout and the editor check them.
  const tags = tagsOf(input.tags);
  if (tags.problems.length > 0) problem("tags", `The tag “${tags.problems[0].input}” is not valid.`);
  let discountRow: { kind: "percent" | "amount"; value: number; label: string } | null = null;
  if (input.discount) {
    const value = input.discount.kind === "percent" ? parsePercentBps(input.discount.value) : parsePrice(input.discount.value, market.currency);
    if (value === null || value <= 0) problem("discount", input.discount.kind === "percent" ? "A percent from 0.01 to 100." : "An amount above 0.");
    else discountRow = { kind: input.discount.kind, value, label: input.discount.label };
  }
  let shippingMinor: number | null = null;
  if (input.shipping.kind === "custom") {
    shippingMinor = parsePrice(input.shipping.price, market.currency);
    if (shippingMinor === null) problem("shipping", "Set the shipping price as an amount.");
  }
  let org = input.organisationNumber;
  if (input.companyName || org) {
    if (!input.companyName || !org) problem("organisationNumber", "A company needs its name and its organisation number.");
    else {
      const checked = organisationNumber(market.code, org);
      if (checked === null) problem("organisationNumber", "That is not a valid organisation number.");
      else org = checked;
    }
  }
  if (input.customerId) {
    const [known] = await db().execute<Row>(sql`select 1 from commerce.customers where store_id = ${storeId}::uuid and id = ${input.customerId}::uuid`);
    if (!known) problem("customerId", "That customer does not exist.");
  }

  // The lines: each catalogue line is read for the market now; a custom item names a VAT category that exists.
  const variantIds = input.lines.flatMap((l) => (l.kind === "goods" && l.variantId ? [l.variantId] : []));
  const facts = await variantFacts(db(), storeId, market, variantIds);
  const categories = new Set(
    (await db().execute<Row>(sql`select code from commerce.vat_categories`)).map((r) => String(r.code)),
  );
  const rows: { id: string | null; kind: "goods" | "custom"; variantId: string | null; title: string; sku: string; quantity: number; unit: number; list: number | null; category: string | null; delivery: "physical" | "service" }[] = [];
  input.lines.forEach((line, i) => {
    const at = `lines.${i}`;
    const typed = line.price && line.price.trim() !== "" ? parsePrice(line.price, market.currency) : null;
    if (line.price && line.price.trim() !== "" && typed === null) problem(`${at}.price`, "A price is an amount, VAT included.");
    if (line.kind === "goods") {
      const f = facts.get(line.variantId!);
      if (!f || !f.sellable || f.listMinor === null) {
        problem(`${at}.variantId`, "This product is not for sale in this market.");
        return;
      }
      rows.push({ id: line.id ?? null, kind: "goods", variantId: f.variantId, title: f.title, sku: f.sku, quantity: line.quantity, unit: typed ?? f.listMinor, list: f.listMinor, category: null, delivery: "physical" });
    } else {
      if (!line.vatCategory || !categories.has(line.vatCategory)) problem(`${at}.vatCategory`, "Choose a VAT category.");
      if (typed === null) problem(`${at}.price`, "A custom item needs a price.");
      rows.push({
        id: line.id ?? null,
        kind: "custom",
        variantId: null,
        title: [...line.title.trim()].slice(0, 120).join(""),
        sku: "CUSTOM",
        quantity: line.quantity,
        unit: typed ?? 0,
        list: null,
        category: line.vatCategory ?? null,
        delivery: "service",
      });
    }
  });
  if (fields.length > 0) return { ok: false, problem: "invalid", fields };

  return db().transaction(async (tx): Promise<SaveDraftResult> => {
    const [locked] = await tx.execute<Row>(sql`select id, status, version, market_slug, currency from commerce.draft_orders where store_id = ${storeId}::uuid and id = ${draftId}::uuid for update`);
    if (!locked) return { ok: false, problem: "not_found" };
    if (locked.status !== "open") return { ok: false, problem: "not_open" };
    if (Number(locked.version) !== input.version) return { ok: false, problem: "conflict" };
    // Changing the market: what happened to the prices (the new values are the ones the lines were just read at).
    let marketChange: Extract<SaveDraftResult, { ok: true }>["marketChange"] = null;
    if (String(locked.market_slug) !== market.slug) {
      const before = await tx.execute<Row>(sql`select ${LINE_COLUMNS} from commerce.draft_order_lines where store_id = ${storeId}::uuid and draft_id = ${draftId}::uuid`);
      const prior = before.map(lineOf);
      const listPrices: Record<string, number | null> = {};
      const nowFacts = await variantFacts(tx, storeId, market, prior.flatMap((l) => (l.variantId ? [l.variantId] : [])));
      for (const line of prior) if (line.variantId) listPrices[line.id] = nowFacts.get(line.variantId)?.listMinor ?? null;
      const re = repriceForMarket(prior.map((l) => ({ key: l.id, kind: l.kind, unitPriceMinor: l.unitPriceMinor, listPriceMinor: l.listPriceMinor })), listPrices);
      marketChange = { changed: re.changed.map((c) => ({ lineId: c.key, from: c.from, to: c.to })), kept: re.kept, unavailable: re.unavailable };
    }
    const [row] = await tx.execute<Row>(sql`
      update commerce.draft_orders set
        market_code = ${market.code}, market_slug = ${market.slug}, currency = ${market.currency}, locale = ${market.locale},
        customer_id = ${input.customerId ?? null}::uuid, email = ${input.email}, phone = ${input.phone},
        shipping_address = ${JSON.stringify(addressJson(input.shippingAddress))}::jsonb, billing_address = ${JSON.stringify(addressJson(input.billingAddress))}::jsonb,
        company_name = ${input.companyName}, organisation_number = ${org},
        note_to_buyer = ${input.noteToBuyer}, internal_note = ${input.internalNote}, tags = ${JSON.stringify(tags.tags.map((tag) => tag.label))}::jsonb,
        discount_kind = ${discountRow?.kind ?? null}, discount_value = ${discountRow?.value ?? null}, discount_label = ${discountRow ? discountRow.label || DEFAULT_DISCOUNT_LABEL : null},
        shipping_kind = ${input.shipping.kind}, shipping_minor = ${shippingMinor},
        version = version + 1, edited_at = now(), updated_at = now()
      where store_id = ${storeId}::uuid and id = ${draftId}::uuid
      returning id
    `);
    if (!row) return { ok: false, problem: "not_found" };
    await tx.execute(sql`delete from commerce.draft_order_lines where store_id = ${storeId}::uuid and draft_id = ${draftId}::uuid`);
    for (const [position, line] of rows.entries()) {
      await tx.execute(sql`
        insert into commerce.draft_order_lines (store_id, draft_id, position, variant_id, title, sku, quantity, unit_price_minor, list_price_minor, vat_category, delivery)
        values (${storeId}::uuid, ${draftId}::uuid, ${position}, ${line.variantId}::uuid, ${line.title}, ${line.sku}, ${line.quantity}, ${line.unit}, ${line.list}, ${line.category}, ${line.delivery})
      `);
    }
    return { ok: true, draft: (await getDraft(storeId, draftId, tx))!, marketChange };
  });
}

/** Deletes a draft that is not sent (an open one, or one that ended). A sent draft is reopened first. */
export async function deleteDraft(storeId: string, actor: OrderActor, draftId: string): Promise<{ ok: true } | { ok: false; problem: "not_found" | "sent" }> {
  const done = await db().transaction(async (tx): Promise<"ok" | "not_found" | "sent"> => {
    const [row] = await tx.execute<Row>(sql`select status from commerce.draft_orders where store_id = ${storeId}::uuid and id = ${draftId}::uuid for update`);
    if (!row) return "not_found";
    if (!isDraftDeletable(row.status as DraftStatus)) return "sent";
    await tx.execute(sql`delete from commerce.draft_orders where store_id = ${storeId}::uuid and id = ${draftId}::uuid`);
    return "ok";
  });
  if (done !== "ok") return { ok: false, problem: done };
  await audit(actor.accountId, storeId, ORDER_AUDIT_ACTIONS.draftDeleted, {}, { target: { type: "draft_order", id: draftId } });
  return { ok: true };
}

// ---------------------------------------------------------------------------------------------------------------------
// The pickers of the editor
// ---------------------------------------------------------------------------------------------------------------------

export type DraftVariantChoice = { variantId: string; productTitle: string; sku: string; options: string; listPriceMinor: number; inStock: number };

/** Goods a draft can sell in a market, found by title or SKU (10 at most): active, shipped, not a host's, priced there. Never a download, subscription, appointment, stay or rental. */
export async function searchDraftVariants(storeId: string, marketSlug: string, query: string, limit = 10): Promise<DraftVariantChoice[]> {
  const store = await storeById(storeId);
  const market = store ? await marketOf(store, marketSlug) : null;
  const q = query.trim().slice(0, 80);
  if (!store || !market || q.length < 2) return [];
  const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const rows = await db().execute<Row>(sql`
    select v.id, v.sku, v.options, cp.amount_minor, coalesce(tl.title, tf.title, p.handle) as title, coalesce(va.in_stock, 0) as in_stock
    from commerce.product_variants v
    join commerce.products p on p.store_id = v.store_id and p.id = v.product_id
    join commerce.current_prices cp on cp.variant_id = v.id and cp.market_code = ${market.code}
    left join commerce.product_translations tl on tl.product_id = p.id and tl.locale = ${market.locale}
    left join lateral (select title from commerce.product_translations where product_id = p.id order by locale limit 1) tf on true
    left join commerce.variant_availability va on va.store_id = v.store_id and va.variant_id = v.id
    where v.store_id = ${storeId}::uuid and p.status = 'active' and v.active and p.kind = 'goods' and v.delivery = 'physical' and p.host_id is null and not p.subscription_only
      and (lower(v.sku) like lower(${like}) or lower(coalesce(tl.title, tf.title, p.handle)) like lower(${like}))
    order by title, v.sku
    limit ${limit}
  `);
  const messages = t(market.lang);
  return rows.map((row) => ({
    variantId: String(row.id),
    productTitle: String(row.title),
    sku: String(row.sku),
    options: variantLabel(shownOptions(messages, (row.options ?? {}) as Record<string, string>)),
    listPriceMinor: shown(market, Number(row.amount_minor)),
    inStock: Number(row.in_stock ?? 0),
  }));
}

export type DraftCustomerChoice = { id: string; name: string; email: string };

/** Customers found by name or email, for the picker (name and email only; 10 at most). Needs nothing beyond `orders:write`. */
export async function searchDraftCustomers(storeId: string, query: string, limit = 10): Promise<DraftCustomerChoice[]> {
  const q = query.trim().slice(0, 80);
  if (q.length < 2) return [];
  const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const rows = await db().execute<Row>(sql`
    select id, name, email from commerce.customers
    where store_id = ${storeId}::uuid and (lower(email) like lower(${like}) or lower(name) like lower(${like}))
    order by lower(email) limit ${limit}
  `);
  return rows.map((r) => ({ id: String(r.id), name: String(r.name ?? ""), email: String(r.email) }));
}

/** What choosing a customer fills in: their name, email, phone, address and company, as they keep them. Null for a customer that is not this store's. */
export async function draftCustomerDetails(storeId: string, customerId: string): Promise<{ email: string; phone: string | null; shippingAddress: DraftAddress; companyName: string | null; organisationNumber: string | null } | null> {
  if (!/^[0-9a-f-]{36}$/i.test(customerId)) return null;
  const [row] = await db().execute<Row>(sql`select name, email, phone, address, company_name, organisation_number from commerce.customers where store_id = ${storeId}::uuid and id = ${customerId}::uuid`);
  if (!row) return null;
  const address = addressOf({ ...(row.address as object), name: (row.address as Record<string, unknown> | null)?.name ?? row.name });
  return {
    email: String(row.email),
    phone: row.phone ? String(row.phone) : null,
    shippingAddress: address,
    companyName: row.company_name ? String(row.company_name) : null,
    organisationNumber: row.organisation_number ? String(row.organisation_number) : null,
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Sending: the draft becomes an order
// ---------------------------------------------------------------------------------------------------------------------

/** A new pay token and its hash: 32 random bytes, base64url; only the SHA-256 (hex) is kept. */
export function newPayToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashPayToken(token) };
}
export const hashPayToken = (token: string): string => createHash("sha256").update(token).digest("hex");

export type PlaceDraftResult =
  | { ok: true; orderId: string; number: string; expiresAt: string }
  | { ok: false; problems: DraftProblem[]; /** The draft is not open (it was sent or deleted meanwhile). */ notOpen?: true };

/**
 * Makes the order of an open draft, inside the caller's transaction (the draft row is locked first): the store is open, the draft is priced again here (so what is sent is what was priced), the stock
 * is allocated under row locks exactly as `placeOrder()` does it (a variant that stops at zero fails with `stock_short`, one on backorder is sold with the days stated), the order is inserted and numbered by
 * the one shared insert (`order-insert.ts`, `source = 'draft'`, the staff discount on it and on its lines), its lines are written, the stock is held until `expiresAt`, the tags are carried to the
 * order, the order's history says `order.placed` by staff with the draft's number, and the draft becomes `sent` with the order, the times and the pay token's hash. A refusal writes nothing.
 */
export async function placeDraftOrder(
  tx: Db,
  input: { storeId: string; draftId: string; actor: OrderActor; validDays: number; tokenHash: string | null },
): Promise<PlaceDraftResult> {
  const { storeId, draftId, actor } = input;
  const [locked] = await tx.execute<Row>(sql`select status, created_by from commerce.draft_orders where store_id = ${storeId}::uuid and id = ${draftId}::uuid for update`);
  if (!locked || locked.status !== "open") return { ok: false, problems: [], notOpen: true };
  const [open] = await tx.execute<Row>(sql`select commerce.store_is_active(${storeId}::uuid) as open`);
  if (!open?.open) return { ok: false, problems: [problemOf("store_closed")] };
  const computed = await computeDraft(tx, storeId, draftId);
  if (!computed || !computed.market || !computed.pricing) return { ok: false, problems: computed?.problems ?? [problemOf("market_gone")] };
  const blocking = [...blockingProblems(computed.problems), ...computed.stale.map((key) => ({ code: "price_changed" as const, key, blocking: true }))];
  if (blocking.length > 0 || !computed.pricing.ok) return { ok: false, problems: blocking.length > 0 ? blocking : computed.problems };
  const { draft, market, pricing, variants } = computed;

  // The stock: the same allocation a checkout makes. A draft's variants that stop at zero fail here; a backordered remainder is sold with its days.
  const goods = draft.lines.filter((l) => l.kind === "goods");
  const keeps = [...new Set(goods.filter((l) => variants.get(l.variantId!)?.policy === "continue").map((l) => l.variantId!))];
  const plan = await allocateStock(
    tx,
    storeId,
    goods.map((l) => ({ variantId: l.variantId!, quantity: l.quantity, policy: variants.get(l.variantId!)?.policy ?? "deny" })),
    keeps,
  );
  if (!plan.ok) return { ok: false, problems: [problemOf("stock_short")] };
  const behind = new Map(plan.behind);
  const backorderOfLine = new Map<string, number>();
  for (const line of goods) {
    const left = behind.get(line.variantId!) ?? 0;
    const give = Math.min(left, line.quantity);
    if (give > 0) backorderOfLine.set(line.id, give);
    behind.set(line.variantId!, left - give);
  }

  // Who pays for sending a withdrawn item back, and the cheapest standard delivery (D153): as the store's settings and flat rate stand now.
  const [returnRules] = await tx.execute<Row>(sql`select who_pays_return from commerce.return_settings where store_id = ${storeId}::uuid`);
  const [rate] = await tx.execute<Row>(sql`select amount_minor, free_over_minor from commerce.shipping_rates where store_id = ${storeId}::uuid and market_code = ${market.code}`);
  const flatShipping = rate
    ? rateShipping(
        draft.lines.map((l) => ({ key: l.id, kind: l.kind, unitPriceMinor: l.unitPriceMinor, quantity: l.quantity, rate: 0, physical: l.kind === "goods" })),
        draft.lines.map((l) => l.unitPriceMinor * l.quantity),
        { amountMinor: shown(market, Number(rate.amount_minor)), freeOverMinor: rate.free_over_minor === null ? null : shown(market, Number(rate.free_over_minor)) },
      )
    : null;
  const ships = computed.ships;
  const standardShipping = ships ? flatShipping : 0;
  const expiresAt = new Date(Date.now() + input.validDays * 24 * 60 * 60 * 1000);
  const outcome = pricing.tax!;
  const staffActorId = actor.accountId;
  if (!staffActorId) return { ok: false, problems: [] };

  const { orderId, number } = await insertOrder(tx, {
    storeId,
    marketCode: market.code,
    currency: market.currency,
    locale: market.locale,
    email: draft.email ?? "",
    subtotalMinor: pricing.subtotalMinor,
    shippingMinor: pricing.shippingMinor,
    discountMinor: pricing.discountMinor,
    taxMinor: pricing.taxMinor,
    totalMinor: pricing.totalMinor,
    billingAddress: { ...addressJson(draft.billingAddress), ...(draft.phone ? { phone: draft.phone } : {}) },
    shippingAddress: addressJson(draft.shippingAddress),
    customerId: draft.customerId,
    companyName: draft.companyName,
    organisationNumber: draft.organisationNumber,
    returnCostPayer: returnRules?.who_pays_return === "store" ? "store" : "shopper",
    standardShippingMinor: standardShipping,
    vatKind: outcome.decision.kind,
    vatReliefMinor: outcome.reliefMinor,
    shippingTaxRate: outcome.shippingRate,
    vatTreatment: outcome.treatment,
    draft: { id: draftId, madeBy: staffActorId },
    staffDiscountMinor: pricing.staffDiscountMinor,
    staffDiscountLabel: pricing.staffDiscountLabel,
  });
  const priced = new Map(pricing.lines.map((l) => [l.key, l]));
  for (const line of draft.lines) {
    const p = priced.get(line.id)!;
    const f = line.variantId ? variants.get(line.variantId) : undefined;
    const backordered = backorderOfLine.get(line.id) ?? 0;
    await insertOrderLine(tx, storeId, orderId, {
      variantId: line.variantId,
      sku: line.sku,
      title: line.title,
      quantity: line.quantity,
      unitPriceMinor: line.unitPriceMinor,
      discountMinor: p.discountMinor,
      totalMinor: p.totalMinor,
      taxMinor: p.taxMinor,
      taxRate: p.rate,
      taxCode: f?.taxCode ?? GENERAL_TAX_CODE,
      // A catalogue line is withdrawn as the product says; a custom item is a service line with no exclusion of its own: `lineEligibility()` decides what that means (docs/wave-3-orders.md 4.7).
      withdrawalExclusion: f ? lineWithdrawal("physical", f.withdrawalExclusion) : "none",
      delivery: line.delivery,
      unitCostMinor: f?.costMinor ?? null,
      vatReliefMinor: p.reliefMinor,
      measure: f?.measure ? { amount: f.measure.amount, unit: f.measure.unit, base: f.measure.base } : null,
      backorderQuantity: backordered,
      backorderDays: backordered > 0 && f?.backorderDays ? f.backorderDays : null,
      listPriceMinor: line.listPriceMinor,
      custom: line.kind === "custom",
      staffDiscountMinor: p.staffDiscountMinor,
    });
  }
  // The hold lasts as long as the link: released by payment, by cancelling the order, or lapsed at the expiry (a lapsed hold stops counting, so a forgotten draft never holds stock).
  await reserveStock(tx, storeId, orderId, plan.holds as StockHold[], { at: expiresAt });
  await writeOrderEvent(tx, storeId, orderId, "order.placed", { draft: draft.number }, "staff");
  // The draft's tags become the order's (Shopify does the same).
  const labels = tagsOf(draft.tags).tags;
  if (labels.length > 0) await changeOrderTags(storeId, orderId, { add: labels }, actor, { runner: tx, audit: false });
  await tx.execute(sql`
    update commerce.draft_orders set status = 'sent', order_id = ${orderId}::uuid, sent_at = now(), expires_at = ${expiresAt.toISOString()}::timestamptz,
      valid_days = ${input.validDays}, pay_token_hash = ${input.tokenHash}, version = version + 1, updated_at = now()
    where store_id = ${storeId}::uuid and id = ${draftId}::uuid
  `);
  return { ok: true, orderId, number, expiresAt: expiresAt.toISOString() };
}

export type SendDraftResult =
  | {
      ok: true;
      orderId: string;
      number: string;
      expiresAt: string;
      /** The link to share, shown ONCE (only its hash is kept): set when the staff member asked for a link instead of an email. */
      link: string | null;
      /** What happened to the email: none for a shared link; a failure leaves the draft sent and staff may send again. */
      emailed: "sent" | "logged" | "failed" | "duplicate" | "suppressed" | null;
    }
  | { ok: false; problem: "not_found" | "not_open" | "conflict" | "invalid" | "closed" | "payments_off" | "limit" | "problems" | "market"; problems?: DraftProblem[] };

/** The link a buyer opens: `/s/{store}/{market}/account/pay/{token}`, on the store's own address. */
export function payLinkFor(store: Pick<EmailStore, "slug">, marketSlug: string, token: string): string {
  return `${storeSiteUrl(store.slug)}${marketPath(store.slug, marketSlug, `/account/pay/${token}`)}`;
}

/** The store's sends of a pay link in an hour (the abuse brake of a staff-typed address, `DRAFT_SENDS_PER_HOUR_STORE`): one atomic counter, `chat_usage` bucket `draft:send`. */
export async function takeStoreSend(storeId: string, limit: number): Promise<boolean> {
  const [row] = await db().execute<Row>(sql`
    insert into commerce.chat_usage (store_id, bucket, "window", count)
    values (${storeId}::uuid, 'draft:send', date_trunc('hour', now()), 1)
    on conflict (store_id, bucket, "window") do update set count = commerce.chat_usage.count + 1
    returning count
  `);
  return Number(row?.count ?? 0) <= limit;
}

/**
 * *Send to the customer*, or *Create a link to share*. Refused before anything is written: the store is not open, payments are off, the draft has problems (no email, no line, a variant that is not for sale, a
 * stock shortage, a list price that moved since the last save, a total of 0), the version is not the one the editor loaded, or the store has sent 60 links this hour. On success the order exists
 * (`pending_payment`, numbered, stock held until `expiresAt`) and the draft is `sent`; the email goes after the commit, so a failed email leaves the draft sent and says so (`emailed`).
 */
export async function sendDraft(storeId: string, actor: OrderActor, draftId: string, raw: unknown): Promise<SendDraftResult> {
  const parsed = draftSendInput.safeParse(raw);
  if (!parsed.success) return { ok: false, problem: "invalid" };
  const options = parsed.data;
  const draft = await getDraft(storeId, draftId);
  if (!draft) return { ok: false, problem: "not_found" };
  if (draft.status !== "open") return { ok: false, problem: "not_open" };
  if (draft.version !== options.version) return { ok: false, problem: "conflict" };
  const [open] = await db().execute<Row>(sql`select commerce.store_is_active(${storeId}::uuid) as open`);
  if (!open?.open) return { ok: false, problem: "closed" };
  const info = await getCheckoutInfo(storeId, draft.marketCode);
  if (!info.paymentsOn) return { ok: false, problem: "payments_off" };
  if (!(await takeStoreSend(storeId, DRAFT_SENDS_PER_HOUR_STORE))) return { ok: false, problem: "limit" };
  const settings = await getOrderSettings(storeId);
  const validDays = options.validDays ?? settings.draftValidDays;
  const { token, hash } = newPayToken();
  const placed = await db().transaction((tx) => placeDraftOrder(tx, { storeId, draftId, actor, validDays, tokenHash: hash }));
  if (!placed.ok) return placed.notOpen ? { ok: false, problem: "not_open" } : { ok: false, problem: "problems", problems: placed.problems };
  await audit(actor.accountId, storeId, ORDER_AUDIT_ACTIONS.draftSent, { draft: draft.number, share: options.createLink }, { target: { type: "draft_order", id: draftId } });

  const store = await storeById(storeId);
  const link = store ? payLinkFor(store, draft.marketSlug, token) : null;
  if (options.createLink) return { ok: true, orderId: placed.orderId, number: placed.number, expiresAt: placed.expiresAt, link, emailed: null };
  const { sendDraftLink } = await import("./draft-emails");
  const emailed = await sendDraftLink(storeId, draftId, token).catch(() => "failed" as const);
  return { ok: true, orderId: placed.orderId, number: placed.number, expiresAt: placed.expiresAt, link: null, emailed };
}

export type ResendResult =
  | { ok: true; link: string | null; emailed: "sent" | "logged" | "failed" | "duplicate" | "suppressed" | null }
  | { ok: false; problem: "not_found" | "not_sent" | "expired" | "limit" | "closed" };

/**
 * *Send again* and *Create a link to share* on a draft that is already sent: a NEW token replaces the old (the earlier link is dead), the validity is unchanged. A draft's link is sent at most 5 times a day
 * and the store's at most 60 an hour. `createLink` answers with the link (once) and sends no email.
 */
export async function resendDraftLink(storeId: string, actor: OrderActor, draftId: string, options: { createLink?: boolean } = {}): Promise<ResendResult> {
  const draft = await getDraft(storeId, draftId);
  if (!draft) return { ok: false, problem: "not_found" };
  if (draft.status !== "sent" || !draft.orderId) return { ok: false, problem: "not_sent" };
  if (draft.expiresAt && new Date(draft.expiresAt).getTime() <= Date.now()) return { ok: false, problem: "expired" };
  const [open] = await db().execute<Row>(sql`select commerce.store_is_active(${storeId}::uuid) as open`);
  if (!open?.open) return { ok: false, problem: "closed" };
  if (!(await takeStoreSend(storeId, DRAFT_SENDS_PER_HOUR_STORE))) return { ok: false, problem: "limit" };
  const { token, hash } = newPayToken();
  // The day's count: one statement, on the store's own day, so two clicks at once cannot both take the last send.
  const [taken] = await db().execute<Row>(sql`
    update commerce.draft_orders d set
      pay_token_hash = ${hash},
      pay_sends_today = case when d.pay_sent_on = (now() at time zone s.time_zone)::date then d.pay_sends_today + 1 else 1 end,
      pay_sent_on = (now() at time zone s.time_zone)::date, updated_at = now()
    from commerce.stores s
    where d.store_id = ${storeId}::uuid and d.id = ${draftId}::uuid and d.status = 'sent' and s.id = d.store_id
      and (d.pay_sent_on is distinct from (now() at time zone s.time_zone)::date or d.pay_sends_today < ${DRAFT_SENDS_PER_DAY})
    returning d.id
  `);
  if (!taken) return { ok: false, problem: "limit" };
  await audit(actor.accountId, storeId, ORDER_AUDIT_ACTIONS.draftSent, { draft: draft.number, again: true, share: Boolean(options.createLink) }, { target: { type: "draft_order", id: draftId } });
  const store = await storeById(storeId);
  const link = store ? payLinkFor(store, draft.marketSlug, token) : null;
  if (options.createLink) return { ok: true, link, emailed: null };
  const { sendDraftLink } = await import("./draft-emails");
  const emailed = await sendDraftLink(storeId, draftId, token, { again: true }).catch(() => "failed" as const);
  return { ok: true, link: null, emailed };
}

// ---------------------------------------------------------------------------------------------------------------------
// Reopening
// ---------------------------------------------------------------------------------------------------------------------

export type ReopenResult = { ok: true; draft: DraftView } | { ok: false; problem: "not_found" | "not_reopenable" | "paid" | "processing" | "changed" };

/**
 * *Reopen*: a sent draft (its Stripe session is closed first, and if it turns out paid or processing the draft is NOT reopened), an expired or a cancelled one becomes `open` with its contents. An unpaid order is
 * cancelled (its number stays on it, cancelled; its stock goes back) and the pay link dies. Sending the draft again makes a new order and a new number. Locks the ORDER first and then the draft (a payment
 * locks the order and then updates the draft, so this order of locks cannot deadlock with one).
 */
export async function reopenDraft(storeId: string, actor: OrderActor, draftId: string): Promise<ReopenResult> {
  const first = await getDraft(storeId, draftId);
  if (!first) return { ok: false, problem: "not_found" };
  if (!canReopenDraft(first.status)) return { ok: false, problem: "not_reopenable" };
  if (first.status === "sent" && first.orderId) {
    const settled = await settleOrderSessions(storeId, first.orderId);
    if (settled === "paid") return { ok: false, problem: "paid" };
    if (settled === "processing") return { ok: false, problem: "processing" };
  }
  const reopened = await db().transaction(async (tx): Promise<"ok" | "not_found" | "not_reopenable" | "changed"> => {
    const [pointer] = await tx.execute<Row>(sql`select order_id from commerce.draft_orders where store_id = ${storeId}::uuid and id = ${draftId}::uuid`);
    if (!pointer) return "not_found";
    if (pointer.order_id) await tx.execute(sql`select id from commerce.orders where store_id = ${storeId}::uuid and id = ${String(pointer.order_id)}::uuid for update`);
    const [draft] = await tx.execute<Row>(sql`select status, order_id from commerce.draft_orders where store_id = ${storeId}::uuid and id = ${draftId}::uuid for update`);
    if (!draft) return "not_found";
    if (!canReopenDraft(draft.status as DraftStatus)) return "not_reopenable";
    const orderId = draft.order_id ? String(draft.order_id) : null;
    // A draft whose payment arrived meanwhile has its order paid: it is not reopened (the order's own trigger made the draft paid in that transaction).
    if (orderId) {
      const [order] = await tx.execute<Row>(sql`select status from commerce.orders where store_id = ${storeId}::uuid and id = ${orderId}::uuid`);
      if (order && order.status !== "pending_payment" && order.status !== "cancelled") return "changed";
    }
    // The draft first (so the order's own trigger finds no draft naming it), then the order: cancelled, its stock released, its number kept.
    await tx.execute(sql`
      update commerce.draft_orders set status = 'open', order_id = null, sent_at = null, expires_at = null, paid_at = null, pay_token_hash = null,
        version = version + 1, updated_at = now(), edited_at = now()
      where store_id = ${storeId}::uuid and id = ${draftId}::uuid
    `);
    if (orderId) await tx.execute(sql`select commerce.cancel_unpaid_order(${orderId}::uuid, 'draft reopened')`);
    return "ok";
  });
  if (reopened !== "ok") return { ok: false, problem: reopened };
  await audit(actor.accountId, storeId, ORDER_AUDIT_ACTIONS.draftReopened, { draft: first.number }, { target: { type: "draft_order", id: draftId } });
  return { ok: true, draft: (await getDraft(storeId, draftId))! };
}

// ---------------------------------------------------------------------------------------------------------------------
// Paid outside Kaizen
// ---------------------------------------------------------------------------------------------------------------------

export type PaidOutsideResult =
  | { ok: true; orderId: string; number: string; emailed: "sent" | "logged" | "failed" | "duplicate" | "suppressed" | null; cashWarning?: boolean }
  | { ok: false; problem: "not_found" | "not_allowed" | "invalid" | "conflict" | "closed" | "no_email" | "already_paid" | "processing" | "not_payable" | "problems" | "received_on" | "cash_limit"; problems?: DraftProblem[] };

/** Thrown inside the transaction that records an outside payment, so what it placed (a draft's order) is rolled back with it. */
class OutsideRefused extends Error {
  constructor(readonly problem: "cash_limit") {
    super(problem);
  }
}

/**
 * Records money taken outside Kaizen (cash, bank transfer, other) for a draft that is open or sent. Who may: the owner, or staff when the owner allowed it (`mayRecordOutsidePayment()`). A draft with no email cannot be
 * paid this way (the confirmation, which states the right of withdrawal, goes to it and is not optional). One transaction: an open draft first becomes an order (as sending does, with no pay link and a validity of a day),
 * a `payments` row (`provider = 'manual'`, the method, `captured`, the order's whole total, no Kaizen fee, `recorded_by`) is written, `complete_order_payment()` runs (stock drawn, the invoice issued stating the money was
 * paid outside Kaizen), the order's history says `order.paid_outside` (`data.note` the reference, if any) and the audit entry names the method and the amount, never the reference. A sent draft's Stripe session is
 * closed first; if it was paid meanwhile this refuses and the order completes through the webhook as normal. Kaizen takes no sale fee on money it never touched.
 */
export async function recordDraftPaidOutside(
  member: Pick<Membership, "account" | "store" | "role" | "kind" | "permissions">,
  draftId: string,
  raw: unknown,
): Promise<PaidOutsideResult> {
  const storeId = member.store.id;
  const parsed = draftPaidOutsideInput.safeParse(raw);
  if (!parsed.success) return { ok: false, problem: "invalid" };
  const input = parsed.data;
  if (!(await mayRecordOutsidePayment(member))) return { ok: false, problem: "not_allowed" };
  const actor = staffActor(member.account.id);
  const draft = await getDraft(storeId, draftId);
  if (!draft) return { ok: false, problem: "not_found" };
  if (draft.status !== "open" && draft.status !== "sent") return { ok: false, problem: draft.status === "paid" ? "already_paid" : "not_payable" };
  if (draft.version !== input.version && draft.status === "open") return { ok: false, problem: "conflict" };
  if (!draft.email || draft.email.trim() === "") return { ok: false, problem: "no_email" };
  const [open] = await db().execute<Row>(sql`select commerce.store_is_active(${storeId}::uuid) as open`);
  if (!open?.open) return { ok: false, problem: "closed" };

  // A sent draft's Stripe session is closed first: paid meanwhile means this is not done (the webhook completes the order), processing means wait.
  if (draft.status === "sent" && draft.orderId) {
    const settled = await settleOrderSessions(storeId, draft.orderId);
    if (settled === "paid") return { ok: false, problem: "already_paid" };
    if (settled === "processing") return { ok: false, problem: "processing" };
  }

  // The day the money was received decides the invoice's supply date and so the VAT period: not in the future (the store's own day) and not far back.
  if (input.receivedOn) {
    const [day] = await db().execute<Row>(sql`
      select commerce.store_day(${storeId}::uuid, now())::text as today, (commerce.store_day(${storeId}::uuid, now()) - ${MANUAL_RECEIVED_DAYS_MAX}::int)::text as earliest
    `);
    if (input.receivedOn > String(day?.today) || input.receivedOn < String(day?.earliest)) return { ok: false, problem: "received_on" };
  }

  const reference = `manual_${crypto.randomUUID()}`;
  let cashWarning = false;
  type Recorded = { ok: true; orderId: string; number: string; totalMinor: number; currency: string } | { ok: false; problem: "not_payable" | "problems" | "processing"; problems?: DraftProblem[] };
  let done: Recorded;
  try {
    done = await db().transaction(async (tx): Promise<Recorded> => {
    let orderId = draft.orderId;
    if (draft.status === "open") {
      const placed = await placeDraftOrder(tx, { storeId, draftId, actor, validDays: DRAFT_PAID_OUTSIDE_VALID_DAYS, tokenHash: null });
      if (!placed.ok) return { ok: false, problem: "problems", problems: placed.problems };
      orderId = placed.orderId;
    }
    if (!orderId) return { ok: false, problem: "not_payable" };
    const [order] = await tx.execute<Row>(sql`
      select number, status, total_minor, currency from commerce.orders where store_id = ${storeId}::uuid and id = ${orderId}::uuid for update
    `);
    if (!order || order.status !== "pending_payment") return { ok: false, problem: "not_payable" };
    // Cash above a country's ceiling is not recorded (data in `src/lib/cash-limits.ts`): thrown, so an order this call placed from an open draft is rolled back with it.
    if (input.method === "cash") {
      const [market] = await tx.execute<Row>(sql`select market_code from commerce.orders where store_id = ${storeId}::uuid and id = ${orderId}::uuid`);
      const code = String(market?.market_code ?? "").trim();
      const currency = String(order.currency).trim();
      const check = checkCash(code, Number(order.total_minor), currency, await cashLimitInCurrency(storeId, code, currency));
      if (check.kind === "refuse") throw new OutsideRefused("cash_limit");
      if (check.kind === "warn") cashWarning = true;
    }
    // The buyer's pay link may have opened a session after the step above closed the earlier ones (it checks the order again under this same lock, so one of the two sees the other): a payable session still pending here
    // means money could arrive for an order paid outside, so nothing is recorded now.
    const [openSession] = await tx.execute<Row>(sql`select count(*)::int as n from commerce.payments where store_id = ${storeId}::uuid and order_id = ${orderId}::uuid and provider = 'stripe' and status = 'pending'`);
    if (Number(openSession?.n ?? 0) > 0) return { ok: false, problem: "processing" };
    await tx.execute(sql`
      insert into commerce.payments (store_id, order_id, provider, provider_reference, amount_minor, currency, status, kaizen_fee_minor, method, recorded_by, received_on)
      values (${storeId}::uuid, ${orderId}::uuid, 'manual', ${reference}, ${Number(order.total_minor)}, ${String(order.currency).trim()}, 'captured', 0, ${input.method}, ${member.account.id}::uuid, ${input.receivedOn ?? null}::date)
    `);
    await tx.execute(sql`select commerce.complete_order_payment(${orderId}::uuid, ${reference})`);
    await writeOrderEvent(tx, storeId, orderId, ORDER_OPS_EVENTS.paidOutside, { method: input.method, ...(input.receivedOn ? { receivedOn: input.receivedOn } : {}), ...(input.reference ? { note: input.reference } : {}) }, "staff");
    return { ok: true, orderId, number: String(order.number), totalMinor: Number(order.total_minor), currency: String(order.currency).trim() };
    });
  } catch (error) {
    if (error instanceof OutsideRefused) return { ok: false, problem: error.problem };
    throw error;
  }
  if (!done.ok) return done.problem === "problems" ? { ok: false, problem: "problems", problems: done.problems } : { ok: false, problem: done.problem };
  await audit(actor.accountId, storeId, ORDER_AUDIT_ACTIONS.draftPaidOutside, { draft: draft.number, method: input.method, amountMinor: done.totalMinor, currency: done.currency, ...(input.receivedOn ? { receivedOn: input.receivedOn } : {}) }, { target: { type: "order", id: done.orderId } });
  // The order joins the customer's account, if they have one, and the confirmation (with the invoice and the right of withdrawal) goes to the buyer: not optional.
  await linkOrderToCustomer(storeId, done.orderId).catch(() => null);
  const emailed = await sendOrderConfirmation(storeId, done.orderId).catch(() => "failed" as const);
  return { ok: true, orderId: done.orderId, number: done.number, emailed, ...(cashWarning ? { cashWarning } : {}) };
}

/** The cash ceiling of a market's country in the order's currency when that is not the ceiling's own (the market's rates), or null when it cannot be converted. */
async function cashLimitInCurrency(storeId: string, code: string, currency: string): Promise<number | null | undefined> {
  const rule = cashRuleOf(code);
  if (!rule || rule.currency === currency) return undefined;
  const store = await storeById(storeId);
  const market = store?.markets.find((m) => m.code.toUpperCase() === code.toUpperCase());
  return market && market.currency === currency && market.nativeCurrency === rule.currency ? shown(market, rule.limitMinor) : null;
}

// ---------------------------------------------------------------------------------------------------------------------
// The jobs
// ---------------------------------------------------------------------------------------------------------------------

export type ExpireRun = { expired: number; paid: number; waiting: number };

/**
 * The five-minute job (and the pay page, which treats a passed time as expired without waiting for it): each sent draft whose time has passed, in an open store, has its Stripe session closed first. If the session turns
 * out paid the order is completed (by `applySession()`) and is NOT cancelled; if the payment is still processing it is left to the webhook; otherwise `cancel_unpaid_order()` cancels the order (its stock
 * goes back, its number STAYS on it, so the sequence has no gap) and the draft becomes `expired` (the order's own trigger). Idempotent; one failing draft never stops the others.
 */
export async function expireDrafts(now: Date = new Date(), options: { limit?: number } = {}): Promise<ExpireRun> {
  const run: ExpireRun = { expired: 0, paid: 0, waiting: 0 };
  const due = await db().execute<Row>(sql`
    select d.store_id, d.id, d.order_id from commerce.draft_orders d
    where d.status = 'sent' and d.expires_at <= ${now.toISOString()}::timestamptz and commerce.store_is_active(d.store_id)
    order by d.expires_at limit ${options.limit ?? 200}
  `);
  for (const row of due) {
    const storeId = String(row.store_id);
    const orderId = row.order_id ? String(row.order_id) : null;
    if (!orderId) continue;
    try {
      const settled = await settleOrderSessions(storeId, orderId);
      if (settled === "paid") {
        run.paid += 1;
        continue;
      }
      if (settled === "processing") {
        run.waiting += 1;
        continue;
      }
      await db().execute(sql`select commerce.cancel_unpaid_order(${orderId}::uuid, 'draft expired')`);
      // A press of the pay link at the very moment of expiry may have opened a session after the settle above: closed again now (the press itself also closes the session it opened when the order is no longer waiting).
      const again = await settleOrderSessions(storeId, orderId);
      if (again === "paid") {
        run.paid += 1;
        continue;
      }
      run.expired += 1;
    } catch (error) {
      console.error("[drafts] a draft could not be expired", String(row.id), error);
    }
  }
  return run;
}

/**
 * The daily clean-up of drafts (GDPR Art. 5(1)(c) and (e), `docs/wave-3-orders.md` 3.6): an open draft not edited for 90 days is deleted, a paid, expired or cancelled one 30 days after it reached that state. A sent draft is never
 * deleted (a live order waits for it). The order a draft made keeps all its own data: only the draft's copy of the buyer's contact data goes. Application code: the database's functions hold no delete.
 */
export async function pruneDraftOrders(now: Date = new Date()): Promise<number> {
  const cutoffs = draftPruneCutoffs(now);
  const gone = await db().execute<Row>(sql`
    delete from commerce.draft_orders
    where (status = 'open' and edited_at < ${cutoffs.open.toISOString()}::timestamptz)
       or (status in ('paid', 'expired', 'cancelled') and coalesce(paid_at, updated_at) < ${cutoffs.done.toISOString()}::timestamptz)
    returning id
  `);
  return gone.length;
}
