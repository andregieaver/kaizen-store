import "server-only";

import { sql } from "drizzle-orm";
import Stripe from "stripe";

import { db } from "@/db/client";
import { registrantInput, registrarContact, DOMAIN_YEARS, type RegistrantInput } from "@/lib/domain-registrant";
import { formatMoney } from "@/lib/money";
import type { PaymentModeName } from "@/lib/stripe-account";
import { invoicePaidAt, type InvoiceShape } from "@/lib/referral-billing";
import { nextTryDelayMs } from "@/lib/theme-prices";

import { audit, type Account } from "./auth";
import { billingMode, billingTaxRates } from "./billing";
import { connectOwnedDomain } from "./domains";
import { domainPricingRows, priceContext, priceIn, storeDomainCurrency } from "./domain-prices";
import { toRegistration, type Registration } from "./domain-registrations";
import { limitRefusal } from "@/lib/usage-format";

import { checkLimit } from "./limits";
import { registrarById, registrarFor } from "./registrars";
import { RegistrarError, type DomainRegistrar } from "./registrars/types";
import { platformStripe } from "./stripe";
import { billedAccount, collectionFor, type ThemeBillingStripe } from "./theme-prices";

type Row = Record<string, unknown>;
type Result<T = object> = ({ ok: true } & T) | { ok: false; problems: string[] };

/**
 * Buying and renewing domains (D315, `docs/domains.md` 4.4 and 9.1): the money first, the registration after. A purchase is quoted when the
 * owner presses a button that named the price, invoiced on Kaizena Flow's Stripe account to the store's (as a premium theme is, D286),
 * registered once Stripe says it is paid, then connected to the store by itself. A registration that cannot be made is refunded in full. In
 * Stripe's test mode nothing is registered (a registrar has no test mode): the purchase ends refunded and says so. This module is the only
 * writer of `domain_purchases` and `domain_registrations` besides the database's own rules.
 */

const isUuid = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

export type PurchaseStatus = "quoted" | "invoiced" | "paid" | "registering" | "done" | "failed" | "refunded" | "void";

export type DomainPurchase = {
  id: string;
  apex: string;
  kind: "register" | "renew";
  years: number;
  status: PurchaseStatus;
  currency: string;
  amountMinor: number;
  invoiceUrl: string | null;
  problem: string | null;
  createdAt: string;
};

const toPurchase = (r: Row): DomainPurchase => ({
  id: String(r.id),
  apex: String(r.apex),
  kind: r.kind === "renew" ? "renew" : "register",
  years: Number(r.years),
  status: String(r.status) as PurchaseStatus,
  currency: String(r.currency).trim(),
  amountMinor: Number(r.amount_minor),
  invoiceUrl: r.invoice_url ? String(r.invoice_url) : null,
  problem: r.problem ? String(r.problem) : null,
  createdAt: new Date(String(r.created_at)).toISOString(),
});

/** The store's purchases still under way, and the last few finished, newest first. */
export async function storeDomainPurchases(storeId: string): Promise<DomainPurchase[]> {
  const rows = await db().execute<Row>(sql`
    select * from commerce.domain_purchases where store_id = ${storeId}::uuid
     order by (status in ('quoted', 'invoiced', 'paid', 'registering')) desc, created_at desc limit 20
  `);
  return rows.map(toPurchase);
}

// ---------------------------------------------------------------------------
// Quoting
// ---------------------------------------------------------------------------

export type Quote = { domain: string; years: number; currency: string; amountMinor: number; renewalMinor: number | null; cost: number; costCurrency: string };

/**
 * What a name costs the store now for `years`, read live from its registrar: refused when it is taken, premium, not sold, or the store's
 * currency cannot be priced. The quote is what the buy button names.
 */
export async function quoteDomain(storeId: string, domain: string, years: number): Promise<Result<{ quote: Quote }>> {
  const name = domain.trim().toLowerCase().replace(/\.$/, "");
  if (!(DOMAIN_YEARS as readonly number[]).includes(years)) return { ok: false, problems: ["Choose 1, 2, 3 or 5 years."] };
  const registrar = await registrarFor(name);
  if (!registrar) return { ok: false, problems: [`Kaizena Flow doesn't sell names ending in .${name.split(".").slice(1).join(".")} yet.`] };
  const [found] = await registrar.search([name]).catch(() => []);
  if (!found) return { ok: false, problems: ["The registrar can't be reached just now. Try again in a moment."] };
  if (!found.available) return { ok: false, problems: [`${name} is taken.`] };
  if (found.premium) return { ok: false, problems: [`${name} is a premium name, priced by its registry, which Kaizena Flow doesn't sell.`] };
  return quoteWith(storeId, registrar, name, years);
}

async function quoteWith(storeId: string, registrar: DomainRegistrar, name: string, years: number): Promise<Result<{ quote: Quote }>> {
  const priced = (await domainPricingRows()).map((p) => p.currency);
  const currency = await storeDomainCurrency(storeId, priced);
  const ctx = await priceContext(currency);
  if (!ctx || !currency) return { ok: false, problems: ["Domains can't be priced in your store's currency yet."] };
  let price;
  try {
    price = await registrar.price(name, years);
  } catch (error) {
    return { ok: false, problems: [error instanceof RegistrarError ? error.message : "The registrar can't be reached just now."] };
  }
  const amountMinor = priceIn(ctx, price.purchase, price.currency, years);
  if (amountMinor === null) return { ok: false, problems: ["Domains can't be priced in your store's currency yet."] };
  return {
    ok: true,
    quote: { domain: name, years, currency, amountMinor, renewalMinor: priceIn(ctx, price.renewal, price.currency, 1), cost: price.purchase, costCurrency: price.currency },
  };
}

// ---------------------------------------------------------------------------
// Starting a purchase
// ---------------------------------------------------------------------------

export type BuyInput = {
  domain: string;
  years: number;
  /** The price the button named, `{currency}:{minor}`: a different price now is refused, so nobody pays a price they weren't shown. */
  agreed: string;
  /** Connect the store to it once registered (the default). */
  connect: boolean;
  registrant: unknown;
};

/** Whether buying is open for a store: to every store once moving away is built (decision 9), until then where a platform admin opened it. */
export async function buyingOpen(storeId: string): Promise<boolean> {
  const [row] = await db().execute<Row>(sql`
    select coalesce((select domains_open from commerce.platform_settings limit 1), false) or s.domain_buying as open
      from commerce.stores s where s.id = ${storeId}::uuid
  `);
  return row?.open === true;
}

/**
 * Starts buying a name for a store: the owner's (the caller checks), the store open for business or being set up, buying open for it, the
 * plan's domain room left when it will be connected, the price the same as the one named, the registrant complete. Makes the registrant and
 * the purchase, then invoices it (`chargeDomainPurchases()`, run by the caller in `after()`).
 */
export async function startDomainPurchase(account: Account, storeId: string, input: BuyInput): Promise<Result<{ purchase: DomainPurchase; quote: Quote }>> {
  const [store] = await db().execute<Row>(sql`select status, is_template, starter from commerce.stores where id = ${storeId}::uuid`);
  if (!store || store.status !== "active" || store.is_template || store.starter) return { ok: false, problems: ["Domains can be bought for an open store only."] };
  if (!(await buyingOpen(storeId))) return { ok: false, problems: ["Buying domains isn't open for this store yet."] };
  const registrant = registrantInput.safeParse(input.registrant);
  if (!registrant.success) return { ok: false, problems: [...new Set(registrant.error.issues.map((i) => i.message))] };
  if (input.connect) {
    const room = await checkLimit(storeId, "custom_domains");
    if (!room.ok) return { ok: false, problems: [limitRefusal("custom_domains", room.limit)] };
  }
  const quoted = await quoteDomain(storeId, input.domain, input.years);
  if (!quoted.ok) return quoted;
  const { quote } = quoted;
  if (input.agreed !== `${quote.currency}:${quote.amountMinor}`) {
    return { ok: false, problems: [`The price is now ${formatMoney(quote.amountMinor, quote.currency, "en-GB")}. Look at it again and confirm to buy.`] };
  }
  const registrar = (await registrarFor(quote.domain))!;
  try {
    const purchase = await db().transaction(async (tx) => {
      const r = registrant.data;
      const [made] = await tx.execute<Row>(sql`
        insert into commerce.domain_registrants (store_id, kind, first_name, last_name, company_name, org_number, email, phone, address1, address2, city, state, postal_code, country, created_by)
        values (${storeId}::uuid, ${r.kind}, ${r.firstName}, ${r.lastName}, ${r.companyName ?? null}, ${r.orgNumber ?? null}, ${r.email}, ${r.phone},
          ${r.address1}, ${r.address2 ?? null}, ${r.city}, ${r.state}, ${r.postalCode}, ${r.country}, ${account.id}::uuid)
        returning id
      `);
      const [row] = await tx.execute<Row>(sql`
        insert into commerce.domain_purchases (store_id, registrant_id, apex, kind, years, currency, amount_minor, registrar, cost, cost_currency, connect, chosen_by)
        values (${storeId}::uuid, ${String(made.id)}::uuid, ${quote.domain}, 'register', ${quote.years}, ${quote.currency}, ${quote.amountMinor},
          ${registrar.id}, ${quote.cost}, ${quote.costCurrency}, ${input.connect}, ${account.id}::uuid)
        returning *
      `);
      return toPurchase(row);
    });
    await audit(account.id, storeId, "store.domain_purchase_started", { domain: quote.domain, years: quote.years, amount: `${quote.currency} ${quote.amountMinor}` });
    return { ok: true, purchase, quote };
  } catch (error) {
    const cause = (error as { cause?: { constraint?: string; constraint_name?: string } })?.cause;
    if ([cause?.constraint, cause?.constraint_name].includes("domain_purchases_open_idx")) return { ok: false, problems: [`${quote.domain} is already being bought.`] };
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Invoicing
// ---------------------------------------------------------------------------

export type DomainBillingDeps = {
  mode?: PaymentModeName;
  stripe?: ThemeBillingStripe & { creditNotes?: Pick<Stripe["creditNotes"], "create"> };
  taxRates?: (country: string | null) => Promise<string[]>;
  account?: (storeId: string, mode: PaymentModeName) => Promise<string | null>;
  registrar?: (id: string) => DomainRegistrar | null;
  connect?: typeof connectOwnedDomain;
  now?: () => Date;
};

class BillingProblem extends Error {}

/** Takes one purchase in `status` no other run holds and that is due a try. */
async function claim(statuses: readonly PurchaseStatus[], storeId?: string): Promise<Row | null> {
  const list = sql.join(statuses.map((s) => sql`${s}`), sql`, `);
  const [row] = await db().execute<Row>(sql`
    update commerce.domain_purchases set claimed_until = now() + interval '3 minutes', tries = tries + 1, updated_at = now()
     where id = (
       select p.id from commerce.domain_purchases p
        where p.status in (${list}) and (p.claimed_until is null or p.claimed_until < now()) and (p.next_try_at is null or p.next_try_at <= now())
          ${storeId && isUuid(storeId) ? sql`and p.store_id = ${storeId}::uuid` : sql``}
        order by p.created_at limit 1
        for update of p skip locked)
    returning *
  `);
  return row ?? null;
}

async function later(id: string, tries: number, problem: string): Promise<void> {
  await db().execute(sql`
    update commerce.domain_purchases set problem = ${problem.slice(0, 500)}, claimed_until = null,
      next_try_at = now() + ${`${nextTryDelayMs(tries)} milliseconds`}::interval, updated_at = now()
     where id = ${id}::uuid
  `);
}

const stripeWords = (error: unknown) => (error instanceof Stripe.errors.StripeError ? error.message : "Stripe could not be reached.");

/**
 * Invoices quoted purchases, a few a run: one Stripe invoice on Kaizena Flow's account to the store's account, with VAT as on its plan, paid
 * at once by the plan's card when there is one, otherwise sent to pay (registration waits for it). Safe to repeat. Never throws.
 */
export async function chargeDomainPurchases(scope: { storeId?: string; limit?: number } = {}, deps: DomainBillingDeps = {}): Promise<{ invoiced: number; failed: number }> {
  const mode = deps.mode ?? billingMode();
  const stripe = deps.stripe ?? (mode ? (platformStripe(mode) as unknown as ThemeBillingStripe) : null);
  if (!mode || !stripe) return { invoiced: 0, failed: 0 };
  let invoiced = 0;
  let failed = 0;
  for (let n = 0; n < (scope.limit ?? 10); n++) {
    const row = await claim(["quoted"], scope.storeId).catch(() => null);
    if (!row) break;
    try {
      await invoiceOne(row, mode, stripe, deps);
      invoiced++;
    } catch (error) {
      failed++;
      await later(String(row.id), Number(row.tries), error instanceof BillingProblem ? error.message : stripeWords(error)).catch(() => {});
    }
  }
  return { invoiced, failed };
}

async function invoiceOne(row: Row, mode: PaymentModeName, stripe: ThemeBillingStripe, deps: DomainBillingDeps): Promise<void> {
  const id = String(row.id);
  const storeId = String(row.store_id);
  const [facts] = await db().execute<Row>(sql`select s.name, s.country from commerce.stores s where s.id = ${storeId}::uuid`);
  if (!facts) throw new BillingProblem("The store no longer exists.");
  const account = await (deps.account ?? billedAccount)(storeId, mode);
  if (!account) throw new BillingProblem("The store has no Stripe account to bill yet, and one could not be made.");
  const currency = String(row.currency).trim().toLowerCase();
  const amount = Number(row.amount_minor);
  const label = `${row.kind === "renew" ? "Renewal" : "Domain"} ${String(row.apex)}, ${Number(row.years)} ${Number(row.years) === 1 ? "year" : "years"}`;
  const metadata = { kaizen_store_id: storeId, kaizen_domain_purchase: id };
  let invoiceId = row.stripe_invoice_id ? String(row.stripe_invoice_id) : null;
  if (!invoiceId) {
    const { card } = await collectionFor(storeId, mode, stripe);
    const taxRates = await (deps.taxRates ?? ((country) => billingTaxRates(stripe as unknown as Stripe, mode, country)))(facts.country ? String(facts.country) : null);
    const made = await stripe.invoices.create(
      {
        customer_account: account,
        currency,
        ...(card ? { collection_method: "charge_automatically", default_payment_method: card } : { collection_method: "send_invoice", days_until_due: 7 }),
        pending_invoice_items_behavior: "exclude",
        auto_advance: false,
        ...(taxRates.length > 0 && { default_tax_rates: taxRates }),
        description: `Kaizena Flow: ${label} for ${String(facts.name)}. The domain is registered once this is paid.`,
        metadata,
      },
      { idempotencyKey: `kaizen-domain-invoice-${id}` },
    );
    invoiceId = made.id ?? null;
    if (!invoiceId) throw new BillingProblem("Stripe made no invoice.");
    await db().execute(sql`
      update commerce.domain_purchases set stripe_invoice_id = ${invoiceId}, mode = ${mode}, collection = ${card ? "card" : "invoice"}, updated_at = now()
       where id = ${id}::uuid and stripe_invoice_id is null
    `);
  }
  let invoice = await stripe.invoices.retrieve(invoiceId);
  if (invoice.status === "draft") {
    const items = await stripe.invoiceItems.list({ invoice: invoiceId, limit: 10 });
    if (!items.data.some((item) => item.metadata?.kaizen_domain_purchase === id)) {
      await stripe.invoiceItems.create({ customer_account: account, invoice: invoiceId, amount, currency, description: label, metadata }, { idempotencyKey: `kaizen-domain-item-${id}` });
    }
    invoice = await stripe.invoices.finalizeInvoice(invoiceId, { auto_advance: true });
    if (invoice.status === "open" && invoice.collection_method === "charge_automatically") {
      try {
        invoice = await stripe.invoices.pay(invoiceId);
      } catch {
        // A refused card leaves the invoice open: Stripe tries again and tells the store, as for its plan.
      }
    }
  }
  await db().execute(sql`
    update commerce.domain_purchases set status = 'invoiced', invoiced_at = now(), invoice_number = ${invoice.number ?? null},
      invoice_url = ${invoice.hosted_invoice_url ?? null}, problem = null, claimed_until = null, next_try_at = null, updated_at = now()
     where id = ${id}::uuid and status = 'quoted'
  `);
  if (invoice.status === "paid") await settlePaid(invoice as unknown as DomainInvoice, Math.floor(Date.now() / 1000));
  await audit(null, storeId, "store.domain_invoiced", { purchase: id, invoice: invoiceId, status: invoice.status });
}

type DomainInvoice = InvoiceShape & { id: string; metadata?: Record<string, string> | null; hosted_invoice_url?: string | null; number?: string | null };

const purchaseOf = (invoice: { metadata?: Record<string, string> | null }): string | null => {
  const id = invoice.metadata?.kaizen_domain_purchase;
  return id && isUuid(id) ? id : null;
};

async function settlePaid(invoice: DomainInvoice, eventCreated: number): Promise<boolean> {
  const id = purchaseOf(invoice);
  if (!id) return false;
  const paidAt = invoicePaidAt(invoice, eventCreated).toISOString();
  await db().execute(sql`
    update commerce.domain_purchases set status = 'invoiced', invoiced_at = coalesce(invoiced_at, now()), stripe_invoice_id = ${invoice.id}, updated_at = now()
     where id = ${id}::uuid and status = 'quoted' and (stripe_invoice_id is null or stripe_invoice_id = ${invoice.id})
  `);
  const rows = await db().execute<Row>(sql`
    update commerce.domain_purchases set status = 'paid', paid_at = ${paidAt}::timestamptz, next_try_at = null, claimed_until = null,
      invoice_url = coalesce(${invoice.hosted_invoice_url ?? null}, invoice_url), invoice_number = coalesce(${invoice.number ?? null}, invoice_number), updated_at = now()
     where id = ${id}::uuid and stripe_invoice_id = ${invoice.id} and status = 'invoiced'
    returning id
  `);
  return rows.length > 0;
}

/**
 * The billing webhook's invoice events for domain purchases (`/api/stripe/billing/{mode}`): paid (the registration follows) and voided.
 * Other invoices are left alone. Safe to repeat.
 */
export async function applyDomainInvoiceEvent(event: Stripe.Event): Promise<{ handled: boolean; detail?: string }> {
  if (event.type !== "invoice.paid" && event.type !== "invoice.voided") return { handled: false };
  const invoice = event.data.object as unknown as DomainInvoice;
  const id = purchaseOf(invoice);
  if (!id) return { handled: false };
  if (event.type === "invoice.paid") return { handled: true, detail: (await settlePaid(invoice, event.created)) ? "domain paid" : "domain known" };
  const rows = await db().execute<Row>(sql`
    update commerce.domain_purchases set status = 'void', updated_at = now() where id = ${id}::uuid and status in ('quoted', 'invoiced') returning id
  `);
  return { handled: true, detail: rows.length ? "domain void" : "domain known" };
}

// ---------------------------------------------------------------------------
// Registering what is paid
// ---------------------------------------------------------------------------

/**
 * Registers paid purchases and follows the registrar's orders, a few a run: a paid `register` is bought at the registrar with the price it
 * was quoted at as the most it may cost, then followed until done; a `renew` renews. Done: the registration is kept, its DNS zone recorded,
 * and the store connected when asked. A registration that cannot be made fails and is refunded. Never throws.
 */
export async function registerPaidDomains(scope: { storeId?: string; limit?: number } = {}, deps: DomainBillingDeps = {}): Promise<{ done: number; failed: number }> {
  let done = 0;
  let failed = 0;
  for (let n = 0; n < (scope.limit ?? 10); n++) {
    const row = await claim(["paid", "registering"], scope.storeId).catch(() => null);
    if (!row) break;
    try {
      const outcome = await registerOne(row, deps);
      if (outcome === "done") done++;
      if (outcome === "failed") failed++;
    } catch (error) {
      await later(String(row.id), Number(row.tries), error instanceof RegistrarError ? `The registrar: ${error.message}` : "The registration could not be followed up; it is tried again.").catch(() => {});
    }
  }
  await refundFailed(deps).catch(() => {});
  return { done, failed };
}

async function fail(id: string, problem: string): Promise<"failed"> {
  await db().execute(sql`
    update commerce.domain_purchases set status = 'failed', problem = ${problem.slice(0, 500)}, claimed_until = null, next_try_at = null, updated_at = now()
     where id = ${id}::uuid and status in ('paid', 'registering')
  `);
  return "failed";
}

async function registerOne(row: Row, deps: DomainBillingDeps): Promise<"done" | "failed" | "waiting"> {
  const id = String(row.id);
  const storeId = String(row.store_id);
  const apex = String(row.apex);
  if (row.mode === "test") return fail(id, "A test payment: nothing is registered with test money, so it is refunded.");
  const registrar = (deps.registrar ?? registrarById)(String(row.registrar));
  if (!registrar) return fail(id, "The registrar for this name is no longer offered.");
  const years = Number(row.years);
  const cost = Number(row.cost);

  if (row.kind === "renew") {
    await registrar.renew(apex, { years, expectedPrice: cost });
    const info = await registrar.domain(apex).catch(() => null);
    await db().transaction(async (tx) => {
      await tx.execute(sql`
        update commerce.domain_registrations set expires_at = coalesce(${info?.expiresAt ?? null}::timestamptz, expires_at + make_interval(years => ${years})),
          status = 'active', updated_at = now()
         where store_id = ${storeId}::uuid and apex = ${apex} and status <> 'transferred_out'
      `);
      await tx.execute(sql`
        update commerce.domain_purchases set status = 'done', done_at = now(), problem = null, claimed_until = null, next_try_at = null, updated_at = now()
         where id = ${id}::uuid and status = 'paid'
      `);
    });
    await audit(null, storeId, "store.domain_renewed", { domain: apex, years });
    return "done";
  }

  if (row.status === "paid") {
    if (!(await registrar.available(apex))) return fail(id, `${apex} was taken before it could be registered, so the payment is refunded.`);
    const [registrant] = await db().execute<Row>(sql`select * from commerce.domain_registrants where id = ${String(row.registrant_id)}::uuid`);
    if (!registrant) return fail(id, "The registrant's details are missing.");
    const contact = registrarContact(
      registrantInput.parse({
        kind: registrant.kind,
        firstName: registrant.first_name,
        lastName: registrant.last_name,
        companyName: registrant.company_name ?? undefined,
        orgNumber: registrant.org_number ?? undefined,
        email: registrant.email,
        phone: registrant.phone,
        address1: registrant.address1,
        address2: registrant.address2 ?? undefined,
        city: registrant.city,
        state: registrant.state ?? "",
        postalCode: registrant.postal_code,
        country: String(registrant.country),
      }) as RegistrantInput,
    );
    let orderId: string;
    try {
      ({ orderId } = await registrar.buy(apex, { years, expectedPrice: cost, autoRenew: true, contact }));
    } catch (error) {
      // A refusal for the name or the price is final; anything else is tried again.
      if (error instanceof RegistrarError && error.status !== null && error.status >= 400 && error.status < 500 && error.status !== 429) {
        return fail(id, `The registrar refused it: ${error.message}`);
      }
      throw error;
    }
    await db().execute(sql`
      update commerce.domain_purchases set status = 'registering', registrar_order_id = ${orderId}, claimed_until = null,
        next_try_at = now() + interval '20 seconds', updated_at = now()
       where id = ${id}::uuid and status = 'paid'
    `);
    return "waiting";
  }

  const order = await registrar.order(String(row.registrar_order_id));
  if (order.status === "failed") return fail(id, `The registrar couldn't register it${order.error ? ` (${order.error})` : ""}, so the payment is refunded.`);
  if (order.status !== "completed") {
    await db().execute(sql`update commerce.domain_purchases set claimed_until = null, next_try_at = now() + interval '30 seconds', updated_at = now() where id = ${id}::uuid`);
    return "waiting";
  }
  const info = await registrar.domain(apex).catch(() => null);
  const registration = await db().transaction(async (tx) => {
    const [reg] = await tx.execute<Row>(sql`
      insert into commerce.domain_registrations (store_id, apex, registrar, status, registrant_id, registered_at, expires_at, renew, registrar_renews, created_by)
      values (${storeId}::uuid, ${apex}, ${registrar.id}, 'active', ${row.registrant_id ? String(row.registrant_id) : null}::uuid, now(),
        coalesce(${info?.expiresAt ?? null}::timestamptz, now() + make_interval(years => ${years})), true, true, ${row.chosen_by ? String(row.chosen_by) : null}::uuid)
      returning *
    `);
    // Bought through Vercel, the domain is on Vercel's nameservers in Kaizena Flow's team: its DNS is kept here.
    await tx.execute(sql`
      insert into commerce.dns_zones (store_id, apex, created_by) values (${storeId}::uuid, ${apex}, ${row.chosen_by ? String(row.chosen_by) : null}::uuid)
      on conflict do nothing
    `);
    await tx.execute(sql`
      update commerce.domain_purchases set status = 'done', done_at = now(), registration_id = ${String(reg.id)}::uuid, problem = null,
        claimed_until = null, next_try_at = null, updated_at = now()
       where id = ${id}::uuid and status = 'registering'
    `);
    return toRegistration(reg);
  });
  await audit(null, storeId, "store.domain_registered", { domain: apex, years, registration: registration.id });
  if (row.connect === true) {
    const connected = await (deps.connect ?? connectOwnedDomain)(null, storeId, apex);
    if (!connected.ok) await audit(null, storeId, "store.domain_connect_failed", { domain: apex, problem: connected.problems.join(" ").slice(0, 300) });
  }
  return "done";
}

/** Refunds failed purchases whose invoice was paid: a credit note for the whole invoice, refunded to how it was paid. */
async function refundFailed(deps: DomainBillingDeps): Promise<void> {
  const rows = await db().execute<Row>(sql`
    select id, store_id, stripe_invoice_id, mode from commerce.domain_purchases
     where status = 'failed' and stripe_invoice_id is not null and (next_try_at is null or next_try_at <= now()) limit 10
  `);
  for (const row of rows) {
    const mode = String(row.mode) as PaymentModeName;
    const stripe = (deps.stripe ?? platformStripe(mode)) as (ThemeBillingStripe & { creditNotes?: Pick<Stripe["creditNotes"], "create"> }) | null;
    if (!stripe?.creditNotes) continue;
    try {
      const invoice = await stripe.invoices.retrieve(String(row.stripe_invoice_id), { expand: ["lines"] } as never);
      const line = (invoice as unknown as { lines?: { data?: { id: string }[] } }).lines?.data?.[0];
      // Only money Stripe holds is given back; an invoice not paid (yet) is looked at again later.
      if (invoice.status !== "paid" || !line) throw new Error("The invoice isn't paid in Stripe yet.");
      {
        await stripe.creditNotes.create(
          {
            invoice: invoice.id!,
            lines: [{ type: "invoice_line_item", invoice_line_item: line.id, quantity: 1 }],
            refund_amount: invoice.amount_paid,
            reason: "order_change",
          },
          { idempotencyKey: `kaizen-domain-refund-${String(row.id)}` },
        );
      }
      await db().execute(sql`update commerce.domain_purchases set status = 'refunded', updated_at = now() where id = ${String(row.id)}::uuid and status = 'failed'`);
      await audit(null, String(row.store_id), "store.domain_refunded", { purchase: String(row.id) });
    } catch (error) {
      await db().execute(sql`
        update commerce.domain_purchases set next_try_at = now() + interval '1 hour', problem = ${`Refund: ${error instanceof Stripe.errors.StripeError ? error.message : error instanceof Error ? error.message : "Stripe could not be reached."}`.slice(0, 500)}, updated_at = now()
         where id = ${String(row.id)}::uuid
      `);
    }
  }
}

// ---------------------------------------------------------------------------
// Renewal (docs/domains.md 9.1)
// ---------------------------------------------------------------------------

/** Days before expiry a renewal is invoiced, and before which an unpaid one turns the registrar's auto-renew off (decision 4). */
export const RENEW_AHEAD_DAYS = 30;
export const UNPAID_CUTOFF_DAYS = 3;

/**
 * Daily renewal work: a registration that renews and expires within 30 days gets a renewal purchase at today's price (invoiced like the
 * first); one still unpaid three days before expiry, or whose owner turned renewal off, has the registrar's auto-renew turned off so nothing
 * is renewed unpaid. Never throws.
 */
export async function runDomainRenewals(deps: DomainBillingDeps = {}): Promise<{ quoted: number; stopped: number }> {
  let quoted = 0;
  let stopped = 0;
  const due = await db().execute<Row>(sql`
    select r.* from commerce.domain_registrations r join commerce.stores s on s.id = r.store_id
     where r.status = 'active' and r.renew and r.expires_at < now() + make_interval(days => ${RENEW_AHEAD_DAYS})
       and not exists (select 1 from commerce.domain_purchases p where p.apex = r.apex and p.kind = 'renew'
                        and p.created_at > r.expires_at - make_interval(days => ${RENEW_AHEAD_DAYS + 5}) and p.status not in ('void', 'failed', 'refunded'))
     limit 20
  `);
  for (const reg of due) {
    try {
      const registrar = (deps.registrar ?? registrarById)(String(reg.registrar));
      if (!registrar) continue;
      const q = await quoteWith(String(reg.store_id), registrar, String(reg.apex), 1);
      if (!q.ok) continue;
      // A renewal is priced at the registrar's renewal price, which `price()` gives as `renewal` for one year.
      const price = await registrar.price(String(reg.apex), 1);
      const ctx = await priceContext(q.quote.currency);
      const amount = ctx ? priceIn(ctx, price.renewal, price.currency, 1) : null;
      if (!amount) continue;
      await db().execute(sql`
        insert into commerce.domain_purchases (store_id, registration_id, registrant_id, apex, kind, years, currency, amount_minor, registrar, cost, cost_currency, connect)
        values (${String(reg.store_id)}::uuid, ${String(reg.id)}::uuid, ${reg.registrant_id ? String(reg.registrant_id) : null}::uuid, ${String(reg.apex)}, 'renew', 1,
          ${q.quote.currency}, ${amount}, ${registrar.id}, ${price.renewal}, ${price.currency}, false)
        on conflict do nothing
      `);
      quoted++;
    } catch {
      // Tried again tomorrow.
    }
  }
  const stop = await db().execute<Row>(sql`
    select r.id, r.apex, r.registrar from commerce.domain_registrations r
     where r.status = 'active' and r.registrar_renews
       and (not r.renew or (r.expires_at < now() + make_interval(days => ${UNPAID_CUTOFF_DAYS})
            and not exists (select 1 from commerce.domain_purchases p where p.apex = r.apex and p.kind = 'renew' and p.status in ('paid', 'registering', 'done')
                            and p.created_at > r.expires_at - make_interval(days => ${RENEW_AHEAD_DAYS + 5}))))
     limit 20
  `);
  for (const reg of stop) {
    try {
      const registrar = (deps.registrar ?? registrarById)(String(reg.registrar));
      await registrar?.setAutoRenew(String(reg.apex), false);
      await db().execute(sql`update commerce.domain_registrations set registrar_renews = false, updated_at = now() where id = ${String(reg.id)}::uuid`);
      stopped++;
    } catch {
      // Tried again tomorrow.
    }
  }
  // Expired registrations are marked so.
  await db().execute(sql`update commerce.domain_registrations set status = 'expired', updated_at = now() where status = 'active' and expires_at < now()`);
  return { quoted, stopped };
}

/** The owner turns renewal on or off (owners only, checked by the caller). On again also turns the registrar's auto-renew back on. */
export async function setDomainRenewal(account: Account, storeId: string, apex: string, renew: boolean, deps: DomainBillingDeps = {}): Promise<Result<{ registration: Registration }>> {
  const [row] = await db().execute<Row>(sql`
    update commerce.domain_registrations set renew = ${renew}, updated_at = now()
     where store_id = ${storeId}::uuid and apex = ${apex.toLowerCase()} and status in ('active', 'expired')
    returning *
  `);
  if (!row) return { ok: false, problems: ["That domain isn't registered by this store through Kaizena Flow."] };
  const registrar = (deps.registrar ?? registrarById)(String(row.registrar));
  try {
    if (renew && !row.registrar_renews) {
      await registrar?.setAutoRenew(apex, true);
      await db().execute(sql`update commerce.domain_registrations set registrar_renews = true where id = ${String(row.id)}::uuid`);
    }
    if (!renew && row.registrar_renews) {
      await registrar?.setAutoRenew(apex, false);
      await db().execute(sql`update commerce.domain_registrations set registrar_renews = false where id = ${String(row.id)}::uuid`);
    }
  } catch {
    // The daily run sets the registrar's switch from `renew` if this did not reach it.
  }
  await audit(account.id, storeId, "store.domain_renewal_set", { domain: apex, renew });
  return { ok: true, registration: toRegistration({ ...row, renew }) };
}

/** Starts a renewal now for `years` at today's renewal price, which the owner was shown (`agreed`), then invoices it. */
export async function renewDomainNow(account: Account, storeId: string, apex: string, years: number, agreed: string): Promise<Result<{ purchase: DomainPurchase }>> {
  const [reg] = await db().execute<Row>(sql`
    select * from commerce.domain_registrations where store_id = ${storeId}::uuid and apex = ${apex.toLowerCase()} and status in ('active', 'expired')
  `);
  if (!reg) return { ok: false, problems: ["That domain isn't registered by this store through Kaizena Flow."] };
  const offer = await renewalOffer(storeId, String(reg.apex), String(reg.registrar), years);
  if (!offer) return { ok: false, problems: ["The renewal can't be priced just now. Try again in a moment."] };
  if (agreed !== `${offer.currency}:${offer.amountMinor}`) return { ok: false, problems: [`The renewal is now ${formatMoney(offer.amountMinor, offer.currency, "en-GB")}. Look at it again to renew.`] };
  try {
    const [row] = await db().execute<Row>(sql`
      insert into commerce.domain_purchases (store_id, registration_id, registrant_id, apex, kind, years, currency, amount_minor, registrar, cost, cost_currency, connect, chosen_by)
      values (${storeId}::uuid, ${String(reg.id)}::uuid, ${reg.registrant_id ? String(reg.registrant_id) : null}::uuid, ${String(reg.apex)}, 'renew', ${years},
        ${offer.currency}, ${offer.amountMinor}, ${String(reg.registrar)}, ${offer.cost}, ${offer.costCurrency}, false, ${account.id}::uuid)
      returning *
    `);
    await audit(account.id, storeId, "store.domain_renewal_started", { domain: String(reg.apex), years });
    return { ok: true, purchase: toPurchase(row) };
  } catch {
    return { ok: false, problems: [`A renewal of ${String(reg.apex)} is already under way.`] };
  }
}

/** What renewing a registration for `years` costs now. */
export async function renewalOffer(storeId: string, apex: string, registrarId: string, years: number) {
  const registrar = registrarById(registrarId);
  if (!registrar) return null;
  const currency = await storeDomainCurrency(storeId, (await domainPricingRows()).map((p) => p.currency));
  const ctx = await priceContext(currency);
  if (!ctx || !currency) return null;
  const price = await registrar.price(apex, 1).catch(() => null);
  if (!price) return null;
  const cost = Math.round(price.renewal * years * 100) / 100;
  const amountMinor = priceIn(ctx, cost, price.currency, years);
  return amountMinor === null ? null : { currency, amountMinor, cost, costCurrency: price.currency };
}
