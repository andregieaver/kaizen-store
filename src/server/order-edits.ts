import "server-only";

import { createHash, randomBytes, randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";

import { db, type Db } from "@/db/client";
import { minChargeMinor } from "@/lib/bonus";
import { lineWithdrawal } from "@/lib/checkout";
import { checkCash } from "@/lib/cash-limits";
import { EDIT_PAY_DAYS, EDIT_SENDS_PER_DAY } from "@/lib/fulfilment-limits";
import { shownOptions, t } from "@/lib/i18n";
import { conversionFor } from "@/lib/localization";
import { marketSlug } from "@/lib/market-slug";
import { findMarket, shown, type Market } from "@/lib/markets";
import { formatMoney } from "@/lib/money";
import {
  documentsSentence,
  editBase,
  editBlock,
  moneyBlock,
  moneySentence,
  orderEditProblemText,
  priceOrderEdit,
  sameBase,
  type EditAddInput,
  type EditBlockReason,
  type EditOrderFacts,
  type EditTaxBasket,
  type OrderEditProblem,
  type OrderEditProblemCode,
  type PricedEdit,
  type SoldLine,
} from "@/lib/order-edit";
import { editPaidOutsideInput, orderEditInput, type OrderEditInput } from "@/lib/order-edit-input";
import { editLabel, type OrderEditReason, type OrderEditStatus } from "@/lib/order-edit-status";
import { FULFILMENT_AUDIT_ACTIONS, FULFILMENT_EVENTS } from "@/lib/order-ops-events";
import { MANUAL_RECEIVED_DAYS_MAX } from "@/lib/order-limits";
import { marketPath, storeSiteUrl } from "@/lib/paths";
import { GENERAL_TAX_CODE, variantLabel } from "@/lib/product-input";
import { shownMeasureFromColumns } from "@/lib/unit-price-rules";

import { audit } from "./auth";
import { cashLimitInCurrency } from "./draft-orders";
import { settleOrderSessions } from "./draft-sessions";
import { allocateStock, insertOrderLine } from "./order-insert";
import { writeOrderEvent, type OrderActor } from "./order-actor";
import { refundOrder } from "./order-admin";
import { accountMayRecordOutside } from "./order-settings";
import { getCheckoutInfo } from "./orders";
import { storeById, type EmailStore } from "./shopper-emails";
import { uuidList } from "./sql-arrays";
import { applyRestock, planRestock, type RestockItem } from "./stock-restock";
import { decideTax, loadTaxFacts, type TaxOutcome } from "./tax-treatment";

type Row = Record<string, unknown>;
type Runner = Pick<Db, "execute">;

/**
 * Changing a paid order after purchase (wave 3, run 3, D174, `docs/wave-3-fulfilment.md` 2.2, 4.3 to 4.6). Staff add goods, take lines off and lower
 * quantities on a paid order with nothing sent; the units kept keep the price and discounts they were sold with (`splitLine()`), added goods are priced at
 * the market's list price as shown (`shown()`) or a price staff typed and taxed by the checkout's own `decideTax()`; the shipping is kept or set.
 *
 * - **A lower or equal total** is applied at once: a lower one is refunded through `refundOrder()` (Stripe on the store's account, or recorded for money
 *   taken outside Kaizen) and the change is written in the SAME transaction that records the refund, so either both are written or neither.
 * - **A higher total** is applied only when the customer pays it (CRD Art. 22): the change is stored `awaiting_payment` with the added units held and a pay
 *   link (`/s/{store}/{market}/account/change/{token}`, only the token's SHA-256 is kept), or staff record it as paid outside Kaizen. A saved card is never charged.
 * - The ONE writer of a change is `writeEdit()` below: it alone sets the edit context (`kaizen.order_edit`, local to its transaction), without which the
 *   database refuses any change to a paid order's lines and money (`order_lines_settled_guard()`, `orders_settled_guard()`). `applyOrderEdit()`,
 *   `recordEditPaidOutside()` and `completeEditPayment()` reach it; a scan test holds that no other module sets the context.
 * - The documents are the database's (`commerce.issue_edit_documents()`: an edit credit note and an additional invoice referring to the original; a failure
 *   leaves them `waiting` for the five-minute job, never the change or its money).
 *
 * Every query names the store. The order's number never changes (D141): nothing here inserts an order.
 */

// ---------------------------------------------------------------------------------------------------------------------
// Reading the order
// ---------------------------------------------------------------------------------------------------------------------

/** What the edit reads of an order: its money and lines (`EditOrderFacts`), what `editBlock()` needs, and how it was paid. */
export type EditableOrder = {
  id: string;
  storeId: string;
  number: string;
  status: string;
  copied: boolean;
  currency: string;
  marketCode: string;
  locale: string;
  email: string | null;
  facts: EditOrderFacts;
  block: EditBlockReason | null;
  /** The change waiting for payment, if any. */
  awaiting: { id: string; seq: number; expiresAt: string | null } | null;
  editCount: number;
  /** The order was paid through Stripe (a captured Stripe payment): a refund goes back through Stripe. */
  paidThroughStripe: boolean;
  /** The order was paid only with money taken outside Kaizen (D173): a refund is recorded, and the store pays back. */
  paidOutside: boolean;
  /** The Stripe payment was in test mode. */
  testMode: boolean;
  /** What may still be refunded: captured payments less refunds that did not fail. */
  refundableMinor: number;
  invoiceNumber: string | null;
  invoiced: boolean;
};

async function loadOrder(runner: Runner, storeId: string, orderId: string, options: { lock?: boolean } = {}): Promise<EditableOrder | null> {
  const [o] = await runner.execute<Row>(sql`
    select o.id, o.number, o.status::text as status, o.copied_from is not null as copied, o.host_id is not null as host, o.vat_kind, trim(o.currency) as currency,
      trim(o.market_code) as market_code, o.locale, o.email, o.restricted_at is not null as restricted, o.balance_minor, o.subscription_id is not null as renewal,
      o.subtotal_minor, o.shipping_minor, o.discount_minor, o.tax_minor, o.total_minor, o.member_discount_minor, o.campaign_discount_minor, o.credit_minor,
      o.referral_discount_minor, o.staff_discount_minor, o.vat_relief_minor, o.shipping_tax_rate,
      commerce.store_is_active(o.store_id) as store_open
    from commerce.orders o where o.store_id = ${storeId}::uuid and o.id = ${orderId}::uuid
    ${options.lock ? sql`for update of o` : sql``}
  `);
  if (!o) return null;
  const [lines, [facts]] = await Promise.all([
    runner.execute<Row>(sql`
      select ol.* from commerce.order_lines ol where ol.store_id = ${storeId}::uuid and ol.order_id = ${orderId}::uuid order by ol.id
    `),
    runner.execute<Row>(sql`
      select
        exists (select 1 from commerce.shipments sh where sh.store_id = ${storeId}::uuid and sh.order_id = ${orderId}::uuid and sh.undone_at is null) as shipped,
        exists (select 1 from commerce.standing_deliveries sd where sd.store_id = ${storeId}::uuid and sd.order_id = ${orderId}::uuid) as weekly_box,
        exists (select 1 from commerce.bookings b where b.store_id = ${storeId}::uuid and b.order_id = ${orderId}::uuid) as booking,
        -- Any withdrawal request (even one never confirmed names the order's lines) or a return that is not cancelled.
        (exists (select 1 from commerce.withdrawal_requests w where w.store_id = ${storeId}::uuid and w.order_id = ${orderId}::uuid)
          or exists (select 1 from commerce.returns r where r.store_id = ${storeId}::uuid and r.order_id = ${orderId}::uuid and r.status::text <> 'cancelled')) as returned,
        exists (select 1 from commerce.unsent_closures c where c.store_id = ${storeId}::uuid and c.order_id = ${orderId}::uuid) as unsent_closed,
        (select count(*)::int from commerce.order_edits e where e.store_id = ${storeId}::uuid and e.order_id = ${orderId}::uuid) as edits,
        (select json_build_object('id', e.id, 'seq', e.seq, 'expiresAt', e.expires_at) from commerce.order_edits e
           where e.store_id = ${storeId}::uuid and e.order_id = ${orderId}::uuid and e.status = 'awaiting_payment') as awaiting,
        exists (select 1 from commerce.payments p where p.store_id = ${storeId}::uuid and p.order_id = ${orderId}::uuid and p.status = 'captured' and p.provider = 'stripe') as stripe_paid,
        exists (select 1 from commerce.payments p where p.store_id = ${storeId}::uuid and p.order_id = ${orderId}::uuid and p.status = 'captured' and p.provider = 'manual') as manual_paid,
        -- The Stripe mode the order was paid in: its captured Stripe payment's connected account's (as refundOrder() finds it).
        exists (select 1 from commerce.payments p join commerce.connected_accounts a on a.store_id = p.store_id and a.account_id = p.provider_account
                where p.store_id = ${storeId}::uuid and p.order_id = ${orderId}::uuid and p.status = 'captured' and a.mode = 'test') as test_mode,
        (select coalesce(sum(p.amount_minor), 0) from commerce.payments p
           where p.store_id = ${storeId}::uuid and p.order_id = ${orderId}::uuid and p.status = 'captured' and p.provider in ('stripe', 'manual'))
        - (select coalesce(sum(r.amount_minor), 0) from commerce.refunds r join commerce.payments p on p.store_id = r.store_id and p.id = r.payment_id
           where p.store_id = ${storeId}::uuid and p.order_id = ${orderId}::uuid and r.status::text <> 'failed') as refundable,
        (select i.document_number from commerce.invoices i where i.store_id = ${storeId}::uuid and i.order_id = ${orderId}::uuid and i.kind = 'order') as invoice_number,
        commerce.invoice_eligibility(${orderId}::uuid) as eligibility
    `),
  ]);
  const sold: SoldLine[] = lines.map((l) => ({
    lineId: String(l.id),
    variantId: l.variant_id ? String(l.variant_id) : null,
    sku: String(l.sku ?? ""),
    title: String(l.title ?? ""),
    quantity: Number(l.quantity),
    unitPriceMinor: Number(l.unit_price_minor),
    totalMinor: Number(l.total_minor),
    taxMinor: Number(l.tax_minor),
    taxRate: Number(l.tax_rate),
    discountMinor: Number(l.discount_minor),
    parts: {
      member: Number(l.member_discount_minor ?? 0),
      campaign: Number(l.campaign_discount_minor ?? 0),
      bonus: Number(l.bonus_discount_minor ?? 0),
      referral: Number(l.referral_discount_minor ?? 0),
      staff: Number(l.staff_discount_minor ?? 0),
      relief: Number(l.vat_relief_minor ?? 0),
    },
    backorderQuantity: Number(l.backorder_quantity ?? 0),
    backorderDays: l.backorder_days === null || l.backorder_days === undefined ? null : Number(l.backorder_days),
    // Goods only: a custom item (D173) is a service line and stays as it is.
    goods: l.variant_id !== null && l.delivery === "physical" && !l.custom,
    physical: l.delivery === "physical",
    gift: Boolean(l.gift),
  }));
  const awaiting = facts?.awaiting as { id: string; seq: number; expiresAt: string | null } | null;
  const status = String(o.status) as "pending_payment" | "paid" | "fulfilled" | "cancelled" | "closed";
  const subscription = Boolean(o.renewal) || lines.some((l) => l.plan_interval !== null || l.selling_plan_id !== null);
  return {
    id: String(o.id),
    storeId,
    number: String(o.number),
    status,
    copied: Boolean(o.copied),
    currency: String(o.currency),
    marketCode: String(o.market_code),
    locale: String(o.locale),
    email: o.email ? String(o.email) : null,
    facts: {
      currency: String(o.currency),
      subtotalMinor: Number(o.subtotal_minor),
      shippingMinor: Number(o.shipping_minor),
      discountMinor: Number(o.discount_minor),
      taxMinor: Number(o.tax_minor),
      totalMinor: Number(o.total_minor),
      memberDiscountMinor: Number(o.member_discount_minor ?? 0),
      campaignDiscountMinor: Number(o.campaign_discount_minor ?? 0),
      creditMinor: Number(o.credit_minor ?? 0),
      referralDiscountMinor: Number(o.referral_discount_minor ?? 0),
      staffDiscountMinor: Number(o.staff_discount_minor ?? 0),
      vatReliefMinor: Number(o.vat_relief_minor ?? 0),
      shippingTaxRate: o.shipping_tax_rate === null || o.shipping_tax_rate === undefined ? null : Number(o.shipping_tax_rate),
      lines: sold,
    },
    block: editBlock({
      status,
      copied: Boolean(o.copied),
      host: Boolean(o.host),
      shipped: Boolean(facts?.shipped),
      subscription,
      weeklyBox: Boolean(facts?.weekly_box),
      booking: Boolean(facts?.booking),
      balanceMinor: Number(o.balance_minor ?? 0),
      vatKind: (String(o.vat_kind) as "standard" | "reverse_charge" | "ioss") ?? "standard",
      returnOrWithdrawal: Boolean(facts?.returned),
      unsentClosed: Boolean(facts?.unsent_closed),
      restricted: Boolean(o.restricted),
      editPending: Boolean(awaiting),
      editCount: Number(facts?.edits ?? 0),
      storeOpen: Boolean(o.store_open),
    }),
    awaiting: awaiting ? { id: String(awaiting.id), seq: Number(awaiting.seq), expiresAt: awaiting.expiresAt ? new Date(String(awaiting.expiresAt)).toISOString() : null } : null,
    editCount: Number(facts?.edits ?? 0),
    paidThroughStripe: Boolean(facts?.stripe_paid),
    paidOutside: !facts?.stripe_paid && Boolean(facts?.manual_paid),
    testMode: Boolean(facts?.test_mode),
    refundableMinor: Number(facts?.refundable ?? 0),
    invoiceNumber: facts?.invoice_number ? String(facts.invoice_number) : null,
    invoiced: String(facts?.eligibility) === "ok",
  };
}

/**
 * Whether the order stands as it did when a change was previewed (`sameBase()`'s rule), read key by key: a base that went through `jsonb` comes back with its keys
 * in another order, and a base from the browser is untrusted (a missing key is a mismatch).
 */
function basesMatch(a: unknown, b: unknown): boolean {
  const x = a as ReturnType<typeof editBase> | null;
  const y = b as ReturnType<typeof editBase> | null;
  if (!x?.totals || !y?.totals || !Array.isArray(x.lines) || !Array.isArray(y.lines)) return false;
  for (const key of Object.keys(x.totals) as (keyof ReturnType<typeof editBase>["totals"])[]) {
    if (Number(x.totals[key]) !== Number(y.totals[key])) return false;
  }
  if (Object.keys(x.totals).length !== Object.keys(y.totals).length) return false;
  return sameBase({ totals: x.totals, lines: x.lines }, { totals: x.totals, lines: y.lines.map((l) => ({ lineId: String(l.lineId), quantity: Number(l.quantity), totalMinor: Number(l.totalMinor) })) });
}

/** The order's own market view (`{country}[-{lang}][-{currency}]`, D109) rebuilt from the order: added goods are priced as the customer was shown prices. */
async function orderMarket(store: EmailStore, order: Pick<EditableOrder, "marketCode" | "locale" | "currency">): Promise<Market | null> {
  const native = store.markets.find((m) => m.code === order.marketCode);
  if (!native) return null;
  const lang = order.locale.split("-")[0] || native.lang;
  const wanted = marketSlug(native.code, { lang, currency: order.currency }, { lang: native.ownLocale.split("-")[0], currency: native.nativeCurrency });
  const view = findMarket(store.markets, wanted, { locales: store.localization.locales, conversion: (from, to) => conversionFor(store.localization, from, to) });
  // Only a view in the order's own currency prices the change: a market that no longer offers it cannot (the amounts would be in another currency).
  if (!view || view.currency !== order.currency) return null;
  return { ...view, locale: order.locale || view.locale, lang };
}

/** What an added variant needs: sellable in the market, its list price as shown, its VAT rate today, its measure and stock. */
type VariantFacts = {
  variantId: string;
  sku: string;
  title: string;
  sellable: boolean;
  listMinor: number | null;
  rate: number;
  taxCode: string;
  withdrawalExclusion: string;
  costMinor: number | null;
  measure: { amount: number | string; unit: string; base: string } | null;
  policy: "continue" | "deny";
  backorderDays: number | null;
  inStock: number;
};

async function variantFacts(runner: Runner, storeId: string, market: Market, variantIds: readonly string[]): Promise<Map<string, VariantFacts>> {
  const out = new Map<string, VariantFacts>();
  if (variantIds.length === 0) return out;
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
    where v.store_id = ${storeId}::uuid and v.id = any(${uuidList(variantIds)})
  `);
  const messages = t(market.lang);
  for (const row of rows) {
    const options = (row.options ?? {}) as Record<string, string>;
    const title = Object.keys(options).length > 0 ? `${row.title} (${variantLabel(shownOptions(messages, options))})` : String(row.title);
    const measure = shownMeasureFromColumns(row.measure_amount, row.measure_unit, row.measure_base, market.code);
    out.set(String(row.id), {
      variantId: String(row.id),
      sku: String(row.sku),
      title: [...title].slice(0, 200).join(""),
      sellable:
        row.status === "active" && Boolean(row.active) && row.kind === "goods" && row.delivery === "physical" && !row.host_id && !row.subscription_only && row.amount_minor !== null,
      listMinor: row.amount_minor === null ? null : shown(market, Number(row.amount_minor)),
      rate: Number(row.vat_rate ?? 0),
      taxCode: String(row.tax_code ?? GENERAL_TAX_CODE),
      withdrawalExclusion: String(row.withdrawal_exclusion ?? "none"),
      costMinor: row.cost_minor === null || row.cost_minor === undefined ? null : Number(row.cost_minor),
      // The content is frozen on the added line as placeOrder() freezes it (D160): copied, never worked on here.
      measure: measure ? { amount: measure.amount, unit: measure.unit, base: measure.base } : null,
      policy: row.stock_policy === "continue" ? "continue" : "deny",
      backorderDays: row.backorder_days === null || row.backorder_days === undefined ? null : Number(row.backorder_days),
      inStock: Number(row.in_stock ?? 0),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// Pricing a change: the one function the preview and the apply both call
// ---------------------------------------------------------------------------------------------------------------------

export type EditProblem = { code: OrderEditProblemCode | EditBlockReason | "needs_payment" | "not_found" | "invalid" | "not_allowed" | "cash_limit"; key?: string; text: string };

const CASH_LIMIT =
  "This much cash for one order is above the country's cash ceiling, so it cannot be recorded as paid in cash: the order's cash payments and this change are one transaction. Ask the customer to pay by card or bank transfer.";
const NEEDS_PAYMENT = "The new total is higher: send the customer a pay link, share one, or record the difference as paid outside Kaizen.";
const problem = (code: EditProblem["code"], key?: string): EditProblem => ({
  code,
  ...(key ? { key } : {}),
  text:
    code === "needs_payment"
      ? NEEDS_PAYMENT
      : code === "not_found"
        ? "The order was not found."
        : code === "invalid"
          ? "Check the change and try again."
          : code === "not_allowed"
            ? "Only the owner can record money taken or paid back outside Kaizen, unless the owner has allowed staff to."
            : code === "cash_limit"
              ? CASH_LIMIT
              : orderEditProblemText(code),
});

/** An added product as the summary shows it. */
export type AddedView = {
  key: string;
  variantId: string;
  sku: string;
  title: string;
  quantity: number;
  unitPriceMinor: number;
  listPriceMinor: number | null;
  custom: boolean;
  /** Units beyond stock that will be sold on backorder (D172), with the days the customer is told. */
  backorder: { units: number; days: number | null } | null;
};

/** The server's summary of a change (`previewOrderEdit()`): the editor shows exactly this; the browser never works a total out. */
export type EditPreview = {
  ok: boolean;
  orderId: string;
  number: string;
  currency: string;
  block: EditBlockReason | null;
  problems: EditProblem[];
  priced: PricedEdit<TaxOutcome> | null;
  added: AddedView[];
  /** The order as previewed: sent back with the apply, which refuses `changed` when the order moved since. */
  base: ReturnType<typeof editBase>;
  money: "charge" | "refund" | "none";
  differenceMinor: number;
  /** The money of the order was taken outside Kaizen: a lower total is recorded as paid back (the store pays the customer itself). */
  outside: boolean;
  mustNotify: boolean;
  /** The summary's sentences (English: the admin). */
  sentences: { money: string; documents: string };
  invoiceNumber: string | null;
};

type Computed = { order: EditableOrder; input: OrderEditInput; preview: EditPreview; added: (EditAddInput & { facts: VariantFacts | null })[]; market: Market | null };

async function compute(runner: Runner, storeId: string, orderId: string, input: OrderEditInput, options: { lock?: boolean; storedTax?: Map<string, number> } = {}): Promise<Computed | null> {
  const order = await loadOrder(runner, storeId, orderId, { lock: options.lock });
  if (!order) return null;
  const store = await storeById(storeId);
  const market = store ? await orderMarket(store, order) : null;
  const problems: EditProblem[] = [];
  if (order.block) problems.push(problem(order.block));
  const variants = market ? await variantFacts(runner, storeId, market, input.added.map((a) => a.variantId)) : new Map<string, VariantFacts>();
  const added = input.added.map((a, i) => {
    const facts = variants.get(a.variantId) ?? null;
    const custom = a.unitPriceMinor !== undefined && a.unitPriceMinor !== null;
    const key = `a${i + 1}`;
    if (!facts || !facts.sellable) problems.push(problem("variant_unavailable", key));
    return {
      key,
      variantId: a.variantId,
      sku: facts?.sku ?? "",
      title: facts?.title ?? "",
      unitPriceMinor: custom ? (a.unitPriceMinor as number) : (facts?.listMinor ?? 0),
      listPriceMinor: facts?.listMinor ?? null,
      quantity: a.quantity,
      rate: facts?.rate ?? 0,
      facts,
    };
  });
  // Stock: a variant that stops at zero must have the units (all added lines of it together); one that keeps selling goes on backorder.
  const wanted = new Map<string, number>();
  for (const a of added) wanted.set(a.variantId, (wanted.get(a.variantId) ?? 0) + a.quantity);
  for (const a of added) {
    if (a.facts && a.facts.policy === "deny" && (wanted.get(a.variantId) ?? 0) > a.facts.inStock) problems.push(problem("stock", a.key));
  }
  const taxFacts = await loadTaxFacts(runner, { storeId, market: { code: order.marketCode }, cartId: null });
  const tax = (basket: EditTaxBasket): TaxOutcome => {
    const outcome = decideTax(taxFacts, { ...basket, lines: basket.lines.map((l) => ({ ...l })), fees: [] });
    if (!options.storedTax) return outcome;
    // A change that waited for payment is applied as it was priced: its added lines carry the VAT they were shown with.
    return { ...outcome, result: { ...outcome.result, lines: outcome.result.lines.map((l) => (options.storedTax?.has(l.key) ? { ...l, taxMinor: options.storedTax.get(l.key) as number } : l)) } };
  };
  const priced = priceOrderEdit(
    {
      order: order.facts,
      quantities: input.quantities,
      added: added.map((a) => ({ key: a.key, variantId: a.variantId, sku: a.sku, title: a.title, unitPriceMinor: a.unitPriceMinor, listPriceMinor: a.listPriceMinor, quantity: a.quantity, rate: a.rate })),
      shipping: input.shipping,
      reason: input.reason,
    },
    tax,
  );
  for (const p of priced.problems) problems.push(problem(p.code as OrderEditProblem["code"], p.key));
  const outside = order.paidOutside;
  const block = moneyBlock({
    differenceMinor: priced.differenceMinor,
    throughStripe: priced.money === "charge" || (priced.money === "refund" && order.paidThroughStripe),
    paymentsOn: (await getCheckoutInfo(storeId, order.marketCode)).paymentsOn,
    // An order paid outside Stripe has no Stripe mode of its own: only one paid in Stripe's test mode (or live) must match the store's mode now.
    orderTestMode: order.paidThroughStripe ? order.testMode : ((await storeTestMode(storeId)) ?? false),
    storeTestMode: (await storeTestMode(storeId)) ?? order.testMode,
  });
  if (block && !(priced.money === "charge" && block === "payments_off")) problems.push(problem(block));
  if (priced.money === "refund" && -priced.differenceMinor > order.refundableMinor) problems.push(problem("over_refundable"));
  const money = priced.money;
  const amount = formatMoney(Math.abs(priced.differenceMinor), order.currency, market?.locale ?? "en-GB");
  const creditMinor = priced.lines.filter((l) => l.kind !== "add").reduce((s, l) => s + l.totalMinor, 0) + Math.max(0, -priced.shippingDelta);
  const invoiceMinor = priced.lines.filter((l) => l.kind === "add").reduce((s, l) => s + l.totalMinor, 0) + Math.max(0, priced.shippingDelta);
  if (!market && input.added.length > 0) problems.push(problem("variant_unavailable"));
  const unique = problems.filter((p, i) => problems.findIndex((q) => q.code === p.code && q.key === p.key) === i);
  const backorderOf = (a: (typeof added)[number]): AddedView["backorder"] => {
    if (!a.facts || a.facts.policy !== "continue") return null;
    const short = Math.max(0, (wanted.get(a.variantId) ?? 0) - Math.max(0, a.facts.inStock));
    return short > 0 ? { units: Math.min(short, a.quantity), days: a.facts.backorderDays } : null;
  };
  return {
    order,
    input,
    market,
    added,
    preview: {
      ok: unique.length === 0 && priced.ok,
      orderId: order.id,
      number: order.number,
      currency: order.currency,
      block: order.block,
      problems: unique,
      priced,
      added: added.map((a) => ({
        key: a.key,
        variantId: a.variantId,
        sku: a.sku,
        title: a.title,
        quantity: a.quantity,
        unitPriceMinor: a.unitPriceMinor,
        listPriceMinor: a.listPriceMinor,
        custom: a.listPriceMinor === null || a.unitPriceMinor !== a.listPriceMinor,
        backorder: backorderOf(a),
      })),
      base: editBase(order.facts),
      money,
      differenceMinor: priced.differenceMinor,
      outside,
      mustNotify: priced.mustNotify,
      sentences: {
        money: moneySentence(money, amount, outside),
        documents: documentsSentence({ invoiced: order.invoiced, creditMinor, invoiceMinor, invoiceNumber: order.invoiceNumber }),
      },
      invoiceNumber: order.invoiceNumber,
    },
  };
}

/** The mode the store's Stripe is in now (`test` or `live`), or null when payments are off. */
async function storeTestMode(storeId: string): Promise<boolean | null> {
  const [row] = await db().execute<Row>(sql`select active_mode from commerce.payment_providers where store_id = ${storeId}::uuid and provider = 'stripe' and enabled`);
  return row ? row.active_mode === "test" : null;
}

/** The summary beside the editor: the same pricing the apply uses. Reads only. Null for an order that is not this store's. */
export async function previewOrderEdit(storeId: string, orderId: string, raw: unknown): Promise<EditPreview | { ok: false; problems: EditProblem[] } | null> {
  const parsed = orderEditInput.safeParse(raw);
  if (!parsed.success) return { ok: false, problems: [problem("invalid")] };
  const computed = await compute(db(), storeId, orderId, parsed.data);
  return computed ? computed.preview : null;
}

// ---------------------------------------------------------------------------------------------------------------------
// The one writer
// ---------------------------------------------------------------------------------------------------------------------

/** A change refused inside its transaction (everything is rolled back). */
class EditRefused extends Error {
  constructor(
    readonly code: EditProblem["code"],
    readonly words?: string,
  ) {
    super(code);
  }
}

/** The database's refusals of a change, read into problem codes (`order_edit.sent: …` → `sent`). Anything else propagates. */
function refusalOf(error: unknown): EditProblem | null {
  let e: unknown = error;
  for (let i = 0; i < 5 && e; i += 1) {
    if (e instanceof EditRefused) return { code: e.code, text: e.words ?? problem(e.code).text };
    const message = e instanceof Error ? e.message : String(e);
    const match = /\b(order_edit|order_line|order|shipment)\.([a-z_]+)\b/.exec(message);
    if (match) {
      const code = match[2];
      const map: Record<string, EditProblem["code"]> = {
        not_paid: "not_paid",
        sent: "sent",
        host: "host",
        vat_kind: "vat_kind",
        store_closed: "store_closed",
        limit: "edit_limit",
        seq: "changed",
        settled: "changed",
        edit_pending: "edit_pending",
        unsent_closed: "unsent_closed",
      };
      if (map[code]) return problem(map[code]);
      if (/copied_order/.test(message)) return problem("copied");
    }
    if (/copied_order/.test(message)) return problem("copied");
    e = (e as { cause?: unknown }).cause;
  }
  return null;
}

/** What `writeEdit()` is asked to do. */
type WriteArgs = {
  storeId: string;
  orderId: string;
  editId: string;
  actor: OrderActor;
  computed: Computed;
  /** `applied`: the order carries it now; `awaiting_payment`: stored with the added units held and a link. */
  status: "applied" | "awaiting_payment";
  tokenHash?: string | null;
  expiresAt?: Date | null;
  /** The payment of an applied change with a higher total (a lower total's refunds are named by `refundChange()` once Stripe has answered). */
  paymentId?: string | null;
};

/** The order line as it is now, whole (kept in `order_edit_lines.before` for a line taken off or lowered). */
async function lineRows(tx: Runner, storeId: string, orderId: string): Promise<Map<string, unknown>> {
  const rows = await tx.execute<Row>(sql`select ol.id, to_jsonb(ol.*) as row from commerce.order_lines ol where ol.store_id = ${storeId}::uuid and ol.order_id = ${orderId}::uuid`);
  return new Map(rows.map((r) => [String(r.id), r.row]));
}

/**
 * Writes a change in the caller's transaction, under the order's row lock: the edit context, the change and its lines, and, for an applied change, the order's
 * lines and totals, the money's link, the stock (added units drawn, units taken off put back) and the documents. Refuses (throws `EditRefused`) when the
 * order moved since it was previewed, cannot be changed any more, or an added variant that stops at zero is short.
 */
async function writeEdit(tx: Db, args: WriteArgs): Promise<void> {
  const { storeId, orderId, editId, computed } = args;
  const fresh = await compute(tx, storeId, orderId, computed.input, { lock: true });
  if (!fresh) throw new EditRefused("not_found");
  if (!basesMatch(fresh.preview.base, computed.preview.base)) throw new EditRefused("changed");
  if (fresh.order.block) throw new EditRefused(fresh.order.block);
  const priced = fresh.preview.priced;
  if (!priced || !priced.ok || priced.differenceMinor !== computed.preview.differenceMinor) throw new EditRefused("changed");
  await tx.execute(sql`select set_config('kaizen.order_edit', ${orderId}, true)`);
  const before = await lineRows(tx, storeId, orderId);
  const input = computed.input;
  await tx.execute(sql`
    insert into commerce.order_edits (id, store_id, order_id, seq, status, reason, notify, restock, currency, base, total_before, total_after, subtotal_delta,
      shipping_before, shipping_after, discount_delta, tax_delta, difference_minor, made_by, pay_token_hash, expires_at)
    values (${editId}::uuid, ${storeId}::uuid, ${orderId}::uuid, ${fresh.order.editCount + 1}, ${args.status}, ${input.reason}, ${input.notify || priced.mustNotify},
      ${input.restock}, ${fresh.order.currency}, ${JSON.stringify({ ...fresh.preview.base, noRestock: input.noRestock })}::jsonb,
      ${priced.before.totalMinor}, ${priced.after.totalMinor}, ${priced.subtotalDelta}, ${priced.before.shippingMinor}, ${priced.after.shippingMinor},
      ${priced.discountDelta}, ${priced.taxDelta}, ${priced.differenceMinor}, ${args.actor.accountId}::uuid, ${args.tokenHash ?? null},
      ${args.expiresAt ? args.expiresAt.toISOString() : null}::timestamptz)
  `);
  for (const l of priced.lines) {
    await tx.execute(sql`
      insert into commerce.order_edit_lines (store_id, order_edit_id, n, kind, order_line_id, variant_id, sku, title, quantity, unit_price_minor, list_price_minor,
        total_minor, discount_minor, tax_minor, tax_rate, parts, before)
      values (${storeId}::uuid, ${editId}::uuid, ${l.n}, ${l.kind}, ${l.orderLineId}::uuid, ${l.variantId}::uuid, ${l.sku}, ${l.title}, ${l.quantity},
        ${l.unitPriceMinor}, ${l.listPriceMinor}, ${l.totalMinor}, ${l.discountMinor}, ${l.taxMinor}, ${l.taxRate}, ${JSON.stringify(l.parts)}::jsonb,
        ${l.orderLineId ? JSON.stringify(before.get(l.orderLineId) ?? l.before) : null}::jsonb)
    `);
  }
  if (args.status === "awaiting_payment") {
    // The added units are held until the link's end, as a draft's are (the order itself is unchanged until the customer pays).
    const goods = fresh.added.filter((a) => a.facts);
    const keeps = [...new Set(goods.filter((a) => a.facts?.policy === "continue").map((a) => a.variantId))];
    const plan = await allocateStock(tx, storeId, goods.map((a) => ({ variantId: a.variantId, quantity: a.quantity, policy: a.facts?.policy ?? "deny" })), keeps);
    if (!plan.ok) throw new EditRefused("stock");
    for (const hold of plan.holds) {
      await tx.execute(sql`
        insert into commerce.inventory_reservations (store_id, variant_id, location_id, quantity, backorder_quantity, order_id, order_edit_id, expires_at)
        values (${storeId}::uuid, ${hold.variantId}::uuid, ${hold.locationId}::uuid, ${hold.quantity}, ${hold.backordered}, ${orderId}::uuid, ${editId}::uuid,
                ${(args.expiresAt ?? new Date()).toISOString()}::timestamptz)
      `);
    }
    return;
  }
  await applyPriced(tx, { ...args, computed: fresh, priced });
}

/** The applying half: the order's lines and totals, the money's link, the stock and the documents, and the history event. In the edit context, under the lock. */
async function applyPriced(tx: Db, args: WriteArgs & { priced: PricedEdit<TaxOutcome> }): Promise<void> {
  const { storeId, orderId, editId, computed, priced } = args;
  for (const r of priced.reduced) {
    await tx.execute(sql`
      update commerce.order_lines set quantity = ${r.after.quantity}, total_minor = ${r.after.totalMinor}, tax_minor = ${r.after.taxMinor},
        discount_minor = ${r.after.discountMinor}, member_discount_minor = ${r.after.parts.member}, campaign_discount_minor = ${r.after.parts.campaign},
        bonus_discount_minor = ${r.after.parts.bonus}, referral_discount_minor = ${r.after.parts.referral}, staff_discount_minor = ${r.after.parts.staff},
        backorder_quantity = ${r.after.backorderQuantity}
      where store_id = ${storeId}::uuid and order_id = ${orderId}::uuid and id = ${r.lineId}::uuid
    `);
  }
  // A line taken off entirely is deleted (nothing can name it on an unsent order without returns, 4.4); its whole row is the edit line's `before`.
  for (const l of priced.removed) {
    await tx.execute(sql`delete from commerce.order_lines where store_id = ${storeId}::uuid and order_id = ${orderId}::uuid and id = ${l.lineId}::uuid`);
  }
  const addedFacts = new Map(computed.added.map((a) => [a.key, a.facts]));
  for (const a of priced.added) {
    const f = addedFacts.get(a.key) ?? null;
    const lineId = await insertOrderLine(tx, storeId, orderId, {
      variantId: a.variantId,
      sku: a.sku,
      title: a.title,
      quantity: a.quantity,
      unitPriceMinor: a.unitPriceMinor,
      discountMinor: 0,
      totalMinor: a.totalMinor,
      taxMinor: a.taxMinor,
      taxRate: a.rate,
      taxCode: f?.taxCode ?? GENERAL_TAX_CODE,
      withdrawalExclusion: lineWithdrawal("physical", f?.withdrawalExclusion ?? "none"),
      delivery: "physical",
      unitCostMinor: f?.costMinor ?? null,
      measure: f?.measure ?? null,
      listPriceMinor: a.listPriceMinor,
      orderEditId: editId,
    });
    const row = priced.lines.find((l) => l.kind === "add" && l.key === a.key);
    if (row) {
      await tx.execute(sql`update commerce.order_edit_lines set order_line_id = ${lineId}::uuid where store_id = ${storeId}::uuid and order_edit_id = ${editId}::uuid and n = ${row.n}`);
    }
  }
  const after = priced.after;
  await tx.execute(sql`
    update commerce.orders set subtotal_minor = ${after.subtotalMinor}, shipping_minor = ${after.shippingMinor}, discount_minor = ${after.discountMinor},
      member_discount_minor = ${after.memberDiscountMinor}, campaign_discount_minor = ${after.campaignDiscountMinor}, credit_minor = ${after.creditMinor},
      referral_discount_minor = ${after.referralDiscountMinor}, staff_discount_minor = ${after.staffDiscountMinor},
      staff_discount_label = case when ${after.staffDiscountMinor}::bigint = 0 then null else staff_discount_label end,
      tax_minor = ${after.taxMinor}, total_minor = ${after.totalMinor}, edited_at = now()
    where store_id = ${storeId}::uuid and id = ${orderId}::uuid
  `);
  if (args.paymentId) {
    await tx.execute(sql`update commerce.order_edits set payment_id = ${args.paymentId}::uuid where store_id = ${storeId}::uuid and id = ${editId}::uuid`);
  }
  // Stock: the added units are drawn (the change's own holds first); a variant that stops at zero and is short refuses the whole change.
  if (priced.added.length > 0) {
    const [drawn] = await tx.execute<Row>(sql`select commerce.draw_edit_stock(${editId}::uuid) as short`);
    if (Number(drawn?.short ?? 0) > 0) throw new EditRefused("stock");
  }
  // The units taken off go back to where they came from (D172), unless staff said they are damaged.
  const input = computed.input;
  if (input.restock) {
    const skip = new Set(input.noRestock);
    const back = new Map<string, RestockItem>();
    const put = (variantId: string | null, sku: string, quantity: number) => {
      if (!variantId || skip.has(variantId) || quantity <= 0) return;
      const item = back.get(variantId) ?? { variantId, sku, quantity: 0 };
      item.quantity += quantity;
      back.set(variantId, item);
    };
    for (const l of priced.removed) if (l.goods) put(l.variantId, l.sku, l.quantity);
    for (const r of priced.reduced) if (r.before.goods) put(r.before.variantId, r.before.sku, r.removed.quantity);
    if (back.size > 0) {
      const plan = await planRestock(tx, storeId, orderId, [...back.values()]);
      if (!plan.ok) throw new EditRefused("changed", plan.problem);
      await applyRestock(tx, storeId, plan.items, { reason: "order_restock", source: "order_edit", accountId: args.actor.accountId, orderId, returnId: null });
    }
  }
  // The documents: never block the change (a failure leaves them waiting for the five-minute job).
  await tx.execute(sql`select commerce.issue_edit_documents(${storeId}::uuid, ${editId}::uuid)`);
  const lineView = (l: (typeof priced.lines)[number]) => ({ kind: l.kind, sku: l.sku, title: l.title, quantity: l.quantity, totalMinor: l.totalMinor, taxMinor: l.taxMinor });
  await writeOrderEvent(
    tx,
    storeId,
    orderId,
    FULFILMENT_EVENTS.editApplied,
    {
      edit: editId,
      seq: computed.order.editCount + 1,
      label: editLabel(computed.order.editCount + 1),
      reason: computed.input.reason,
      before: { totals: priced.before, lines: computed.order.facts.lines.map((l) => ({ lineId: l.lineId, sku: l.sku, quantity: l.quantity, totalMinor: l.totalMinor })) },
      after: { totals: priced.after },
      lines: priced.lines.map(lineView),
      difference: priced.differenceMinor,
      currency: computed.order.currency,
      by: args.actor.accountId,
      ...(computed.input.note ? { note: computed.input.note } : {}),
    },
    args.actor.kind,
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Staff's actions
// ---------------------------------------------------------------------------------------------------------------------

export type ApplyResult =
  | { ok: true; editId: string; label: string; differenceMinor: number; money: "charge" | "refund" | "none"; emailed: string | null }
  | { ok: false; problems: EditProblem[] };

const refused = (...codes: EditProblem[]): { ok: false; problems: EditProblem[] } => ({ ok: false, problems: codes });

/**
 * *Save the change* for a lower or equal total (2.2): applied at once. A lower total is refunded through `refundOrder()` with the change's own Stripe key
 * (`order-edit-refund:{edit}`) and the change is written in the transaction that records the refund; a refund Stripe refuses writes nothing; one Stripe
 * answers `pending` applies (the money is on its way). A higher total is `needs_payment` (send a link, share one, or record it as paid outside).
 * Permission (`orders:write`) is the caller's; recording a refund of money taken outside Kaizen is the owner's, or staff's when the owner allowed it.
 */
export async function applyOrderEdit(storeId: string, orderId: string, raw: unknown, actor: OrderActor): Promise<ApplyResult> {
  const parsed = orderEditInput.safeParse(raw);
  if (!parsed.success) return refused(problem("invalid"));
  if (!actor.accountId) return refused(problem("not_allowed"));
  const computed = await compute(db(), storeId, orderId, parsed.data);
  if (!computed) return refused(problem("not_found"));
  const { preview } = computed;
  if (parsed.data.base !== undefined && !basesMatch(parsed.data.base, preview.base)) return refused(problem("changed"));
  if (!preview.ok) return refused(...preview.problems);
  if (preview.money === "charge") return refused(problem("needs_payment"));
  if (preview.money === "refund" && preview.outside && !(await accountMayRecordOutside(storeId, actor.accountId))) return refused(problem("not_allowed"));
  const editId = randomUUID();
  const label = editLabel(computed.order.editCount + 1);
  try {
    if (preview.money === "refund") {
      const outcome = await refundChange(storeId, orderId, editId, label, actor, computed, -preview.differenceMinor);
      if (outcome) return refused(outcome);
    } else {
      await db().transaction(async (tx) => writeEdit(tx, { storeId, orderId, editId, actor, computed, status: "applied" }));
    }
  } catch (error) {
    const known = refusalOf(error);
    if (known) return refused(known);
    throw error;
  }
  await audit(actor.accountId, storeId, FULFILMENT_AUDIT_ACTIONS.editApplied, { edit: editId, label, differenceMinor: preview.differenceMinor, currency: preview.currency }, { target: { type: "order", id: orderId } });
  const emailed = await notifyApplied(storeId, editId);
  return { ok: true, editId, label, differenceMinor: preview.differenceMinor, money: preview.money, emailed };
}

/**
 * A lower total (4.5), in ONE transaction and in this order: the change is written and checked under the order's row lock (the order as previewed, what may
 * be changed, the added units drawn from stock, the units taken off put back, the documents), THEN Stripe is asked for the refund of the difference (the
 * change's own key, `order-edit-refund:{edit}`), THEN the refund is recorded in the same transaction and named by the change. So nothing that could refuse the
 * change is left after money moved: a second press of the same change (a double click, two tabs) waits for the order's lock and finds the order moved, and a
 * stock shortage refuses before Stripe is asked (review of wave 3 run 3). A refund Stripe refuses, or answers `failed`, rolls everything back. The lock is held
 * while Stripe answers (about a second); the one thing left that can lose a refund is the database failing between Stripe's answer and the commit, which the
 * webhook then records as a refund made in Stripe. Returns null when applied, else the problem.
 */
async function refundChange(storeId: string, orderId: string, editId: string, label: string, actor: OrderActor, computed: Computed, amountMinor: number): Promise<EditProblem | null> {
  try {
    await db().transaction(async (tx) => {
      await writeEdit(tx, { storeId, orderId, editId, actor, computed, status: "applied" });
      const refund = await refundOrder(storeId, orderId, { amountMinor, reason: `Order change ${label}`, restock: [] }, actor.accountId, {
        idempotencyKey: `order-edit-refund:${editId}`,
        eventData: { edit: editId },
        within: tx,
      });
      if (!refund.ok) throw new EditRefused("refund_failed", refund.problem);
      const ids = refund.refundIds ?? (refund.refundId ? [refund.refundId] : []);
      if (refund.status === "failed" || ids.length === 0) throw new EditRefused("refund_failed");
      // Every refund of the difference names the change (they add up to it, held at commit by `order_edits_settled()`); the change names the first.
      await tx.execute(sql`update commerce.refunds set order_edit_id = ${editId}::uuid where store_id = ${storeId}::uuid and id = any(${uuidList(ids)})`);
      await tx.execute(sql`update commerce.order_edits set refund_id = ${ids[0]}::uuid where store_id = ${storeId}::uuid and id = ${editId}::uuid`);
    });
  } catch (error) {
    const known = refusalOf(error);
    if (!known) throw error;
    return known;
  }
  return null;
}

/** The change email after a change was applied, once (`order-changed:{edit}`), when the change says to tell the customer. Never throws. */
async function notifyApplied(storeId: string, editId: string): Promise<string | null> {
  const [edit] = await db().execute<Row>(sql`select notify from commerce.order_edits where store_id = ${storeId}::uuid and id = ${editId}::uuid`);
  if (!edit?.notify) return null;
  const { sendOrderChanged } = await import("./order-edit-emails");
  return sendOrderChanged(storeId, editId).catch(() => "failed");
}

/** A new pay token: 32 random bytes as base64url (43 characters), and its SHA-256 as base64url (`order_edits.pay_token_hash`). */
export function newEditToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashEditToken(token) };
}
export const hashEditToken = (token: string): string => createHash("sha256").update(token).digest("base64url");

/** The change pay page's address in the order's own market view. */
export function editPayLink(store: Pick<EmailStore, "slug">, marketSlugValue: string, token: string): string {
  return `${storeSiteUrl(store.slug)}${marketPath(store.slug, marketSlugValue, `/account/change/${token}`)}`;
}

export type SendEditResult =
  | { ok: true; editId: string; label: string; expiresAt: string; /** The link, shown once (never kept). */ link: string; emailed: string | null }
  | { ok: false; problems: EditProblem[] };

async function takeBucket(storeId: string, bucket: string, limit: number, window: "hour" | "day"): Promise<boolean> {
  const [row] = await db().execute<Row>(sql`
    insert into commerce.chat_usage (store_id, bucket, "window", count)
    values (${storeId}::uuid, ${bucket}, date_trunc(${window}, now()), 1)
    on conflict (store_id, bucket, "window") do update set count = commerce.chat_usage.count + 1
    returning count
  `);
  return Number(row?.count ?? 0) <= limit;
}

/**
 * A change with a higher total (2.2, 4.5): stored `awaiting_payment` with the added units held until the link's end (`EDIT_PAY_DAYS`), the order unchanged.
 * `email: true` sends the customer the change email with the pay link (*Send the customer a pay link*); `false` only returns the link to share. The token is
 * returned once and only its hash is kept.
 */
export async function sendOrderEdit(storeId: string, orderId: string, raw: unknown, actor: OrderActor, options: { email: boolean }): Promise<SendEditResult> {
  const parsed = orderEditInput.safeParse(raw);
  if (!parsed.success) return refused(problem("invalid"));
  if (!actor.accountId) return refused(problem("not_allowed"));
  const computed = await compute(db(), storeId, orderId, parsed.data);
  if (!computed) return refused(problem("not_found"));
  const { preview } = computed;
  if (parsed.data.base !== undefined && !basesMatch(parsed.data.base, preview.base)) return refused(problem("changed"));
  if (!preview.ok) return refused(...preview.problems);
  if (preview.money !== "charge") return refused({ code: "invalid", text: "A pay link is for a change with a higher total: save this change instead." });
  if ((await getCheckoutInfo(storeId, computed.order.marketCode)).paymentsOn === false) return refused(problem("payments_off"));
  if (preview.differenceMinor < minChargeMinor(preview.currency)) return refused(problem("amount_too_small"));
  if (!computed.market) return refused(problem("variant_unavailable"));
  const editId = randomUUID();
  const { token, hash } = newEditToken();
  const expiresAt = new Date(Date.now() + EDIT_PAY_DAYS * 86_400_000);
  // Customers are always told of a change that asks them to pay (it cannot be switched off).
  const computedNotify = { ...computed, input: { ...computed.input, notify: true } };
  try {
    await db().transaction(async (tx) => {
      await writeEdit(tx, { storeId, orderId, editId, actor, computed: computedNotify, status: "awaiting_payment", tokenHash: hash, expiresAt });
      await writeOrderEvent(
        tx,
        storeId,
        orderId,
        FULFILMENT_EVENTS.editSent,
        { edit: editId, label: editLabel(computed.order.editCount + 1), difference: preview.differenceMinor, currency: preview.currency, emailed: options.email, expiresAt: expiresAt.toISOString(), by: actor.accountId, ...(parsed.data.note ? { note: parsed.data.note } : {}) },
        actor.kind,
      );
    });
  } catch (error) {
    const known = refusalOf(error);
    if (known) return refused(known);
    throw error;
  }
  const label = editLabel(computed.order.editCount + 1);
  await audit(actor.accountId, storeId, FULFILMENT_AUDIT_ACTIONS.editSent, { edit: editId, label, differenceMinor: preview.differenceMinor, currency: preview.currency, emailed: options.email }, { target: { type: "order", id: orderId } });
  const link = editPayLink({ slug: (await storeById(storeId))?.slug ?? "" }, computed.market.slug, token);
  let emailed: string | null = null;
  if (options.email) {
    await takeBucket(storeId, `edit:send:${editId}`, EDIT_SENDS_PER_DAY, "day");
    const { sendOrderChangePayLink } = await import("./order-edit-emails");
    emailed = await sendOrderChangePayLink(storeId, editId, token, 1).catch(() => "failed");
  }
  return { ok: true, editId, label, expiresAt: expiresAt.toISOString(), link, emailed };
}

/** *Create a link to share*: as `sendOrderEdit()` without the email. */
export const shareOrderEditLink = (storeId: string, orderId: string, raw: unknown, actor: OrderActor) => sendOrderEdit(storeId, orderId, raw, actor, { email: false });

export type ResendEditResult = { ok: true; link: string; emailed: string | null; expiresAt: string } | { ok: false; problem: "not_found" | "not_waiting" | "limit" | "processing" | "paid" };

/**
 * *Send again* / *Create a link to share* for a change waiting for payment: a NEW token (the old link stops working) and a new end, the change's earlier Stripe
 * sessions closed first (`settleOrderSessions()`: a session found paid applies the change through the webhook path and this answers `paid`). At most
 * `EDIT_SENDS_PER_DAY` emails a day per change.
 */
export async function resendOrderEdit(storeId: string, editId: string, actor: OrderActor, options: { email: boolean }): Promise<ResendEditResult> {
  const [edit] = await db().execute<Row>(sql`select order_id, status, seq from commerce.order_edits where store_id = ${storeId}::uuid and id = ${editId}::uuid`);
  if (!edit) return { ok: false, problem: "not_found" };
  if (edit.status !== "awaiting_payment") return { ok: false, problem: "not_waiting" };
  const orderId = String(edit.order_id);
  if (options.email && !(await takeBucket(storeId, `edit:send:${editId}`, EDIT_SENDS_PER_DAY, "day"))) return { ok: false, problem: "limit" };
  const settled = await settleEditSessions(storeId, orderId);
  if (settled === "paid") return { ok: false, problem: "paid" };
  if (settled === "processing") return { ok: false, problem: "processing" };
  const { token, hash } = newEditToken();
  const expiresAt = new Date(Date.now() + EDIT_PAY_DAYS * 86_400_000);
  const moved = await db().transaction(async (tx) => {
    const [row] = await tx.execute<Row>(sql`
      update commerce.order_edits set pay_token_hash = ${hash}, expires_at = ${expiresAt.toISOString()}::timestamptz
      where store_id = ${storeId}::uuid and id = ${editId}::uuid and status = 'awaiting_payment' returning id
    `);
    if (!row) return false;
    await tx.execute(sql`
      update commerce.inventory_reservations set expires_at = ${expiresAt.toISOString()}::timestamptz
      where store_id = ${storeId}::uuid and order_edit_id = ${editId}::uuid and released_at is null
    `);
    await writeOrderEvent(tx, storeId, orderId, FULFILMENT_EVENTS.editSent, { edit: editId, label: editLabel(Number(edit.seq)), again: true, emailed: options.email, expiresAt: expiresAt.toISOString(), by: actor.accountId }, actor.kind);
    return true;
  });
  if (!moved) return { ok: false, problem: "not_waiting" };
  await audit(actor.accountId, storeId, FULFILMENT_AUDIT_ACTIONS.editSent, { edit: editId, label: editLabel(Number(edit.seq)), again: true, emailed: options.email }, { target: { type: "order", id: orderId } });
  const order = await loadOrder(db(), storeId, orderId);
  const store = await storeById(storeId);
  const market = store && order ? await orderMarket(store, order) : null;
  const link = editPayLink({ slug: store?.slug ?? "" }, market?.slug ?? (order?.marketCode ?? "").toLowerCase(), token);
  let emailed: string | null = null;
  if (options.email) {
    const [n] = await db().execute<Row>(sql`select count(*)::int as n from commerce.order_events where store_id = ${storeId}::uuid and order_id = ${orderId}::uuid and type = ${FULFILMENT_EVENTS.editSent} and data ->> 'edit' = ${editId}`);
    const { sendOrderChangePayLink } = await import("./order-edit-emails");
    emailed = await sendOrderChangePayLink(storeId, editId, token, Number(n?.n ?? 1)).catch(() => "failed");
  }
  return { ok: true, link, emailed, expiresAt: expiresAt.toISOString() };
}

/**
 * Closes the Stripe sessions of one change (D173's `settleOrderSessions()` is per order; a change's sessions are the order's pending Stripe payments that name
 * it, and an awaiting change is the only thing that opens a session on a paid order). `paid` means a session completed and its webhook path applied it.
 */
async function settleEditSessions(storeId: string, orderId: string): Promise<"none" | "closed" | "paid" | "processing"> {
  return settleOrderSessions(storeId, orderId);
}

export type CancelEditResult = { ok: true } | { ok: false; problem: "not_found" | "not_waiting" | "processing" | "paid" };

/**
 * Ends a change waiting for payment (*Cancel the change*, the job's expiry, a confirmed withdrawal or the store closing): its Stripe sessions are closed first
 * (`processing` refuses, so a payment on its way is never orphaned; a session found paid was applied and this answers `paid`), then the change is `cancelled`
 * or `expired` and its held units are released, with the history event. The order was never changed, so nothing else moves.
 */
export async function endOrderEdit(storeId: string, editId: string, how: "cancelled" | "expired", actor: OrderActor, options: { force?: boolean } = {}): Promise<CancelEditResult> {
  const [edit] = await db().execute<Row>(sql`select order_id, status, seq from commerce.order_edits where store_id = ${storeId}::uuid and id = ${editId}::uuid`);
  if (!edit) return { ok: false, problem: "not_found" };
  if (edit.status !== "awaiting_payment") return { ok: false, problem: edit.status === "applied" ? "paid" : "not_waiting" };
  const orderId = String(edit.order_id);
  const settled = await settleEditSessions(storeId, orderId).catch(() => "processing" as const);
  if (settled === "paid") return { ok: false, problem: "paid" };
  if (settled === "processing" && !options.force) return { ok: false, problem: "processing" };
  const done = await db().transaction(async (tx) => endInTransaction(tx, storeId, editId, how, actor));
  if (!done) return { ok: false, problem: "not_waiting" };
  if (how === "cancelled" && actor.accountId) {
    await audit(actor.accountId, storeId, FULFILMENT_AUDIT_ACTIONS.editCancelled, { edit: editId, label: editLabel(Number(edit.seq)) }, { target: { type: "order", id: orderId } });
  }
  return { ok: true };
}

/** *Cancel the change* (staff). */
export const cancelOrderEdit = (storeId: string, editId: string, actor: OrderActor) => endOrderEdit(storeId, editId, "cancelled", actor);

/** The database half of ending a change, in the caller's transaction: the status, the holds released, the event. False when it was not waiting. */
async function endInTransaction(tx: Runner, storeId: string, editId: string, how: "cancelled" | "expired", actor: OrderActor): Promise<boolean> {
  const [row] = await tx.execute<Row>(sql`
    update commerce.order_edits set status = ${how} where store_id = ${storeId}::uuid and id = ${editId}::uuid and status = 'awaiting_payment'
    returning order_id, seq
  `);
  if (!row) return false;
  await tx.execute(sql`update commerce.inventory_reservations set released_at = now() where store_id = ${storeId}::uuid and order_edit_id = ${editId}::uuid and released_at is null`);
  await writeOrderEvent(
    tx,
    storeId,
    String(row.order_id),
    how === "cancelled" ? FULFILMENT_EVENTS.editCancelled : FULFILMENT_EVENTS.editExpired,
    { edit: editId, label: editLabel(Number(row.seq)), by: actor.accountId },
    actor.kind,
  );
  return true;
}

/**
 * A confirmed withdrawal never waits for a change (2.2, 4.5): inside the withdrawal's own transaction the change waiting for payment is cancelled and its units
 * released. Its Stripe sessions are closed after the commit (`closeEditSessionsAfterWithdrawal()`); a payment that still arrives is refunded in full by
 * `completeEditPayment()` (2.7).
 */
export async function cancelEditsForWithdrawal(tx: Runner, storeId: string, orderId: string): Promise<string[]> {
  const rows = await tx.execute<Row>(sql`select id from commerce.order_edits where store_id = ${storeId}::uuid and order_id = ${orderId}::uuid and status = 'awaiting_payment'`);
  const ended: string[] = [];
  for (const r of rows) if (await endInTransaction(tx, storeId, String(r.id), "cancelled", { accountId: null, kind: "system" })) ended.push(String(r.id));
  return ended;
}

/** After a withdrawal's commit: the cancelled change's open Stripe sessions are closed (best effort; a late payment is refunded by its own path). Never throws. */
export async function closeEditSessionsAfterWithdrawal(storeId: string, orderId: string): Promise<void> {
  await settleOrderSessions(storeId, orderId).catch(() => null);
}

export type PaidOutsideEditResult = { ok: true; editId: string; label: string; /** Cash at or above a `warn` country's ceiling (D173's rule): recorded, with a notice. */ cashWarning?: boolean } | { ok: false; problems: EditProblem[] };

/**
 * Cash for a change is held to the country's cash ceiling as cash for a draft is (D173, `src/lib/cash-limits.ts`: Norway refuses 40,000 NOK or more, hvitvaskingsloven
 * § 5). A change belongs to its order's sale, so what counts is the ORDER's cash for the transaction: every captured cash payment of the order recorded outside
 * Kaizen plus this change's difference. Checked under the order's row lock (the caller's transaction); throws `EditRefused("cash_limit")` for a `refuse` rule and
 * returns true for a `warn` one. Payments by bank transfer or other means are not cash and are not checked.
 */
async function checkEditCash(tx: Runner, storeId: string, orderId: string, differenceMinor: number, currency: string): Promise<boolean> {
  const [order] = await tx.execute<Row>(sql`
    select trim(o.market_code) as market_code,
      (select coalesce(sum(p.amount_minor), 0) from commerce.payments p
        where p.store_id = o.store_id and p.order_id = o.id and p.provider = 'manual' and p.method = 'cash' and p.status = 'captured') as cash
    from commerce.orders o where o.store_id = ${storeId}::uuid and o.id = ${orderId}::uuid for update of o
  `);
  if (!order) throw new EditRefused("not_found");
  const code = String(order.market_code);
  const check = checkCash(code, Number(order.cash ?? 0) + differenceMinor, currency, await cashLimitInCurrency(storeId, code, currency));
  if (check.kind === "refuse") throw new EditRefused("cash_limit");
  return check.kind === "warn";
}

/**
 * *Record as paid outside Kaizen* (D173's rule: the owner, or staff when `staff_mark_paid` is on): a `manual` payment of the difference that names the change,
 * with its method, reference (in the event's `data.note`) and the day received, and the change applied in the same transaction. For a change already waiting
 * (`target.editId`: its sessions are closed first) or a new one (`target.raw`: priced as the editor sent it).
 */
export async function recordEditPaidOutside(
  storeId: string,
  target: { editId: string } | { orderId: string; raw: unknown },
  rawOutside: unknown,
  actor: OrderActor,
): Promise<PaidOutsideEditResult> {
  const outside = editPaidOutsideInput.safeParse(rawOutside);
  if (!outside.success) return refused(problem("invalid"));
  if (!actor.accountId || !(await accountMayRecordOutside(storeId, actor.accountId))) return refused(problem("not_allowed"));
  if (outside.data.receivedOn) {
    const [day] = await db().execute<Row>(sql`
      select commerce.store_day(${storeId}::uuid, now())::text as today, (commerce.store_day(${storeId}::uuid, now()) - ${MANUAL_RECEIVED_DAYS_MAX}::int)::text as earliest
    `);
    if (outside.data.receivedOn > String(day?.today) || outside.data.receivedOn < String(day?.earliest)) {
      return refused({ code: "invalid", text: `The day received is not in the future and at most ${MANUAL_RECEIVED_DAYS_MAX} days back.` });
    }
  }
  let editId: string;
  let label: string;
  let differenceMinor: number;
  let currency: string;
  let orderId: string;
  let cashWarning = false;
  try {
    if ("editId" in target) {
      const [edit] = await db().execute<Row>(sql`select order_id, status, seq, difference_minor, currency from commerce.order_edits where store_id = ${storeId}::uuid and id = ${target.editId}::uuid`);
      if (!edit) return refused(problem("not_found"));
      if (edit.status !== "awaiting_payment") return refused({ code: "invalid", text: "This change is not waiting for payment." });
      orderId = String(edit.order_id);
      const settled = await settleEditSessions(storeId, orderId);
      if (settled === "paid") return refused({ code: "invalid", text: "The customer has paid this change already." });
      if (settled === "processing") return refused({ code: "invalid", text: "A card payment for this change is still being processed: wait for it." });
      editId = target.editId;
      label = editLabel(Number(edit.seq));
      differenceMinor = Number(edit.difference_minor);
      currency = String(edit.currency).trim();
      await db().transaction(async (tx) => {
        if (outside.data.method === "cash") cashWarning = await checkEditCash(tx, storeId, orderId, differenceMinor, currency);
        const paymentId = await insertManualPayment(tx, storeId, orderId, editId, differenceMinor, currency, outside.data, actor.accountId as string);
        await applyAwaiting(tx, storeId, editId, paymentId, actor);
        await writeOrderEvent(tx, storeId, orderId, FULFILMENT_EVENTS.editPaidOutside, paidOutsideEvent(editId, label, outside.data), actor.kind);
      });
    } else {
      const parsed = orderEditInput.safeParse(target.raw);
      if (!parsed.success) return refused(problem("invalid"));
      orderId = target.orderId;
      const computed = await compute(db(), storeId, orderId, parsed.data);
      if (!computed) return refused(problem("not_found"));
      const { preview } = computed;
      if (parsed.data.base !== undefined && !basesMatch(parsed.data.base, preview.base)) return refused(problem("changed"));
      // A payment taken outside Kaizen does not move money through Stripe: payments being off is no reason to refuse it.
      const blocking = preview.problems.filter((p) => p.code !== "payments_off" && p.code !== "test_mode");
      if (blocking.length > 0 || !preview.priced?.ok) return refused(...(blocking.length > 0 ? blocking : preview.problems));
      if (preview.money !== "charge") return refused({ code: "invalid", text: "Only a change with a higher total is paid: save this change instead." });
      editId = randomUUID();
      label = editLabel(computed.order.editCount + 1);
      differenceMinor = preview.differenceMinor;
      currency = preview.currency;
      const notifying = { ...computed, input: { ...computed.input, notify: true } };
      await db().transaction(async (tx) => {
        // The change is written first (applied), then its payment, then the order: the payment names the change, and the change names it back (checked at commit).
        if (outside.data.method === "cash") cashWarning = await checkEditCash(tx, storeId, orderId, differenceMinor, currency);
        await writeEditApplied(tx, { storeId, orderId, editId, actor, computed: notifying, status: "applied" }, async () =>
          insertManualPayment(tx, storeId, orderId, editId, differenceMinor, currency, outside.data, actor.accountId as string),
        );
        await writeOrderEvent(tx, storeId, orderId, FULFILMENT_EVENTS.editPaidOutside, paidOutsideEvent(editId, label, outside.data), actor.kind);
      });
    }
  } catch (error) {
    const known = refusalOf(error);
    if (known) return refused(known);
    throw error;
  }
  await audit(actor.accountId, storeId, FULFILMENT_AUDIT_ACTIONS.editPaidOutside, { edit: editId, label, method: outside.data.method, amountMinor: differenceMinor, currency }, { target: { type: "order", id: orderId } });
  await notifyApplied(storeId, editId);
  return { ok: true, editId, label, ...(cashWarning ? { cashWarning } : {}) };
}

const paidOutsideEvent = (editId: string, label: string, input: { method: string; receivedOn?: string; reference?: string }) => ({
  edit: editId,
  label,
  method: input.method,
  ...(input.receivedOn ? { receivedOn: input.receivedOn } : {}),
  ...(input.reference ? { note: input.reference } : {}),
});

async function insertManualPayment(
  tx: Runner,
  storeId: string,
  orderId: string,
  editId: string,
  amountMinor: number,
  currency: string,
  input: { method: string; receivedOn?: string },
  accountId: string,
): Promise<string> {
  const [row] = await tx.execute<Row>(sql`
    insert into commerce.payments (store_id, order_id, provider, provider_reference, amount_minor, currency, status, kaizen_fee_minor, method, recorded_by, received_on, order_edit_id)
    values (${storeId}::uuid, ${orderId}::uuid, 'manual', ${`manual_edit_${randomUUID()}`}, ${amountMinor}, ${currency}, 'captured', 0, ${input.method}, ${accountId}::uuid,
            ${input.receivedOn ?? null}::date, ${editId}::uuid)
    returning id
  `);
  return String(row.id);
}

/** A new change written applied with a payment made inside the same transaction (the payment names the change, so the change is written first). */
async function writeEditApplied(tx: Db, args: WriteArgs, pay: () => Promise<string>): Promise<void> {
  const { storeId, orderId, editId, computed } = args;
  const fresh = await compute(tx, storeId, orderId, computed.input, { lock: true });
  if (!fresh) throw new EditRefused("not_found");
  if (!basesMatch(fresh.preview.base, computed.preview.base)) throw new EditRefused("changed");
  // Stored waiting for a moment (no link is ever shown), then paid and applied: the one path `applyAwaiting()` takes for a payment.
  const { hash } = newEditToken();
  await writeEdit(tx, { ...args, status: "awaiting_payment", tokenHash: hash, expiresAt: new Date(Date.now() + 60_000) });
  const paymentId = await pay();
  await applyAwaiting(tx, storeId, editId, paymentId, args.actor);
}

/**
 * Applies a change that waited for payment, in the caller's transaction: the order locked, the change re-priced from what was stored (the same quantities, the
 * same added lines at the price and VAT shown) and held equal to it, then written as applied with its payment. Throws `EditRefused` when the order moved.
 */
async function applyAwaiting(tx: Db, storeId: string, editId: string, paymentId: string, actor: OrderActor): Promise<void> {
  const [edit] = await tx.execute<Row>(sql`select * from commerce.order_edits where store_id = ${storeId}::uuid and id = ${editId}::uuid for update`);
  if (!edit || edit.status !== "awaiting_payment") throw new EditRefused("changed");
  const orderId = String(edit.order_id);
  const lines = await tx.execute<Row>(sql`select * from commerce.order_edit_lines where store_id = ${storeId}::uuid and order_edit_id = ${editId}::uuid order by n`);
  const base = (edit.base ?? {}) as ReturnType<typeof editBase> & { noRestock?: string[] };
  const quantities: Record<string, number> = {};
  for (const l of lines) {
    if (l.kind === "add" || !l.order_line_id) continue;
    const was = base.lines?.find((b) => b.lineId === String(l.order_line_id))?.quantity ?? 0;
    quantities[String(l.order_line_id)] = l.kind === "remove" ? 0 : was - Number(l.quantity);
  }
  const addLines = lines.filter((l) => l.kind === "add");
  const storedTax = new Map(addLines.map((l, i) => [`add:a${i + 1}`, Number(l.tax_minor)]));
  const input: OrderEditInput = {
    quantities,
    added: addLines.map((l) => ({ variantId: String(l.variant_id), quantity: Number(l.quantity), unitPriceMinor: Number(l.unit_price_minor) })),
    shipping: Number(edit.shipping_after) === Number(edit.shipping_before) ? { kind: "keep" } : { kind: "set", amountMinor: Number(edit.shipping_after) },
    reason: String(edit.reason) as OrderEditReason,
    notify: Boolean(edit.notify),
    restock: Boolean(edit.restock),
    noRestock: base.noRestock ?? [],
  };
  const computed = await compute(tx, storeId, orderId, input, { lock: true, storedTax });
  if (!computed?.preview.priced) throw new EditRefused("changed");
  const priced = computed.preview.priced;
  // The order must stand as it did when the change was made, and the change must price as it did: anything else is not what the customer paid for.
  if (!basesMatch(computed.preview.base, base) || priced.differenceMinor !== Number(edit.difference_minor) || priced.after.totalMinor !== Number(edit.total_after)) {
    throw new EditRefused("changed");
  }
  // Only what a change of a paid order needs: the order may not be blocked for any reason but the change itself waiting.
  if (computed.order.block && computed.order.block !== "edit_pending") throw new EditRefused(computed.order.block);
  await tx.execute(sql`select set_config('kaizen.order_edit', ${orderId}, true)`);
  await tx.execute(sql`update commerce.order_edits set status = 'applied' where store_id = ${storeId}::uuid and id = ${editId}::uuid`);
  await applyPriced(tx, { storeId, orderId, editId, actor, computed: { ...computed, order: { ...computed.order, editCount: Number(edit.seq) - 1 } }, status: "applied", paymentId, priced });
}

// ---------------------------------------------------------------------------------------------------------------------
// The customer's payment (the webhook and the return from Stripe), and the job
// ---------------------------------------------------------------------------------------------------------------------

export type EditPaymentOutcome = "applied" | "already" | "refunded" | "not_edit" | "failed";

/**
 * A completed Stripe session of a change's difference (`applySession()` branches here on `payments.order_edit_id`, before anything else, and never calls
 * `complete_order_payment()` for it): in one transaction under the order's lock the payment row is captured and the change applied. Applying twice is a no-op
 * (`already`). A payment for a change that can no longer be applied (cancelled or expired while Stripe was processing, or the order moved) is refunded in full
 * at once from that payment (2.7), with the event `order.edit_payment_refunded`; nothing else changes.
 */
export async function completeEditPayment(storeId: string, sessionId: string): Promise<EditPaymentOutcome> {
  const [payment] = await db().execute<Row>(sql`
    select id, order_id, order_edit_id, status from commerce.payments where store_id = ${storeId}::uuid and provider = 'stripe' and provider_reference = ${sessionId}
  `);
  if (!payment?.order_edit_id) return "not_edit";
  const paymentId = String(payment.id);
  const editId = String(payment.order_edit_id);
  const orderId = String(payment.order_id);
  const [edit] = await db().execute<Row>(sql`select status, payment_id, seq from commerce.order_edits where store_id = ${storeId}::uuid and id = ${editId}::uuid`);
  if (edit?.status === "applied" && String(edit.payment_id) === paymentId) return "already";
  let applied = false;
  try {
    applied = await db().transaction(async (tx) => {
      await tx.execute(sql`select id from commerce.orders where store_id = ${storeId}::uuid and id = ${orderId}::uuid for update`);
      const [locked] = await tx.execute<Row>(sql`select status from commerce.order_edits where store_id = ${storeId}::uuid and id = ${editId}::uuid for update`);
      if (locked?.status !== "awaiting_payment") return false;
      await tx.execute(sql`update commerce.payments set status = 'captured', updated_at = now() where store_id = ${storeId}::uuid and id = ${paymentId}::uuid`);
      await applyAwaiting(tx, storeId, editId, paymentId, { accountId: null, kind: "system" });
      return true;
    });
  } catch (error) {
    if (!refusalOf(error)) throw error;
    applied = false;
  }
  if (applied) {
    await notifyApplied(storeId, editId);
    return "applied";
  }
  // Already applied by a concurrent call with this payment?
  const [now] = await db().execute<Row>(sql`select status, payment_id from commerce.order_edits where store_id = ${storeId}::uuid and id = ${editId}::uuid`);
  if (now?.status === "applied" && String(now.payment_id) === paymentId) return "already";
  // The money arrived for a change that cannot be applied: given back in full, from this payment.
  await db().execute(sql`update commerce.payments set status = 'captured', updated_at = now() where store_id = ${storeId}::uuid and id = ${paymentId}::uuid and status <> 'captured'`);
  const [amount] = await db().execute<Row>(sql`select amount_minor from commerce.payments where store_id = ${storeId}::uuid and id = ${paymentId}::uuid`);
  const [done] = await db().execute<Row>(sql`select 1 from commerce.refunds where store_id = ${storeId}::uuid and payment_id = ${paymentId}::uuid and status::text <> 'failed'`);
  if (done) return "refunded";
  const refund = await refundOrder(
    storeId,
    orderId,
    { amountMinor: Number(amount?.amount_minor ?? 0), reason: "The order changed before the payment arrived", restock: [] },
    null,
    {
      paymentId,
      whileEditPending: true,
      idempotencyKey: `order-edit-late:${paymentId}`,
      eventData: { edit: editId, late: true },
      inTransaction: async (tx, result) => {
        if (result.refundId) await tx.execute(sql`update commerce.refunds set order_edit_id = ${editId}::uuid where store_id = ${storeId}::uuid and id = ${result.refundId}::uuid`);
        await writeOrderEvent(tx, storeId, orderId, FULFILMENT_EVENTS.editPaymentRefunded, { edit: editId, label: editLabel(Number(edit?.seq ?? 0)), refund: result.refundId, amount: Number(amount?.amount_minor ?? 0) }, "system");
      },
    },
  );
  if (!refund.ok) {
    console.error("[order-edits] a late payment for a change could not be refunded", { storeId, orderId, editId });
    return "failed";
  }
  const { sendRefunded } = await import("./shopper-emails");
  await sendRefunded(storeId, orderId, refund.refundId, refund.amountMinor).catch(() => null);
  return "refunded";
}

/** A Stripe session of a change's difference that expired or failed: only its payment row is marked (the order is paid; nothing is cancelled). */
export async function markEditSessionEnded(storeId: string, sessionId: string, status: "cancelled" | "failed"): Promise<boolean> {
  const rows = await db().execute<Row>(sql`
    update commerce.payments set status = ${status}, updated_at = now()
    where store_id = ${storeId}::uuid and provider = 'stripe' and provider_reference = ${sessionId} and order_edit_id is not null and status = 'pending'
    returning id
  `);
  return rows.length > 0;
}

export type ExpireEditsRun = { expired: number; waiting: number; paid: number };

/**
 * The five-minute job (`/api/cron/cart-reminders`): changes whose link has ended are expired, after their Stripe sessions are closed; a session found paid is
 * applied (not expired) and one still processing makes the job wait. Per store, never throwing.
 */
export async function expireOrderEdits(now: Date = new Date(), options: { limit?: number } = {}): Promise<ExpireEditsRun> {
  const run: ExpireEditsRun = { expired: 0, waiting: 0, paid: 0 };
  const due = await db().execute<Row>(sql`
    select store_id, id from commerce.order_edits where status = 'awaiting_payment' and expires_at <= ${now.toISOString()}::timestamptz
    order by expires_at limit ${options.limit ?? 100}
  `);
  for (const row of due) {
    try {
      const done = await endOrderEdit(String(row.store_id), String(row.id), "expired", { accountId: null, kind: "system" });
      if (done.ok) run.expired += 1;
      else if (done.problem === "paid") run.paid += 1;
      else if (done.problem === "processing") run.waiting += 1;
    } catch (error) {
      console.error("[order-edits] expiring a change failed", row.id, error instanceof Error ? error.message : error);
    }
  }
  return run;
}

/** A store that closes (D171) cancels its changes waiting for payment: their sessions closed first, their units released. Never throws. */
export async function cancelEditsForClosure(storeId: string): Promise<number> {
  const rows = await db().execute<Row>(sql`select id from commerce.order_edits where store_id = ${storeId}::uuid and status = 'awaiting_payment'`);
  let n = 0;
  for (const r of rows) {
    const done = await endOrderEdit(storeId, String(r.id), "cancelled", { accountId: null, kind: "system" }, { force: true }).catch(() => null);
    if (done?.ok) n += 1;
  }
  return n;
}

// ---------------------------------------------------------------------------------------------------------------------
// Reads for the pages
// ---------------------------------------------------------------------------------------------------------------------

/** Whether the order can be edited now, and if not why (the order page shows *Edit items* or the reason). Null for another store's order. */
export async function orderEditability(storeId: string, orderId: string): Promise<{ block: EditBlockReason | null; text: string | null; awaiting: EditableOrder["awaiting"] } | null> {
  const order = await loadOrder(db(), storeId, orderId);
  if (!order) return null;
  return { block: order.block, text: order.block ? orderEditProblemText(order.block) : null, awaiting: order.awaiting };
}

/** One change with its lines, for the order page and the pay page. Null when it is not this store's. */
export type OrderEditView = {
  id: string;
  orderId: string;
  seq: number;
  label: string;
  status: OrderEditStatus;
  reason: OrderEditReason;
  currency: string;
  totalBeforeMinor: number;
  totalAfterMinor: number;
  shippingBeforeMinor: number;
  shippingAfterMinor: number;
  differenceMinor: number;
  documents: string;
  expiresAt: string | null;
  appliedAt: string | null;
  endedAt: string | null;
  createdAt: string;
  lines: { n: number; kind: "add" | "remove" | "reduce"; sku: string; title: string; quantity: number; unitPriceMinor: number; totalMinor: number; taxMinor: number }[];
};

export async function getOrderEdit(storeId: string, editId: string, runner: Runner = db()): Promise<OrderEditView | null> {
  const [e] = await runner.execute<Row>(sql`select * from commerce.order_edits where store_id = ${storeId}::uuid and id = ${editId}::uuid`);
  if (!e) return null;
  const lines = await runner.execute<Row>(sql`select n, kind, sku, title, quantity, unit_price_minor, total_minor, tax_minor from commerce.order_edit_lines where store_id = ${storeId}::uuid and order_edit_id = ${editId}::uuid order by n`);
  const iso = (v: unknown) => (v ? new Date(String(v)).toISOString() : null);
  return {
    id: String(e.id),
    orderId: String(e.order_id),
    seq: Number(e.seq),
    label: editLabel(Number(e.seq)),
    status: String(e.status) as OrderEditStatus,
    reason: String(e.reason) as OrderEditReason,
    currency: String(e.currency).trim(),
    totalBeforeMinor: Number(e.total_before),
    totalAfterMinor: Number(e.total_after),
    shippingBeforeMinor: Number(e.shipping_before),
    shippingAfterMinor: Number(e.shipping_after),
    differenceMinor: Number(e.difference_minor),
    documents: String(e.documents),
    expiresAt: iso(e.expires_at),
    appliedAt: iso(e.applied_at),
    endedAt: iso(e.ended_at),
    createdAt: iso(e.created_at) as string,
    lines: lines.map((l) => ({
      n: Number(l.n),
      kind: String(l.kind) as "add" | "remove" | "reduce",
      sku: String(l.sku),
      title: String(l.title),
      quantity: Number(l.quantity),
      unitPriceMinor: Number(l.unit_price_minor),
      totalMinor: Number(l.total_minor),
      taxMinor: Number(l.tax_minor),
    })),
  };
}

/** The order's market view as a change is priced in it (for the pay page and the emails). */
export async function marketOfOrder(storeId: string, orderId: string): Promise<{ store: EmailStore; market: Market } | null> {
  const order = await loadOrder(db(), storeId, orderId);
  const store = await storeById(storeId);
  if (!order || !store) return null;
  const market = await orderMarket(store, order);
  return market ? { store, market } : null;
}
