import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { featuresForAnswers, targetFeatures, type OnboardingAnswers } from "@/lib/onboarding";
import { featureOn } from "@/lib/store-features";

import { audit, type Membership } from "./auth";
import { setFeatures, type SetFeaturesResult } from "./store-features";
import { getPaymentSettings, type SaveResult } from "./settings";
import type { Store, StoreDetails } from "./stores";

type Row = Record<string, unknown>;

// The wizard's steps follow the store's features (D178 step 6): `src/lib/setup-steps.ts`.
export { isSetupStep, SETUP_STEPS, setupStepsFor, type SetupStepId } from "@/lib/setup-steps";

/**
 * The audit action written when the owner answers the wizard's question "What will you sell?" (D178 step 6). The answers themselves are the
 * store's features; this entry is how the wizard knows the question was answered, read from the activity log rather than stored apart.
 */
export const FEATURES_CHOSEN = "store.features_chosen";

/** Demo products copied from the template have handles starting with `demo-`. */
const DEMO_HANDLE = "demo-%";

export type SetupProgress = {
  /** The owner answered "What will you sell?" (an entry of `FEATURES_CHOSEN` in the store's activity log). */
  features: boolean;
  details: boolean;
  countries: boolean;
  payments: boolean;
  /** With Appointments on, staff to book; with Stays and rentals on, a room or an item (only asked while either is on). */
  bookings: boolean;
  /** Stripe switched on, so shoppers can pay. */
  paymentsOn: boolean;
  /** Every country the store sells to has a shipping price. */
  shipping: boolean;
  products: boolean;
  /** The store is on a plan with Kaizen. */
  plan: boolean;
  /** Everything the store needs before it can open. */
  readyToOpen: boolean;
  counts: { demoProducts: number; ownProducts: number; staff: number; units: number };
};

/**
 * What is done, read from the store's data rather than stored separately, so
 * the checklist stays right whichever page a change was made on.
 */
export async function getSetupProgress(store: Store): Promise<SetupProgress> {
  const [[counts], payments, [shippingRow], [planRow], [facts]] = await Promise.all([
    db().execute<Row>(sql`
      select
        count(*) filter (where handle like ${DEMO_HANDLE} and status = 'active')::int as demo,
        count(*) filter (where handle not like ${DEMO_HANDLE} and status <> 'archived')::int as own
      from commerce.products where store_id = ${store.id}::uuid
    `),
    getPaymentSettings(store),
    db().execute<Row>(sql`
      select count(*)::int as priced from commerce.shipping_rates r
      join commerce.markets m on m.store_id = r.store_id and m.code = r.market_code and m.active
      where r.store_id = ${store.id}::uuid
    `),
    db().execute<Row>(sql`
      select 1 as on_plan from commerce.store_billing
      where store_id = ${store.id}::uuid and status in ('trialing', 'active', 'past_due')
    `),
    db().execute<Row>(sql`
      select
        exists (select 1 from commerce.audit_log a where a.store_id = ${store.id}::uuid and a.action = ${FEATURES_CHOSEN}) as chosen,
        (select count(*)::int from commerce.booking_resources r where r.store_id = ${store.id}::uuid and r.kind = 'staff' and r.active) as staff,
        (select count(*)::int from commerce.booking_resources r where r.store_id = ${store.id}::uuid and r.kind in ('unit', 'item') and r.active) as units
    `),
  ]);
  const d = store.details;
  const details = Boolean(d.legalName && d.contactEmail && d.postalAddress && d.country);
  const countries = store.keptMarkets.length > 0;
  const demoProducts = Number(counts?.demo ?? 0);
  const ownProducts = Number(counts?.own ?? 0);
  const bookings =
    (!featureOn(store, "appointments") || Number(facts?.staff ?? 0) > 0) && (!featureOn(store, "bookings") || Number(facts?.units ?? 0) > 0);
  return {
    features: Boolean(facts?.chosen),
    details,
    countries,
    bookings,
    // Test payments need no setup (D20): this is the store's real, live account.
    payments: payments.accounts.live?.cardPayments === "active",
    paymentsOn: payments.stripe.enabled,
    shipping: Number(shippingRow?.priced ?? 0) >= store.keptMarkets.length && store.keptMarkets.length > 0,
    products: ownProducts > 0 || demoProducts === 0,
    plan: Boolean(planRow),
    readyToOpen: details && countries,
    counts: { demoProducts, ownProducts, staff: Number(facts?.staff ?? 0), units: Number(facts?.units ?? 0) },
  };
}

export type DetailsInput = StoreDetails & { name: string };

export async function saveStoreDetails(
  { account, store }: Membership,
  input: DetailsInput,
): Promise<SaveResult> {
  await db().execute(sql`
    update commerce.stores set
      name = ${input.name},
      legal_name = ${input.legalName},
      organisation_number = ${input.organisationNumber},
      contact_email = ${input.contactEmail},
      postal_address = ${input.postalAddress},
      country = ${input.country}
    where id = ${store.id}::uuid
  `);
  await audit(account.id, store.id, "store.details_updated", {
    changed: Object.entries(input)
      .filter(([key, value]) => value !== (key === "name" ? store.name : store.details[key as keyof StoreDetails]))
      .map(([key]) => key),
  });
  return { ok: true };
}

/**
 * Makes exactly these countries the store's active markets. Countries sold
 * to before keep their settings and prices, and come back as they were if
 * switched on again. With Several countries off (D178) the store sells in
 * one country: choosing the one it already sells in changes nothing (the
 * other countries it keeps for when the feature is on again stay as they
 * are), choosing another makes that the only one on the list.
 */
export async function setMarkets(
  { account, store }: Membership,
  codes: string[],
): Promise<SaveResult> {
  codes = [...new Set(codes)];
  if (codes.length === 0) return { ok: false, problems: ["Choose at least one country."] };
  if (!featureOn(store, "countries")) {
    if (codes.length > 1) return { ok: false, problems: ["Several countries is switched off under Settings, Features: choose one country, or switch it on first."] };
    if (codes[0] === store.keptMarkets[0]?.code) return { ok: true, note: "Nothing changed." };
  }

  const known = await db().execute<Row>(sql`
    select code from commerce.countries
    where code in (${sql.join(codes.map((c) => sql`${c}`), sql`, `)})
  `);
  if (known.length !== codes.length) return { ok: false, problems: ["Unknown country."] };

  await db().transaction(async (tx) => {
    await tx.execute(sql`
      insert into commerce.markets (store_id, code, currency, default_locale, locales, active)
      select ${store.id}::uuid, code, currency, default_locale, locales, true
      from commerce.countries
      where code in (${sql.join(codes.map((c) => sql`${c}`), sql`, `)})
      on conflict (store_id, code) do update set active = true
    `);
    await tx.execute(sql`
      update commerce.markets set active = false
      where store_id = ${store.id}::uuid
        and code not in (${sql.join(codes.map((c) => sql`${c}`), sql`, `)})
    `);
  });
  await audit(account.id, store.id, "store.markets_updated", { active: codes });
  return { ok: true };
}

/** Takes the demo products out of the store (archived, never deleted). */
export async function archiveDemoProducts({ account, store }: Membership): Promise<number> {
  const rows = await db().execute<Row>(sql`
    update commerce.products set status = 'archived', updated_at = now()
    where store_id = ${store.id}::uuid and handle like ${DEMO_HANDLE} and status <> 'archived'
    returning handle
  `);
  await audit(account.id, store.id, "products.demo_archived", { count: rows.length });
  return rows.length;
}

export async function completeSetup({ account, store }: Membership): Promise<SaveResult> {
  const progress = await getSetupProgress(store);
  if (!progress.readyToOpen) {
    return { ok: false, problems: ["Add your business details and at least one country first."] };
  }
  await db().execute(sql`
    update commerce.stores set setup_completed_at = coalesce(setup_completed_at, now())
    where id = ${store.id}::uuid
  `);
  await audit(account.id, store.id, "store.setup_completed");
  return { ok: true };
}

/** `kind`: goods, an appointment, a stay or a rental (the wizard says when a kind's feature is off, D178). */
export type ProductRow = { handle: string; title: string; status: string; kind: string };

/** The store's products, for the wizard's product step. */
export async function listStoreProducts(store: Store): Promise<ProductRow[]> {
  const locale = store.markets[0]?.locale ?? "en";
  const rows = await db().execute<Row>(sql`
    select p.handle, p.status, p.kind, coalesce(tl.title, tf.title, p.handle) as title
    from commerce.products p
    left join commerce.product_translations tl on tl.product_id = p.id and tl.locale = ${locale}
    left join lateral (
      select title from commerce.product_translations where product_id = p.id order by locale limit 1
    ) tf on true
    where p.store_id = ${store.id}::uuid and p.status <> 'archived'
    order by p.created_at, p.handle
  `);
  return rows.map((row) => ({
    handle: String(row.handle),
    title: String(row.title),
    status: String(row.status),
    kind: String(row.kind),
  }));
}

/**
 * The owner's answer to "What will you sell?" (D178 step 6): the answers become the store's features through `setFeatures()` (owners only,
 * each feature with what it needs, nothing switched off while customers would be hit, warnings only once `confirmed`, every switch audited as
 * `store.feature`), keeping the bonus and referral programs as they are kept. The answer itself is one `store.features_chosen` entry in the
 * activity log, which is how the wizard knows it was answered (`getSetupProgress().features`); nothing else is stored, and the owner changes
 * everything later on the Features page.
 */
export async function answerFeatureQuestion(member: Membership, answers: OnboardingAnswers, options: { confirmed?: boolean } = {}): Promise<SetFeaturesResult> {
  const answered = featuresForAnswers(answers);
  if (!answered.ok) return { ok: false, problems: answered.problems };
  const result = await setFeatures(member, targetFeatures(member.store.features, answered.features), { confirmed: options.confirmed, via: "setup" });
  if (!result.ok) return result;
  // The action is `FEATURES_CHOSEN`, written out so the audit scan sees it.
  await audit(member.account.id, member.store.id, "store.features_chosen", { sells: answers.sells, extras: answers.extras, features: result.features }, {
    area: "settings",
    target: { type: "store", id: member.store.id },
  });
  return result;
}

/** The store template a store was made from (D175), by its title, for the wizard's question; null for a Standard store. */
export async function starterTitleOf(store: Store): Promise<string | null> {
  const [row] = await db().execute<Row>(sql`
    select st.title from commerce.stores s join commerce.store_starters st on st.id = s.made_from_starter where s.id = ${store.id}::uuid
  `);
  return row ? String(row.title) : null;
}
