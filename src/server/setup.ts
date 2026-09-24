import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";

import { audit, type Membership } from "./auth";
import { getPaymentSettings, type SaveResult } from "./settings";
import type { Store, StoreDetails } from "./stores";

type Row = Record<string, unknown>;

/** The setup wizard's steps, in order. */
export const SETUP_STEPS = [
  { id: "details", title: "Your business" },
  { id: "countries", title: "Where you sell" },
  { id: "payments", title: "Payments" },
  { id: "products", title: "Products" },
  { id: "launch", title: "Open your store" },
] as const;

export type SetupStepId = (typeof SETUP_STEPS)[number]["id"];

export function isSetupStep(value: string): value is SetupStepId {
  return SETUP_STEPS.some((step) => step.id === value);
}

/** Demo products copied from the template have handles starting with `demo-`. */
const DEMO_HANDLE = "demo-%";

export type SetupProgress = {
  details: boolean;
  countries: boolean;
  payments: boolean;
  /** Stripe switched on, so shoppers can pay. */
  paymentsOn: boolean;
  /** Every country the store sells to has a shipping price. */
  shipping: boolean;
  products: boolean;
  /** Everything the store needs before it can open. */
  readyToOpen: boolean;
  counts: { demoProducts: number; ownProducts: number };
};

/**
 * What is done, read from the store's data rather than stored separately, so
 * the checklist stays right whichever page a change was made on.
 */
export async function getSetupProgress(store: Store): Promise<SetupProgress> {
  const [[counts], payments, [shippingRow]] = await Promise.all([
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
  ]);
  const d = store.details;
  const details = Boolean(d.legalName && d.contactEmail && d.postalAddress && d.country);
  const countries = store.markets.length > 0;
  const demoProducts = Number(counts?.demo ?? 0);
  const ownProducts = Number(counts?.own ?? 0);
  return {
    details,
    countries,
    payments: Object.values(payments.accounts).some((a) => a.cardPayments === "active"),
    paymentsOn: payments.stripe.enabled,
    shipping: Number(shippingRow?.priced ?? 0) >= store.markets.length && store.markets.length > 0,
    products: ownProducts > 0 || demoProducts === 0,
    readyToOpen: details && countries,
    counts: { demoProducts, ownProducts },
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
 * switched on again.
 */
export async function setMarkets(
  { account, store }: Membership,
  codes: string[],
): Promise<SaveResult> {
  if (codes.length === 0) return { ok: false, problems: ["Choose at least one country."] };

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

export type ProductRow = { handle: string; title: string; status: string };

/** The store's products, for the wizard's product step. */
export async function listStoreProducts(store: Store): Promise<ProductRow[]> {
  const locale = store.markets[0]?.locale ?? "en";
  const rows = await db().execute<Row>(sql`
    select p.handle, p.status, coalesce(tl.title, tf.title, p.handle) as title
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
  }));
}
