import "server-only";

import { sql } from "drizzle-orm";

import type { Db } from "@/db/client";
import type { GiftFields } from "@/lib/gift";
import { allocate, totalsOf } from "@/lib/stock-routing";

type Row = Record<string, unknown>;

/**
 * The one place an order is written and numbered (D141, wave 3 run 2, D173, `docs/wave-3-orders.md` 4.5). `insertOrder()` takes the next number from the
 * store's gap-free series (`commerce.next_document_number(store, 'order')`) in the SAME transaction that inserts the order, so a number is used only by an order
 * that exists; a transaction that rolls back gives the number back. Three callers use it: `placeOrder()` (a cart), the subscription renewal and `placeDraftOrder()`
 * (a draft order sent or paid outside Kaizen). A unit test (`src/lib/order-numbers.test.ts`) fails for any other file that inserts into `commerce.orders` or numbers an
 * order. Orders are never deleted or renumbered (a cancelled one keeps its number): the sequence has no gap.
 *
 * `insertOrderLine()` writes a line with every column an order line has, so the checkout and a draft write them one way; `reserveStock()` holds what was
 * allocated (`allocate()`, D172) against the order until it is paid or the hold ends.
 */

/** What an order row is made of. Anything not named takes the database's own default (the same one the column has). */
export type OrderInsert = {
  storeId: string;
  marketCode: string;
  currency: string;
  locale: string;
  cartId?: string | null;
  email?: string;
  subtotalMinor: number;
  shippingMinor: number;
  /** Everything taken off: codes, groups, campaigns, the friend's discount, credits, the VAT not charged and a staff discount. */
  discountMinor: number;
  taxMinor: number;
  totalMinor: number;
  billingAddress?: Record<string, unknown>;
  shippingAddress?: Record<string, unknown>;
  /** The moment the shopper consented to downloads starting at once (D24): `"now"` or a time. */
  digitalConsentAt?: "now" | string | null;
  customerId?: string | null;
  discountCodeId?: string | null;
  discountCode?: string | null;
  companyName?: string | null;
  organisationNumber?: string | null;
  balanceMinor?: number;
  hostId?: string | null;
  memberDiscountMinor?: number;
  memberLabel?: string | null;
  memberPercent?: number | null;
  campaignDiscountMinor?: number;
  campaignLabel?: string | null;
  creditMinor?: number;
  referralDiscountMinor?: number;
  delivery?: unknown | null;
  standardShippingMinor?: number | null;
  returnCostPayer?: string | null;
  vatKind?: string;
  vatReliefMinor?: number;
  shippingTaxRate?: number | null;
  vatTreatment?: unknown | null;
  vatCheckId?: string | null;
  subscriptionId?: string | null;
  /** The buyer's gift (D173): copied from the cart; `NO_GIFT` or absent for none. */
  gift?: GiftFields | null;
  /** A draft order's order (D173): all three or none (the database checks `orders_source_draft`). */
  draft?: { id: string; madeBy: string } | null;
  staffDiscountMinor?: number;
  staffDiscountLabel?: string | null;
};

/** The order's own number, as `{prefix}{n}`, from the store's series (D141). Called only by `insertOrder()`. */
async function nextOrderNumber(tx: Db, storeId: string): Promise<string> {
  const [numbered] = await tx.execute<Row>(sql`
    select s.prefix || commerce.next_document_number(${storeId}::uuid, 'order')::text as number
    from commerce.document_series s
    where s.store_id = ${storeId}::uuid and s.series = 'order'
  `);
  return String(numbered.number);
}

/** Numbers and inserts an order waiting for payment. The caller's transaction holds both, so a failure later gives the number back. */
export async function insertOrder(tx: Db, input: OrderInsert): Promise<{ orderId: string; number: string }> {
  const number = await nextOrderNumber(tx, input.storeId);
  const gift = input.gift?.isGift ? input.gift : null;
  const consent = input.digitalConsentAt === "now" ? sql`now()` : sql`${input.digitalConsentAt ?? null}::timestamptz`;
  const [order] = await tx.execute<Row>(sql`
    insert into commerce.orders (
      store_id, number, market_code, currency, locale, cart_id, email, status,
      subtotal_minor, shipping_minor, discount_minor, tax_minor, total_minor,
      billing_address, shipping_address, digital_consent_at, customer_id, discount_code_id, discount_code,
      company_name, organisation_number, balance_minor, host_id,
      member_discount_minor, member_label, member_percent, campaign_discount_minor, campaign_label, credit_minor,
      referral_discount_minor, delivery, standard_shipping_minor, return_cost_payer,
      vat_kind, vat_relief_minor, shipping_tax_rate, vat_treatment, vat_check_id, subscription_id,
      is_gift, gift_to, gift_from, gift_message, source, draft_id, made_by, staff_discount_minor, staff_discount_label
    ) values (
      ${input.storeId}::uuid, ${number}, ${input.marketCode}, ${input.currency}, ${input.locale},
      ${input.cartId ?? null}::uuid, ${input.email ?? ""}, 'pending_payment',
      ${input.subtotalMinor}, ${input.shippingMinor}, ${input.discountMinor}, ${input.taxMinor}, ${input.totalMinor},
      ${JSON.stringify(input.billingAddress ?? {})}::jsonb, ${JSON.stringify(input.shippingAddress ?? {})}::jsonb,
      ${consent}, ${input.customerId ?? null}::uuid, ${input.discountCodeId ?? null}::uuid, ${input.discountCode ?? null},
      ${input.companyName ?? null}, ${input.organisationNumber ?? null}, ${input.balanceMinor ?? 0}, ${input.hostId ?? null}::uuid,
      ${input.memberDiscountMinor ?? 0}, ${input.memberLabel ?? null}, ${input.memberPercent ?? null},
      ${input.campaignDiscountMinor ?? 0}, ${input.campaignLabel ?? null}, ${input.creditMinor ?? 0},
      ${input.referralDiscountMinor ?? 0}, ${input.delivery === null || input.delivery === undefined ? null : JSON.stringify(input.delivery)}::jsonb,
      ${input.standardShippingMinor ?? null}::bigint, ${input.returnCostPayer ?? null},
      ${input.vatKind ?? "standard"}, ${input.vatReliefMinor ?? 0}, ${input.shippingTaxRate ?? null},
      ${input.vatTreatment === null || input.vatTreatment === undefined ? null : JSON.stringify(input.vatTreatment)}::jsonb,
      ${input.vatCheckId ?? null}::uuid, ${input.subscriptionId ?? null}::uuid,
      ${gift !== null}, ${gift?.to ?? null}, ${gift?.from ?? null}, ${gift?.message ?? null},
      ${input.draft ? "draft" : "checkout"}, ${input.draft?.id ?? null}::uuid, ${input.draft?.madeBy ?? null}::uuid,
      ${input.staffDiscountMinor ?? 0}, ${input.staffDiscountLabel ?? null}
    )
    returning id
  `);
  return { orderId: String(order.id), number };
}

/** An order line as the checkout and a draft write it. Anything not named takes the column's default. */
export type OrderLineInsert = {
  variantId: string | null;
  sku: string;
  title: string;
  quantity: number;
  unitPriceMinor: number;
  discountMinor: number;
  memberDiscountMinor?: number;
  totalMinor: number;
  taxMinor: number;
  taxRate: number;
  taxCode: string;
  withdrawalExclusion: string;
  delivery: "physical" | "digital" | "service";
  sellingPlanId?: string | null;
  planInterval?: string | null;
  planIntervalCount?: number | null;
  venueMinor?: number;
  bookedCount?: number | null;
  campaignDiscountMinor?: number;
  campaignId?: string | null;
  campaignParts?: { id: string; name: string; minor: number }[];
  gift?: boolean;
  bonusDiscountMinor?: number;
  referralDiscountMinor?: number;
  unitCostMinor?: number | null;
  vatReliefMinor?: number;
  measure?: { amount: number | string; unit: string; base: string } | null;
  backorderQuantity?: number;
  backorderDays?: number | null;
  /** A draft line (D173): the list price as shown when it was added, whether it is a custom item, and its share of the staff discount. */
  listPriceMinor?: number | null;
  custom?: boolean;
  staffDiscountMinor?: number;
};

/** Writes one order line and returns its id. */
export async function insertOrderLine(tx: Db, storeId: string, orderId: string, line: OrderLineInsert): Promise<string> {
  const [row] = await tx.execute<Row>(sql`
    insert into commerce.order_lines (
      store_id, order_id, variant_id, sku, title, quantity, unit_price_minor, discount_minor, member_discount_minor,
      total_minor, tax_minor, tax_rate, tax_code, withdrawal_exclusion, delivery,
      selling_plan_id, plan_interval, plan_interval_count, venue_minor, booked_count,
      campaign_discount_minor, campaign_id, campaign_parts, gift, bonus_discount_minor, referral_discount_minor,
      unit_cost_minor, vat_relief_minor, measure_amount, measure_unit, measure_base, backorder_quantity, backorder_days,
      list_price_minor, custom, staff_discount_minor
    ) values (
      ${storeId}::uuid, ${orderId}::uuid, ${line.variantId}::uuid, ${line.sku},
      ${line.title}, ${line.quantity}, ${line.unitPriceMinor}, ${line.discountMinor}, ${line.memberDiscountMinor ?? 0},
      ${line.totalMinor}, ${line.taxMinor}, ${line.taxRate}, ${line.taxCode},
      ${line.withdrawalExclusion}, ${line.delivery},
      ${line.sellingPlanId ?? null}::uuid,
      ${line.planInterval ?? null}::commerce.plan_interval,
      ${line.planIntervalCount ?? null}, ${line.venueMinor ?? 0},
      ${line.bookedCount ?? null},
      ${line.campaignDiscountMinor ?? 0}, ${line.campaignId ?? null}::uuid, ${JSON.stringify(line.campaignParts ?? [])}::jsonb, ${line.gift ?? false},
      ${line.bonusDiscountMinor ?? 0}, ${line.referralDiscountMinor ?? 0},
      ${line.unitCostMinor ?? null}, ${line.vatReliefMinor ?? 0},
      ${line.measure?.amount ?? null}::numeric, ${line.measure?.unit ?? null}, ${line.measure?.base ?? null},
      ${line.backorderQuantity ?? 0}, ${line.backorderDays ?? null},
      ${line.listPriceMinor ?? null}, ${line.custom ?? false}, ${line.staffDiscountMinor ?? 0}
    )
    returning id
  `);
  return String(row.id);
}

/** Units held against an order by `allocate()` (D172): where from, how many, and how many of them are beyond stock. */
export type StockHold = { variantId: string; locationId: string; quantity: number; backordered: number };

/**
 * Holds the allocated stock for the order: until `minutes` from now (a checkout's session), or until a given moment (a draft's expiry). A hold that has
 * lapsed stops counting in `variant_availability`, so a forgotten order never keeps stock for ever.
 */
export async function reserveStock(
  tx: Db,
  storeId: string,
  orderId: string,
  holds: readonly StockHold[],
  until: { minutes: number } | { at: Date },
): Promise<void> {
  for (const hold of holds) {
    await tx.execute(sql`
      insert into commerce.inventory_reservations (store_id, variant_id, location_id, quantity, backorder_quantity, order_id, expires_at)
      values (${storeId}::uuid, ${hold.variantId}::uuid, ${hold.locationId}::uuid, ${hold.quantity}, ${hold.backordered}, ${orderId}::uuid,
              ${"minutes" in until ? sql`now() + make_interval(mins => ${until.minutes})` : sql`${until.at.toISOString()}::timestamptz`})
    `);
  }
}

/** What is wanted of one variant: how many units, and whether the variant may be sold past its stock (`continue`, D172) or stops at zero (`deny`). */
export type StockWant = { variantId: string; quantity: number; policy: "continue" | "deny" };

export type StockPlan = { ok: false } | { ok: true; holds: StockHold[]; /** The units of each variant that are beyond what is in stock. */ behind: Map<string, number> };

/**
 * Where the units come from (D172, `docs/wave-3-inventory.md` 2.5), for a checkout and for a draft order sent to a buyer. The level rows of every variant being bought are locked first, in the
 * one order every writer uses (variant, location), so two checkouts cannot deadlock; then the free units are counted (on hand minus live holds) and `allocate()` applies the stated rule: keep an order
 * together, else by the locations' rank, the backordered remainder at the first location that stocks the variant. A variant that keeps selling on backorder takes the units beyond its stock too; one that
 * stops at zero fails (`ok: false`). `ensureLevelFor` names the variants that keep selling and may have no level at any active location: they get one (at 0) at the first, so there is a row to lock and draw.
 * It writes only those rows; nothing is held until `reserveStock()`.
 */
export async function allocateStock(tx: Db, storeId: string, wants: readonly StockWant[], ensureLevelFor: readonly string[]): Promise<StockPlan> {
  const variantIds = [...new Set(wants.map((w) => w.variantId))].sort();
  if (variantIds.length === 0) return { ok: true, holds: [], behind: new Map() };
  const ids = sql.join(variantIds.map((id) => sql`${id}::uuid`), sql`, `);
  const places = await tx.execute<Row>(sql`
    select id, priority, created_at from commerce.inventory_locations
    where store_id = ${storeId}::uuid and active
    order by priority, created_at, id
  `);
  // A variant that keeps selling past zero and has no level at any active location gets one at the first, so there is a row to lock and draw.
  const home = places[0] ? String(places[0].id) : null;
  if (home) {
    for (const variantId of ensureLevelFor) {
      await tx.execute(sql`
        insert into commerce.inventory_levels (store_id, variant_id, location_id, on_hand)
        select ${storeId}::uuid, ${variantId}::uuid, ${home}::uuid, 0
        where not exists (
          select 1 from commerce.inventory_levels l
          join commerce.inventory_locations loc on loc.store_id = l.store_id and loc.id = l.location_id and loc.active
          where l.store_id = ${storeId}::uuid and l.variant_id = ${variantId}::uuid
        )
        on conflict (variant_id, location_id) do nothing
      `);
    }
  }
  const levels = await tx.execute<Row>(sql`
    select l.variant_id, l.location_id, l.on_hand
    from commerce.inventory_levels l
    where l.store_id = ${storeId}::uuid and l.variant_id in (${ids})
    order by l.variant_id, l.location_id
    for update of l
  `);
  const holds = await tx.execute<Row>(sql`
    select variant_id, location_id, sum(quantity)::int as held
    from commerce.inventory_reservations
    where store_id = ${storeId}::uuid and variant_id in (${ids})
      and released_at is null and expires_at > now()
    group by variant_id, location_id
  `);
  const heldAt = new Map(holds.map((h) => [`${h.variant_id}:${h.location_id}`, Number(h.held)]));
  const outcome = allocate({
    locations: places.map((l) => ({ id: String(l.id), priority: Number(l.priority), createdAt: new Date(String(l.created_at)).toISOString(), active: true })),
    cells: levels.map((l) => ({
      variantId: String(l.variant_id),
      locationId: String(l.location_id),
      onHand: Number(l.on_hand),
      reserved: heldAt.get(`${l.variant_id}:${l.location_id}`) ?? 0,
    })),
    lines: wants.map((w) => ({ variantId: w.variantId, quantity: w.quantity, policy: w.policy })),
  });
  if (!outcome.ok) return { ok: false };
  return {
    ok: true,
    holds: outcome.takes.map((take) => ({ variantId: take.variantId, locationId: take.locationId, quantity: take.quantity, backordered: take.backordered })),
    behind: new Map([...totalsOf(outcome.takes)].map(([id, t]) => [id, t.backordered])),
  };
}
