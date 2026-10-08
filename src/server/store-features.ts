import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { homeMarket } from "@/lib/markets";
import { formatMoney } from "@/lib/money";
import {
  FEATURES_BY_ID,
  dependentsOf,
  featureBlockers,
  featureOn,
  featureWarnings,
  missingNeeds,
  normaliseFeatures,
  type FeatureBlocker,
  type FeatureFacts,
  type FeatureId,
} from "@/lib/store-features";

import { affiliateTag } from "./affiliates";
import { afterSaleTag } from "./after-sale";
import { audit, type Membership } from "./auth";
import { catalogTag } from "./catalog";
import { pagesTag } from "./pages";
import { memberCan } from "./permissions";
import { refreshTag } from "./refresh";
import { cookiesTag } from "./site-cookies";
import { STORES_TAG } from "./seo";
import { storeObligations } from "./store-closure";
import { storeTag } from "./stores";

/**
 * Switching a store's features on and off (D178, `docs/store-features.md`). The registry and the rules of what blocks or warns are pure
 * (`src/lib/store-features.ts`); here they are counted from the database and applied, owners only, under the store's row lock, and audited
 * (`store.feature`). Nothing is deleted: a feature switched off is hidden and refused, and comes back as it was when switched on again.
 */

type Row = Record<string, unknown>;
type Tx = Parameters<Parameters<ReturnType<typeof db>["transaction"]>[0]>[0];
type Executor = Pick<ReturnType<typeof db>, "execute"> | Tx;

const n = (value: unknown) => Number(value ?? 0);

/** Everything the Features page and the switches need to know of a store's data, counted now. */
export async function featureFacts(storeId: string, executor: Executor = db()): Promise<FeatureFacts> {
  const obligations = await storeObligations(storeId, executor);
  const [row] = await executor.execute<Row>(sql`
    with s as (select id, country, locales from commerce.stores where id = ${storeId}::uuid),
    -- The store's own country (D178: \`home_market()\`), or its business's country before it has a market.
    home as (select coalesce(commerce.home_market(${storeId}::uuid), (select country from s)) as code),
    held as (
      select p.kind, count(*)::int as n from commerce.bookings b
      join commerce.products p on p.store_id = b.store_id and p.id = b.product_id
      where b.store_id = ${storeId}::uuid and b.status in ('held', 'confirmed') and b.ends_at > now()
      group by p.kind
    ),
    credits as (
      select bal.available_minor + bal.pending_minor as held_minor
      from (select distinct e.customer_id from commerce.bonus_entries e where e.store_id = ${storeId}::uuid) c
      cross join lateral commerce.bonus_balance(${storeId}::uuid, c.customer_id) bal
    )
    select
      (select count(*)::int from commerce.subscriptions su, home where su.store_id = ${storeId}::uuid
        and su.status in ('active', 'past_due', 'paused') and su.market_code is distinct from home.code) as foreign_subscriptions,
      (select count(distinct sp.product_id)::int from commerce.selling_plans sp where sp.store_id = ${storeId}::uuid and sp.active) as subscription_products,
      (select count(*)::int from commerce.standing_orders d
        join commerce.delivery_schedules sc on sc.store_id = d.store_id and sc.id = d.schedule_id, home
        where d.store_id = ${storeId}::uuid and d.status in ('active', 'paused') and sc.market_code is distinct from home.code) as foreign_boxes,
      (select count(*)::int from commerce.standing_deliveries sd
        join commerce.orders o on o.store_id = sd.store_id and o.id = sd.order_id
        where sd.store_id = ${storeId}::uuid and o.status = 'pending_payment') as box_orders_unpaid,
      (select count(*)::int from commerce.delivery_schedules sc where sc.store_id = ${storeId}::uuid) as delivery_schedules,
      (select coalesce(sum(n), 0)::int from held where kind = 'appointment') as future_appointments,
      (select coalesce(sum(n), 0)::int from held where kind in ('stay', 'rental')) as future_stays,
      (select count(*)::int from commerce.products p where p.store_id = ${storeId}::uuid and p.kind = 'appointment' and p.status <> 'archived') as appointment_products,
      (select count(*)::int from commerce.products p where p.store_id = ${storeId}::uuid and p.kind in ('stay', 'rental') and p.status <> 'archived') as stay_products,
      (select count(*)::int from commerce.booking_resources r where r.store_id = ${storeId}::uuid and r.kind = 'staff' and r.active) as staff,
      (select count(*)::int from commerce.booking_resources r where r.store_id = ${storeId}::uuid and r.kind in ('unit', 'item') and r.active) as units,
      (select count(*)::int from commerce.hosts h where h.store_id = ${storeId}::uuid and h.disabled_at is null) as hosts,
      (select count(*)::int from commerce.host_commissions c where c.store_id = ${storeId}::uuid and c.status = 'pending' and c.amount_minor > c.reversed_minor) as unpaid_host_commissions,
      (select count(*)::int from commerce.markets m, home where m.store_id = ${storeId}::uuid and m.active and m.code is distinct from home.code) as other_countries,
      -- Paid orders with goods still to send to another country (real payments, as \`storeObligations()\` counts them), and open carts there.
      (select count(*)::int from commerce.orders o, home
        where o.store_id = ${storeId}::uuid and o.status = 'paid' and o.copied_from is null and o.market_code is distinct from home.code
          and exists (select 1 from commerce.order_lines l where l.store_id = o.store_id and l.order_id = o.id and l.delivery = 'physical' and not l.gift)
          and not coalesce((select bool_and(p.test_mode) from commerce.payments p where p.store_id = o.store_id and p.order_id = o.id), false)
      ) as foreign_unsent,
      (select count(*)::int from commerce.carts c, home
        where c.store_id = ${storeId}::uuid and c.status = 'open' and c.expires_at > now() and c.market_code is distinct from home.code
          and exists (select 1 from commerce.cart_lines cl where cl.store_id = c.store_id and cl.cart_id = c.id)
      ) as foreign_carts,
      -- Languages besides each active country's own (D178: what Several languages adds, and what is hidden while it is off).
      (select count(distinct split_part(l, '-', 1))::int from (
        select unnest(s.locales) as l from s
        union all
        select unnest(m.locales) from commerce.markets m where m.store_id = ${storeId}::uuid and m.active
      ) langs
      where split_part(l, '-', 1) not in (
        select split_part(m.default_locale, '-', 1) from commerce.markets m where m.store_id = ${storeId}::uuid and m.active
      )) as other_languages,
      (select count(*)::int from commerce.store_currencies c where c.store_id = ${storeId}::uuid
        and c.currency not in (select m.currency from commerce.markets m where m.store_id = c.store_id and m.active)) as extra_currencies,
      (select count(*)::int from commerce.carts c where c.store_id = ${storeId}::uuid and c.status = 'open' and coalesce(c.vat_number, '') <> '') as business_carts,
      (select count(*)::int from commerce.products p where p.store_id = ${storeId}::uuid and p.audience = 'businesses' and p.status <> 'archived') as business_products,
      (select count(*)::int from commerce.customer_companies cc where cc.store_id = ${storeId}::uuid) as companies,
      coalesce((select b.enabled from commerce.bonus_settings b where b.store_id = ${storeId}::uuid), false) as bonus_enabled,
      (select b.currency from commerce.bonus_settings b where b.store_id = ${storeId}::uuid) as credits_currency,
      (select count(*)::int from credits where held_minor > 0) as credit_holders,
      (select coalesce(sum(held_minor), 0)::bigint from credits where held_minor > 0) as credits_minor,
      coalesce((select a.enabled from commerce.affiliate_settings a where a.store_id = ${storeId}::uuid), false) as referrals_enabled,
      (select count(*)::int from commerce.affiliates a where a.store_id = ${storeId}::uuid and a.blocked_at is null) as referrers,
      (select count(*)::int from commerce.affiliate_attributions a where a.store_id = ${storeId}::uuid and a.status = 'pending') as pending_referrals
  `);
  return {
    paidUnshipped: obligations.paidUnshipped,
    openCheckouts: obligations.openCheckouts,
    runningSubscriptions: obligations.runningSubscriptions,
    foreignSubscriptions: n(row?.foreign_subscriptions),
    subscriptionProducts: n(row?.subscription_products),
    runningBoxes: obligations.runningDeliveries,
    foreignBoxes: n(row?.foreign_boxes),
    boxOrdersUnpaid: n(row?.box_orders_unpaid),
    deliverySchedules: n(row?.delivery_schedules),
    futureAppointments: n(row?.future_appointments),
    appointmentProducts: n(row?.appointment_products),
    staff: n(row?.staff),
    futureStays: n(row?.future_stays),
    unpaidHostCommissions: n(row?.unpaid_host_commissions),
    stayProducts: n(row?.stay_products),
    units: n(row?.units),
    hosts: n(row?.hosts),
    otherCountries: n(row?.other_countries),
    foreignUnsent: n(row?.foreign_unsent),
    foreignCarts: n(row?.foreign_carts),
    otherLanguages: n(row?.other_languages),
    extraCurrencies: n(row?.extra_currencies),
    businessCarts: n(row?.business_carts),
    businessProducts: n(row?.business_products),
    companies: n(row?.companies),
    bonusEnabled: Boolean(row?.bonus_enabled),
    creditHolders: n(row?.credit_holders),
    creditsMinor: n(row?.credits_minor),
    creditsCurrency: row?.credits_currency ? String(row.credits_currency).trim() : null,
    referralsEnabled: Boolean(row?.referrals_enabled),
    referrers: n(row?.referrers),
    pendingReferrals: n(row?.pending_referrals),
  };
}

/** How amounts in warnings are written: in the store's main language. */
const moneyIn = (locale: string) => (minor: number, currency: string) => formatMoney(minor, currency, locale);

/** What stands in the way of switching a feature off in this store now (D178); empty: nothing. */
export async function storeFeatureBlockers(storeId: string, id: FeatureId, executor: Executor = db()): Promise<FeatureBlocker[]> {
  return featureBlockers(id, await featureFacts(storeId, executor));
}

/** What the owner confirms before switching a feature off (D178); empty: nothing to confirm. */
export async function storeFeatureWarnings(storeId: string, id: FeatureId, features: readonly string[], locale = "en", executor: Executor = db()): Promise<string[]> {
  return featureWarnings(id, await featureFacts(storeId, executor), features, moneyIn(locale));
}

export type SetFeatureResult =
  | { ok: true; features: FeatureId[]; changed: boolean }
  | { ok: false; problems: string[]; blockers?: FeatureBlocker[]; warnings?: string[]; needsConfirmation?: boolean };

export type SetFeatureOptions = {
  /** The owner has seen the warnings and confirmed: needed to switch off a feature with warnings. */
  confirmed?: boolean;
};

/**
 * Switches a store's feature on or off (D178). Owners only. On: refused while something it needs is off ("needs the bonus program"). Off:
 * refused while customers would be hit (`featureBlockers()`), and with warnings only once confirmed. The store's row is locked while the
 * facts are counted and the change is written, so a subscription started a second ago cannot slip past. Audited as `store.feature`.
 */
export async function setFeature(member: Membership, id: FeatureId, on: boolean, options: SetFeatureOptions = {}): Promise<SetFeatureResult> {
  if (!memberCan(member, "owner")) return { ok: false, problems: ["Only an owner can switch features on or off."] };
  const feature = FEATURES_BY_ID[id];
  if (!feature) return { ok: false, problems: ["There is no such feature."] };
  const { store, account } = member;
  const locale = homeMarket(store)?.locale ?? "en";

  const outcome = await db().transaction(async (tx): Promise<SetFeatureResult & { before?: FeatureId[] }> => {
    const [row] = await tx.execute<Row>(sql`select features from commerce.stores where id = ${store.id}::uuid for update`);
    if (!row) return { ok: false, problems: ["That store is gone."] };
    const before = normaliseFeatures(((row.features ?? []) as unknown[]).map(String));
    const kept = before.includes(id);
    if (kept === on) return { ok: true, features: before, changed: false };

    if (on) {
      const missing = missingNeeds(before, id);
      if (missing.length > 0) {
        const labels = missing.map((need) => (need === "shop" ? "the online shop" : `the ${FEATURES_BY_ID[need].label.toLowerCase()}`));
        return { ok: false, problems: [`${feature.label} needs ${labels.join(" and ")}. Switch ${missing.length === 1 ? "it" : "them"} on first.`] };
      }
    } else {
      const facts = await featureFacts(store.id, tx);
      // A feature that is kept on but asleep (its needs are off) touches no customer: nothing blocks putting its switch down.
      const live = featureOn(before, id);
      const blockers = live ? featureBlockers(id, facts) : [];
      const warnings = live ? featureWarnings(id, facts, before, moneyIn(locale)) : [];
      if (blockers.length > 0) {
        return { ok: false, problems: [`${feature.label} can't be switched off yet.`, ...blockers.map((b) => b.text)], blockers, warnings };
      }
      if (warnings.length > 0 && !options.confirmed) {
        return { ok: false, problems: ["Confirm to switch it off."], warnings, needsConfirmation: true };
      }
    }

    const after = normaliseFeatures(on ? [...before, id] : before.filter((f) => f !== id));
    // An array literal of the registry's ids (plain words, so nothing to quote).
    await tx.execute(sql`update commerce.stores set features = ${`{${after.join(",")}}`}::text[] where id = ${store.id}::uuid`);
    return { ok: true, features: after, changed: true, before };
  });

  if (!outcome.ok || !outcome.changed) return outcome;
  const { before = [], features: after } = outcome;
  await audit(
    account.id,
    store.id,
    "store.feature",
    {
      feature: id,
      on,
      // What else came on or went to sleep with it (the referral program with the bonus program, everything with the shop).
      alsoAffected: dependentsOf(id).filter((dep) => featureOn(before, dep) !== featureOn(after, dep)),
    },
    { area: "settings", target: { type: "store", id: store.id }, changes: { features: { from: before, to: after } } },
  );
  refreshFeatureTags(store);
  return { ok: true, features: after, changed: true };
}

/**
 * The caches a feature's switch reaches: the store (its admin and storefront, its audience among them), its catalogue (products for
 * businesses only come and go with Sell to businesses), the list of stores, its pages (shop components of a feature), the referral
 * program's storefront read (`affiliateSite()`, with the bonus and referral features), its cookie list and whether its after-sale is open
 * (the online shop's switch, D178 step 5).
 */
export function refreshFeatureTags(store: { id: string; slug: string }): void {
  refreshTag(storeTag(store.slug));
  refreshTag(catalogTag(store.id));
  refreshTag(STORES_TAG);
  refreshTag(pagesTag(store.id));
  refreshTag(affiliateTag(store.id));
  refreshTag(cookiesTag(store.id));
  // What a website keeps of its shop while an order can still be withdrawn from (D178 step 5): the footer's withdrawal link.
  refreshTag(afterSaleTag(store.id));
}
