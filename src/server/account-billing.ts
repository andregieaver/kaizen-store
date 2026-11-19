import "server-only";

import { sql } from "drizzle-orm";
import type Stripe from "stripe";
import { z } from "zod";

import { db } from "@/db/client";
import { endedExtensions, GRACE_DAYS, itemChanges, itemProblems, type WantedExtension, type WantedPrice } from "@/lib/account-billing";
import { isExtensionId, type ExtensionId } from "@/lib/extensions";
import { storeBase, storeOrigin } from "@/lib/paths";
import { effectiveFeeBps, isOnPlan } from "@/lib/plans";
import type { PaymentModeName } from "@/lib/stripe-account";

import { audit, type Account } from "./auth";
import {
  billingMode,
  billingTaxRates,
  NO_COUNTRY,
  portalConfiguration,
  recordSync,
  SUBSCRIPTION_KEPT,
  syncedId,
  syncPlans,
  syncRecurringPrice,
  toInvoice,
  type PlanInvoice,
  type StoreBilling,
} from "./billing";
import { createStripeAccount, getSaleFeeBps, getStripeAccounts, stripeProblem } from "./connect";
import { refreshExtensionFacts } from "./extensions";
import { forgetLimits } from "./limits";
import type { SaveResult } from "./settings";
import { platformStripe } from "./stripe";
import { getStore } from "./stores";
import { col, typedRow, typedRows } from "./typed-rows";

/**
 * An account billed through its account (D748 step E4 part two, `docs/extensions.md` 13): one subscription on Kaizena Flow's Stripe account
 * for all its stores, holding the plan and every extension bought on its own as items, billed to the account's customer (the Stripe account
 * of its first store). Its row is `commerce.organisation_billing`; an account without one is billed store by store (`billing.ts`) and is
 * refused here (`NOT_BILLED_BY_ACCOUNT`). Nothing calls this for an owner until part three's screen and part four's move.
 */

/** Why an account's plan actions refuse while it is still billed store by store. */
export const NOT_BILLED_BY_ACCOUNT = "This account is still billed store by store: choose each store's plan on its Billing page.";

const BILLING_ROW = z.object({
  organisation_id: col.uuid,
  name: col.text,
  plan_id: col.uuid.nullable(),
  plan_name: col.textOrNull,
  plan_fee_bps: col.int.nullable(),
  price_id: col.uuid.nullable(),
  currency: col.currency.nullable(),
  interval: z.enum(["month", "year"]).nullable(),
  amount_minor: col.minorOrNull,
  mode: col.textOrNull,
  subscription_id: col.textOrNull,
  status: col.textOrNull,
  current_period_end: col.timestampOrNull,
  cancel_at_period_end: col.bool,
  sale_fee_bps_override: col.int.nullable(),
  trial_ends_at: col.timestampOrNull,
  customer_account: col.textOrNull,
  moved_at: col.timestampOrNull,
});

/** The account's billing: the plan and subscription fields as a store's (`feeBps` its override, else its plan's while on it), and its own. */
export type AccountBilling = Pick<
  StoreBilling,
  "planId" | "planName" | "priceId" | "price" | "mode" | "subscriptionId" | "status" | "currentPeriodEnd" | "cancelAtPeriodEnd" | "feeBps"
> & {
  organisationId: string;
  name: string;
  trialEndsAt: string | null;
  customerAccount: string | null;
  movedAt: string | null;
};

/** The account's billing, or null while it is billed store by store. */
export async function getAccountBilling(organisationId: string): Promise<AccountBilling | null> {
  const [row, defaultBps] = await Promise.all([
    typedRow(
      BILLING_ROW,
      sql`
        select ob.organisation_id, o.name, ob.plan_id, p.name as plan_name, p.sale_fee_bps as plan_fee_bps, ob.price_id,
               pp.currency, pp.interval, pp.amount_minor, ob.mode::text as mode, ob.subscription_id, ob.status, ob.current_period_end,
               ob.cancel_at_period_end, ob.sale_fee_bps_override, ob.trial_ends_at, ob.customer_account, ob.moved_at
          from commerce.organisation_billing ob
          join commerce.organisations o on o.id = ob.organisation_id
          left join commerce.plans p on p.id = ob.plan_id
          left join commerce.plan_prices pp on pp.id = ob.price_id
         where ob.organisation_id = ${organisationId}::uuid
      `,
    ),
    getSaleFeeBps(),
  ]);
  if (!row) return null;
  return {
    organisationId: row.organisation_id,
    name: row.name,
    planId: row.plan_id,
    planName: row.plan_name,
    priceId: row.price_id,
    price: row.currency && row.interval && row.amount_minor !== null ? { currency: row.currency, interval: row.interval, amountMinor: row.amount_minor } : null,
    mode: (row.mode as PaymentModeName | null) ?? null,
    subscriptionId: row.subscription_id,
    status: row.status,
    currentPeriodEnd: row.current_period_end,
    cancelAtPeriodEnd: row.cancel_at_period_end,
    trialEndsAt: row.trial_ends_at,
    customerAccount: row.customer_account,
    movedAt: row.moved_at,
    feeBps: effectiveFeeBps({ overrideBps: row.sale_fee_bps_override, planFeeBps: row.plan_fee_bps, status: row.status, defaultBps }),
  };
}

// ---------------------------------------------------------------------------
// The extensions in Stripe: a Product per extension, a Price per size's price
// ---------------------------------------------------------------------------

const SYNC_PRICE_ROW = z.object({
  id: col.uuid,
  extension_id: col.text,
  extension_name: col.text,
  extension_description: col.text,
  extension_active: col.bool,
  size_label: col.text,
  size_id: col.uuid,
  currency: col.currency,
  interval: z.enum(["month", "year"]),
  amount_minor: col.minor,
  active: col.bool,
});

/**
 * Makes Kaizena Flow's Stripe account match the extensions (as `syncPlans()` does the plans): a Product per extension (`extension:<id>`),
 * a Price per size's price, switched off when the price is (`syncRecurringPrice()`). Safe to repeat.
 */
export async function syncExtensions(mode: PaymentModeName): Promise<SaveResult> {
  const stripe = platformStripe(mode);
  if (!stripe) return { ok: false, problems: [`No ${mode} key is configured.`] };
  const rows = await typedRows(
    SYNC_PRICE_ROW,
    sql`
      select ep.id, e.id as extension_id, e.name as extension_name, e.description as extension_description, e.active as extension_active,
             es.label as size_label, es.id as size_id, ep.currency, ep.interval, ep.amount_minor, ep.active
        from commerce.extensions e
        join commerce.extension_sizes es on es.extension_id = e.id
        join commerce.extension_prices ep on ep.size_id = es.id
       order by e.position, e.id, es.position, ep.created_at
    `,
  );
  const problems: string[] = [];
  for (const extensionId of [...new Set(rows.map((r) => r.extension_id))]) {
    const prices = rows.filter((r) => r.extension_id === extensionId);
    const first = prices[0];
    const local = `extension:${extensionId}`;
    try {
      let productId = await syncedId(mode, "product", local);
      const fields = { name: `Kaizena Flow ${first.extension_name}`, active: first.extension_active };
      if (productId) await stripe.products.update(productId, { ...fields, description: first.extension_description || "" });
      else {
        const product = await stripe.products.create(
          { ...fields, ...(first.extension_description && { description: first.extension_description }), metadata: { kaizen_extension_id: extensionId } },
          { idempotencyKey: `kaizen-extension-${extensionId}-${mode}` },
        );
        productId = product.id;
      }
      await recordSync(mode, "product", local, { stripeId: productId });
      for (const price of prices) {
        await syncRecurringPrice(
          stripe,
          mode,
          productId,
          { id: price.id, active: price.active, currency: price.currency, interval: price.interval, amountMinor: price.amount_minor },
          {
            name: `${price.extension_name} ${price.size_label}`,
            metadata: { kaizen_extension_id: extensionId, kaizen_size_id: price.size_id, kaizen_extension_price_id: price.id },
            idempotencyKey: `kaizen-extension-price-${price.id}-${mode}`,
          },
        );
      }
    } catch (error) {
      const problem = stripeProblem(error);
      await recordSync(mode, "product", local, { error: problem });
      problems.push(`${first.extension_name}: ${problem}`);
    }
  }
  return problems.length > 0 ? { ok: false, problems } : { ok: true };
}

// ---------------------------------------------------------------------------
// The account's customer and its one subscription
// ---------------------------------------------------------------------------

/** One subscription change at a time per account, as `oneAtATime()` does per store; the move to one plan takes it too. */
export function accountLock<T>(organisationId: string, work: () => Promise<T>): Promise<T> {
  return db().transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('account_subscribe'), hashtext(${organisationId}))`);
    return work();
  });
}

/** The account a store is billed through, when its account has a row: the platform's plan actions on that store act on the account. */
export async function billedAccountOf(storeId: string): Promise<string | null> {
  const row = await typedRow(
    z.object({ organisation_id: col.uuid }),
    sql`select ob.organisation_id from commerce.stores s join commerce.organisation_billing ob on ob.organisation_id = s.organisation_id where s.id = ${storeId}::uuid`,
  );
  return row?.organisation_id ?? null;
}

/** The account's first open store (its oldest): its Stripe account is the account's customer, its country the VAT's. */
async function firstStore(organisationId: string) {
  const row = await typedRow(z.object({ slug: col.text }), sql`
    select s.slug from commerce.stores s
     where s.organisation_id = ${organisationId}::uuid and s.status <> 'closed' and not (s.is_template or s.starter or s.sandbox or s.house)
     order by s.created_at, s.id limit 1
  `);
  return row ? getStore(row.slug) : null;
}

/**
 * The Stripe account the account's subscription bills (Accounts v2 `customer_account`), made when missing: its first store's own, as a
 * store's plan bills today, kept on the row. An account with no store has no country for the VAT yet and is refused (`NO_COUNTRY`); step
 * E7's workspaces give an account its own business details and its own customer.
 */
async function accountCustomer(
  actor: Account,
  organisationId: string,
  mode: PaymentModeName,
  origin: string,
): Promise<{ ok: true; accountId: string; country: string; name: string } | { ok: false; problems: string[] }> {
  const billing = await getAccountBilling(organisationId);
  if (!billing) return { ok: false, problems: [NOT_BILLED_BY_ACCOUNT] };
  const store = await firstStore(organisationId);
  const country = store?.details.country;
  if (!store || !country) return { ok: false, problems: [NO_COUNTRY] };
  if (billing.customerAccount && (billing.mode === null || billing.mode === mode)) return { ok: true, accountId: billing.customerAccount, country, name: billing.name };
  const created = await createStripeAccount({ account: actor, store }, mode, storeOrigin(store.slug) ?? `${origin}${storeBase(store.slug)}`);
  if (!created.ok) return created;
  const accountId = (await getStripeAccounts(store.id))[mode]?.accountId;
  if (!accountId) return { ok: false, problems: ["The account's Stripe account could not be created."] };
  await db().execute(sql`
    update commerce.organisation_billing set customer_account = ${accountId}, updated_at = now(), updated_by = ${actor.id}::uuid
     where organisation_id = ${organisationId}::uuid
  `);
  return { ok: true, accountId, country, name: billing.name };
}

const WANTED_ROW = z.object({ id: col.uuid, kind: z.enum(["plan", "extension"]), owner: col.text, currency: col.currency, interval: z.enum(["month", "year"]) });

/**
 * What the account wants on its subscription: a plan price (or none) and the extension prices it buys on their own; `"kept"` keeps the
 * extensions it pays for now, at their sizes, in the plan's currency and interval, less any the plan includes (never paid twice).
 */
export type AccountItems = { planPriceId: string | null; extensionPriceIds: readonly string[] | "kept" };

type Resolved = { plan: (WantedPrice & { planId: string }) | null; extensions: WantedExtension[]; stripePrices: string[] };

/** The wanted prices read (offered ones only), checked against each other and the plan's grants, and their Stripe prices (synced if missing). */
async function resolveItems(
  organisationId: string,
  wanted: AccountItems,
  mode: PaymentModeName,
): Promise<{ ok: true; resolved: Resolved } | { ok: false; problems: string[] }> {
  const items = { planPriceId: wanted.planPriceId, extensionPriceIds: wanted.extensionPriceIds === "kept" ? await keptPrices(organisationId, wanted.planPriceId) : wanted.extensionPriceIds };
  const ids = [...(items.planPriceId ? [items.planPriceId] : []), ...items.extensionPriceIds];
  if (ids.some((id) => !/^[0-9a-f-]{36}$/i.test(id))) return { ok: false, problems: ["That price is no longer offered."] };
  const list = sql.join(
    ids.map((id) => sql`${id}::uuid`),
    sql`, `,
  );
  const rows =
    ids.length === 0
      ? []
      : await typedRows(
          WANTED_ROW,
          sql`
            select pp.id, 'plan' as kind, pp.plan_id::text as owner, pp.currency, pp.interval from commerce.plan_prices pp
              join commerce.plans p on p.id = pp.plan_id and p.active
             where pp.active and pp.id in (${list})
            union all
            select ep.id, 'extension', es.extension_id, ep.currency, ep.interval from commerce.extension_prices ep
              join commerce.extension_sizes es on es.id = ep.size_id and es.active
              join commerce.extensions e on e.id = es.extension_id and e.active
             where ep.active and ep.id in (${list})
          `,
        );
  const planRow = items.planPriceId ? rows.find((r) => r.id === items.planPriceId && r.kind === "plan") : null;
  if (items.planPriceId && !planRow) return { ok: false, problems: ["That plan is no longer offered."] };
  const extensions: WantedExtension[] = [];
  for (const id of items.extensionPriceIds) {
    const row = rows.find((r) => r.id === id && r.kind === "extension");
    if (!row || !isExtensionId(row.owner)) return { ok: false, problems: ["That extension is no longer offered."] };
    extensions.push({ id, currency: row.currency, interval: row.interval, extensionId: row.owner });
  }
  const plan = planRow ? { id: planRow.id, currency: planRow.currency, interval: planRow.interval, planId: planRow.owner } : null;
  const included = plan
    ? (await typedRows(z.object({ extension_id: col.text }), sql`select extension_id from commerce.plan_extension_grants where plan_id = ${plan.planId}::uuid`))
        .map((r) => r.extension_id)
        .filter(isExtensionId)
    : [];
  const problems = itemProblems(plan, extensions, included);
  if (problems.length > 0) return { ok: false, problems };

  const stripeIdOf = async (id: string) => syncedId(mode, "price", id);
  let stripePrices = await Promise.all(ids.map(stripeIdOf));
  if (stripePrices.some((id) => !id)) {
    await syncPlans(mode);
    await syncExtensions(mode);
    stripePrices = await Promise.all(ids.map(stripeIdOf));
  }
  if (stripePrices.some((id) => !id)) return { ok: false, problems: ["The prices are not in Stripe yet. Try again in a moment."] };
  return { ok: true, resolved: { plan, extensions, stripePrices: stripePrices as string[] } };
}

/**
 * The prices of the extensions the account pays for now, at their sizes, in the plan price's currency and interval, less those the plan
 * includes. An extension without a price there is left out, and the check after says nothing of it: the owner sees it gone from the list.
 */
async function keptPrices(organisationId: string, planPriceId: string | null): Promise<string[]> {
  if (!planPriceId || !/^[0-9a-f-]{36}$/i.test(planPriceId)) return [];
  const rows = await typedRows(
    z.object({ id: col.uuid }),
    sql`
      select ep.id from commerce.organisation_extensions oe
        join commerce.plan_prices pp on pp.id = ${planPriceId}::uuid
        join commerce.extension_prices ep on ep.size_id = oe.size_id and ep.active and ep.currency = pp.currency and ep.interval = pp.interval
       where oe.organisation_id = ${organisationId}::uuid and oe.source = 'bought' and oe.ended_at is null
         and not exists (select 1 from commerce.plan_extension_grants g where g.plan_id = pp.plan_id and g.extension_id = oe.extension_id)
    `,
  );
  return rows.map((r) => r.id);
}

/** The account's running subscription in the mode Kaizena Flow bills in, if any. */
function running(billing: AccountBilling, mode: PaymentModeName): string | null {
  return billing.subscriptionId && billing.mode === mode && !["canceled", "incomplete_expired"].includes(billing.status ?? "") ? billing.subscriptionId : null;
}

const metadataOf = (organisationId: string, resolved: Resolved): Record<string, string> => ({
  kaizen_organisation_id: organisationId,
  ...(resolved.plan && { kaizen_plan_id: resolved.plan.planId, kaizen_price_id: resolved.plan.id }),
});

const accountTarget = (organisationId: string) => ({ target: { type: "organisation", id: organisationId } });

/** Moves the running subscription to the wanted items at once, prorated: kept items untouched, new ones added, the rest taken off. */
async function changeItems(actor: Account, organisationId: string, mode: PaymentModeName, stripe: Stripe, subscriptionId: string, resolved: Resolved): Promise<SaveResult> {
  let subscription: Stripe.Subscription;
  try {
    const current = await stripe.subscriptions.retrieve(subscriptionId);
    subscription = await stripe.subscriptions.update(subscriptionId, {
      items: itemChanges(
        current.items.data.map((item) => ({ id: item.id, price: item.price.id })),
        resolved.stripePrices,
      ),
      proration_behavior: "create_prorations",
      cancel_at_period_end: false,
      metadata: metadataOf(organisationId, resolved),
    });
  } catch (error) {
    return { ok: false, problems: [stripeProblem(error)] };
  }
  await applyAccountSubscription(subscription, mode, actor);
  await audit(actor.id, null, "billing.account_plan_changed", { organisationId, subscriptionId, prices: resolved.stripePrices.length }, accountTarget(organisationId));
  return { ok: true };
}

/** What every change of an account's plan needs first: Stripe, the account's row, the wanted items checked, and its customer. */
async function prepareAccount(actor: Account, organisationId: string, items: AccountItems, origin: string) {
  const mode = billingMode();
  const stripe = mode && platformStripe(mode);
  if (!mode || !stripe) return { ok: false as const, problems: ["Plans cannot be chosen right now."] };
  const billing = await getAccountBilling(organisationId);
  if (!billing) return { ok: false as const, problems: [NOT_BILLED_BY_ACCOUNT] };
  const resolved = await resolveItems(organisationId, items, mode);
  if (!resolved.ok) return resolved;
  const customer = await accountCustomer(actor, organisationId, mode, origin);
  if (!customer.ok) return customer;
  return { ok: true as const, mode, stripe, billing, resolved: resolved.resolved, customer, running: running(billing, mode) };
}

/**
 * For the account's owner: chooses its plan and the extensions it buys on their own. Without a running subscription the owner is sent to
 * Stripe Checkout to pay by card; with one, its items change at once, prorated.
 */
export async function chooseAccountPlan(
  owner: Account,
  organisationId: string,
  items: AccountItems,
  origin: string,
): Promise<{ ok: true; checkoutUrl?: string } | { ok: false; problems: string[] }> {
  return accountLock(organisationId, async () => {
    const p = await prepareAccount(owner, organisationId, items, origin);
    if (!p.ok) return p;
    if (p.running) return changeItems(owner, organisationId, p.mode, p.stripe, p.running, p.resolved);
    const back = `${origin}/admin/account/billing`;
    const metadata = metadataOf(organisationId, p.resolved);
    // The account's trial: a plan chosen before it ends costs nothing until then (Stripe takes a trial end two days away or more).
    const trialAt = p.billing.trialEndsAt ? new Date(p.billing.trialEndsAt).getTime() : 0;
    const trialEnd = trialAt > Date.now() + 2 * 86_400_000 ? Math.floor(trialAt / 1000) : null;
    try {
      const vatRates = await billingTaxRates(p.stripe, p.mode, p.customer.country);
      const session = await p.stripe.checkout.sessions.create({
        mode: "subscription",
        customer_account: p.customer.accountId,
        line_items: p.resolved.stripePrices.map((price) => ({ price, quantity: 1, ...(vatRates.length > 0 && { tax_rates: vatRates }) })),
        allow_promotion_codes: true,
        subscription_data: { description: `Kaizena Flow: ${p.customer.name}`, metadata, ...(trialEnd && { trial_end: trialEnd }) },
        metadata,
        locale: "auto",
        success_url: `${back}?checkout={CHECKOUT_SESSION_ID}`,
        cancel_url: back,
      });
      if (!session.url) return { ok: false, problems: ["Stripe did not return a payment page."] };
      await audit(owner.id, null, "billing.account_checkout_started", { organisationId, prices: p.resolved.stripePrices.length }, accountTarget(organisationId));
      return { ok: true, checkoutUrl: session.url };
    } catch (error) {
      return { ok: false, problems: [stripeProblem(error)] };
    }
  });
}

/**
 * The owner adds an extension to the account's subscription, or ends one bought on its own (D748 E5): the subscription keeps its plan and
 * every other extension; the extension is added at its smallest size in the plan's currency and interval (monthly in the account's currency
 * without a plan). Without a running subscription, adding one opens Stripe Checkout, as a first plan does.
 */
export async function setAccountExtension(
  owner: Account,
  organisationId: string,
  extensionId: ExtensionId,
  on: boolean,
  origin: string,
): Promise<{ ok: true; checkoutUrl?: string } | { ok: false; problems: string[] }> {
  const billing = await getAccountBilling(organisationId);
  if (!billing) return { ok: false, problems: [NOT_BILLED_BY_ACCOUNT] };
  const currency = billing.price?.currency ?? (await accountCurrency(organisationId));
  const interval = billing.price?.interval ?? "month";
  const kept = await typedRows(
    z.object({ id: col.uuid, extension_id: col.text }),
    sql`
      select ep.id, oe.extension_id from commerce.organisation_extensions oe
        join commerce.extension_prices ep on ep.size_id = oe.size_id and ep.active and ep.currency = ${currency} and ep.interval = ${interval}
       where oe.organisation_id = ${organisationId}::uuid and oe.source = 'bought' and oe.ended_at is null
    `,
  );
  const others = kept.filter((k) => k.extension_id !== extensionId).map((k) => k.id);
  if (!on) {
    if (others.length === 0 && !billing.priceId) return cancelAccountPlan(owner, organisationId, "now");
    return chooseAccountPlan(owner, organisationId, { planPriceId: billing.priceId, extensionPriceIds: others }, origin);
  }
  const added = await typedRow(
    z.object({ id: col.uuid }),
    sql`
      select ep.id from commerce.extension_sizes es
        join commerce.extension_prices ep on ep.size_id = es.id and ep.active and ep.currency = ${currency} and ep.interval = ${interval}
       where es.extension_id = ${extensionId} and es.active
       order by es.position, es.created_at limit 1
    `,
  );
  if (!added) return { ok: false, problems: ["That extension has no price in your account's currency yet."] };
  return chooseAccountPlan(owner, organisationId, { planPriceId: billing.priceId, extensionPriceIds: [...others, added.id] }, origin);
}

/**
 * For platform admins (and the move at launch): puts the account on these items. A new subscription is invoiced (due in 14 days, as a
 * store's is); a running one changes at once, prorated.
 */
export async function assignAccountPlan(actor: Account, organisationId: string, items: AccountItems, trialDays: number, origin: string): Promise<SaveResult> {
  return accountLock(organisationId, async () => {
    const p = await prepareAccount(actor, organisationId, items, origin);
    if (!p.ok) return p;
    if (p.running) return changeItems(actor, organisationId, p.mode, p.stripe, p.running, p.resolved);
    let subscription: Stripe.Subscription;
    try {
      const vatRates = await billingTaxRates(p.stripe, p.mode, p.customer.country);
      subscription = await p.stripe.subscriptions.create(
        {
          customer_account: p.customer.accountId,
          items: p.resolved.stripePrices.map((price) => ({ price })),
          collection_method: "send_invoice",
          days_until_due: 14,
          ...(trialDays > 0 && { trial_period_days: trialDays }),
          ...(vatRates.length > 0 && { default_tax_rates: vatRates }),
          description: `Kaizena Flow: ${p.customer.name}`,
          metadata: metadataOf(organisationId, p.resolved),
        },
        // A double click must not start two subscriptions.
        { idempotencyKey: `kaizen-account-subscribe-${organisationId}-${p.resolved.stripePrices.join(".")}-${Math.floor(Date.now() / 60_000)}` },
      );
    } catch (error) {
      return { ok: false, problems: [stripeProblem(error)] };
    }
    await applyAccountSubscription(subscription, p.mode, actor);
    await audit(actor.id, null, "billing.account_plan_started", { organisationId, subscriptionId: subscription.id, trialDays }, accountTarget(organisationId));
    return { ok: true };
  });
}

/** When the owner returns from Stripe Checkout: records the subscription at once; only a session for this account counts. */
export async function completeAccountCheckout(organisationId: string, sessionId: string): Promise<boolean> {
  const mode = billingMode();
  const stripe = mode && platformStripe(mode);
  if (!mode || !stripe || !/^cs_[A-Za-z0-9_]+$/.test(sessionId)) return false;
  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ["subscription"] });
    const ours = session.metadata?.kaizen_organisation_id === organisationId;
    return ours && typeof session.subscription === "object" && session.subscription ? applyAccountSubscription(session.subscription, mode) : false;
  } catch {
    return false; // The webhook will follow.
  }
}

/** Ends the account's subscription now, or at the end of the period it has paid for; or undoes that. */
export async function cancelAccountPlan(actor: Account, organisationId: string, when: "period_end" | "now" | "undo"): Promise<SaveResult> {
  const billing = await getAccountBilling(organisationId);
  if (!billing) return { ok: false, problems: [NOT_BILLED_BY_ACCOUNT] };
  const mode = billing.mode;
  const stripe = mode && platformStripe(mode);
  const subscriptionId = mode ? running(billing, mode) : null;
  if (!mode || !stripe || !subscriptionId) return { ok: false, problems: ["The account has no plan to cancel."] };
  const ended = await (when === "now"
    ? stripe.subscriptions.cancel(subscriptionId, { invoice_now: false, prorate: false })
    : stripe.subscriptions.update(subscriptionId, { cancel_at_period_end: when === "period_end" })
  ).then(
    (subscription) => ({ ok: true as const, subscription }),
    (error: unknown) => ({ ok: false as const, problem: stripeProblem(error) }),
  );
  if (!ended.ok) return { ok: false, problems: [ended.problem] };
  await applyAccountSubscription(ended.subscription, mode, actor);
  await audit(actor.id, null, `billing.account_plan_cancel_${when}`, { organisationId, subscriptionId }, accountTarget(organisationId));
  return { ok: true };
}

/** A link into Stripe's customer portal for the account's customer: Kaizena Flow's invoices and how the account pays. */
export async function accountPortalUrl(organisationId: string, returnUrl: string): Promise<{ ok: true; url: string } | { ok: false; problem: string }> {
  const billing = await getAccountBilling(organisationId);
  if (!billing) return { ok: false, problem: NOT_BILLED_BY_ACCOUNT };
  const mode = billing.mode ?? billingMode();
  const stripe = mode && platformStripe(mode);
  if (!mode || !stripe || !billing.customerAccount) return { ok: false, problem: "Your account has no plan with Kaizena Flow yet." };
  const configuration = await portalConfiguration(stripe, mode);
  return stripe.billingPortal.sessions.create({ customer_account: billing.customerAccount, return_url: returnUrl, configuration }).then(
    (session) => ({ ok: true as const, url: session.url }),
    (error: unknown) => ({ ok: false as const, problem: stripeProblem(error) }),
  );
}

/** The currency the account is billed in: its plan's, else its first store's main currency (as a store's plan is first offered). */
export async function accountCurrency(organisationId: string): Promise<string | null> {
  const billing = await getAccountBilling(organisationId);
  if (billing?.price) return billing.price.currency;
  const store = await firstStore(organisationId);
  return store?.markets[0]?.currency ?? null;
}

/** The extensions the account pays for on its subscription now (bought, running or in its grace period), with their sizes. */
export async function boughtExtensions(organisationId: string): Promise<{ extensionId: ExtensionId; name: string; size: string; endedAt: string | null }[]> {
  const rows = await typedRows(
    z.object({ extension_id: col.text, name: col.text, size: col.text, ended_at: col.timestampOrNull }),
    sql`
      select oe.extension_id, e.name, es.label as size, oe.ended_at from commerce.organisation_extensions oe
        join commerce.extensions e on e.id = oe.extension_id
        join commerce.extension_sizes es on es.id = oe.size_id
       where oe.organisation_id = ${organisationId}::uuid and oe.source = 'bought' and (oe.ended_at is null or oe.grace_ends_at > now())
       order by e.position, e.id
    `,
  );
  return rows.flatMap((r) => (isExtensionId(r.extension_id) ? [{ extensionId: r.extension_id, name: r.name, size: r.size, endedAt: r.ended_at }] : []));
}

/** The account's latest invoices from Kaizena Flow, newest first: none before it is billed, null when Stripe cannot be asked. */
export async function listAccountInvoices(organisationId: string, limit = 12): Promise<PlanInvoice[] | null> {
  const billing = await getAccountBilling(organisationId);
  const mode = billing?.mode ?? billingMode();
  const stripe = mode && platformStripe(mode);
  if (!billing?.customerAccount || !mode || !stripe) return [];
  return stripe.invoices.list({ customer_account: billing.customerAccount, limit }).then(
    (page) => page.data.map((invoice) => toInvoice(invoice, mode)),
    () => null,
  );
}

// ---------------------------------------------------------------------------
// Stripe's word on the subscription
// ---------------------------------------------------------------------------

const ITEM_PRICE_ROW = z.object({ stripe_id: col.text, kind: z.enum(["plan", "extension"]), price_id: col.uuid, owner: col.text, size_id: col.uuid.nullable() });

/** The plan price and the extension prices a subscription's items bill, by their Stripe prices. */
async function itemPrices(stripePrices: readonly string[], mode: PaymentModeName) {
  if (stripePrices.length === 0) return [];
  const list = sql.join(
    stripePrices.map((id) => sql`${id}`),
    sql`, `,
  );
  return typedRows(
    ITEM_PRICE_ROW,
    sql`
      select s.stripe_id, 'plan' as kind, pp.id as price_id, pp.plan_id::text as owner, null::uuid as size_id
        from commerce.stripe_sync s join commerce.plan_prices pp on pp.id::text = s.local_id
       where s.mode = ${mode} and s.kind = 'price' and s.stripe_id in (${list})
      union all
      select s.stripe_id, 'extension', ep.id, es.extension_id, es.id
        from commerce.stripe_sync s join commerce.extension_prices ep on ep.id::text = s.local_id
        join commerce.extension_sizes es on es.id = ep.size_id
       where s.mode = ${mode} and s.kind = 'price' and s.stripe_id in (${list})
    `,
  );
}

/**
 * Records an account's subscription as Stripe reports it (the billing webhook, and every change made here): the plan and its status on
 * `organisation_billing`, each extension item as a bought `organisation_extensions` row, and every bought extension no longer paid for ended
 * with its grace period. An event about an older, cancelled subscription never replaces the account's current one. Returns false for a
 * subscription that is not an account's (the store's own path takes it).
 */
export async function applyAccountSubscription(subscription: Stripe.Subscription, mode: PaymentModeName, actor?: Account): Promise<boolean> {
  let organisationId: string | null = subscription.metadata?.kaizen_organisation_id ?? null;
  if (!organisationId) {
    const row = await typedRow(z.object({ organisation_id: col.uuid }), sql`
      select organisation_id from commerce.organisation_billing where mode = ${mode} and subscription_id = ${subscription.id}
    `);
    organisationId = row?.organisation_id ?? null;
  }
  if (!organisationId || !/^[0-9a-f-]{36}$/i.test(organisationId)) return false;

  const prices = await itemPrices(
    subscription.items.data.map((item) => item.price.id),
    mode,
  );
  const plan = prices.find((p) => p.kind === "plan") ?? null;
  const extensions = prices.filter((p): p is typeof p & { owner: ExtensionId } => p.kind === "extension" && isExtensionId(p.owner));
  const firstItem = subscription.items.data[0];
  const periodEnd = firstItem?.current_period_end ? new Date(firstItem.current_period_end * 1000).toISOString() : null;
  const status = subscription.status;

  const applied = await db().transaction(async (tx) => {
    const kept = await typedRow(
      z.object({ organisation_id: col.uuid }),
      sql`
        insert into commerce.organisation_billing as b (
          organisation_id, plan_id, price_id, mode, subscription_id, status, current_period_end, cancel_at_period_end, updated_by
        ) values (
          ${organisationId}::uuid, ${plan ? plan.owner : null}::uuid, ${plan ? plan.price_id : null}::uuid, ${mode},
          ${subscription.id}, ${status}, ${periodEnd}, ${subscription.cancel_at_period_end}, ${actor?.id ?? null}::uuid
        )
        on conflict (organisation_id) do update set
          plan_id = excluded.plan_id,
          price_id = excluded.price_id,
          ${SUBSCRIPTION_KEPT}
        returning b.organisation_id
      `,
      tx,
    );
    if (!kept) return false;
    // Each extension on the subscription: bought, at its size, running (a trial or an ended purchase becomes bought).
    if (isOnPlan(status)) {
      for (const item of extensions) {
        await tx.execute(sql`
          insert into commerce.organisation_extensions (organisation_id, extension_id, source, size_id)
          values (${organisationId}::uuid, ${item.owner}, 'bought', ${item.size_id}::uuid)
          on conflict (organisation_id, extension_id) do update set
            source = 'bought', size_id = excluded.size_id, bundle_id = null, trial_ends_at = null, ended_at = null, grace_ends_at = null, updated_at = now()
        `);
      }
    }
    const bought = await typedRows(
      z.object({ extension_id: col.text }),
      sql`select extension_id from commerce.organisation_extensions where organisation_id = ${organisationId}::uuid and source = 'bought' and ended_at is null`,
      tx,
    );
    const ended = endedExtensions(
      bought.map((r) => r.extension_id).filter(isExtensionId),
      extensions.map((e) => e.owner),
      status,
    );
    if (ended.length > 0) {
      const names = sql.join(
        ended.map((id) => sql`${id}`),
        sql`, `,
      );
      await tx.execute(sql`
        update commerce.organisation_extensions
           set ended_at = now(), grace_ends_at = now() + make_interval(days => ${GRACE_DAYS}), updated_at = now()
         where organisation_id = ${organisationId}::uuid and source = 'bought' and ended_at is null and extension_id in (${names})
      `);
    }
    return true;
  });
  if (applied) {
    await refreshExtensionFacts({ organisationId });
    forgetLimits();
  }
  return true;
}
