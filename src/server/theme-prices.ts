import "server-only";

import { sql } from "drizzle-orm";
import Stripe from "stripe";

import { db, readDb } from "@/db/client";
import { storeBase, storeOrigin } from "@/lib/paths";
import { parsePrice } from "@/lib/product-input";
import { invoiceExTaxMinor, invoicePaidAt, type InvoiceShape } from "@/lib/referral-billing";
import type { PaymentModeName } from "@/lib/stripe-account";
import {
  THEME_PRICE_MAX_MINOR,
  nextTryDelayMs,
  orderPrices,
  type OwnedStatus,
  type ThemeCharge,
  type ThemePrice,
  type ThemePurchaseStatus,
} from "@/lib/theme-prices";

import { activeAccount, audit, type Account } from "./auth";
import { billingMode, billingTaxRates, getStoreBilling, planCurrencies } from "./billing";
import { createStripeAccount, ensureTestAccount, getStripeAccounts } from "./connect";
import { platformStripe } from "./stripe";
import { getStore } from "./stores";

/**
 * Premium themes (D286, `docs/theme-prices.md`): a theme's prices, what making one live costs a store, and the purchases the database makes
 * when a priced theme goes live (`commerce.theme_installs_charge()`), invoiced through Kaizena Flow's own Stripe billing (the store's Stripe
 * account as the customer, as its plan is) once the store is open: by the plan's card when the plan is paid by card, otherwise as an invoice
 * due in 14 days. The billing webhook marks them paid (`applyThemeInvoiceEvent()`), and a referred store's payment earns its referrer as
 * its plan invoices do (`commerce.referral_earn()`, `theme_invoice:{invoice}`). This module is the only writer of `theme_prices`, and of
 * `theme_purchases` besides the database's own rules.
 */

type Row = Record<string, unknown>;
type Tx = Pick<ReturnType<typeof db>, "execute">;
type Result = { ok: true } | { ok: false; problems: string[] };

const isUuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

const toPrice = (row: Row): ThemePrice => ({ currency: String(row.currency).trim(), amountMinor: Number(row.amount_minor) });

/* ------------------------------------------------------------------------------------------------------------------------------------------
 * Prices
 * ---------------------------------------------------------------------------------------------------------------------------------------- */

/** The prices of these themes, in the order the plans' currencies are listed; a theme missing from the map is free. */
export async function themePrices(presetIds: readonly string[]): Promise<Map<string, ThemePrice[]>> {
  const ids = presetIds.filter(isUuid);
  const out = new Map<string, ThemePrice[]>();
  if (ids.length === 0) return out;
  const [rows, currencies] = await Promise.all([
    readDb().execute<Row>(sql`select preset_id, currency, amount_minor from commerce.theme_prices where preset_id = any(${`{${ids.join(",")}}`}::uuid[])`),
    planCurrencies(),
  ]);
  for (const row of rows) {
    const id = String(row.preset_id);
    out.set(id, [...(out.get(id) ?? []), toPrice(row)]);
  }
  for (const [id, prices] of out) out.set(id, orderPrices(prices, currencies));
  return out;
}

/**
 * The prices typed on a theme's page: Free, or Premium with an amount in every currency stores are billed in (the plans' currencies), so a
 * store is never billed in a currency it does not pay its plan in.
 */
export function parseThemePricesForm(
  form: { get(name: string): FormDataEntryValue | null },
  currencies: readonly string[],
): { ok: true; prices: ThemePrice[] } | { ok: false; problems: string[] } {
  if (form.get("pricing") !== "premium") return { ok: true, prices: [] };
  const prices: ThemePrice[] = [];
  const problems: string[] = [];
  for (const currency of currencies) {
    const text = String(form.get(`price:${currency}`) ?? "").trim();
    if (!text) {
      problems.push(`Give the price in ${currency}: stores are billed in it.`);
      continue;
    }
    const amount = parsePrice(text, currency);
    if (amount === null || amount <= 0 || amount > THEME_PRICE_MAX_MINOR) problems.push(`"${text}" is not a price in ${currency}.`);
    else prices.push({ currency, amountMinor: amount });
  }
  if (currencies.length === 0) problems.push("Kaizena Flow bills in no currency yet: set the plans' currencies first.");
  return problems.length > 0 ? { ok: false, problems } : { ok: true, prices };
}

/**
 * Sets a theme's prices (none: free). A theme given its first price stays free for the stores that have it already (each gets it as
 * `granted`); a theme made free charges nobody who has not been invoiced yet (what was owed or due and not invoiced is cancelled). Saved at
 * once, not as a draft; the caller refreshes the theme store (`DESIGNS_TAG`).
 */
export async function setThemePrices(admin: Account, presetId: string, prices: readonly ThemePrice[]): Promise<Result & { granted?: number; cancelled?: number }> {
  if (!isUuid(presetId)) return { ok: false, problems: ["That theme no longer exists."] };
  const seen = new Set<string>();
  for (const price of prices) {
    if (!/^[A-Z]{3}$/.test(price.currency) || seen.has(price.currency)) return { ok: false, problems: ["Each currency is priced once."] };
    if (!Number.isSafeInteger(price.amountMinor) || price.amountMinor <= 0 || price.amountMinor > THEME_PRICE_MAX_MINOR) {
      return { ok: false, problems: [`${price.currency}: the price is out of range.`] };
    }
    seen.add(price.currency);
  }
  const done = await db().transaction(async (tx) => {
    const [theme] = await tx.execute<Row>(sql`
      select title, author_id, (select count(*)::int from commerce.theme_prices p where p.preset_id = d.id) as priced
        from commerce.design_presets d where d.id = ${presetId}::uuid for update
    `);
    if (!theme) return null;
    // A theme from outside is free until a revenue share is decided (D344); the database refuses its price too.
    if (theme.author_id && prices.length > 0) return "author" as const;
    const wasPremium = Number(theme.priced) > 0;
    await tx.execute(sql`delete from commerce.theme_prices where preset_id = ${presetId}::uuid`);
    for (const price of prices) {
      await tx.execute(sql`
        insert into commerce.theme_prices (preset_id, currency, amount_minor, updated_by)
        values (${presetId}::uuid, ${price.currency}, ${price.amountMinor}, ${admin.id}::uuid)
      `);
    }
    let granted = 0;
    let cancelled = 0;
    if (prices.length === 0) {
      const rows = await tx.execute<Row>(sql`
        update commerce.theme_purchases set status = 'cancelled', ended_at = now(), updated_at = now()
         where preset_id = ${presetId}::uuid and (status = 'owed' or (status = 'due' and stripe_invoice_id is null))
        returning id
      `);
      cancelled = rows.length;
    } else if (!wasPremium) {
      // Stores that have it already keep it as they took it: free.
      const rows = await tx.execute<Row>(sql`
        insert into commerce.theme_purchases (store_id, preset_id, status, currency, amount_minor, chosen_by)
        select distinct i.store_id, ${presetId}::uuid, 'granted', (select pr.currency from commerce.theme_price_for(i.store_id, ${presetId}::uuid) pr), 0, ${admin.id}::uuid
          from commerce.store_theme_installs i join commerce.stores s on s.id = i.store_id
         where i.preset_id = ${presetId}::uuid and not (s.is_template or s.starter)
           and not exists (
             select 1 from commerce.theme_purchases p
              where p.store_id = i.store_id and p.preset_id = ${presetId}::uuid and p.status in ('owed', 'due', 'invoiced', 'paid', 'granted'))
        returning id
      `);
      granted = rows.length;
    }
    return { title: String(theme.title), granted, cancelled, wasPremium };
  });
  if (!done) return { ok: false, problems: ["That theme no longer exists."] };
  if (done === "author") return { ok: false, problems: ["A theme from outside is free until a revenue share is decided."] };
  await audit(admin.id, null, "platform.theme_prices_set", {
    preset: presetId,
    title: done.title,
    prices: prices.map((p) => `${p.currency} ${p.amountMinor}`),
    granted: done.granted,
    cancelled: done.cancelled,
  });
  return { ok: true, granted: done.granted, cancelled: done.cancelled };
}

/* ------------------------------------------------------------------------------------------------------------------------------------------
 * What making a theme live costs a store
 * ---------------------------------------------------------------------------------------------------------------------------------------- */

/**
 * What making each of these themes live would cost the store now (`ThemeCharge`): free (also on a store template), nothing more (it has it,
 * or owes it already), or the theme's price as `commerce.theme_price_for()` decides it: paid when the store opens, or charged at once.
 */
export async function themeCharges(storeId: string, presetIds: readonly string[]): Promise<Map<string, ThemeCharge>> {
  const ids = [...new Set(presetIds.filter(isUuid))];
  const out = new Map<string, ThemeCharge>();
  if (ids.length === 0 || !isUuid(storeId)) return out;
  const rows = await db().execute<Row>(sql`
    select t.id, s.setup_completed_at is not null as open, (s.starter or s.is_template) as kept,
      (select p.status from commerce.theme_purchases p
        where p.store_id = s.id and p.preset_id = t.id and p.status in ('owed', 'due', 'invoiced', 'paid', 'granted') limit 1) as owned,
      pr.currency, pr.amount_minor
    from unnest(${`{${ids.join(",")}}`}::uuid[]) as t(id)
    cross join commerce.stores s
    left join lateral commerce.theme_price_for(s.id, t.id) pr on true
    where s.id = ${storeId}::uuid
  `);
  for (const row of rows) {
    const id = String(row.id);
    if (row.kept || row.currency == null) out.set(id, { kind: "free" });
    else if (row.owned) out.set(id, { kind: "owned", status: String(row.owned) as OwnedStatus });
    else out.set(id, { kind: row.open ? "now" : "at_opening", price: toPrice(row) });
  }
  return out;
}

export async function themeCharge(storeId: string, presetId: string): Promise<ThemeCharge> {
  return (await themeCharges(storeId, [presetId])).get(presetId) ?? { kind: "free" };
}

/**
 * What a transaction that makes a theme live tells the database (`commerce.theme_installs_charge()`): who did it, and the price they agreed
 * to (`chargeToken()`), or `grant` for a theme Kaizena Flow gives. Without an agreed price a premium theme the store does not have is refused
 * on an open store; before it opens it is owed without one, as the person was shown when choosing it.
 */
export async function setThemeCharge(tx: Tx, accountId: string, charge: string | null | undefined): Promise<void> {
  await tx.execute(sql`select set_config('kaizen.theme_actor', ${accountId}, true), set_config('kaizen.theme_charge', ${charge ?? ""}, true)`);
}

/** Whether an error is the database refusing a premium theme whose price was not agreed to. */
export const isChargeRefusal = (error: unknown): boolean =>
  /theme_purchases\.confirm/.test(error instanceof Error ? `${error.message} ${String((error as { cause?: unknown }).cause ?? "")}` : String(error));

export const CHARGE_CHANGED = "This theme's price is not the one you were shown. Look at it again and confirm the price to use it.";

/* ------------------------------------------------------------------------------------------------------------------------------------------
 * Purchases as stores and the platform see them
 * ---------------------------------------------------------------------------------------------------------------------------------------- */

export type ThemePurchase = {
  id: string;
  presetId: string;
  title: string;
  status: ThemePurchaseStatus;
  price: ThemePrice;
  invoiceNumber: string | null;
  invoiceUrl: string | null;
  problem: string | null;
  createdAt: string;
  paidAt: string | null;
};

const when = (value: unknown) => (value ? new Date(String(value)).toISOString() : null);

/** A store's theme purchases, newest first, leaving out those that were never charged. */
export async function storeThemePurchases(storeId: string): Promise<ThemePurchase[]> {
  if (!isUuid(storeId)) return [];
  const rows = await db().execute<Row>(sql`
    select p.id, p.preset_id, d.title, p.status, p.currency, p.amount_minor, p.invoice_number, p.invoice_url, p.problem, p.created_at, p.paid_at
      from commerce.theme_purchases p join commerce.design_presets d on d.id = p.preset_id
     where p.store_id = ${storeId}::uuid and p.status <> 'cancelled'
     order by p.created_at desc
  `);
  return rows.map((row) => ({
    id: String(row.id),
    presetId: String(row.preset_id),
    title: String(row.title),
    status: String(row.status) as ThemePurchaseStatus,
    price: toPrice(row),
    invoiceNumber: row.invoice_number ? String(row.invoice_number) : null,
    invoiceUrl: row.invoice_url ? String(row.invoice_url) : null,
    problem: row.problem ? String(row.problem) : null,
    createdAt: when(row.created_at) ?? "",
    paidAt: when(row.paid_at),
  }));
}

/** How many stores have each standing of a theme, for its page in the platform's admin. */
export async function themePurchaseCounts(presetId: string): Promise<Record<ThemePurchaseStatus, number>> {
  const counts: Record<ThemePurchaseStatus, number> = { owed: 0, due: 0, invoiced: 0, paid: 0, granted: 0, cancelled: 0, void: 0 };
  if (!isUuid(presetId)) return counts;
  const rows = await db().execute<Row>(sql`select status, count(*)::int as n from commerce.theme_purchases where preset_id = ${presetId}::uuid group by status`);
  for (const row of rows) counts[String(row.status) as ThemePurchaseStatus] = Number(row.n);
  return counts;
}

/** Purchases waiting to be invoiced that could not be, for the platform's theme page: the store and what went wrong. */
export async function stuckThemePurchases(presetId: string): Promise<{ store: string; problem: string; tries: number }[]> {
  if (!isUuid(presetId)) return [];
  const rows = await db().execute<Row>(sql`
    select s.name, p.problem, p.tries from commerce.theme_purchases p join commerce.stores s on s.id = p.store_id
     where p.preset_id = ${presetId}::uuid and p.status = 'due' and p.problem is not null order by p.due_at limit 20
  `);
  return rows.map((row) => ({ store: String(row.name), problem: String(row.problem), tries: Number(row.tries) }));
}

/* ------------------------------------------------------------------------------------------------------------------------------------------
 * Invoicing what is due
 * ---------------------------------------------------------------------------------------------------------------------------------------- */

/** The parts of Stripe invoicing uses, so the integration tests can stand in for it. */
export type ThemeBillingStripe = {
  invoices: Pick<Stripe["invoices"], "create" | "retrieve" | "finalizeInvoice" | "pay">;
  invoiceItems: Pick<Stripe["invoiceItems"], "create" | "list">;
  subscriptions: Pick<Stripe["subscriptions"], "retrieve">;
};

export type ThemeBillingDeps = {
  mode?: PaymentModeName;
  stripe?: ThemeBillingStripe;
  /** The VAT rates on the invoice for a store's country (Kaizena Flow's MVA for a Norwegian store). */
  taxRates?: (country: string | null) => Promise<string[]>;
  /** The store's Stripe account in the mode, made when missing. */
  account?: (storeId: string, mode: PaymentModeName) => Promise<string | null>;
};

/** The words for a purchase the next try will take up again. */
class BillingProblem extends Error {}

/** The store's Stripe account as Kaizena Flow's customer in the mode, made as choosing a plan makes it when the store has none yet. */
export async function billedAccount(storeId: string, mode: PaymentModeName): Promise<string | null> {
  const existing = (await getStripeAccounts(storeId))[mode]?.accountId;
  if (existing) return existing;
  const [row] = await db().execute<Row>(sql`
    select s.slug, (select m.account_id from commerce.store_members m
                     where m.store_id = s.id and m.role = 'owner' and m.disabled_at is null order by m.created_at limit 1) as owner
      from commerce.stores s where s.id = ${storeId}::uuid
  `);
  if (!row) return null;
  if (mode === "test") {
    const made = await ensureTestAccount(storeId, row.owner ? String(row.owner) : null, null);
    return made.ok ? made.accountId : null;
  }
  const [owner, store] = await Promise.all([row.owner ? activeAccount(String(row.owner)) : null, getStore(String(row.slug))]);
  if (!owner || !store) return null;
  const made = await createStripeAccount({ account: owner, store }, mode, storeOrigin(store.slug) ?? storeBase(store.slug));
  return made.ok ? ((await getStripeAccounts(storeId))[mode]?.accountId ?? null) : null;
}

/** How the store pays Kaizena Flow: by its plan's card when the plan is paid by card in this mode, else by invoice. */
export async function collectionFor(storeId: string, mode: PaymentModeName, stripe: ThemeBillingStripe): Promise<{ card: string | null }> {
  const billing = await getStoreBilling(storeId);
  if (!billing?.subscriptionId || billing.mode !== mode) return { card: null };
  try {
    const subscription = await stripe.subscriptions.retrieve(billing.subscriptionId);
    const method = subscription.default_payment_method;
    if (subscription.collection_method !== "charge_automatically" || !method) return { card: null };
    return { card: typeof method === "string" ? method : method.id };
  } catch {
    return { card: null };
  }
}

const stripeWords = (error: unknown) => (error instanceof Stripe.errors.StripeError ? error.message : "Stripe could not be reached.");

/** Takes one due purchase no other run holds, the next try counted. */
async function claimDue(storeId: string | undefined): Promise<Row | null> {
  const [row] = await db().execute<Row>(sql`
    update commerce.theme_purchases set claimed_until = now() + interval '3 minutes', tries = tries + 1, updated_at = now()
     where id = (
       select p.id from commerce.theme_purchases p join commerce.stores s on s.id = p.store_id
        where p.status = 'due' and s.status = 'active'
          and (p.claimed_until is null or p.claimed_until < now()) and (p.next_try_at is null or p.next_try_at <= now())
          ${storeId && isUuid(storeId) ? sql`and p.store_id = ${storeId}::uuid` : sql``}
        order by p.due_at limit 1
        for update of p skip locked)
    returning id, store_id, preset_id, currency, amount_minor, stripe_invoice_id, tries
  `);
  return row ?? null;
}

/**
 * Invoices the purchases that are due (a store opened with a premium theme live, or an open store made one live), a few a run: a Stripe
 * invoice on Kaizena Flow's account to the store's account with one line for the theme, VAT as on its plan, finalized, and paid at once by
 * the plan's card when there is one (else Stripe sends it, due in 14 days). Every step is safe to repeat: the invoice is kept on the
 * purchase as soon as it exists, its line is found by its mark, and a try that fails is taken up again later with the problem in words.
 * Run from `after()` where a store opens or a theme is bought, and from the five-minute job. Never throws.
 */
export async function chargeDueThemePurchases(scope: { storeId?: string; limit?: number } = {}, deps: ThemeBillingDeps = {}): Promise<{ invoiced: number; failed: number }> {
  const mode = deps.mode ?? billingMode();
  const stripe = deps.stripe ?? (mode ? platformStripe(mode) : null);
  if (!mode || !stripe) return { invoiced: 0, failed: 0 };
  let invoiced = 0;
  let failed = 0;
  for (let n = 0; n < (scope.limit ?? 10); n++) {
    let row: Row | null;
    try {
      row = await claimDue(scope.storeId);
    } catch (error) {
      console.error("[theme-prices] claiming a purchase failed", error);
      break;
    }
    if (!row) break;
    try {
      await invoiceOne(row, mode, stripe, deps);
      invoiced++;
    } catch (error) {
      failed++;
      const problem = (error instanceof BillingProblem ? error.message : stripeWords(error)).slice(0, 500);
      if (!(error instanceof BillingProblem) && !(error instanceof Stripe.errors.StripeError)) console.error("[theme-prices] invoicing failed", error);
      await db()
        .execute(sql`
          update commerce.theme_purchases set problem = ${problem}, claimed_until = null, updated_at = now(),
            next_try_at = now() + ${`${nextTryDelayMs(Number(row.tries))} milliseconds`}::interval
           where id = ${String(row.id)}::uuid and status = 'due'
        `)
        .catch((recordError) => console.error("[theme-prices] recording a problem failed", recordError));
    }
  }
  return { invoiced, failed };
}

async function invoiceOne(row: Row, mode: PaymentModeName, stripe: ThemeBillingStripe, deps: ThemeBillingDeps): Promise<void> {
  const id = String(row.id);
  const storeId = String(row.store_id);
  const price = toPrice(row);
  const [facts] = await db().execute<Row>(sql`
    select s.name, s.country, d.title from commerce.stores s, commerce.design_presets d
     where s.id = ${storeId}::uuid and d.id = ${String(row.preset_id)}::uuid
  `);
  if (!facts) throw new BillingProblem("The store or the theme no longer exists.");
  const account = await (deps.account ?? billedAccount)(storeId, mode);
  if (!account) throw new BillingProblem("The store has no Stripe account to bill yet, and one could not be made.");
  const metadata = { kaizen_store_id: storeId, kaizen_theme_purchase: id, kaizen_theme_id: String(row.preset_id) };

  let invoiceId = row.stripe_invoice_id ? String(row.stripe_invoice_id) : null;
  let collection: "card" | "invoice" | null = null;
  if (!invoiceId) {
    const { card } = await collectionFor(storeId, mode, stripe);
    collection = card ? "card" : "invoice";
    const taxRates = await (deps.taxRates ?? ((country) => billingTaxRates(stripe as Stripe, mode, country)))(facts.country ? String(facts.country) : null);
    const made = await stripe.invoices.create(
      {
        customer_account: account,
        currency: price.currency.toLowerCase(),
        ...(card ? { collection_method: "charge_automatically", default_payment_method: card } : { collection_method: "send_invoice", days_until_due: 14 }),
        pending_invoice_items_behavior: "exclude",
        auto_advance: false,
        ...(taxRates.length > 0 && { default_tax_rates: taxRates }),
        description: `Kaizena Flow theme ${String(facts.title)} for ${String(facts.name)}: paid once, the store keeps it with every preset and update.`,
        metadata,
      },
      { idempotencyKey: `kaizen-theme-invoice-${id}` },
    );
    invoiceId = made.id ?? null;
    if (!invoiceId) throw new BillingProblem("Stripe made no invoice.");
    await db().execute(sql`
      update commerce.theme_purchases set stripe_invoice_id = ${invoiceId}, mode = ${mode}, collection = ${collection}, updated_at = now()
       where id = ${id}::uuid and stripe_invoice_id is null
    `);
  }

  let invoice = await stripe.invoices.retrieve(invoiceId);
  let finalizedNow = false;
  if (invoice.status === "draft") {
    const items = await stripe.invoiceItems.list({ invoice: invoiceId, limit: 10 });
    if (!items.data.some((item) => item.metadata?.kaizen_theme_purchase === id)) {
      await stripe.invoiceItems.create(
        {
          customer_account: account,
          invoice: invoiceId,
          amount: price.amountMinor,
          currency: price.currency.toLowerCase(),
          description: `Theme: ${String(facts.title)} (once, for ${String(facts.name)})`,
          metadata,
        },
        { idempotencyKey: `kaizen-theme-item-${id}` },
      );
    }
    invoice = await stripe.invoices.finalizeInvoice(invoiceId, { auto_advance: true });
    finalizedNow = true;
  }
  if (finalizedNow && invoice.status === "open" && invoice.collection_method === "charge_automatically") {
    try {
      invoice = await stripe.invoices.pay(invoiceId);
    } catch {
      // A card that is refused leaves the invoice open: Stripe tries it again and tells the store, as it does for the plan.
    }
  }
  await db().execute(sql`
    update commerce.theme_purchases
       set status = 'invoiced', invoiced_at = now(), mode = ${mode}, collection = coalesce(collection, ${collection ?? (invoice.collection_method === "send_invoice" ? "invoice" : "card")}),
           invoice_number = ${invoice.number ?? null}, invoice_url = ${invoice.hosted_invoice_url ?? null},
           problem = null, claimed_until = null, next_try_at = null, updated_at = now()
     where id = ${id}::uuid and status = 'due'
  `);
  if (invoice.status === "paid") await settlePaid(mode, invoice as unknown as InvoiceShape & { metadata?: Record<string, string> | null; hosted_invoice_url?: string | null }, Math.floor(Date.now() / 1000));
  else if (invoice.status === "void") await settleVoid(invoice.id ?? invoiceId);
  await audit(null, storeId, "billing.theme_invoiced", { purchase: id, invoice: invoiceId, amount: `${price.currency} ${price.amountMinor}`, status: invoice.status });
}

/* ------------------------------------------------------------------------------------------------------------------------------------------
 * The billing webhook
 * ---------------------------------------------------------------------------------------------------------------------------------------- */

type ThemeInvoice = InvoiceShape & { metadata?: Record<string, string> | null; hosted_invoice_url?: string | null };

/** The theme purchase an invoice is for, when Kaizena Flow made it for one. */
const purchaseOf = (invoice: ThemeInvoice): string | null => {
  const id = invoice.metadata?.kaizen_theme_purchase;
  return id && isUuid(id) ? id : null;
};

/** A theme invoice was paid: the purchase is paid (once), and a referred store's referrer earns on it as on a plan invoice. */
async function settlePaid(mode: PaymentModeName, invoice: ThemeInvoice, eventCreated: number): Promise<boolean> {
  const id = purchaseOf(invoice);
  if (!id) return false;
  const paidAt = invoicePaidAt(invoice, eventCreated).toISOString();
  // A purchase whose invoice was made but not yet recorded as such is recorded first: its steps only go forward.
  await db().execute(sql`
    update commerce.theme_purchases set status = 'invoiced', invoiced_at = coalesce(invoiced_at, now()), mode = ${mode},
      stripe_invoice_id = ${invoice.id}, updated_at = now()
     where id = ${id}::uuid and status = 'due' and (stripe_invoice_id is null or stripe_invoice_id = ${invoice.id})
  `);
  const [row] = await db().execute<Row>(sql`
    update commerce.theme_purchases set status = 'paid', paid_at = ${paidAt}::timestamptz, invoice_number = coalesce(${invoice.number ?? null}, invoice_number),
      invoice_url = coalesce(${invoice.hosted_invoice_url ?? null}, invoice_url), updated_at = now()
     where id = ${id}::uuid and stripe_invoice_id = ${invoice.id} and status in ('invoiced', 'paid')
    returning store_id, currency
  `);
  if (!row) return false;
  const fee = invoiceExTaxMinor(invoice);
  if (fee > 0) {
    await db().execute(sql`
      select commerce.referral_earn(
        ${String(row.store_id)}::uuid, ${fee}::bigint, ${String(row.currency).trim()}, 'theme_invoice', ${invoice.id},
        ${`Theme invoice${invoice.number ? ` ${invoice.number}` : ""}`}, ${paidAt}::timestamptz
      ) as earned
    `);
  }
  return true;
}

/** A theme invoice was voided: the purchase is recorded as such (the store keeps what it has; the platform's admin sees it). */
async function settleVoid(invoiceId: string): Promise<boolean> {
  const rows = await db().execute<Row>(sql`
    update commerce.theme_purchases set status = 'void', ended_at = now(), updated_at = now()
     where stripe_invoice_id = ${invoiceId} and status = 'invoiced'
    returning id
  `);
  return rows.length > 0;
}

/**
 * The billing webhook's invoice events for theme purchases (`/api/stripe/billing/{mode}`): paid and voided. Events of other invoices are left
 * alone (handled false). Safe to repeat; a failure is thrown so Stripe sends the event again.
 */
export async function applyThemeInvoiceEvent(mode: PaymentModeName, event: Stripe.Event): Promise<{ handled: boolean; detail?: string }> {
  if (event.type !== "invoice.paid" && event.type !== "invoice.voided") return { handled: false };
  const invoice = event.data.object as unknown as ThemeInvoice;
  if (!purchaseOf(invoice)) return { handled: false };
  if (event.type === "invoice.paid") return { handled: true, detail: (await settlePaid(mode, invoice, event.created)) ? "theme paid" : "theme unknown" };
  // A voided invoice that was never recorded as invoiced is recorded so first.
  await db().execute(sql`
    update commerce.theme_purchases set status = 'invoiced', invoiced_at = coalesce(invoiced_at, now()), mode = ${mode}, stripe_invoice_id = ${invoice.id}, updated_at = now()
     where id = ${purchaseOf(invoice)}::uuid and status = 'due' and (stripe_invoice_id is null or stripe_invoice_id = ${invoice.id})
  `);
  return { handled: true, detail: (await settleVoid(invoice.id)) ? "theme void" : "theme unknown" };
}
