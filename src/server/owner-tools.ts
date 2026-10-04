import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { summarizeUsage } from "@/lib/ai-usage";
import { formatMoney } from "@/lib/money";
import { OWNER_TOOLS_BY_NAME, readToolInput, type OwnerToolInput, type OwnerToolName } from "@/lib/owner-tools";
import { mayUseTool, toolRefusal } from "@/lib/owner-tool-permissions";
import type { PermissionHolder } from "@/lib/permissions";
import { auditProblems } from "@/lib/order-numbers";
import { marketPath, storeHref } from "@/lib/paths";
import { parsePrice } from "@/lib/product-input";

import { audit, type Account } from "./auth";
import { OwnerToolError } from "./owner-tool-error";
import {
  applyWinnerTool,
  draftExperimentTool,
  explainResultsTool,
  listExperimentsTool,
  preflightExperimentTool,
  startExperimentTool,
  stopExperimentTool,
  suggestExperimentsTool,
} from "./experiment-tools";
import { cancelBooking, listBookings } from "./bookings";
import { cartReminderStats } from "./cart-reminders";
import { approveReturnTool, declineReturnTool, explainReturnTool, listReturnsTool, preflightReturnTool } from "./return-tools";
import { findCustomer, getCustomerDetail, listCustomers } from "./customer-admin";
import { listEmails } from "./email";
import { findClaims } from "@/lib/claims";
import { fieldShows, groupApplies, isEmptyValue, isStaffEntity, isTranslatable, readField, valuesFor, type Facts } from "@/lib/custom-fields";
import {
  buildFieldGroup,
  describeLocation,
  entityWords,
  fieldValueText,
  groupTexts,
  prepareValues,
  termIdsInRules,
  wordsIn,
  type ToolFieldEntity,
} from "@/lib/field-tools";
import { t } from "@/lib/i18n";

import { activeFieldGroups, fieldsTag, getFieldData, listFieldGroups, pageFacts, productFacts, saveFieldData, saveFieldGroup, storeRuleFacts } from "./custom-fields";
import { listIntegrations, postToSlack } from "./integrations";
import { ownedStores, usageRows } from "./ai-usage";
import { analyticsAlertsTool, analyticsOverviewTool, explainChangeTool } from "./analytics-tools";
import { customerInsights, productPerformance, restockSuggestions, salesFunnel, salesTrend } from "./owner-insights";
import { getSetupProgress } from "./setup";
import { deliveryRounds } from "./standing-orders";
import { listSubscriptions } from "./subscriptions";
import { mostWishedProducts, wishlistFigures } from "./wishlist-admin";
import { BONUS_DEFAULTS, bonusSettingsInput, type BonusSettings } from "@/lib/bonus";
import {
  BONUS_ACCOUNTING_NOTE,
  BONUS_EXPLANATION,
  bpsToPercentText,
  moneyIn,
  overviewRows,
  percentTextToBps,
  readAdjustment,
  rulesSummary,
} from "@/lib/bonus-admin";
import { mainCurrency } from "@/lib/markets";
import { adjustBonus, bonusOverview, customerBonus, getBonusSettings, saveBonusSettings } from "./bonus";
import { AFFILIATE_DEFAULTS, affiliateSettingsInput, type AffiliateSettings } from "@/lib/affiliates";
import {
  AFFILIATE_EXPLANATION,
  AFFILIATE_NEEDS_BONUS,
  attributionStatus,
  example as affiliateExample,
  overviewRows as affiliateOverviewRows,
  rulesSummary as affiliateRulesSummary,
} from "@/lib/affiliate-admin";
import { affiliateOverview, affiliateTag, customerAffiliate, getAffiliateSettings, saveAffiliateSettings, setAffiliateBlocked } from "./affiliates";
import { cookiesTag } from "./site-cookies";
import { catalogTag } from "./catalog";
import { contentCounts, productsNeedingMeasure, variantUnitPrices } from "./unit-price-gaps";
import { contentWords, unitPriceAnswer } from "@/lib/unit-price-tools";
import { recommendationReport } from "./recommend-events";
import { REPLAY_ORDERS, replayOnOrders } from "./recommend-eval";
import {
  addRule,
  getRecommendSettingsFresh,
  listRules,
  recommendTag,
  removeRuleBetween,
  saveRecommendSettingsValues,
  tokensUsedThisMonth,
} from "./recommend-settings";
import { settingsProblems, type RecommendSettings } from "@/lib/recommendations";
import { campaignsTag } from "./campaign-notices";
import { listCampaigns, saveCampaign, setCampaignActive } from "./campaigns";
import { campaignStatus, describeCampaign } from "@/lib/campaigns";
import { listDiscounts, saveDiscount } from "./discounts";
import { getInvoiceSettings, invoiceReadiness, seriesStates } from "./invoice-settings";
import { invoiceCheckupFindings, invoiceCounts, listCreditNotes, listInvoices, waitingCreditNotes, waitingInvoices } from "./invoices";
import { orderNumberAudit } from "./order-numbers";
import { taxCheckupFindings, taxProfileView } from "./tax-profile";
import { addOrderNote, CARRIERS, getOrderAdmin, markSent, refundOrder } from "./order-admin";
import { listOrders } from "./orders";
import { listPages, pagesTag, unpublishPage } from "./pages";
import { listAdminProducts, setArchived } from "./products";
import { sendBookingCancelled, sendOrderConfirmation, sendRefunded, sendShipped, sendStoreMessage } from "./shopper-emails";
import { storeTag, type Store } from "./stores";

type Row = Record<string, unknown>;

/**
 * What the owner assistant's tools do (D94): the store's own reads and
 * writes, for one store and its owner. Answers are small JSON the model
 * repeats: amounts are written out here in the store's own format, and
 * totals and averages worked out here, never by the model.
 */

export type OwnerToolContext = {
  account: Account;
  store: Store;
  /** Refreshes a cache tag: `updateTag` in a server action, `revalidateTag` in a route. */
  invalidate: (tag: string) => void;
  /**
   * Who the tools work for, for the permission each tool needs (`src/lib/owner-tool-permissions.ts`). The assistant and the store's MCP server
   * pass the member's own; a run with none is an owner's (the assistant is the owner's alone in this wave), which is what tests and internal runs are.
   */
  holder?: PermissionHolder;
};

/** Refuses, in the assistant's words, a tool the member's role does not hold the permission for. */
function requireToolPermission(ctx: OwnerToolContext, name: string): void {
  if (!mayUseTool(ctx.holder ?? { role: "owner" }, name)) fail(toolRefusal(name));
}

export { OwnerToolError };

const fail = (message: string): never => {
  throw new OwnerToolError(message);
};

const mainLocale = (store: Store) => store.markets[0]?.locale ?? "en";
const money = (store: Store, minor: number, currency: string) => formatMoney(minor, currency, mainLocale(store));

/**
 * An order by its number or id, the store's only. History copied from another store (D129) can be read
 * (`read: true`) but never acted on: anything that changes an order, sends about it or refunds it is refused.
 */
async function findOrderId(store: Store, ref: string, { read = false }: { read?: boolean } = {}): Promise<string> {
  const byId = /^[0-9a-f-]{36}$/i.test(ref);
  const [row] = await db().execute<Row>(sql`
    select id, copied_from is not null as copied from commerce.orders
    where store_id = ${store.id}::uuid and ${byId ? sql`id = ${ref}::uuid` : sql`number = ${ref.replace(/^#/, "")}`}
  `);
  if (row && Boolean(row.copied) && !read) {
    return fail(`Order ${ref} is history copied from another store, so it is read-only: nothing can be changed, sent or refunded.`);
  }
  return row ? String(row.id) : fail(`No order ${ref} in this store.`);
}

/** A product by id, handle or title, the store's only; a title that fits several says so. */
async function findProductId(store: Store, ref: string): Promise<string> {
  const byId = /^[0-9a-f-]{36}$/i.test(ref);
  const rows = await db().execute<Row>(sql`
    select distinct p.id, p.handle from commerce.products p
    left join commerce.product_translations t on t.product_id = p.id
    where p.store_id = ${store.id}::uuid
      and ${byId ? sql`p.id = ${ref}::uuid` : sql`(p.handle = ${ref} or lower(t.title) = lower(${ref}))`}
    limit 3
  `);
  if (rows.length === 0) return fail(`No product "${ref}" in this store. Use list_products to find it.`);
  if (rows.length > 1) return fail(`Several products match "${ref}": ${rows.map((r) => r.handle).join(", ")}. Name one by its handle.`);
  return String(rows[0].id);
}

// Reading ----------------------------------------------------------------------

async function storeOverview({ store }: OwnerToolContext) {
  const [counts] = await db().execute<Row>(sql`
    select
      (select count(*)::int from commerce.products where store_id = ${store.id}::uuid and status = 'active') as active_products,
      (select count(*)::int from commerce.products where store_id = ${store.id}::uuid and status = 'draft') as draft_products,
      (select count(*)::int from commerce.orders where store_id = ${store.id}::uuid and status in ('paid', 'fulfilled', 'closed') and copied_from is null) as orders,
      (select count(*)::int from commerce.orders where store_id = ${store.id}::uuid and status = 'paid' and copied_from is null) as orders_to_handle
  `);
  return {
    name: store.name,
    status: store.status,
    address: storeHref(store.slug, marketPath(store.slug, store.markets[0]?.slug ?? "")),
    payments: store.paymentsOn ? (store.paymentsTest ? "on, in test mode" : "on") : "off",
    sells_to: store.audience,
    bookings_module: store.bookingsOn,
    work_module: store.workOn,
    time_zone: store.timeZone,
    countries: store.markets.map((m) => ({ code: m.code, name: m.name, currency: m.currency, language: m.lang })),
    products: { active: Number(counts.active_products), drafts: Number(counts.draft_products) },
    orders: { taken: Number(counts.orders), paid_not_yet_sent: Number(counts.orders_to_handle) },
  };
}

async function salesSummary({ store }: OwnerToolContext, { days }: OwnerToolInput<"sales_summary">) {
  // The period starts at midnight in the store's time zone, `days` days back counting today.
  const since = sql`(date_trunc('day', now() at time zone ${store.timeZone}) - make_interval(days => ${days - 1})) at time zone ${store.timeZone}`;
  const paid = sql`(o.copied_from is null and exists (select 1 from commerce.payments p where p.order_id = o.id and p.status = 'captured'))`;
  const [totals, refunds, top] = await Promise.all([
    db().execute<Row>(sql`
      select o.currency, count(*)::int as orders, sum(o.total_minor)::bigint as total
      from commerce.orders o
      where o.store_id = ${store.id}::uuid and o.placed_at >= ${since} and ${paid}
      group by o.currency order by total desc
    `),
    db().execute<Row>(sql`
      select o.currency, sum(r.amount_minor)::bigint as refunded
      from commerce.refunds r
      join commerce.payments p on p.store_id = r.store_id and p.id = r.payment_id
      join commerce.orders o on o.store_id = p.store_id and o.id = p.order_id
      where r.store_id = ${store.id}::uuid and r.status = 'succeeded' and r.created_at >= ${since}
      group by o.currency
    `),
    db().execute<Row>(sql`
      select l.title, sum(l.quantity)::int as quantity
      from commerce.order_lines l join commerce.orders o on o.store_id = l.store_id and o.id = l.order_id
      where o.store_id = ${store.id}::uuid and o.placed_at >= ${since} and ${paid} and l.variant_id is not null
      group by l.title order by quantity desc, l.title limit 5
    `),
  ]);
  const refunded = new Map(refunds.map((r) => [String(r.currency), Number(r.refunded)]));
  return {
    period: days === 1 ? "today" : `the last ${days} days, today included`,
    per_currency: totals.map((t) => {
      const currency = String(t.currency);
      const orders = Number(t.orders);
      const total = Number(t.total);
      const back = refunded.get(currency) ?? 0;
      return {
        currency,
        paid_orders: orders,
        taken: money(store, total, currency),
        refunded: money(store, back, currency),
        after_refunds: money(store, total - back, currency),
        average_order: money(store, Math.round(total / orders), currency),
      };
    }),
    best_sellers: top.map((t) => ({ product: String(t.title), sold: Number(t.quantity) })),
    note: totals.length === 0 ? "No paid orders in this period." : "Totals include VAT and shipping, as charged.",
  };
}

async function listOrdersTool({ store }: OwnerToolContext, input: OwnerToolInput<"list_orders">) {
  const rows = await listOrders(store.id, { unpaid: input.which === "unpaid", toSend: input.which === "to_send" });
  const search = input.search?.toLowerCase();
  const found = search
    ? rows.filter((o) => [o.number, o.email, o.name ?? ""].some((v) => v.toLowerCase().includes(search.replace(/^#/, ""))))
    : rows;
  return {
    count: found.length,
    orders: found.slice(0, input.limit).map((o) => ({
      number: o.number,
      status: o.status,
      customer: o.name ?? o.email,
      email: o.email,
      placed: o.placedAt,
      total: money(store, o.totalMinor, o.currency),
      items: o.items,
      // History copied from another store (D129): read-only, and in no sales figure.
      ...(o.copied ? { copied_history: true } : {}),
    })),
  };
}

async function getOrderTool({ store }: OwnerToolContext, { order }: OwnerToolInput<"get_order">) {
  const view = await getOrderAdmin(store.id, await findOrderId(store, order, { read: true }));
  if (!view) return fail(`No order ${order} in this store.`);
  const m = (minor: number) => money(store, minor, view.currency);
  return {
    number: view.number,
    status: view.status,
    ...(view.copied ? { copied_history: "This order was copied from another store: it is read-only history." } : {}),
    placed: view.placedAt,
    customer: { email: view.email, name: view.shippingAddress?.name ?? view.billingAddress?.name ?? null },
    country: view.marketCode,
    lines: view.lines.map((l) => ({
      title: l.title,
      sku: l.sku,
      quantity: l.quantity,
      total: m(l.totalMinor),
      delivery: l.delivery,
      booking: l.booking ? { kind: l.booking.kind, starts: l.booking.startsAt, ends: l.booking.endsAt, status: l.booking.status, with: l.booking.staff } : null,
    })),
    subtotal: m(view.subtotalMinor),
    shipping: m(view.shippingMinor),
    discount: view.discountMinor ? { code: view.discountCode, off: m(view.discountMinor) } : null,
    vat: m(view.taxMinor),
    // The VAT treatment (D157): its kind and the VAT not charged; never a buyer's VAT number or VIES's answer.
    vat_treatment: view.vatKind === "standard" ? null : { kind: view.vatKind, relief: m(view.vatReliefMinor) },
    total: m(view.totalMinor),
    paid: m(view.paidMinor),
    refunded: m(view.refundedMinor),
    left_to_refund: m(view.refundableMinor),
    due_at_venue: view.balanceMinor ? m(view.balanceMinor) : null,
    shipments: view.shipments.map((s) => ({ carrier: s.carrier, tracking: s.trackingNumber, sent: s.createdAt })),
    admin: `/admin/${store.slug}/orders/${view.id}`,
  };
}

async function listProductsTool({ store }: OwnerToolContext, input: OwnerToolInput<"list_products">) {
  const rows = await listAdminProducts(store, { archived: input.status === "archived" });
  const search = input.search?.toLowerCase();
  const found = rows.filter(
    (p) => (!input.status || p.status === input.status) && (!search || p.title.toLowerCase().includes(search) || p.handle.includes(search)),
  );
  return {
    count: found.length,
    products: found.slice(0, input.limit).map((p) => ({
      id: p.id,
      title: p.title,
      handle: p.handle,
      status: p.status,
      price: p.price
        ? p.price.min === p.price.max
          ? money(store, p.price.min, p.price.currency)
          : `${money(store, p.price.min, p.price.currency)} – ${money(store, p.price.max, p.price.currency)}`
        : null,
      stock: p.variants > p.digitalVariants ? p.stock : null,
      variants: p.variants,
    })),
    prices: store.audience === "businesses" ? "Without VAT, as the store shows them." : "With VAT, in the main country.",
  };
}

async function getProductTool({ store }: OwnerToolContext, { product }: OwnerToolInput<"get_product">) {
  const id = await findProductId(store, product);
  const locale = mainLocale(store);
  const [[head], variants] = await Promise.all([
    db().execute<Row>(sql`
      select p.handle, p.status, p.kind, coalesce(tl.title, tf.title, p.handle) as title, coalesce(tl.description, tf.description, '') as description
      from commerce.products p
      left join commerce.product_translations tl on tl.product_id = p.id and tl.locale = ${locale}
      left join lateral (select title, description from commerce.product_translations where product_id = p.id order by locale limit 1) tf on true
      where p.store_id = ${store.id}::uuid and p.id = ${id}::uuid
    `),
    db().execute<Row>(sql`
      select v.id, v.sku, v.options, v.delivery,
        (select coalesce(sum(l.on_hand), 0)::int from commerce.inventory_levels l where l.variant_id = v.id) as stock,
        coalesce((select jsonb_agg(jsonb_build_object('market', c.market_code, 'amount', c.amount_minor, 'currency', c.currency) order by c.market_code)
          from commerce.current_prices c where c.variant_id = v.id), '[]') as prices
      from commerce.product_variants v
      where v.store_id = ${store.id}::uuid and v.product_id = ${id}::uuid and v.active
      order by v.sku
    `),
  ]);
  // The price per kg, litre or metre (D160), worked out by the store's own `unitPriceShown()`: the model repeats it.
  const unitPrices = await variantUnitPrices(store.id, id);
  const words = t("en");
  return {
    id,
    title: String(head.title),
    handle: String(head.handle),
    status: String(head.status),
    kind: String(head.kind),
    description: String(head.description).slice(0, 1500),
    variants: variants.map((v) => {
      const own = unitPrices.filter((u) => u.sku === String(v.sku));
      const measure = own.find((u) => u.measure)?.measure ?? null;
      return {
        sku: String(v.sku),
        options: v.options,
        delivery: String(v.delivery),
        stock: v.delivery === "physical" ? Number(v.stock) : null,
        prices: (v.prices as { market: string; amount: number; currency: string }[]).map((p) => ({
          country: p.market,
          price: money(store, Number(p.amount), p.currency),
        })),
        ...(measure && {
          content: contentWords(measure),
          unit_prices: own.map((u) => ({ country: u.marketCode, ...unitPriceAnswer(u.unit, u.currency, mainLocale(store), words) })),
        }),
      };
    }),
    prices: "With VAT, as charged.",
    admin: `/admin/${store.slug}/products/${id}`,
  };
}

/**
 * The unit price (D160): which products still need their content, or one product's unit prices per country. Read only;
 * every figure is `unitPriceShown()`'s, written by `unitPriceAnswer()`. The owner sets content in the product editor.
 */
async function unitPriceGapsTool({ store }: OwnerToolContext, { product, limit }: OwnerToolInput<"unit_price_gaps">) {
  const words = t("en");
  const editor = (id: string) => adminLink(store, `/products/${id}`);
  const how = "Content (what a pack holds, in g, kg, ml, l, m and so on) is set per variant in the product editor, by a person; the editor refuses to save an active product that needs it and has none. You cannot set it.";
  if (product) {
    const id = await findProductId(store, product);
    const rows = await variantUnitPrices(store.id, id);
    const skus = [...new Set(rows.map((r) => r.sku))];
    return {
      product: id,
      variants: skus.map((sku) => {
        const own = rows.filter((r) => r.sku === sku);
        const measure = own.find((r) => r.measure)?.measure ?? null;
        return measure
          ? { sku, content: contentWords(measure), countries: own.map((r) => ({ country: r.marketCode, price: money(store, r.amountMinor, r.currency), ...unitPriceAnswer(r.unit, r.currency, mainLocale(store), words) })) }
          : { sku, content: null, note: "No content set, so no unit price is shown." };
      }),
      note: "A unit price is not shown where it would equal the price or the price is 0. Prices are in each country's own currency; the figure follows the VAT the store shows.",
      admin: editor(id),
      how,
    };
  }
  const [needing, counts] = await Promise.all([productsNeedingMeasure(store.id, mainLocale(store)), contentCounts(store.id)]);
  return {
    count: needing.length,
    products: needing.slice(0, limit).map((p) => ({
      id: p.productId,
      title: p.title,
      handle: p.handle,
      why: p.reason.kind === "flag" ? "the product is marked as sold by measure" : `its category ${p.reason.category} needs a unit price`,
      skus_without_content: p.skus,
      admin: editor(p.productId),
    })),
    variants_with_content: counts.withContent,
    variants_in_all: counts.total,
    note: "These products stay on sale and show no unit price until their content is set; nothing is hidden. The list is the store's own, never a guess.",
    how,
  };
}

async function lowStock({ store }: OwnerToolContext, { at_most }: OwnerToolInput<"low_stock">) {
  const locale = mainLocale(store);
  const rows = await db().execute<Row>(sql`
    select v.sku, v.options, coalesce(tl.title, p.handle) as title, coalesce(sum(l.on_hand), 0)::int as stock
    from commerce.product_variants v
    join commerce.products p on p.store_id = v.store_id and p.id = v.product_id and p.status = 'active'
    left join commerce.product_translations tl on tl.product_id = p.id and tl.locale = ${locale}
    left join commerce.inventory_levels l on l.variant_id = v.id
    where v.store_id = ${store.id}::uuid and v.active and v.delivery = 'physical'
    group by v.id, v.sku, v.options, tl.title, p.handle
    having coalesce(sum(l.on_hand), 0) <= ${at_most}
    order by stock, title
    limit 50
  `);
  return { count: rows.length, variants: rows.map((r) => ({ product: String(r.title), sku: String(r.sku), options: r.options, stock: Number(r.stock) })) };
}

/** Midnight of a day in the store's time zone, as an instant. */
async function dayStart(store: Store, day: string | undefined): Promise<Date> {
  const [row] = await db().execute<Row>(sql`
    select (${day ? sql`${day}::date` : sql`(now() at time zone ${store.timeZone})::date`}::timestamp at time zone ${store.timeZone}) as at
  `);
  return new Date(String(row.at));
}

async function listBookingsTool({ store }: OwnerToolContext, input: OwnerToolInput<"list_bookings">) {
  if (!store.bookingsOn) return { note: "The bookings module is off in this store." };
  const from = await dayStart(store, input.from);
  const to = new Date(from.getTime() + input.days * 86_400_000);
  const [staff, ranges] = await Promise.all([listBookings(store.id, from, to, ["staff"]), listBookings(store.id, from, to, ["unit", "item"])]);
  const time = new Intl.DateTimeFormat(mainLocale(store), { dateStyle: "medium", timeStyle: "short", timeZone: store.timeZone });
  return {
    time_zone: store.timeZone,
    bookings: [...staff, ...ranges]
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
      .slice(0, 100)
      .map((b) => ({
        id: b.id,
        what: b.service,
        with: b.staff,
        starts: time.format(new Date(b.startsAt)),
        ends: time.format(new Date(b.endsAt)),
        status: b.status,
        customer: b.customer,
        order: b.orderNumber,
      })),
  };
}

async function listDiscountsTool({ store }: OwnerToolContext) {
  const rows = await listDiscounts(store.id);
  return {
    discounts: rows.map((d) => ({
      code: d.code,
      active: d.active,
      gives:
        d.kind === "percent"
          ? `${d.percent} % off`
          : Object.entries(d.amounts)
              .map(([market, minor]) => {
                const m = store.markets.find((x) => x.code === market);
                return m ? `${money(store, minor, m.currency)} off in ${m.name}` : null;
              })
              .filter(Boolean)
              .join(", "),
      runs: { from: d.startsAt, until: d.endsAt },
      used: d.used,
      limit: d.usageLimit,
    })),
  };
}

async function listCampaignsTool({ store }: OwnerToolContext) {
  const rows = await listCampaigns(store.id);
  const [terms, products] = await Promise.all([
    db().execute<Row>(sql`select id, name from commerce.terms where store_id = ${store.id}::uuid and content_type = 'product'`),
    db().execute<Row>(sql`
      select p.id, coalesce((select title from commerce.product_translations where product_id = p.id order by locale limit 1), p.handle) as title
      from commerce.products p where p.store_id = ${store.id}::uuid`),
  ]);
  const name = (rows: Row[], id: string) => String(rows.find((r) => String(r.id) === id)?.name ?? rows.find((r) => String(r.id) === id)?.title ?? id);
  return {
    campaigns: rows.map((c) => ({
      name: c.name,
      status: campaignStatus(c),
      gives: describeCampaign(c, (minor, marketCode) => money(store, minor, store.markets.find((m) => m.code === marketCode)?.currency ?? "NOK")),
      free_product: c.giftTitle,
      applies_to: c.productIds.length + c.termIds.length === 0 ? "everything" : [...c.productIds.map((id) => name(products, id)), ...c.termIds.map((id) => name(terms, id))],
      only_for_customer_groups: c.tierIds.length > 0 ? c.tierIds.length : undefined,
      adds_on_top_of_other_campaigns: c.stacks || undefined,
      runs: { from: c.startsAt, until: c.endsAt },
      orders: c.orders,
      orders_limit: c.usageLimit,
      orders_per_customer_limit: c.perCustomerLimit ?? undefined,
      only_in: c.markets.length > 0 ? c.markets.map((code) => store.markets.find((m) => m.code === code)?.name ?? code) : undefined,
      given: Object.entries(c.given).map(([currency, minor]) => money(store, minor, currency)),
    })),
    page: adminLink(store, "/campaigns"),
  };
}

async function listPagesTool({ store }: OwnerToolContext, { type }: OwnerToolInput<"list_pages">) {
  const pages = await listPages(store.id, type);
  return {
    pages: pages.map((p) => ({ id: p.id, title: p.title, address: p.slug, state: p.state, published: p.publishedAt })),
  };
}

async function searchInsights({ store }: OwnerToolContext, input: OwnerToolInput<"search_insights">) {
  const since = sql`now() - make_interval(days => ${input.days})`;
  const [top, none] = await Promise.all([
    db().execute<Row>(sql`
      select lower(query) as query, count(*)::int as times from commerce.search_queries
      where store_id = ${store.id}::uuid and created_at >= ${since}
      group by lower(query) order by times desc, query limit ${input.limit}
    `),
    db().execute<Row>(sql`
      select lower(query) as query, count(*)::int as times from commerce.search_queries
      where store_id = ${store.id}::uuid and created_at >= ${since} and results = 0
      group by lower(query) order by times desc, query limit ${input.limit}
    `),
  ]);
  return {
    most_searched: top.map((r) => ({ search: String(r.query), times: Number(r.times) })),
    found_nothing: none.map((r) => ({ search: String(r.query), times: Number(r.times) })),
  };
}

// Changing ---------------------------------------------------------------------

async function addOrderNoteTool({ store, account }: OwnerToolContext, input: OwnerToolInput<"add_order_note">) {
  const id = await findOrderId(store, input.order);
  await addOrderNote(store.id, id, input.note, `${account.email} (assistant)`);
  return { done: `Note added to order ${input.order}.` };
}

async function markOrderSentTool({ store, account }: OwnerToolContext, input: OwnerToolInput<"mark_order_sent">) {
  const id = await findOrderId(store, input.order);
  const carrier = CARRIERS.find((c) => c.id === input.carrier.toLowerCase() || c.name.toLowerCase() === input.carrier.toLowerCase())?.id ?? "other";
  const shipment = await markSent(store.id, id, { carrier, trackingNumber: input.tracking_number, trackingUrl: null }, account.id);
  if (!shipment) return fail(`Order ${input.order} is not paid, or every item on it was withdrawn before sending, so it cannot be sent.`);
  if (input.notify) await sendShipped(store.id, id, shipment);
  return { done: input.notify ? `Order ${input.order} is marked as sent and the customer has been told.` : `Order ${input.order} is marked as sent.` };
}

async function cancelBookingTool({ store, account }: OwnerToolContext, input: OwnerToolInput<"cancel_booking">) {
  if (!(await cancelBooking({ account, store, role: "owner" }, input.booking))) return fail("That booking is not a confirmed booking of this store.");
  if (input.notify) await sendBookingCancelled(store.id, input.booking);
  return { done: input.notify ? "The booking is cancelled and the customer has been told." : "The booking is cancelled." };
}

async function archiveProductTool(ctx: OwnerToolContext, input: OwnerToolInput<"archive_product">) {
  const id = await findProductId(ctx.store, input.product);
  if (!(await setArchived(ctx.store, id, input.archived, ctx.account))) return fail("That product is not this store's.");
  ctx.invalidate(catalogTag(ctx.store.id));
  return { done: input.archived ? `${input.product} is taken off the site.` : `${input.product} is back, as a draft to publish from the product page.` };
}

async function unpublishPageTool(ctx: OwnerToolContext, input: OwnerToolInput<"unpublish_page">) {
  if (!(await unpublishPage(ctx.account, ctx.store.id, input.page, input.type))) return fail("That page is not one of this store's published pages.");
  ctx.invalidate(pagesTag(ctx.store.id));
  return { done: "The page is taken off the site; its draft is kept." };
}

type Handler = (ctx: OwnerToolContext, input: never) => Promise<unknown>;

// The AI manager's store tools (D103) -----------------------------------------------

const adminLink = (store: Store, path: string) => `/admin/${store.slug}${path}`;

async function setupProgressTool({ store }: OwnerToolContext) {
  const p = await getSetupProgress(store);
  const step = (done: boolean, what: string, page: string) => ({ what, done, page: adminLink(store, page) });
  return {
    ready_to_open: p.readyToOpen,
    status: store.status,
    steps: [
      step(p.details, "Business details", "/settings/company"),
      step(p.countries, "Countries to sell to", "/setup/countries"),
      step(p.shipping, "Shipping price for every country", "/settings/shipping"),
      step(p.payments, "Stripe account set up", "/settings/payments"),
      step(p.paymentsOn, "Payments switched on", "/settings/payments"),
      step(p.products, "Own products (not only the demo ones)", "/products"),
      step(p.plan, "A Kaizen plan", "/billing"),
    ],
    products: { own: p.counts.ownProducts, demo: p.counts.demoProducts },
  };
}

async function storeCheckup(ctx: OwnerToolContext) {
  const { store } = ctx;
  const [[counts], [low], progress, integrations, restock, numbering, taxFindings, documentFindings] = await Promise.all([
    db().execute<Row>(sql`
      select
        (select count(*)::int from commerce.orders o where o.store_id = ${store.id}::uuid and o.status = 'paid' and o.copied_from is null
           and o.placed_at < now() - interval '2 days'
           and exists (select 1 from commerce.order_lines l where l.order_id = o.id and l.delivery = 'physical')) as late_orders,
        (select count(*)::int from commerce.orders o where o.store_id = ${store.id}::uuid and o.status = 'paid' and o.copied_from is null
           and exists (select 1 from commerce.order_lines l where l.order_id = o.id and l.delivery = 'physical')) as to_send,
        (select count(distinct lower(q.query))::int from commerce.search_queries q
           where q.store_id = ${store.id}::uuid and q.results = 0 and q.created_at > now() - interval '7 days') as searches_missed,
        (select count(*)::int from commerce.assistant_approvals a
           where a.store_id = ${store.id}::uuid and a.account_id = ${ctx.account.id}::uuid and a.status = 'pending') as approvals,
        (select count(*)::int from commerce.products p where p.store_id = ${store.id}::uuid and p.status = 'draft') as drafts
    `),
    db().execute<Row>(sql`
      select count(*)::int as n from commerce.product_variants v
      join commerce.products p on p.store_id = v.store_id and p.id = v.product_id
      where v.store_id = ${store.id}::uuid and p.status = 'active' and v.active and v.delivery = 'physical' and p.kind = 'goods'
        and coalesce((select sum(l.on_hand) from commerce.inventory_levels l where l.variant_id = v.id), 0) <= 3
    `),
    getSetupProgress(store),
    listIntegrations(store.id),
    restockSuggestions({ store }, { days: 30, cover_days: 30, lead_days: 7 }),
    orderNumberAudit(store.id),
    taxCheckupFindings(store.id),
    invoiceCheckupFindings(store.id),
  ]);
  const findings: { what: string; page: string }[] = [];
  const add = (when: boolean, what: string, page: string) => when && findings.push({ what, page: adminLink(store, page) });
  add(!progress.readyToOpen, "The store is not ready to open yet: setup_progress says what is left.", "");
  add(Number(counts.late_orders) > 0, `${counts.late_orders} paid order(s) have waited more than two days to be sent.`, "/orders?show=to-send");
  add(Number(counts.to_send) > 0 && Number(counts.late_orders) === 0, `${counts.to_send} paid order(s) are waiting to be sent.`, "/orders?show=to-send");
  add(Number(low.n) > 0, `${low.n} variant(s) have 3 or fewer left in stock.`, "/products");
  add(restock.urgent > 0, `${restock.urgent} variant(s) will run out within a week at the current pace: restock_suggestions says how many to order.`, "/products");
  add(Number(counts.searches_missed) > 0, `${counts.searches_missed} different search(es) found nothing this week.`, "/search");
  add(Number(counts.approvals) > 0, `${counts.approvals} change(s) you asked me for are waiting for your approval.`, "/assistant");
  for (const problem of auditProblems(numbering)) add(true, `Order numbering is not in sequence: ${problem}`, "/orders");
  // The tax profile (D157): registered without a number, a number never checked valid, IOSS or OSS half filled in.
  for (const finding of taxFindings) add(true, finding.message, "/settings/tax");
  // Invoices and credit notes (D159): numbering in sequence, invoices waiting, a refund with no credit note, PDFs that could not be made.
  for (const finding of documentFindings) add(true, finding.message, "/invoices");
  add(Number(counts.drafts) > 0, `${counts.drafts} product(s) are drafts, not on the site.`, "/products");
  add(store.paymentsTest && store.paymentsOn, "Payments are in test mode: shoppers cannot really pay yet.", "/settings/payments");
  for (const i of integrations) add(i.enabled && i.recentFailures > 0, `${i.provider} failed ${i.recentFailures} send(s) this week.`, `/integrations/${i.provider}`);
  return { findings, all_good: findings.length === 0 };
}

/** The store's tax registration (D157), read only. The seller's own number is on its documents; no buyer's is ever here. */
async function getTaxProfileTool({ store }: OwnerToolContext) {
  const { profile, country, check } = await taxProfileView(store.id);
  return {
    store_country: country,
    registered_for_vat: profile.vatRegistered,
    vat_number: profile.vatNumber,
    vat_number_checked: profile.vatNumberValid === null ? "not checked, or the check could not be made" : profile.vatNumberValid ? "valid" : "not valid",
    checked_at: profile.vatNumberCheckedAt,
    checked_with: check ? (check.source === "vies" ? "VIES" : "the open company register") : null,
    goods_sent_from: profile.dispatchCountry ?? country,
    oss: { scheme: profile.ossScheme, member_state: profile.ossMemberState, number: profile.ossNumber, registered_on: profile.ossRegisteredOn },
    ioss: { number: profile.iossNumber, intermediary: profile.iossIntermediary, markets: profile.iossMarkets, registered_on: profile.iossRegisteredOn },
    page: adminLink(store, "/settings/tax"),
    note: "Only a person changes a VAT number, a registration or a rate, on the Tax page. This is not tax advice.",
  };
}

/** What the VAT features need (D157): on or off, and what is missing, from `readiness()`. */
async function taxReadinessTool({ store }: OwnerToolContext) {
  const { readiness: lines } = await taxProfileView(store.id);
  return {
    features: lines.map((line) => ({ feature: line.key, on: line.on, needs: line.needs, text: line.text })),
    page: adminLink(store, "/settings/tax"),
    note: "A valid answer from VIES says that a number is registered; it does not say that a sale is exempt. Destination VAT is charged on consumer sales. Ask an accountant for anything beyond that.",
  };
}

const VAT_KIND_WORDS: Record<string, string> = {
  standard: "VAT charged",
  reverse_charge: "Reverse charge: no VAT charged, the buyer accounts for it",
  ioss: "IOSS: VAT charged for the destination country under the import scheme",
};

/**
 * The store's invoices and credit notes (D159), read only. Amounts come from the documents' own frozen figures in each order's currency,
 * totals are added in code per currency, and a buyer's name, address or email is never part of the answer.
 */
async function listInvoicesTool({ store }: OwnerToolContext, input: OwnerToolInput<"list_invoices">) {
  if (input.search?.includes("@")) return fail("Search by a document number or an order number: the assistant does not look documents up by an email address.");
  if (input.from && input.to && input.from > input.to) return fail("`from` is after `to`.");
  if (input.which === "waiting") {
    const [waiting, creditNotes] = await Promise.all([waitingInvoices(store.id), waitingCreditNotes(store.id)]);
    const sums = new Map<string, number>();
    for (const w of waiting) sums.set(w.currency, (sums.get(w.currency) ?? 0) + w.totalMinor);
    return {
      invoices_waiting: waiting.length,
      overdue: waiting.filter((w) => w.overdue).length,
      waiting_total: [...sums].map(([currency, minor]) => money(store, minor, currency)),
      orders: waiting.slice(0, input.limit).map((w) => ({
        order: w.orderNumber,
        paid_on: w.paidOn,
        total: money(store, w.totalMinor, w.currency),
        treatment: VAT_KIND_WORDS[w.vatKind] ?? w.vatKind,
        why_it_waits: w.words,
        fix_at: w.fixAt ? adminLink(store, w.fixAt) : null,
        ...(w.overdue ? { overdue_since: w.deadline } : {}),
      })),
      credit_notes_to_check: creditNotes.slice(0, input.limit).map((c) => ({
        order: c.orderNumber,
        state: c.state === "short" ? "The refund was larger than what the invoice had left, so the credit note covers only part of it." : "The refund has no credit note yet; it is tried again every five minutes.",
        [c.state === "short" ? "left_uncredited" : "refunded"]: money(store, c.amountMinor, c.currency),
      })),
      page: adminLink(store, "/invoices"),
      note: "Invoices are made when an order is paid, and waiting ones are tried again every five minutes. The owner presses Check again on the Waiting tab after fixing the cause.",
    };
  }
  const filter = { from: input.from ?? null, to: input.to ?? null, q: input.search ?? null, limit: input.limit };
  const kind = input.which === "credit_notes" ? "credit_notes" : "invoices";
  const { rows, total } = kind === "invoices" ? await listInvoices(store.id, filter) : await listCreditNotes(store.id, filter);
  // Added in code, per currency, over the rows given (the count says if there are more).
  const sums = new Map<string, { net: number; vat: number; total: number }>();
  for (const r of rows) {
    const sum = sums.get(r.currency) ?? { net: 0, vat: 0, total: 0 };
    sum.net += r.netMinor;
    sum.vat += r.vatMinor;
    sum.total += r.totalMinor;
    sums.set(r.currency, sum);
  }
  return {
    count: total,
    shown: rows.length,
    ...(total > rows.length ? { more: `${total - rows.length} more match; narrow the period or search by a number.` } : {}),
    totals_of_those_shown: [...sums].map(([currency, s]) => ({ net: money(store, s.net, currency), vat: money(store, s.vat, currency), total: money(store, s.total, currency) })),
    documents: rows.map((r) => ({
      number: r.documentNumber,
      type: kind === "invoices" ? "invoice" : "credit_note",
      issued_on: r.issuedOn,
      order: r.orderNumber,
      ...(r.vatKind ? { treatment: VAT_KIND_WORDS[r.vatKind] ?? r.vatKind } : {}),
      buyer_country: r.buyerCountry,
      net: money(store, r.netMinor, r.currency),
      vat: money(store, r.vatMinor, r.currency),
      total: money(store, r.totalMinor, r.currency),
      pdf_stored: r.hasPdf,
      ...(r.invoiceNumber ? { credits_invoice: r.invoiceNumber } : {}),
      ...(r.anonymised ? { anonymised: true } : {}),
    })),
    page: adminLink(store, "/invoices"),
    note: "Buyers' details are not given here; open the order in the admin. A credit note's figures are what it takes back.",
  };
}

/** What invoicing needs (D159), from `invoiceReadiness()`: on or off, what is missing, the series, how much waits. */
async function invoiceReadinessTool({ store }: OwnerToolContext) {
  const [readiness, settings, series, counts] = await Promise.all([invoiceReadiness(store.id), getInvoiceSettings(store.id), seriesStates(store.id), invoiceCounts(store.id)]);
  const FIELD_WORDS: Record<string, string> = {
    legal_name: "the legal name",
    postal_address: "the postal address",
    organisation_number: "the organisation number",
    country: "the country",
    vat_number: "the VAT number (the store is registered for VAT)",
  };
  return {
    invoicing_on: settings.enabled,
    ...(settings.enabledFrom ? { on_since: settings.enabledFrom, note_on_since: "Only orders paid after this get an invoice; earlier ones are never back-dated." } : {}),
    ready_to_issue: readiness.ready,
    missing: readiness.missing.map((field) => ({ what: FIELD_WORDS[field] ?? field, fix_at: adminLink(store, readiness.fixAt[field] ?? "/settings/company") })),
    tax_profile_saved: readiness.taxProfileSaved,
    registered_for_vat: readiness.vatRegistered,
    ...(readiness.taxProfileSaved ? {} : { tax_profile_page: adminLink(store, "/settings/tax") }),
    ...(readiness.ratesByHand ? { rates_by_hand: "The store keeps its exchange rates by hand: an invoice in another currency than the seller's own needs the VAT stated in the seller's currency, so an accountant should look at the rates." } : {}),
    ...(readiness.stripeInvoicesIgnored ? { stripe_invoice_option: "Stripe's own invoice option is switched on but is not used while the store makes its own invoices." } : {}),
    series: series.map((s) => ({
      series: s.series === "invoice" ? "invoices" : "credit notes",
      next_number: s.nextDocumentNumber,
      issued: s.issued,
      locked: s.locked,
    })),
    invoices_issued: counts.invoices,
    credit_notes_issued: counts.creditNotes,
    invoices_waiting: counts.waiting,
    overdue_reverse_charge: counts.overdue,
    pdfs_failing: counts.pdfFailing,
    page: adminLink(store, "/invoices"),
    settings_page: adminLink(store, "/settings/invoices"),
    note: "Only an owner changes the invoicing settings and numbering. This is not tax or accounting advice: an accountant should confirm the content of the invoices for each country.",
  };
}

async function listCustomersTool({ store }: OwnerToolContext, { search, limit }: OwnerToolInput<"list_customers">) {
  const rows = await listCustomers(store.id, { q: search ?? "", limit });
  return rows.map((c) => ({
    key: c.key,
    name: c.name,
    email: c.email,
    account: c.account ?? "none",
    orders: c.orders,
    live_subscriptions: c.liveSubscriptions,
    spent: Object.entries(c.spentMinor).map(([currency, minor]) => money(store, minor, currency)),
    last_order: c.lastOrderAt,
    admin: adminLink(store, `/customers/${encodeURIComponent(c.key)}`),
  }));
}

async function getCustomerTool({ store }: OwnerToolContext, { customer }: OwnerToolInput<"get_customer">) {
  const isId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(customer);
  let ref = isId ? await findCustomer(store.id, customer) : null;
  if (!ref && !isId) {
    const [match] = await listCustomers(store.id, { q: customer, limit: 1 });
    ref = match ? await findCustomer(store.id, match.key) : null;
  }
  const detail = ref ? await getCustomerDetail(store.id, ref) : null;
  if (!ref || !detail) return fail(`No customer "${customer}" in this store. Use list_customers to find them.`);
  return {
    name: detail.name,
    email: ref.email,
    phone: detail.phone,
    account_since: detail.accountCreatedAt,
    first_order: detail.firstOrderAt,
    orders: detail.orderList.slice(0, 20).map((o) => ({ number: o.number, status: o.status, placed: o.placedAt, total: money(store, o.totalMinor, o.currency) })),
    subscriptions: detail.subscriptionList.map((s) => ({ number: s.number, status: s.status, each_renewal: money(store, s.totalMinor, s.currency) })),
    wishlist_items: detail.wishlistItems,
    cart_reminders_off: detail.cartRemindersOptedOut,
    admin: adminLink(store, `/customers/${encodeURIComponent(ref.key)}`),
  };
}

async function listSubscriptionsTool({ store }: OwnerToolContext, { limit }: OwnerToolInput<"list_subscriptions">) {
  const rows = await listSubscriptions(store.id);
  return rows.slice(0, limit).map((s) => ({
    number: s.number,
    status: s.status,
    customer: s.name || s.email,
    each_renewal: money(store, s.totalMinor, s.currency),
    every: `${s.intervalCount} ${s.interval}`,
    renews: s.currentPeriodEnd,
    ending: s.cancelAtPeriodEnd || Boolean(s.cancelAt),
    admin: adminLink(store, `/subscriptions/${s.id}`),
  }));
}

async function cartReminderStatsTool({ store }: OwnerToolContext) {
  const stats = await cartReminderStats(store.id);
  return {
    period: "the last 30 days",
    checkouts_left_with_email: stats.captured,
    reminded: stats.reminded,
    bought_after_reminder: stats.recovered,
    won_back: Object.entries(stats.recoveredMinor).map(([currency, minor]) => money(store, minor, currency)),
    page: adminLink(store, "/cart-reminders"),
  };
}

async function wishlistInsights({ store }: OwnerToolContext) {
  const [figures, wished] = await Promise.all([wishlistFigures(store.id), mostWishedProducts(store.id, mainLocale(store), 5)]);
  return {
    lists: figures.lists,
    items_saved: figures.savedItems,
    shoppers: figures.shoppers,
    put_in_cart: figures.toCart,
    bought: figures.bought,
    bought_for: Object.entries(figures.boughtMinor).map(([currency, minor]) => money(store, minor, currency)),
    most_wished: wished.map((w) => ({ product: w.title, lists: w.lists })),
    page: adminLink(store, "/wishlists"),
  };
}

async function listEmailsTool({ store }: OwnerToolContext, { limit }: OwnerToolInput<"list_emails">) {
  const rows = await listEmails({ storeId: store.id, limit });
  return rows.map((e) => ({ what: e.kind, to: e.to, subject: e.subject, status: e.status, error: e.error, sent: e.createdAt, admin: adminLink(store, `/emails/${e.id}`) }));
}

async function subscriptionBoxes({ store }: OwnerToolContext) {
  if (!store.deliveriesOn) return { on: false, note: "Subscription boxes are off: they are switched on under Features.", page: adminLink(store, "/settings/features") };
  const rounds = await deliveryRounds(store.id);
  return {
    on: true,
    delivery_days: rounds.map((r) => ({
      name: r.schedule.name,
      country: r.schedule.marketCode,
      active: r.schedule.active,
      lists: r.schedule.lists,
      next_delivery: r.next.date,
      next_cutoff: new Date(r.next.cutoffAt).toISOString(),
      being_packed: r.current
        ? {
            delivery: r.current.date,
            orders: r.current.orders.map((o) => ({ number: o.number, customer: o.name, total: money(store, o.totalMinor, r.schedule.currency), status: o.status })),
            without_delivery: r.current.skipped,
          }
        : null,
    })),
    page: adminLink(store, "/deliveries"),
  };
}

async function refundOrderTool(ctx: OwnerToolContext, { order, amount, reason, restock, notify }: OwnerToolInput<"refund_order">) {
  const { store } = ctx;
  const orderId = await findOrderId(store, order);
  const admin = await getOrderAdmin(store.id, orderId);
  if (!admin) return fail(`No order ${order} in this store.`);
  if (!admin.canRefund || admin.refundableMinor <= 0) return fail(`Order ${admin.number} has nothing left to refund through Stripe.`);
  const amountMinor = amount ? parsePrice(amount, admin.currency) : admin.refundableMinor;
  if (amountMinor === null || amountMinor <= 0) return fail(`"${amount}" is not an amount.`);
  if (amountMinor > admin.refundableMinor) return fail(`At most ${money(store, admin.refundableMinor, admin.currency)} can be refunded on order ${admin.number}.`);
  const back = restock
    ? admin.lines.filter((l) => l.variantId && l.delivery === "physical" && l.quantity > l.restocked).map((l) => ({ lineId: l.id, quantity: l.quantity - l.restocked }))
    : [];
  const outcome = await refundOrder(store.id, orderId, { amountMinor, reason, restock: back }, ctx.account.id);
  if (!outcome.ok) return fail(outcome.problem);
  if (notify && outcome.amountMinor > 0) await sendRefunded(store.id, orderId, outcome.refundId, outcome.amountMinor);
  ctx.invalidate(catalogTag(store.id));
  return { done: `Refunded ${money(store, outcome.amountMinor, admin.currency)} on order ${admin.number}${back.length ? ", and put its items back in stock" : ""}.` };
}

async function createDiscountTool(ctx: OwnerToolContext, input: OwnerToolInput<"create_discount">) {
  const result = await saveDiscount({ account: ctx.account, store: ctx.store, role: "owner" }, null, {
    code: input.code,
    kind: input.kind,
    percent: input.percent,
    endsAt: input.ends_at ? `${input.ends_at}T23:59` : null,
    usageLimit: input.usage_limit ?? null,
    oncePerCustomer: input.once_per_customer,
    active: true,
  });
  if (!result.ok) return fail(result.problems.join(" "));
  return { done: `The code ${input.code.toUpperCase()} works now.`, admin: result.id ? adminLink(ctx.store, `/discounts/${result.id}`) : adminLink(ctx.store, "/discounts") };
}

async function setDiscountActiveTool(ctx: OwnerToolContext, { code, active }: OwnerToolInput<"set_discount_active">) {
  const rows = await db().execute<Row>(sql`
    update commerce.discount_codes set active = ${active}, updated_at = now()
    where store_id = ${ctx.store.id}::uuid and upper(code) = upper(${code}) returning code
  `);
  if (rows.length === 0) return fail(`No code ${code} in this store. Use list_discounts to find it.`);
  return { done: `The code ${String(rows[0].code)} is ${active ? "on" : "off"}.` };
}

/** The ids of a store's product categories or tags named by owners, in their own words. */
async function termIdsByName(store: Store, kind: "category" | "tag", names: string[] = []): Promise<string[]> {
  const ids: string[] = [];
  for (const wanted of names) {
    const rows = await db().execute<Row>(sql`
      select id from commerce.terms
      where store_id = ${store.id}::uuid and content_type = 'product' and kind = ${kind} and (lower(name) = lower(${wanted}) or slug = lower(${wanted}))
      limit 3
    `);
    if (rows.length === 0) return fail(`No product ${kind} "${wanted}" in this store. Use list_products or the store's categories to find it.`);
    if (rows.length > 1) return fail(`Several ${kind}s are called "${wanted}". Name one by its address.`);
    ids.push(String(rows[0].id));
  }
  return ids;
}

async function createCampaignTool(ctx: OwnerToolContext, input: OwnerToolInput<"create_campaign">) {
  const { store } = ctx;
  const market = store.markets[0];
  if (input.kind === "percent" && !input.percent) return fail("Say how many percent off.");
  if (input.kind === "multi_buy" && (!input.buy_quantity || !input.pay_quantity)) return fail("Say how many the shopper buys and how many they pay for: 3 and 2 for 3 for 2.");
  let giftVariantId: string | null = null;
  if (input.kind === "gift") {
    if (!input.gift_sku) return fail("Say which product to give, by its SKU (get_product lists each variant's SKU).");
    if (!input.amount || !market) return fail("Say what the basket must come to for the free product.");
    const [variant] = await db().execute<Row>(sql`select id from commerce.product_variants where store_id = ${store.id}::uuid and upper(sku) = upper(${input.gift_sku})`);
    if (!variant) return fail(`No product with the SKU ${input.gift_sku} in this store. Use get_product to find it.`);
    giftVariantId = String(variant.id);
  }
  const productIds = await Promise.all((input.products ?? []).map((ref) => findProductId(store, ref)));
  const termIds = [...(await termIdsByName(store, "category", input.categories)), ...(await termIdsByName(store, "tag", input.tags))];
  const tierIds: string[] = [];
  for (const wanted of input.customer_groups ?? []) {
    const [tier] = await db().execute<Row>(sql`select id from commerce.customer_tiers where store_id = ${store.id}::uuid and lower(name) = lower(${wanted})`);
    if (!tier) return fail(`No customer group "${wanted}" in this store.`);
    tierIds.push(String(tier.id));
  }
  const markets: string[] = [];
  for (const wanted of input.countries ?? []) {
    const found = store.markets.find((m) => m.code.toLowerCase() === wanted.toLowerCase() || m.name.toLowerCase() === wanted.toLowerCase());
    if (!found) return fail(`The store does not sell to "${wanted}". Its countries: ${store.markets.map((m) => `${m.name} (${m.code})`).join(", ")}.`);
    markets.push(found.code);
  }
  const result = await saveCampaign({ account: ctx.account, store, role: "owner" }, null, {
    name: input.name,
    kind: input.kind,
    percent: input.percent ?? 10,
    buyQuantity: input.buy_quantity ?? 3,
    payQuantity: input.pay_quantity ?? 2,
    giftVariantId,
    giftQuantity: input.gift_quantity,
    thresholds: input.kind === "gift" && market ? { [market.code]: input.amount ?? "" } : {},
    scope: productIds.length + termIds.length > 0 ? "some" : "all",
    productIds,
    termIds,
    tierIds,
    usageLimit: input.usage_limit ?? null,
    perCustomerLimit: input.per_customer_limit ?? null,
    markets,
    stacks: input.kind !== "gift" && input.stacks,
    startsAt: input.starts_on ? `${input.starts_on}T00:00` : null,
    endsAt: input.ends_on ? `${input.ends_on}T23:59` : null,
    active: true,
  });
  if (!result.ok) return fail(result.problems.join(" "));
  ctx.invalidate(campaignsTag(store.id));
  return { done: `The campaign "${input.name}" is set up${input.starts_on ? ` and starts ${input.starts_on}` : " and runs now"}.`, admin: result.id ? adminLink(store, `/campaigns/${result.id}`) : adminLink(store, "/campaigns") };
}

async function setCampaignActiveTool(ctx: OwnerToolContext, { campaign, active }: OwnerToolInput<"set_campaign_active">) {
  const rows = await db().execute<Row>(sql`select id, name from commerce.campaigns where store_id = ${ctx.store.id}::uuid and lower(name) = lower(${campaign})`);
  if (rows.length === 0) return fail(`No campaign "${campaign}" in this store. Use list_campaigns to find it.`);
  if (rows.length > 1) return fail(`Several campaigns are called "${campaign}". Rename one first, in the admin.`);
  const result = await setCampaignActive({ account: ctx.account, store: ctx.store, role: "owner" }, String(rows[0].id), active);
  if (!result.ok) return fail(result.problems.join(" "));
  ctx.invalidate(campaignsTag(ctx.store.id));
  return { done: `The campaign ${String(rows[0].name)} is ${active ? "on" : "off"}.` };
}

// The bonus program (D130) --------------------------------------------------------------------

/** A customer with an account by email or id, the store's only: credits belong to the account, never to a guest. */
async function findBonusCustomer(store: Store, ref: string): Promise<{ id: string; email: string }> {
  const byId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ref);
  const [row] = await db().execute<Row>(sql`
    select id, email from commerce.customers
    where store_id = ${store.id}::uuid and ${byId ? sql`id = ${ref}::uuid` : sql`lower(email) = lower(${ref})`}
  `);
  return row ? { id: String(row.id), email: String(row.email) } : fail(`No customer with an account called "${ref}" in this store. Only customers with an account have credits; list_customers shows who does.`);
}

async function getBonusProgramTool({ store }: OwnerToolContext, { customer }: OwnerToolInput<"get_bonus_program">) {
  const currency = mainCurrency(store);
  const locale = mainLocale(store);
  const format = moneyIn(currency, locale);
  const [settings, overview] = await Promise.all([getBonusSettings(store.id), bonusOverview(store.id)]);
  const who = customer ? await findBonusCustomer(store, customer) : null;
  const credits = who ? await customerBonus(store.id, who.id) : null;
  return {
    on: settings.enabled,
    credits_are_in: currency,
    how_it_works: BONUS_EXPLANATION,
    percent_back: bpsToPercentText(settings.earnBps),
    wait_days: settings.pendingDays,
    most_percent_of_order_goods: settings.maxRedeemPercent,
    least_to_use: settings.minRedeemMinor > 0 ? format(settings.minRedeemMinor) : "no minimum",
    expires_after_months: settings.expiresMonths ?? "never",
    rules_for_shoppers: rulesSummary(settings, format, currency),
    store_owes: Object.fromEntries(overviewRows(overview, format).map((row) => [row.label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, ""), row.value])),
    accounting: BONUS_ACCOUNTING_NOTE,
    ...(who && credits && {
      customer: {
        email: who.email,
        available: moneyIn(credits.balance.currency, locale)(credits.balance.availableMinor),
        pending: moneyIn(credits.balance.currency, locale)(credits.balance.pendingMinor),
        next_to_expire: credits.balance.expiringSoon
          ? { amount: moneyIn(credits.balance.currency, locale)(credits.balance.expiringSoon.amountMinor), on: credits.balance.expiringSoon.at }
          : null,
        latest: [...credits.entries]
          .sort((a, b) => b.at.localeCompare(a.at))
          .slice(0, 10)
          .map((e) => ({ when: e.at, what: e.kind, amount: moneyIn(credits.balance.currency, locale)(e.amountMinor), order: e.orderNumber, note: e.note || undefined })),
      },
    }),
    page: adminLink(store, "/bonus"),
  };
}

/** The settings a change would make: what the store has now, with what was given put over it. Problems are said for the model. */
async function bonusSettingsFor(store: Store, input: OwnerToolInput<"set_bonus_program">): Promise<BonusSettings> {
  if (Object.values(input).every((v) => v === undefined)) return fail("Say what to change: switch it on or off, credits back, the wait, the most of an order, the least to use or expiry.");
  const current = await getBonusSettings(store.id);
  const next: BonusSettings = { ...BONUS_DEFAULTS, ...current };
  if (input.enabled !== undefined) next.enabled = input.enabled;
  if (input.percent_back !== undefined) {
    const bps = percentTextToBps(String(input.percent_back));
    if (bps === null) return fail("Credits back is a percentage with at most two decimals, such as 5 or 2.5.");
    next.earnBps = bps;
  }
  if (input.wait_days !== undefined) next.pendingDays = input.wait_days;
  if (input.max_percent_of_order !== undefined) next.maxRedeemPercent = input.max_percent_of_order;
  if (input.min_credits_to_use !== undefined) {
    const minor = /^0+([.,]0+)?$/.test(input.min_credits_to_use.trim()) ? 0 : parsePrice(input.min_credits_to_use, mainCurrency(store));
    if (minor === null) return fail(`The least to use is an amount in ${mainCurrency(store)}, such as 50 or 49,50, or 0 for no minimum.`);
    next.minRedeemMinor = minor;
  }
  if (input.expires_after_months !== undefined) next.expiresMonths = input.expires_after_months;
  return next;
}

async function setBonusProgramTool(ctx: OwnerToolContext, input: OwnerToolInput<"set_bonus_program">) {
  const { store } = ctx;
  const settings = await bonusSettingsFor(store, input);
  const result = await saveBonusSettings(ctx.account, store.id, settings);
  if (!result.ok) return fail(result.problems.join(" "));
  ctx.invalidate(storeTag(store.slug));
  ctx.invalidate(catalogTag(store.id));
  // The referral program works only while the bonus program is on (D131): its link capture and cookie follow.
  ctx.invalidate(affiliateTag(store.id));
  ctx.invalidate(cookiesTag(store.id));
  const currency = mainCurrency(store);
  return {
    done: settings.enabled ? "The bonus program is on with these rules." : "The bonus program is off. Balances are kept.",
    rules_for_shoppers: rulesSummary(settings, moneyIn(currency, mainLocale(store)), currency),
    admin: adminLink(store, "/bonus"),
  };
}

// Recommendations (D139, D140) -------------------------------------------------------------------------------------

const RULE_WORDS = { goes_with: "goes with", never_with: "is never shown with", hide: "is never recommended" } as const;

async function getRecommendationsTool({ store }: OwnerToolContext, { days }: OwnerToolInput<"get_recommendations">) {
  const [settings, used, rules, report] = await Promise.all([
    getRecommendSettingsFresh(store.id),
    tokensUsedThisMonth(store.id),
    listRules(store.id),
    recommendationReport(store.id, Number(days)),
  ]);
  const locale = mainLocale(store);
  const arm = (a: (typeof report.arms)[number]) => ({
    visitors: a.visitors,
    shown: a.impressions,
    clicked: a.clicks,
    tabs_that_clicked: a.clickers,
    added_to_cart: a.adds,
    tabs_that_added: a.adders,
    orders: a.orders,
    revenue: a.revenue.map((r) => ({
      currency: r.currency,
      total: money(store, r.minor, r.currency),
      orders: r.orders,
      per_visitor: a.visitors > 0 ? money(store, Math.round(r.minor / a.visitors), r.currency) : null,
    })),
  });
  return {
    on: settings.enabled,
    ai_reranking: settings.ai,
    upsell_ceiling_percent: settings.upsellCeilingPercent,
    plain_ranking_share_percent: settings.holdoutPercent,
    monthly_ai_cap: settings.monthlyTokenCap === null ? "none" : `${(settings.monthlyTokenCap / 1000).toLocaleString(locale)} thousand tokens`,
    ai_used_this_month: `${Math.round(used / 1000).toLocaleString(locale)} thousand tokens`,
    rules: rules.map((r) => `${r.product.title} ${RULE_WORDS[r.kind]}${r.other ? ` ${r.other.title}` : ""}`),
    period_days: report.days,
    with_ai: arm(report.arms[0]),
    plain_ranking: arm(report.arms[1]),
    comparison: report.comparison.words,
    how_it_is_compared: "On the share of tabs that clicked a recommendation and that put one in the cart, with a two-proportion test (clear under p = 0.05), only with at least 100 tabs in each ranking. Revenue is per currency, never added across.",
    placements: report.placements,
    most_clicked: report.topProducts.slice(0, 5).map((p) => ({ title: p.title, shown: p.impressions, clicked: p.clicks, added: p.adds })),
    where_they_show: "Only in content grids that recommend (page builder: content grid, Recommend products for each shopper), on a product layout, the All products page, articles, other pages, and category and tag pages built in the page builder, and in the chat assistant's suggestions.",
    admin: adminLink(store, "/recommendations"),
  };
}

/** What the settings become when a tool call changes some of them. */
async function recommendSettingsFor(store: Store, input: OwnerToolInput<"set_recommendations">): Promise<RecommendSettings> {
  const now = await getRecommendSettingsFresh(store.id);
  return {
    enabled: input.enabled ?? now.enabled,
    ai: input.ai ?? now.ai,
    holdoutPercent: input.holdout_percent ?? now.holdoutPercent,
    upsellCeilingPercent: input.upsell_ceiling_percent ?? now.upsellCeilingPercent,
    monthlyTokenCap: input.monthly_token_cap_thousands === undefined ? now.monthlyTokenCap : input.monthly_token_cap_thousands === null ? null : input.monthly_token_cap_thousands * 1000,
  };
}

async function setRecommendationsTool(ctx: OwnerToolContext, input: OwnerToolInput<"set_recommendations">) {
  const settings = await recommendSettingsFor(ctx.store, input);
  const result = await saveRecommendSettingsValues(ctx.account, ctx.store.id, settings);
  if (!result.ok) return fail(result.problems.join(" "));
  ctx.invalidate(recommendTag(ctx.store.id));
  return {
    done: settings.enabled ? "Recommendations are on with these settings." : "Recommendations are off.",
    ai_reranking: settings.ai,
    upsell_ceiling_percent: settings.upsellCeilingPercent,
    plain_ranking_share_percent: settings.holdoutPercent,
    monthly_ai_cap: settings.monthlyTokenCap === null ? "none" : `${settings.monthlyTokenCap / 1000} thousand tokens`,
    note: settings.enabled ? "They show only in content grids that recommend, and in the chat assistant." : undefined,
    admin: adminLink(ctx.store, "/recommendations"),
  };
}

async function ruleProductIds(store: Store, input: { kind: string; product: string; other_product?: string }) {
  const productId = await findProductId(store, input.product);
  const otherProductId = input.kind === "hide" ? null : input.other_product ? await findProductId(store, input.other_product) : fail(`Name the other product for a ${input.kind} rule.`);
  return { productId, otherProductId };
}

async function addRecommendationRuleTool(ctx: OwnerToolContext, input: OwnerToolInput<"add_recommendation_rule">) {
  const { productId, otherProductId } = await ruleProductIds(ctx.store, input);
  const result = await addRule(ctx.account, ctx.store.id, { kind: input.kind, productId, otherProductId, both: input.both });
  if (!result.ok) return fail(result.problems.join(" "));
  ctx.invalidate(recommendTag(ctx.store.id));
  return { done: "The rule is added.", admin: adminLink(ctx.store, "/recommendations") };
}

async function removeRecommendationRuleTool(ctx: OwnerToolContext, input: OwnerToolInput<"remove_recommendation_rule">) {
  const { productId, otherProductId } = await ruleProductIds(ctx.store, input);
  const result = await removeRuleBetween(ctx.account, ctx.store.id, { kind: input.kind, productId, otherProductId });
  if (!result.ok) return fail(result.problems.join(" "));
  ctx.invalidate(recommendTag(ctx.store.id));
  return { done: "The rule is removed.", admin: adminLink(ctx.store, "/recommendations") };
}

async function checkRecommendationsTool({ store }: OwnerToolContext) {
  const market = store.markets[0];
  if (!market) return fail("The store has no market to check in.");
  const result = await replayOnOrders(store, market, REPLAY_ORDERS);
  if (result.evaluated === 0) {
    return { checked: 0, note: `No order to check yet: the store needs paid orders of two goods or more whose products are still on sale (${result.considered} found).` };
  }
  return {
    orders_checked: result.evaluated,
    left_out_not_on_sale_now: result.skipped.notOnSaleNow,
    engine: { product_first_percent: result.engine.hit[1], within_first_4_percent: result.engine.hit[4], within_first_12_percent: result.engine.hit[12], mean_reciprocal_rank_percent: result.engine.mrr },
    best_sellers_alone: { product_first_percent: result.bestSellers.hit[1], within_first_4_percent: result.bestSellers.hit[4], within_first_12_percent: result.bestSellers.hit[12], mean_reciprocal_rank_percent: result.bestSellers.mrr },
    engine_vs_best_sellers_at_4: result.liftAt4 === null ? null : `${result.liftAt4} times as often`,
    note: `${result.evaluated < 30 ? "Few orders, so take it as a hint. " : ""}This replays what people bought together with the AI left out; it does not say what shoppers would click. Compare the AI's order with the plain one with get_recommendations once visitors have come.`,
    admin: adminLink(store, "/recommendations"),
  };
}

/** What an adjustment asks, with the customer found and the amount read, or the reason it cannot be done. */
async function adjustmentFor(store: Store, input: OwnerToolInput<"adjust_customer_credits">) {
  const who = await findBonusCustomer(store, input.customer);
  const read = readAdjustment(input.amount, input.reason, mainCurrency(store));
  if (!read.ok) return fail(read.problem);
  return { who, ...read };
}

async function adjustCustomerCreditsTool(ctx: OwnerToolContext, input: OwnerToolInput<"adjust_customer_credits">) {
  const { store } = ctx;
  const { who, amountMinor, note } = await adjustmentFor(store, input);
  const result = await adjustBonus(ctx.account, store.id, who.id, amountMinor, note);
  if (!result.ok) return fail(result.problems.join(" "));
  const { balance } = await customerBonus(store.id, who.id);
  const format = moneyIn(balance.currency, mainLocale(store));
  return {
    done: `${amountMinor > 0 ? `Added ${format(amountMinor)} in credits to` : `Took ${format(-amountMinor)} in credits from`} ${who.email}.`,
    available_now: format(balance.availableMinor),
    pending: format(balance.pendingMinor),
    admin: adminLink(store, `/customers/${who.id}`),
  };
}

// The referral program (D131) -----------------------------------------------------------------

async function getAffiliateProgramTool({ store }: OwnerToolContext, { customer }: OwnerToolInput<"get_affiliate_program">) {
  const locale = mainLocale(store);
  const [program, overview, bonus] = await Promise.all([getAffiliateSettings(store.id), affiliateOverview(store.id), getBonusSettings(store.id)]);
  const format = moneyIn(program.currency, locale);
  const who = customer ? await findBonusCustomer(store, customer) : null;
  const mine = who ? await customerAffiliate(store.id, who.id) : null;
  return {
    on: program.enabled && program.bonusOn,
    switched_on: program.enabled,
    bonus_program_on: program.bonusOn,
    ...(!program.bonusOn && { needs: AFFILIATE_NEEDS_BONUS }),
    credits_are_in: program.currency,
    how_it_works: AFFILIATE_EXPLANATION,
    friend_percent: program.friendPercent,
    friend_most_off: program.friendMaxMinor === null ? "no limit" : format(program.friendMaxMinor),
    referrer_percent: bpsToPercentText(program.rewardBps),
    orders_that_earn: program.rewardOrders ?? "every order",
    monthly_limit_per_referrer: program.monthlyCapMinor === null ? "no limit" : format(program.monthlyCapMinor),
    link_remembered_days: program.cookieDays,
    rules_for_shoppers: affiliateRulesSummary(program, format, bonus.pendingDays),
    example: affiliateExample(program, program.currency, locale),
    lately: Object.fromEntries(affiliateOverviewRows(overview, format).map((row) => [row.label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, ""), row.value])),
    ...(who && mine && {
      customer: {
        email: who.email,
        link_code: mine.code,
        blocked: mine.blocked,
        ...(mine.blocked && { blocked_reason: mine.blockedReason }),
        friends_who_ordered: mine.friends,
        credits_earned: format(mine.earnedMinor),
        referred_by: mine.referredBy ? { email: mine.referredBy.email, code: mine.referredBy.code } : null,
        orders_through_links: mine.attributions.slice(0, 10).map((row) => ({ order: row.orderNumber, status: attributionStatus(row), credits: row.rewardMinor > 0 ? moneyIn(row.creditsCurrency, locale)(row.rewardMinor) : undefined })),
      },
    }),
    page: adminLink(store, "/affiliates"),
  };
}

/** The settings a change would make: what the store has now, with what was given put over it. Problems are said for the model. */
async function affiliateSettingsFor(store: Store, input: OwnerToolInput<"set_affiliate_program">): Promise<{ settings: AffiliateSettings; bonusOn: boolean }> {
  if (Object.values(input).every((v) => v === undefined)) return fail("Say what to change: switch it on or off, the friend's discount, what a referrer earns, for how many orders, the monthly limit or how long a link is remembered.");
  const current = await getAffiliateSettings(store.id);
  const { bonusOn, currency, ...settings } = current;
  const next: AffiliateSettings = { ...AFFILIATE_DEFAULTS, ...settings };
  if (input.enabled !== undefined) next.enabled = input.enabled;
  if (input.friend_percent !== undefined) next.friendPercent = input.friend_percent;
  if (input.friend_max !== undefined) {
    const minor = input.friend_max === null ? null : parsePrice(input.friend_max, currency);
    if (input.friend_max !== null && minor === null) return fail(`The most the welcome discount takes off is an amount in ${currency}, such as 100 or 99,50, or null for no limit.`);
    next.friendMaxMinor = minor;
  }
  if (input.reward_percent !== undefined) {
    const bps = percentTextToBps(String(input.reward_percent));
    if (bps === null) return fail("What a referrer earns is a percentage with at most two decimals, such as 5 or 2.5.");
    next.rewardBps = bps;
  }
  if (input.reward_orders !== undefined) next.rewardOrders = input.reward_orders;
  if (input.monthly_cap !== undefined) {
    const minor = input.monthly_cap === null ? null : parsePrice(input.monthly_cap, currency);
    if (input.monthly_cap !== null && minor === null) return fail(`The monthly limit is an amount in ${currency}, such as 500, or null for no limit.`);
    next.monthlyCapMinor = minor;
  }
  if (input.cookie_days !== undefined) next.cookieDays = input.cookie_days;
  return { settings: next, bonusOn };
}

async function setAffiliateProgramTool(ctx: OwnerToolContext, input: OwnerToolInput<"set_affiliate_program">) {
  const { store } = ctx;
  const { settings } = await affiliateSettingsFor(store, input);
  const result = await saveAffiliateSettings(ctx.account, store.id, settings);
  if (!result.ok) return fail(result.problems.join(" "));
  ctx.invalidate(affiliateTag(store.id));
  ctx.invalidate(cookiesTag(store.id));
  ctx.invalidate(storeTag(store.slug));
  ctx.invalidate(catalogTag(store.id));
  const program = await getAffiliateSettings(store.id);
  const bonus = await getBonusSettings(store.id);
  return {
    done: settings.enabled ? "The referral program is on with these rules." : "The referral program is off. Credits already earned are kept.",
    rules_for_shoppers: affiliateRulesSummary(settings, moneyIn(program.currency, mainLocale(store)), bonus.pendingDays),
    ...(settings.enabled && { note: "Visitors are asked about marketing cookies, because a friend's link is remembered only with their consent." }),
    admin: adminLink(store, "/affiliates"),
  };
}

/** The customer with a link, found, or the reason there is none. */
async function affiliateCustomerFor(store: Store, ref: string) {
  const who = await findBonusCustomer(store, ref);
  const [link] = await db().execute<Row>(sql`select 1 from commerce.affiliates where store_id = ${store.id}::uuid and customer_id = ${who.id}::uuid`);
  return link ? who : fail(`${who.email} has no referral link yet: customers get one when they open Refer a friend in My account.`);
}

async function blockAffiliateTool(ctx: OwnerToolContext, input: OwnerToolInput<"block_affiliate">) {
  const { store } = ctx;
  const who = await affiliateCustomerFor(store, input.customer);
  const result = await setAffiliateBlocked(ctx.account, store.id, who.id, input.blocked, input.reason);
  if (!result.ok) return fail(result.problems.join(" "));
  return {
    done: input.blocked ? `${who.email} is blocked: they earn no more referral credits.` : `${who.email} earns referral credits again.`,
    admin: adminLink(store, `/customers/${who.id}`),
  };
}

// Reaching customers, the team and the stock (D104) -------------------------------------------

async function listIntegrationsTool({ store }: OwnerToolContext) {
  const connected = await listIntegrations(store.id);
  return {
    connected: connected.map((i) => ({
      service: i.provider,
      on: i.enabled,
      events: i.events,
      last_sent: i.lastDelivery ? { status: i.lastDelivery.status, at: i.lastDelivery.at } : null,
      failed_this_week: i.recentFailures,
      admin: adminLink(store, `/integrations/${i.provider}`),
    })),
    available: ["zapier", "make", "slack"].filter((p) => !connected.some((i) => i.provider === p)),
    note: "Zapier and Make pass the store's events on to other tools, such as newsletters or spreadsheets; Slack posts them to a channel. Connect them under Integrations.",
    admin: adminLink(store, "/integrations"),
  };
}

/** Words the claims filter (D76) finds in AI-written text for customers, which must be rewritten first. */
function claimsIn(...texts: string[]): string[] {
  return [...new Set(texts.flatMap((text) => findClaims(text).map((c) => c.phrase)))];
}

async function emailCustomerTool({ store }: OwnerToolContext, { to, subject, message }: OwnerToolInput<"email_customer">) {
  const claims = claimsIn(subject, message);
  if (claims.length) return fail(`Rewrite without claims the store cannot back: ${claims.join(", ")}.`);
  const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to);
  // Only the store's own customers: someone who ordered, or has an account here.
  const [found] = isEmail
    ? await db().execute<Row>(sql`
        select email, id as order_id, market_code, locale from (
          select o.email, o.id, o.market_code, o.locale, o.created_at from commerce.orders o
          where o.store_id = ${store.id}::uuid and lower(o.email) = lower(${to}) and o.copied_from is null
          union all
          select c.email, null::uuid, null, c.locale, c.created_at from commerce.customers c
          where c.store_id = ${store.id}::uuid and lower(c.email) = lower(${to})
        ) found order by (id is null), created_at desc limit 1
      `)
    : await db().execute<Row>(sql`
        select o.email, o.id as order_id, o.market_code, o.locale from commerce.orders o
        where o.store_id = ${store.id}::uuid and o.id = ${await findOrderId(store, to)}::uuid and o.email <> ''
      `);
  if (!found) return fail(`${to} is not a customer of this store. Use list_customers or get_order.`);
  const outcome = await sendStoreMessage(store.id, {
    to: String(found.email),
    subject,
    text: message,
    // Linked to the order when written about one; a message to an email alone links none.
    orderId: isEmail ? null : String(found.order_id),
    marketCode: found.market_code ? String(found.market_code) : null,
    locale: found.locale ? String(found.locale) : null,
  });
  if (outcome === "failed" || outcome === null) return fail("The email could not be sent. Try again later.");
  return { done: outcome === "logged" ? `Written to ${String(found.email)} (email is not set up here, so it was only logged).` : `Emailed ${String(found.email)}.` };
}

async function resendOrderEmailTool({ store }: OwnerToolContext, { order, which }: OwnerToolInput<"resend_order_email">) {
  const orderId = await findOrderId(store, order);
  if (which === "confirmation") {
    const outcome = await sendOrderConfirmation(store.id, orderId, { resend: true });
    if (!outcome || outcome === "failed") return fail("The confirmation could not be sent: the order has no email, or is not paid.");
    return { done: `The order confirmation for ${order} went to the customer again.` };
  }
  const [shipment] = await db().execute<Row>(sql`
    select id, carrier, tracking_number, tracking_url from commerce.shipments
    where store_id = ${store.id}::uuid and order_id = ${orderId}::uuid order by created_at desc limit 1
  `);
  if (!shipment) return fail(`Order ${order} has not been sent yet.`);
  const outcome = await sendShipped(
    store.id,
    orderId,
    {
      id: String(shipment.id),
      carrier: String(shipment.carrier),
      trackingNumber: String(shipment.tracking_number),
      trackingUrl: shipment.tracking_url ? String(shipment.tracking_url) : null,
    },
    { resend: true },
  );
  if (!outcome || outcome === "failed") return fail("The shipping notice could not be sent.");
  return { done: `The shipping notice for ${order} went to the customer again.` };
}

async function setStockTool(ctx: OwnerToolContext, { sku, quantity }: OwnerToolInput<"set_stock">) {
  const { store } = ctx;
  const variants = await db().execute<Row>(sql`
    select v.id, v.product_id, (select count(*)::int from commerce.inventory_levels l where l.variant_id = v.id) as places
    from commerce.product_variants v
    where v.store_id = ${store.id}::uuid and v.active and v.delivery = 'physical' and lower(v.sku) = lower(${sku})
  `);
  if (variants.length === 0) return fail(`No shipped variant with the SKU ${sku}. Use get_product for SKUs.`);
  if (variants.length > 1) return fail(`More than one variant has the SKU ${sku}: set it on the product page.`);
  const variant = variants[0];
  if (Number(variant.places) > 1) return fail(`${sku} is kept in more than one place: set it on the product page.`);
  await db().transaction(async (tx) => {
    const [place] = await tx.execute<Row>(sql`
      select coalesce(
        (select location_id from commerce.inventory_levels where variant_id = ${String(variant.id)}::uuid limit 1),
        (select id from commerce.inventory_locations where store_id = ${store.id}::uuid and active order by created_at limit 1)
      ) as location_id
    `);
    if (!place?.location_id) return fail("The store has no stock location yet: save the product once on its page.");
    await tx.execute(sql`
      insert into commerce.inventory_levels (store_id, variant_id, location_id, on_hand)
      values (${store.id}::uuid, ${String(variant.id)}::uuid, ${String(place.location_id)}::uuid, ${quantity})
      on conflict (variant_id, location_id) do update set on_hand = excluded.on_hand, updated_at = now()
    `);
  });
  ctx.invalidate(catalogTag(store.id));
  return { done: `${sku} now has ${quantity} in stock.`, admin: adminLink(store, `/products/${String(variant.product_id)}`) };
}

async function postToSlackTool({ store }: OwnerToolContext, { message }: OwnerToolInput<"post_to_slack">) {
  const outcome = await postToSlack(store.id, message);
  if (!outcome.ok) return fail(`Slack did not take it: ${outcome.error ?? "no answer"}.`);
  return { done: "Posted to the store's Slack channel." };
}

async function aiUsageTool({ account, store }: OwnerToolContext, { days, scope }: OwnerToolInput<"ai_usage">) {
  const all = scope === "all_my_stores";
  if (all && (await ownedStores(account.id)).length === 0) return fail("The account owns no store.");
  const rows = await usageRows({ days, ...(all ? { ownedBy: account.id } : { storeId: store.id, ownedBy: account.id }) });
  return { period: `the last ${days} days, today included`, covers: all ? "every store the owner owns" : store.name, ...summarizeUsage(rows), admin: "/admin/account/usage" };
}

// Custom fields (D118) -------------------------------------------------------------------------

const mainOf = (store: Store) => store.localization.locales[0] ?? "en";

type FieldTarget = { id: string; title: string; facts: Facts; editor: string; tags: string[] };

/** The product, page or article a tool means (or the store itself, which needs no `ref`), the store's only, with what group rules ask about it. */
async function findFieldTarget(store: Store, entity: ToolFieldEntity, item: string | undefined): Promise<FieldTarget> {
  if (entity === "store") {
    // The store's own fields (D120): one set for the whole site.
    const facts = await storeRuleFacts(db(), store.id, store.id);
    if (!facts) return fail("The store could not be found.");
    return { id: store.id, title: store.name, facts, editor: adminLink(store, "/fields/store"), tags: [storeTag(store.slug)] };
  }
  const ref = item ?? "";
  if (ref === "") return fail(`Say which ${entity} with item: its id, ${entity === "product" ? "handle or title" : "address (slug) or id"}.`);
  if (entity === "product") {
    const id = await findProductId(store, ref);
    const [[head], facts] = await Promise.all([
      db().execute<Row>(sql`
        select coalesce((select title from commerce.product_translations where product_id = p.id and locale = ${mainOf(store)}),
          (select title from commerce.product_translations where product_id = p.id order by locale limit 1), p.handle) as title
        from commerce.products p where p.store_id = ${store.id}::uuid and p.id = ${id}::uuid
      `),
      productFacts(db(), store.id, id),
    ]);
    if (!facts) return fail(`No product "${ref}" in this store. Use list_products to find it.`);
    return { id, title: String(head.title), facts, editor: adminLink(store, `/products/${id}`), tags: [catalogTag(store.id)] };
  }
  const rows = await db().execute<Row>(sql`
    select id, coalesce(nullif(draft ->> 'title', ''), nullif(published ->> 'title', ''), slug) as title from commerce.pages
    where store_id = ${store.id}::uuid and type = ${entity} and (id::text = ${ref} or slug = ${ref}) limit 2
  `);
  if (rows.length === 0) return fail(`No ${entity} "${ref}" in this store. Use list_pages${entity === "article" ? " with type article" : ""} to find it.`);
  const id = String(rows[0].id);
  const facts = await pageFacts(db(), store.id, id, "draft");
  if (!facts) return fail(`No ${entity} "${ref}" in this store.`);
  return { id, title: String(rows[0].title), facts, editor: adminLink(store, entity === "article" ? `/articles/${id}` : `/pages/${id}`), tags: [pagesTag(store.id)] };
}

async function listFieldGroupsTool({ store }: OwnerToolContext) {
  // Customers' and orders' groups are for staff and never shown here (D120).
  const groups = (await listFieldGroups(store.id)).filter((g) => !g.entities.some(isStaffEntity));
  const termIds = [...new Set(groups.flatMap(termIdsInRules))];
  const terms = termIds.length
    ? await db().execute<Row>(sql`select id, name from commerce.terms where store_id = ${store.id}::uuid and id in (${sql.join(termIds.map((id) => sql`${id}::uuid`), sql`, `)})`)
    : [];
  const names = new Map(terms.map((r) => [String(r.id), String(r.name)]));
  return {
    groups: groups.map((g) => ({
      name: g.name,
      slug: g.slug,
      on: entityWords(g.entities),
      applies_to: describeLocation(g, names),
      active: g.active,
      column: g.position,
      fields: g.fields.map((f) => ({
        label: f.label,
        name: f.name,
        type: f.type,
        required: f.required === true,
        access: f.access === "public" ? "public (shown on the site)" : "private (staff only)",
        options: f.choices?.map((c) => c.label),
        units: f.units,
        unit: f.unit,
        filter: f.filter || undefined,
        search: f.search || undefined,
        chat: f.chat || undefined,
        hidden_unless: f.when && f.when.length > 0 ? true : undefined,
      })),
    })),
    note: groups.length === 0 ? "The store has no custom fields yet: create_field_group makes a group." : "A field is private until it is made public. The site shows public fields through the product layout's Custom fields component (the standard product page shows them after the description).",
    page: adminLink(store, "/fields"),
  };
}

async function getFieldsTool({ store }: OwnerToolContext, { entity, item }: OwnerToolInput<"get_fields">) {
  const target = await findFieldTarget(store, entity, item);
  const main = mainOf(store);
  const yesNo = t(main.split("-")[0]).customFields;
  const [groups, data] = await Promise.all([activeFieldGroups(store.id, entity), getFieldData(store.id, entity, target.id)]);
  const applying = groups.filter((g) => groupApplies(g, target.facts));
  return {
    [entity]: target.title,
    language: main,
    groups: applying.map((g) => {
      const values = valuesFor(g.fields, data, main, main);
      return {
        group: g.name,
        fields: g.fields.map((f) => {
          const value = readField(f, data, main, main);
          return {
            name: f.name,
            label: f.label,
            type: f.type,
            required: f.required === true,
            access: f.access,
            value: value === undefined || isEmptyValue(value) ? null : fieldValueText(f, value, main, yesNo),
            options: f.choices?.map((c) => c.label),
            hidden_by_its_logic: fieldShows(f, values) ? undefined : true,
          };
        }),
      };
    }),
    note: applying.length === 0 ? `No custom fields apply to this ${entity}: list_field_groups shows the groups and where each applies.` : "A null value is empty. Public fields show on the site; private ones are for staff.",
    admin: target.editor,
  };
}

/** Words the store cannot back in what would be written: the claims filter (D76) reads it before a change is even kept. */
function claimsFail(claims: string[]): void {
  if (claims.length > 0) fail(`Rewrite without claims the store cannot back: ${claims.join(", ")}.`);
}

/** Works out a `set_fields` call against the store's own groups: which fields, what they take, every problem in words. */
async function prepareSetFields({ store }: OwnerToolContext, input: OwnerToolInput<"set_fields">) {
  if (Object.keys(input.values).length === 0) return fail("Name at least one field to set.");
  if (Object.keys(input.values).length > 30) return fail("Set at most 30 fields at a time.");
  const target = await findFieldTarget(store, input.entity, input.item);
  const groups = (await activeFieldGroups(store.id, input.entity)).filter((g) => groupApplies(g, target.facts));
  if (groups.length === 0) {
    return fail(`No custom fields apply to this ${input.entity}. list_field_groups shows the groups and where each applies; create_field_group makes one.`);
  }
  const prepared = prepareValues(
    input.values,
    groups.flatMap((group) => group.fields.map((def) => ({ group, def }))),
    `the ${input.entity}'s editor (${target.editor})`,
  );
  if (!prepared.ok) return fail(prepared.problems.join(" "));
  claimsFail(claimsIn(...wordsIn(prepared.prepared)));
  return { target, prepared: prepared.prepared };
}

async function setFieldsTool(ctx: OwnerToolContext, input: OwnerToolInput<"set_fields">) {
  const { store } = ctx;
  const { target, prepared } = await prepareSetFields(ctx, input);
  const main = mainOf(store);
  // Text is per language: it is written in the main one; the rest are the same in every language.
  const raw = { values: {} as Record<string, unknown>, translations: { [main]: {} as Record<string, unknown> } };
  for (const { candidate, value } of prepared) {
    (isTranslatable(candidate.def.type) ? raw.translations[main] : raw.values)[candidate.def.id] = value;
  }
  const problems = await db().transaction((tx) =>
    saveFieldData(tx, store.id, input.entity, target.id, raw, { facts: target.facts, locales: store.localization.locales, main, requireAll: false }),
  );
  if (problems.length > 0) return fail(problems.join(" "));
  for (const tag of [fieldsTag(store.id), ...target.tags]) ctx.invalidate(tag);
  const set = prepared.filter((p) => !p.clears).map((p) => p.candidate.def.label);
  const cleared = prepared.filter((p) => p.clears).map((p) => p.candidate.def.label);
  const shown = prepared.filter((p) => p.candidate.def.access === "public").map((p) => p.candidate.def.label);
  const kept = prepared.filter((p) => p.candidate.def.access !== "public").map((p) => p.candidate.def.label);
  return {
    done: `${[set.length > 0 && `Set ${set.join(", ")}`, cleared.length > 0 && `cleared ${cleared.join(", ")}`].filter(Boolean).join(" and ")} on ${target.title}.`.replace(/^c/, "C"),
    on_the_site: shown.length > 0 ? shown : undefined,
    private_so_not_shown: kept.length > 0 ? kept : undefined,
    admin: target.editor,
  };
}

async function createFieldGroupTool(ctx: OwnerToolContext, input: OwnerToolInput<"create_field_group">) {
  const { store } = ctx;
  claimsFail(claimsIn(...groupTexts(input)));
  const existing = await listFieldGroups(store.id);
  const built = buildFieldGroup(input, existing.map((g) => g.slug));
  if (!built.ok) return fail(built.problem);
  const result = await saveFieldGroup({ account: ctx.account, store, role: "owner" }, built.group);
  if (!result.ok) return fail(result.problems.join(" "));
  ctx.invalidate(fieldsTag(store.id));
  const anyPublic = built.group.fields.some((f) => f.access === "public");
  return {
    done: `The field group "${input.name}" is made for ${entityWords([input.entity])[0]}, with ${built.group.fields.map((f) => f.label).join(", ")}.`,
    fields: built.group.fields.map((f) => ({ name: f.name, label: f.label, type: f.type, access: f.access })),
    note: anyPublic
      ? "Public fields show on the site once filled in: the standard product page shows them after the description, and a product layout shows them through its Custom fields component. Fill them in with set_fields."
      : "The fields are private, so only staff see them. To show them on the site, make them public in the admin editor; a product layout shows them through its Custom fields component. Fill them in with set_fields.",
    admin: result.id ? adminLink(store, `/fields/${result.id}`) : adminLink(store, "/fields"),
  };
}

/**
 * Checks a gated call before it is even kept for approval: what would be
 * written must pass the claims filter (D76) and name fields that exist, so
 * the owner is never asked to approve what could not be done. Throws
 * `OwnerToolError` with the reason for the model.
 */
export async function preflightOwnerTool(ctx: OwnerToolContext, name: string, raw: unknown): Promise<void> {
  // A change the member's role may not make is refused now, never kept for a yes.
  if (OWNER_TOOLS_BY_NAME[name]) requireToolPermission(ctx, name);
  // A return that could not be approved or declined (a withdrawal is never declined) is refused now, never kept for a yes (D153).
  if (name === "approve_return" || name === "decline_return") {
    const tool = OWNER_TOOLS_BY_NAME[name];
    const input = readToolInput(tool, raw);
    if (!input.ok) return fail(`The arguments could not be read: ${input.problem}`);
    return preflightReturnTool(ctx, name, input.input as Record<string, unknown>);
  }
  // A test that could not be started, stopped or decided is refused now, never kept for a yes (D148).
  if (name === "start_experiment" || name === "stop_experiment" || name === "apply_winner") {
    const tool = OWNER_TOOLS_BY_NAME[name];
    const input = readToolInput(tool, raw);
    if (!input.ok) return fail(`The arguments could not be read: ${input.problem}`);
    return preflightExperimentTool(ctx, name, input.input as Record<string, unknown>);
  }
  if (name !== "set_recommendations" && name !== "add_recommendation_rule" && name !== "remove_recommendation_rule" && name !== "set_fields" && name !== "create_field_group" && name !== "set_bonus_program" && name !== "adjust_customer_credits" && name !== "set_affiliate_program" && name !== "block_affiliate") return;
  const tool = OWNER_TOOLS_BY_NAME[name];
  const input = tool ? readToolInput(tool, raw) : null;
  if (!input?.ok) return fail(`The arguments could not be read: ${input?.problem ?? "unknown tool"}`);
  // A recommendations change that could not be made is refused now, never kept for a yes.
  if (name === "set_recommendations") {
    const problems = settingsProblems(await recommendSettingsFor(ctx.store, input.input as OwnerToolInput<"set_recommendations">));
    if (problems.length > 0) return fail(problems.join(" "));
    return;
  }
  if (name === "add_recommendation_rule" || name === "remove_recommendation_rule") {
    await ruleProductIds(ctx.store, input.input as { kind: string; product: string; other_product?: string });
    return;
  }
  // A bonus change that could not be made is refused now, never kept for a yes.
  if (name === "set_bonus_program") {
    const settings = await bonusSettingsFor(ctx.store, input.input as OwnerToolInput<"set_bonus_program">);
    const checked = bonusSettingsInput.safeParse(settings);
    if (!checked.success) return fail(checked.error.issues.map((i) => i.message).join(" "));
    return;
  }
  if (name === "adjust_customer_credits") {
    await adjustmentFor(ctx.store, input.input as OwnerToolInput<"adjust_customer_credits">);
    return;
  }
  // A referral change that could not be made is refused now too: the rules, and the bonus program being on.
  if (name === "set_affiliate_program") {
    const { settings, bonusOn } = await affiliateSettingsFor(ctx.store, input.input as OwnerToolInput<"set_affiliate_program">);
    const checked = affiliateSettingsInput.safeParse(settings);
    if (!checked.success) return fail(checked.error.issues.map((i) => i.message).join(" "));
    if (settings.enabled && !bonusOn) return fail(AFFILIATE_NEEDS_BONUS);
    return;
  }
  if (name === "block_affiliate") {
    await affiliateCustomerFor(ctx.store, (input.input as OwnerToolInput<"block_affiliate">).customer);
    return;
  }
  if (name === "set_fields") await prepareSetFields(ctx, input.input as OwnerToolInput<"set_fields">);
  else claimsFail(claimsIn(...groupTexts(input.input as OwnerToolInput<"create_field_group">)));
}

const HANDLERS: Record<OwnerToolName, Handler> = {
  store_overview: storeOverview,
  sales_summary: salesSummary,
  list_orders: listOrdersTool,
  get_order: getOrderTool,
  list_returns: listReturnsTool,
  explain_return: explainReturnTool,
  approve_return: approveReturnTool,
  decline_return: declineReturnTool,
  list_products: listProductsTool,
  get_product: getProductTool,
  low_stock: lowStock,
  unit_price_gaps: unitPriceGapsTool,
  list_bookings: listBookingsTool,
  list_discounts: listDiscountsTool,
  list_campaigns: listCampaignsTool,
  list_field_groups: listFieldGroupsTool,
  get_fields: getFieldsTool,
  create_field_group: createFieldGroupTool,
  set_fields: setFieldsTool,
  list_pages: listPagesTool,
  search_insights: searchInsights,
  add_order_note: addOrderNoteTool,
  mark_order_sent: markOrderSentTool,
  cancel_booking: cancelBookingTool,
  archive_product: archiveProductTool,
  unpublish_page: unpublishPageTool,
  setup_progress: setupProgressTool,
  store_checkup: storeCheckup,
  get_tax_profile: getTaxProfileTool,
  tax_readiness: taxReadinessTool,
  list_invoices: listInvoicesTool,
  invoice_readiness: invoiceReadinessTool,
  list_customers: listCustomersTool,
  get_customer: getCustomerTool,
  list_subscriptions: listSubscriptionsTool,
  cart_reminder_stats: cartReminderStatsTool,
  wishlist_insights: wishlistInsights,
  list_emails: listEmailsTool,
  subscription_boxes: subscriptionBoxes,
  refund_order: refundOrderTool,
  create_discount: createDiscountTool,
  set_discount_active: setDiscountActiveTool,
  create_campaign: createCampaignTool,
  set_campaign_active: setCampaignActiveTool,
  get_recommendations: getRecommendationsTool,
  set_recommendations: setRecommendationsTool,
  add_recommendation_rule: addRecommendationRuleTool,
  remove_recommendation_rule: removeRecommendationRuleTool,
  check_recommendations: checkRecommendationsTool,
  get_bonus_program: getBonusProgramTool,
  set_bonus_program: setBonusProgramTool,
  adjust_customer_credits: adjustCustomerCreditsTool,
  get_affiliate_program: getAffiliateProgramTool,
  set_affiliate_program: setAffiliateProgramTool,
  block_affiliate: blockAffiliateTool,
  customer_insights: customerInsights,
  product_performance: productPerformance,
  sales_trend: salesTrend,
  sales_funnel: salesFunnel,
  analytics_overview: analyticsOverviewTool,
  explain_change: explainChangeTool,
  analytics_alerts: analyticsAlertsTool,
  restock_suggestions: restockSuggestions,
  list_integrations: listIntegrationsTool,
  email_customer: emailCustomerTool,
  resend_order_email: resendOrderEmailTool,
  set_stock: setStockTool,
  ai_usage: aiUsageTool,
  post_to_slack: postToSlackTool,
  list_experiments: listExperimentsTool,
  explain_results: explainResultsTool,
  suggest_experiments: suggestExperimentsTool,
  draft_experiment: draftExperimentTool,
  start_experiment: startExperimentTool,
  stop_experiment: stopExperimentTool,
  apply_winner: applyWinnerTool,
};

/**
 * Runs a tool for the store's owner, its arguments checked first. Gated
 * tools run here only once approved (`runApproved` in the assistant);
 * changes are written to the store's audit log.
 */
export async function runOwnerTool(ctx: OwnerToolContext, name: string, raw: unknown): Promise<unknown> {
  const tool = OWNER_TOOLS_BY_NAME[name];
  if (!tool) return fail(`There is no tool called ${name}.`);
  requireToolPermission(ctx, name);
  const input = readToolInput(tool, raw);
  if (!input.ok) return fail(`The arguments could not be read: ${input.problem}`);
  const result = await HANDLERS[name as OwnerToolName](ctx, input.input as never);
  if (tool.gate || name === "add_order_note") {
    await audit(ctx.account.id, ctx.store.id, `store.assistant.${name}`, { args: input.input as Record<string, unknown> });
  }
  return result;
}
