import "server-only";

import { sql } from "drizzle-orm";
import Stripe from "stripe";

import { db } from "@/db/client";
import { effectiveFeeBps, type PlanInterval } from "@/lib/plans";
import { storeBase } from "@/lib/paths";
import type { PaymentModeName } from "@/lib/stripe-account";

import { audit, type Account } from "./auth";
import { createStripeAccount, getSaleFeeBps, getStripeAccounts } from "./connect";
import type { SaveResult } from "./settings";
import { platformModes, platformStripe } from "./stripe";
import { getStore } from "./stores";

type Row = Record<string, unknown>;

/** The Stripe mode Kaizen bills stores in: live once live keys are set. */
export function billingMode(): PaymentModeName | null {
  if (platformStripe("live")) return "live";
  return platformStripe("test") ? "test" : null;
}

function stripeProblem(error: unknown): string {
  return error instanceof Stripe.errors.StripeError ? error.message : "Stripe could not be reached.";
}

// ---------------------------------------------------------------------------
// Plans
// ---------------------------------------------------------------------------

export type PlanPrice = {
  id: string;
  currency: string;
  interval: PlanInterval;
  amountMinor: number;
  active: boolean;
  /** Stores whose subscription is on this price. */
  stores: number;
};

export type SyncState = { synced: boolean; error: string | null };

export type Plan = {
  id: string;
  name: string;
  description: string;
  saleFeeBps: number;
  position: number;
  active: boolean;
  prices: PlanPrice[];
  stores: number;
  /** Whether the plan and its prices exist in Kaizen's Stripe account, per mode. */
  sync: Partial<Record<PaymentModeName, SyncState>>;
};

export async function listPlans(): Promise<Plan[]> {
  const [plans, prices, syncs] = await Promise.all([
    db().execute<Row>(sql`
      select p.id, p.name, p.description, p.sale_fee_bps, p.position, p.active,
             (select count(*)::int from commerce.store_billing b
               where b.plan_id = p.id and b.status in ('trialing', 'active', 'past_due')) as stores
      from commerce.plans p order by p.active desc, p.position, lower(p.name)
    `),
    db().execute<Row>(sql`
      select pp.id, pp.plan_id, pp.currency, pp.interval, pp.amount_minor, pp.active,
             (select count(*)::int from commerce.store_billing b
               where b.price_id = pp.id and b.status in ('trialing', 'active', 'past_due')) as stores
      from commerce.plan_prices pp order by pp.currency, pp.interval, pp.created_at desc
    `),
    db().execute<Row>(sql`
      select s.mode, s.kind, s.local_id, s.stripe_id, s.error from commerce.stripe_sync s
      where s.kind in ('product', 'price')
    `),
  ]);
  const modes = platformModes();
  return plans.map((plan) => {
    const id = String(plan.id);
    const planPrices = prices.filter((price) => price.plan_id === plan.id);
    const sync: Plan["sync"] = {};
    for (const mode of modes) {
      const rows = syncs.filter(
        (row) =>
          row.mode === mode &&
          ((row.kind === "product" && row.local_id === id) ||
            (row.kind === "price" && planPrices.some((price) => price.id === row.local_id && price.active))),
      );
      const needed = 1 + planPrices.filter((price) => price.active).length;
      const error = rows.find((row) => row.error)?.error;
      sync[mode] = {
        synced: rows.filter((row) => row.stripe_id).length >= needed && !error,
        error: error ? String(error) : null,
      };
    }
    return {
      id,
      name: String(plan.name),
      description: String(plan.description),
      saleFeeBps: Number(plan.sale_fee_bps),
      position: Number(plan.position),
      active: Boolean(plan.active),
      stores: Number(plan.stores),
      sync,
      prices: planPrices.map((price) => ({
        id: String(price.id),
        currency: String(price.currency),
        interval: price.interval as PlanInterval,
        amountMinor: Number(price.amount_minor),
        active: Boolean(price.active),
        stores: Number(price.stores),
      })),
    };
  });
}

export type PlanInput = {
  name: string;
  description: string;
  saleFeeBps: number;
  position: number;
  active: boolean;
  /** The prices the plan should offer; any other active price is switched off. */
  prices: { currency: string; interval: PlanInterval; amountMinor: number }[];
};

/**
 * Creates or updates a plan and its prices, then copies it to Stripe. A
 * changed amount becomes a new price (Stripe prices cannot change); stores on
 * the old one keep it until moved.
 */
export async function savePlan(
  actor: Account,
  planId: string | null,
  input: PlanInput,
): Promise<SaveResult & { planId?: string }> {
  const id = await db().transaction(async (tx) => {
    let id = planId;
    if (id) {
      await tx.execute(sql`
        update commerce.plans set name = ${input.name}, description = ${input.description},
          sale_fee_bps = ${input.saleFeeBps}, position = ${input.position}, active = ${input.active},
          updated_at = now(), updated_by = ${actor.id}::uuid
        where id = ${id}::uuid
      `);
    } else {
      const [row] = await tx.execute<Row>(sql`
        insert into commerce.plans (name, description, sale_fee_bps, position, active, updated_by)
        values (${input.name}, ${input.description}, ${input.saleFeeBps}, ${input.position}, ${input.active},
                ${actor.id}::uuid)
        returning id
      `);
      id = String(row.id);
    }

    const current = await tx.execute<Row>(sql`
      select id, currency, interval, amount_minor from commerce.plan_prices
      where plan_id = ${id}::uuid and active
    `);
    const wanted = new Map(input.prices.map((p) => [`${p.currency}:${p.interval}`, p]));
    for (const row of current) {
      const want = wanted.get(`${row.currency}:${row.interval}`);
      if (want && Number(row.amount_minor) === want.amountMinor) {
        wanted.delete(`${row.currency}:${row.interval}`);
      } else {
        await tx.execute(sql`update commerce.plan_prices set active = false where id = ${String(row.id)}::uuid`);
      }
    }
    for (const price of wanted.values()) {
      await tx.execute(sql`
        insert into commerce.plan_prices (plan_id, currency, interval, amount_minor)
        values (${id}::uuid, ${price.currency}, ${price.interval}, ${price.amountMinor})
      `);
    }
    return id as string;
  });

  await audit(actor.id, null, planId ? "platform.plan_updated" : "platform.plan_created", {
    planId: id,
    name: input.name,
    saleFeeBps: input.saleFeeBps,
    prices: input.prices,
    active: input.active,
  });

  const problems: string[] = [];
  for (const mode of platformModes()) {
    const result = await syncPlans(mode);
    if (!result.ok) problems.push(`Stripe (${mode}): ${result.problems.join(" ")}`);
  }
  return {
    ok: true,
    planId: id,
    note: problems.length > 0 ? `Saved, but not yet in Stripe. ${problems.join(" ")}` : undefined,
  };
}

async function recordSync(
  mode: PaymentModeName,
  kind: "product" | "price" | "tax_rate" | "portal",
  localId: string,
  outcome: { stripeId: string } | { error: string },
) {
  const stripeId = "stripeId" in outcome ? outcome.stripeId : null;
  const error = "error" in outcome ? outcome.error : null;
  await db().execute(sql`
    insert into commerce.stripe_sync (mode, kind, local_id, stripe_id, synced_at, error)
    values (${mode}, ${kind}, ${localId}, ${stripeId}, ${stripeId ? sql`now()` : null}, ${error})
    on conflict (mode, kind, local_id) do update set
      stripe_id = coalesce(excluded.stripe_id, commerce.stripe_sync.stripe_id),
      synced_at = coalesce(excluded.synced_at, commerce.stripe_sync.synced_at),
      error = excluded.error, updated_at = now()
  `);
}

async function syncedId(mode: PaymentModeName, kind: string, localId: string): Promise<string | null> {
  const [row] = await db().execute<Row>(sql`
    select stripe_id from commerce.stripe_sync where mode = ${mode} and kind = ${kind} and local_id = ${localId}
  `);
  return row?.stripe_id ? String(row.stripe_id) : null;
}

async function isArchived(mode: PaymentModeName, localId: string): Promise<boolean> {
  const [row] = await db().execute<Row>(sql`
    select archived from commerce.stripe_sync where mode = ${mode} and kind = 'price' and local_id = ${localId}
  `);
  return Boolean(row?.archived);
}

/**
 * Makes Kaizen's Stripe account match its plans: a Product per plan and a
 * Price per plan price (switched off when the price is), plus the Norwegian
 * VAT rate and the customer portal settings stores use. Safe to repeat.
 */
export async function syncPlans(mode: PaymentModeName): Promise<SaveResult> {
  const stripe = platformStripe(mode);
  if (!stripe) return { ok: false, problems: [`No ${mode} key is configured.`] };
  const problems: string[] = [];

  for (const plan of await listPlans()) {
    try {
      let productId = await syncedId(mode, "product", plan.id);
      const fields = { name: plan.name, description: plan.description || undefined, active: plan.active };
      if (productId) {
        await stripe.products.update(productId, { ...fields, description: plan.description });
      } else {
        const product = await stripe.products.create(
          { ...fields, metadata: { kaizen_plan_id: plan.id } },
          { idempotencyKey: `kaizen-plan-${plan.id}-${mode}` },
        );
        productId = product.id;
      }
      await recordSync(mode, "product", plan.id, { stripeId: productId });

      for (const price of plan.prices) {
        const priceId = await syncedId(mode, "price", price.id);
        if (priceId) {
          if (!price.active && !(await isArchived(mode, price.id))) {
            await stripe.prices.update(priceId, { active: false });
            await db().execute(sql`
              update commerce.stripe_sync set archived = true, updated_at = now()
              where mode = ${mode} and kind = 'price' and local_id = ${price.id}
            `);
          }
          continue;
        }
        if (!price.active) continue;
        const created = await stripe.prices.create(
          {
            product: productId,
            currency: price.currency.toLowerCase(),
            unit_amount: price.amountMinor,
            recurring: { interval: price.interval },
            tax_behavior: "exclusive",
            metadata: { kaizen_plan_id: plan.id, kaizen_price_id: price.id },
          },
          { idempotencyKey: `kaizen-price-${price.id}-${mode}` },
        );
        await recordSync(mode, "price", price.id, { stripeId: created.id });
      }
    } catch (error) {
      const problem = stripeProblem(error);
      await recordSync(mode, "product", plan.id, { error: problem });
      problems.push(`${plan.name}: ${problem}`);
    }
  }

  try {
    await norwegianVatRate(stripe, mode);
    await portalConfiguration(stripe, mode);
  } catch (error) {
    problems.push(stripeProblem(error));
  }
  return problems.length > 0 ? { ok: false, problems } : { ok: true };
}

/** Kaizen's 25 % Norwegian VAT, added to plans for stores in Norway. */
async function norwegianVatRate(stripe: Stripe, mode: PaymentModeName): Promise<string> {
  const existing = await syncedId(mode, "tax_rate", "NO-VAT-25");
  if (existing) return existing;
  const rate = await stripe.taxRates.create(
    {
      display_name: "MVA",
      description: "Merverdiavgift (Norway)",
      percentage: 25,
      inclusive: false,
      country: "NO",
      tax_type: "vat",
    },
    { idempotencyKey: `kaizen-tax-no-25-${mode}` },
  );
  await recordSync(mode, "tax_rate", "NO-VAT-25", { stripeId: rate.id });
  return rate.id;
}

/** Stripe's customer portal as stores see it: their invoices and how they pay. */
async function portalConfiguration(stripe: Stripe, mode: PaymentModeName): Promise<string> {
  const existing = await syncedId(mode, "portal", "stores");
  if (existing) return existing;
  const configuration = await stripe.billingPortal.configurations.create(
    {
      name: "Kaizen stores",
      business_profile: { headline: "Your Kaizen plan: invoices and payment details" },
      features: {
        invoice_history: { enabled: true },
        payment_method_update: { enabled: true },
      },
    },
    { idempotencyKey: `kaizen-portal-${mode}` },
  );
  await recordSync(mode, "portal", "stores", { stripeId: configuration.id });
  return configuration.id;
}

// ---------------------------------------------------------------------------
// Stores' subscriptions
// ---------------------------------------------------------------------------

export type StoreBilling = {
  storeId: string;
  slug: string;
  name: string;
  country: string | null;
  status: string | null;
  planId: string | null;
  planName: string | null;
  priceId: string | null;
  price: { currency: string; interval: PlanInterval; amountMinor: number } | null;
  mode: PaymentModeName | null;
  subscriptionId: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  saleFeeBpsOverride: number | null;
  /** Kaizen's fee on the store's sales right now. */
  feeBps: number;
  ownerEmail: string | null;
};

const billingQuery = (where: ReturnType<typeof sql>) => sql`
  select s.id as store_id, s.slug, s.name, s.country, s.status as store_status,
         b.plan_id, p.name as plan_name, p.sale_fee_bps as plan_fee_bps, b.price_id,
         pp.currency, pp.interval, pp.amount_minor, b.mode, b.subscription_id, b.status,
         b.current_period_end, coalesce(b.cancel_at_period_end, false) as cancel_at_period_end,
         b.sale_fee_bps_override,
         (select a.email from commerce.store_members m join commerce.accounts a on a.id = m.account_id
           where m.store_id = s.id and m.role = 'owner' and m.disabled_at is null
           order by m.created_at limit 1) as owner_email
  from commerce.stores s
  left join commerce.store_billing b on b.store_id = s.id
  left join commerce.plans p on p.id = b.plan_id
  left join commerce.plan_prices pp on pp.id = b.price_id
  where ${where}
  order by s.is_template desc, lower(s.name)
`;

function toBilling(row: Row, defaultBps: number): StoreBilling {
  const override = row.sale_fee_bps_override == null ? null : Number(row.sale_fee_bps_override);
  const planFee = row.plan_fee_bps == null ? null : Number(row.plan_fee_bps);
  const status = row.status ? String(row.status) : null;
  return {
    storeId: String(row.store_id),
    slug: String(row.slug),
    name: String(row.name),
    country: row.country ? String(row.country) : null,
    status,
    planId: row.plan_id ? String(row.plan_id) : null,
    planName: row.plan_name ? String(row.plan_name) : null,
    priceId: row.price_id ? String(row.price_id) : null,
    price: row.currency
      ? {
          currency: String(row.currency),
          interval: row.interval as PlanInterval,
          amountMinor: Number(row.amount_minor),
        }
      : null,
    mode: (row.mode as PaymentModeName) ?? null,
    subscriptionId: row.subscription_id ? String(row.subscription_id) : null,
    currentPeriodEnd: row.current_period_end ? new Date(String(row.current_period_end)).toISOString() : null,
    cancelAtPeriodEnd: Boolean(row.cancel_at_period_end),
    saleFeeBpsOverride: override,
    feeBps: effectiveFeeBps({ overrideBps: override, planFeeBps: planFee, status, defaultBps }),
    ownerEmail: row.owner_email ? String(row.owner_email) : null,
  };
}

export async function listStoreBilling(): Promise<StoreBilling[]> {
  const [rows, defaultBps] = await Promise.all([
    db().execute<Row>(billingQuery(sql`s.status <> 'closed'`)),
    getSaleFeeBps(),
  ]);
  return rows.map((row) => toBilling(row, defaultBps));
}

export async function getStoreBilling(storeId: string): Promise<StoreBilling | null> {
  const [[row], defaultBps] = await Promise.all([
    db().execute<Row>(billingQuery(sql`s.id = ${storeId}::uuid`)),
    getSaleFeeBps(),
  ]);
  return row ? toBilling(row, defaultBps) : null;
}

/** Kaizen's fee on a store's sales right now, for checkout. */
export async function storeFeeBps(storeId: string): Promise<number> {
  return (await getStoreBilling(storeId))?.feeBps ?? (await getSaleFeeBps());
}

/**
 * Records a subscription as Stripe reports it. An event about an older,
 * cancelled subscription never replaces the store's current one.
 */
export async function applySubscription(
  subscription: Stripe.Subscription,
  mode: PaymentModeName,
  actor?: Account,
): Promise<boolean> {
  let storeId: string | null = subscription.metadata?.kaizen_store_id ?? null;
  if (!storeId) {
    const [row] = await db().execute<Row>(sql`
      select store_id from commerce.store_billing where mode = ${mode} and subscription_id = ${subscription.id}
    `);
    storeId = row ? String(row.store_id) : null;
  }
  if (!storeId) return false;

  const item = subscription.items.data[0];
  const [price] = item
    ? await db().execute<Row>(sql`
        select pp.id, pp.plan_id from commerce.stripe_sync s
        join commerce.plan_prices pp on pp.id::text = s.local_id
        where s.mode = ${mode} and s.kind = 'price' and s.stripe_id = ${item.price.id}
      `)
    : [];
  const periodEnd = item?.current_period_end ? new Date(item.current_period_end * 1000).toISOString() : null;

  await db().execute(sql`
    insert into commerce.store_billing as b (
      store_id, plan_id, price_id, mode, subscription_id, status, current_period_end, cancel_at_period_end,
      updated_by
    ) values (
      ${storeId}::uuid, ${price ? String(price.plan_id) : null}, ${price ? String(price.id) : null}, ${mode},
      ${subscription.id}, ${subscription.status}, ${periodEnd}, ${subscription.cancel_at_period_end},
      ${actor?.id ?? null}
    )
    on conflict (store_id) do update set
      plan_id = coalesce(excluded.plan_id, b.plan_id),
      price_id = coalesce(excluded.price_id, b.price_id),
      mode = excluded.mode,
      subscription_id = excluded.subscription_id,
      status = excluded.status,
      current_period_end = excluded.current_period_end,
      cancel_at_period_end = excluded.cancel_at_period_end,
      updated_at = now(),
      updated_by = coalesce(excluded.updated_by, b.updated_by)
    where b.subscription_id is null
       or b.subscription_id = excluded.subscription_id
       or excluded.status not in ('canceled', 'incomplete_expired')
  `);
  return true;
}

async function currentSubscription(storeId: string) {
  const billing = await getStoreBilling(storeId);
  const live =
    billing?.subscriptionId && billing.mode && !["canceled", "incomplete_expired"].includes(billing.status ?? "");
  return { billing, live: Boolean(live) };
}

/**
 * Puts a store on a plan price: starts a subscription (Kaizen emails an
 * invoice each period, due in 14 days) or moves the existing one, with
 * prorated charges. The store's Stripe account is created if it has none.
 */
export async function assignPlan(
  actor: Account,
  storeSlug: string,
  priceId: string,
  trialDays: number,
  origin: string,
): Promise<SaveResult> {
  const mode = billingMode();
  const stripe = mode && platformStripe(mode);
  if (!mode || !stripe) return { ok: false, problems: ["Kaizen's Stripe keys are not set."] };
  const store = await getStore(storeSlug);
  if (!store) return { ok: false, problems: ["Unknown store."] };

  const [price] = await db().execute<Row>(sql`
    select pp.id, pp.plan_id, pp.currency, p.name as plan_name from commerce.plan_prices pp
    join commerce.plans p on p.id = pp.plan_id
    where pp.id = ${priceId}::uuid and pp.active and p.active
  `);
  if (!price) return { ok: false, problems: ["That price is no longer offered."] };

  let stripePrice = await syncedId(mode, "price", priceId);
  if (!stripePrice) {
    await syncPlans(mode);
    stripePrice = await syncedId(mode, "price", priceId);
  }
  if (!stripePrice) return { ok: false, problems: ["The plan is not in Stripe yet. Sync plans and try again."] };

  const created = await createStripeAccount({ account: actor, store }, mode, `${origin}${storeBase(store.slug)}`);
  if (!created.ok) return created;
  const account = (await getStripeAccounts(store.id))[mode];
  if (!account) return { ok: false, problems: ["The store's Stripe account could not be created."] };

  const metadata = {
    kaizen_store_id: store.id,
    kaizen_plan_id: String(price.plan_id),
    kaizen_price_id: priceId,
  };
  const { billing, live } = await currentSubscription(store.id);
  let subscription: Stripe.Subscription;
  try {
    if (live && billing?.mode === mode && billing.subscriptionId) {
      const current = await stripe.subscriptions.retrieve(billing.subscriptionId);
      subscription = await stripe.subscriptions.update(billing.subscriptionId, {
        items: [{ id: current.items.data[0]?.id, price: stripePrice }],
        proration_behavior: "create_prorations",
        cancel_at_period_end: false,
        metadata,
      });
    } else {
      const inNorway = (store.details.country ?? "NO") === "NO";
      const vatRate = inNorway ? await norwegianVatRate(stripe, mode) : null;
      subscription = await stripe.subscriptions.create(
        {
          customer_account: account.accountId,
          items: [{ price: stripePrice }],
          collection_method: "send_invoice",
          days_until_due: 14,
          ...(trialDays > 0 && { trial_period_days: trialDays }),
          ...(vatRate && { default_tax_rates: [vatRate] }),
          description: `Kaizen ${String(price.plan_name)}: ${store.name}`,
          metadata,
        },
        // A double click must not start two subscriptions.
        { idempotencyKey: `kaizen-subscribe-${store.id}-${priceId}-${Math.floor(Date.now() / 60_000)}` },
      );
    }
  } catch (error) {
    return { ok: false, problems: [stripeProblem(error)] };
  }

  await applySubscription(subscription, mode, actor);
  await audit(actor.id, store.id, live ? "billing.plan_changed" : "billing.plan_started", {
    priceId,
    planId: String(price.plan_id),
    subscriptionId: subscription.id,
    trialDays,
  });
  return { ok: true };
}

/** Ends a store's plan now, or at the end of the period it has paid for; or undoes that. */
export async function cancelPlan(
  actor: Account,
  storeId: string,
  when: "period_end" | "now" | "undo",
): Promise<SaveResult> {
  const { billing, live } = await currentSubscription(storeId);
  const stripe = billing?.mode && platformStripe(billing.mode);
  if (!live || !billing?.subscriptionId || !billing.mode || !stripe) {
    return { ok: false, problems: ["The store has no plan to cancel."] };
  }
  let subscription: Stripe.Subscription;
  try {
    subscription =
      when === "now"
        ? await stripe.subscriptions.cancel(billing.subscriptionId, { invoice_now: false, prorate: false })
        : await stripe.subscriptions.update(billing.subscriptionId, {
            cancel_at_period_end: when === "period_end",
          });
  } catch (error) {
    return { ok: false, problems: [stripeProblem(error)] };
  }
  await applySubscription(subscription, billing.mode, actor);
  await audit(actor.id, storeId, `billing.plan_cancel_${when}`, { subscriptionId: subscription.id });
  return { ok: true };
}

/** Sets or clears a store's own fee per sale, which overrides its plan's. */
export async function setStoreFee(actor: Account, storeId: string, bps: number | null): Promise<SaveResult> {
  if (bps !== null && (!Number.isInteger(bps) || bps < 0 || bps > 2000)) {
    return { ok: false, problems: ["The fee must be between 0 and 20 %."] };
  }
  await db().execute(sql`
    insert into commerce.store_billing (store_id, sale_fee_bps_override, updated_by)
    values (${storeId}::uuid, ${bps}, ${actor.id}::uuid)
    on conflict (store_id) do update set
      sale_fee_bps_override = excluded.sale_fee_bps_override, updated_at = now(), updated_by = excluded.updated_by
  `);
  await audit(actor.id, storeId, "billing.fee_override_set", { bps });
  return { ok: true };
}

/** A link into Stripe's customer portal, where the store sees Kaizen's invoices and how it pays. */
export async function portalUrl(
  storeId: string,
  returnUrl: string,
): Promise<{ ok: true; url: string } | { ok: false; problem: string }> {
  const billing = await getStoreBilling(storeId);
  const mode = billing?.mode ?? billingMode();
  const stripe = mode && platformStripe(mode);
  const account = mode ? (await getStripeAccounts(storeId))[mode] : undefined;
  if (!mode || !stripe || !account) return { ok: false, problem: "Your store has no plan with Kaizen yet." };
  try {
    const configuration = await portalConfiguration(stripe, mode);
    const session = await stripe.billingPortal.sessions.create({
      customer_account: account.accountId,
      return_url: returnUrl,
      configuration,
    });
    return { ok: true, url: session.url };
  } catch (error) {
    return { ok: false, problem: stripeProblem(error) };
  }
}

/** The currencies plans can be priced in: those of the markets Kaizen launched (NOK first). */
export async function planCurrencies(): Promise<string[]> {
  const rows = await db().execute<Row>(sql`
    select distinct m.currency from commerce.markets m
    join commerce.stores s on s.id = m.store_id
    where s.is_template and m.active
  `);
  return rows.map((row) => String(row.currency)).sort((a, b) => (a === "NOK" ? -1 : b === "NOK" ? 1 : a.localeCompare(b)));
}
