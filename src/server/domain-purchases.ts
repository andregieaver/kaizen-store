import "server-only";

import { sql } from "drizzle-orm";
import Stripe from "stripe";

import { db } from "@/db/client";
import { registrantInput, registrarContact, DOMAIN_YEARS, type RegistrantInput } from "@/lib/domain-registrant";
import { formatMoney } from "@/lib/money";
import type { PaymentModeName } from "@/lib/stripe-account";
import { invoicePaidAt, type InvoiceShape } from "@/lib/referral-billing";
import { nextTryDelayMs } from "@/lib/theme-prices";

import {
  CONSENT_TEXT,
  currencyForCountry,
  nameNeedsReview,
  newAccountRoom,
  NEW_ACCOUNT_DAYS,
  NEW_ACCOUNT_DOMAINS,
  vatFor,
  VAT_PROBLEM_TEXT,
  type BuyerKind,
  type VatKind,
} from "@/lib/domain-buyer";

import { audit, type Account } from "./auth";
import { billingMode, billingTaxRates } from "./billing";
import { connectOwnedDomain } from "./domains";
import { accountHolder, heldBy, holderColumns, storeOf, type HolderRef } from "./domain-holder";
import { domainPricingRows, priceContext, priceIn, storeDomainCurrency } from "./domain-prices";
import { toRegistration, type Registration } from "./domain-registrations";
import { checkVatNumber } from "./vies";
import { limitRefusal } from "@/lib/usage-format";
import { decryptSecret, encryptSecret, parseKey } from "@/lib/secret-box";

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
  kind: "register" | "renew" | "transfer";
  years: number;
  status: PurchaseStatus;
  currency: string;
  amountMinor: number;
  invoiceUrl: string | null;
  problem: string | null;
  /** Waiting for a platform admin's yes before the registrar is asked (D317 10), until it is given. */
  inReview: boolean;
  createdAt: string;
};

const toPurchase = (r: Row): DomainPurchase => ({
  id: String(r.id),
  apex: String(r.apex),
  kind: r.kind === "renew" ? "renew" : r.kind === "transfer" ? "transfer" : "register",
  years: Number(r.years),
  status: String(r.status) as PurchaseStatus,
  currency: String(r.currency).trim(),
  amountMinor: Number(r.amount_minor),
  invoiceUrl: r.invoice_url ? String(r.invoice_url) : null,
  problem: r.problem ? String(r.problem) : null,
  inReview: r.review != null && r.review_outcome == null,
  createdAt: new Date(String(r.created_at)).toISOString(),
});

/** The holder's purchases still under way, and the last few finished, newest first. */
export async function storeDomainPurchases(holder: HolderRef): Promise<DomainPurchase[]> {
  const rows = await db().execute<Row>(sql`
    select * from commerce.domain_purchases where ${heldBy(holder)}
     order by (status in ('quoted', 'invoiced', 'paid', 'registering')) desc, created_at desc limit 20
  `);
  return rows.map(toPurchase);
}

// ---------------------------------------------------------------------------
// Quoting
// ---------------------------------------------------------------------------

export type Quote = { domain: string; years: number; currency: string; amountMinor: number; renewalMinor: number | null; cost: number; costCurrency: string };

/** Who is buying, for a purchase made without a store (D317): consumer or business, their country, a business's VAT number. */
export type BuyerInput = { kind: BuyerKind; country: string; vatNumber?: string | null };

/** The currency a holder pays in: a store's (its plan's, else its country's), an account's by the buyer's country (D317 6). */
async function holderCurrency(holder: HolderRef, priced: readonly string[], country?: string | null): Promise<string | null> {
  const storeId = storeOf(holder);
  if (storeId) return storeDomainCurrency(storeId, priced);
  return currencyForCountry(country ?? "NO", priced);
}

/**
 * What a name costs now for `years`, read live from its registrar: refused when it is taken, premium, not sold, or the holder's currency
 * cannot be priced. The quote is what the buy button names, without VAT (a consumer's price with VAT is `withVat()` of it).
 */
export async function quoteDomain(holder: HolderRef, domain: string, years: number, opts: { country?: string | null } = {}): Promise<Result<{ quote: Quote }>> {
  const name = domain.trim().toLowerCase().replace(/\.$/, "");
  if (!(DOMAIN_YEARS as readonly number[]).includes(years)) return { ok: false, problems: ["Choose 1, 2, 3 or 5 years."] };
  const registrar = await registrarFor(name);
  if (!registrar) return { ok: false, problems: [`Kaizena Flow doesn't sell names ending in .${name.split(".").slice(1).join(".")} yet.`] };
  const [found] = await registrar.search([name]).catch(() => []);
  if (!found) return { ok: false, problems: ["The registrar can't be reached just now. Try again in a moment."] };
  if (!found.available) return { ok: false, problems: [`${name} is taken.`] };
  if (found.premium) return { ok: false, problems: [`${name} is a premium name, priced by its registry, which Kaizena Flow doesn't sell.`] };
  return quoteWith(holder, registrar, name, years, opts.country);
}

async function quoteWith(holder: HolderRef, registrar: DomainRegistrar, name: string, years: number, country?: string | null): Promise<Result<{ quote: Quote }>> {
  const priced = (await domainPricingRows()).map((p) => p.currency);
  const currency = await holderCurrency(holder, priced, country);
  const ctx = await priceContext(currency);
  if (!ctx || !currency) return { ok: false, problems: ["Domains can't be priced in your currency yet."] };
  let price;
  try {
    price = await registrar.price(name, years);
  } catch (error) {
    return { ok: false, problems: [error instanceof RegistrarError ? error.message : "The registrar can't be reached just now."] };
  }
  const amountMinor = priceIn(ctx, price.purchase, price.currency, years);
  if (amountMinor === null) return { ok: false, problems: ["Domains can't be priced in your currency yet."] };
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
  /** Connect the store to it once registered (the default); never for a domain bought without a store. */
  connect: boolean;
  registrant: unknown;
  /** Without a store (D317): who buys, and a consumer's consent that registration starts at once (`CONSENT_TEXT`), in their language. */
  buyer?: BuyerInput;
  consent?: { given: boolean; lang: "en" | "nb" };
};

/**
 * Whether buying is open: for a store, to every store once moving away is built (decision 9), until then where a platform admin opened it;
 * for an account without a store, while the platform sells domains to the public (D317, `platform_settings.domains_public`).
 */
/** Whether Kaizena Flow sells domains to people without a store (D317, Platform → Domains). */
export async function domainsPublic(): Promise<boolean> {
  const [row] = await db().execute<Row>(sql`select coalesce((select domains_public from commerce.platform_settings limit 1), false) as open`);
  return row?.open === true;
}

export async function buyingOpen(holder: HolderRef): Promise<boolean> {
  const storeId = storeOf(holder);
  if (!storeId) return domainsPublic();
  const [row] = await db().execute<Row>(sql`
    select coalesce((select domains_open from commerce.platform_settings limit 1), false) or s.domain_buying as open
      from commerce.stores s where s.id = ${storeId}::uuid
  `);
  return row?.open === true;
}

type Terms = { buyer: BuyerKind | null; vatKind: VatKind | null; vatNumber: string | null; consentAt: boolean; consentText: string | null };

/**
 * The checks before a purchase or transfer starts, by holder. A store: open, buying open, the plan's room when it will be connected. An
 * account (D317): buying open to the public, the new-account limit, who buys and the VAT the invoice will carry (decision 1), a business's
 * VAT number checked with VIES (refused when VIES says it is invalid; when VIES can't answer, the purchase waits for a person), a consumer's
 * express consent.
 */
async function gate(account: Account, holder: HolderRef, input: { connect: boolean; domain: string; buyer?: BuyerInput; consent?: BuyInput["consent"] }, deps: GateDeps): Promise<Result<{ terms: Terms; review: "name" | "risk" | null }>> {
  const storeId = storeOf(holder);
  if (storeId) {
    const [store] = await db().execute<Row>(sql`select status, is_template, starter from commerce.stores where id = ${storeId}::uuid`);
    if (!store || store.status !== "active" || store.is_template || store.starter) return { ok: false, problems: ["Domains can be bought for an open store only."] };
    if (!(await buyingOpen(storeId))) return { ok: false, problems: ["Buying domains isn't open for this store yet."] };
    if (input.connect) {
      const [connected] = await db().execute<Row>(sql`select 1 as on from commerce.store_domains where store_id = ${storeId}::uuid and hostname = ${input.domain}`);
      if (!connected) {
        const room = await checkLimit(storeId, "custom_domains");
        if (!room.ok) return { ok: false, problems: [limitRefusal("custom_domains", room.limit)] };
      }
    }
    return { ok: true, terms: { buyer: null, vatKind: null, vatNumber: null, consentAt: false, consentText: null }, review: null };
  }
  if (!(await buyingOpen(holder))) return { ok: false, problems: ["Kaizena Flow doesn't sell domains on their own yet."] };
  const [facts] = await db().execute<Row>(sql`
    select a.created_at,
           (select count(*)::int from commerce.domain_purchases p where p.account_id = a.id and p.store_id is null and p.kind <> 'renew'
              and p.status not in ('void', 'failed', 'refunded')) as bought,
           exists (select 1 from commerce.domain_purchases p where p.account_id = a.id and p.kind = 'renew' and p.status = 'done')
             or exists (select 1 from commerce.store_members m where m.account_id = a.id and m.role = 'owner' and m.disabled_at is null) as trusted
      from commerce.accounts a where a.id = ${account.id}::uuid
  `);
  if (!facts) return { ok: false, problems: ["That account is gone."] };
  if (!newAccountRoom({ createdAt: new Date(String(facts.created_at)), bought: Number(facts.bought), renewedOrStore: facts.trusted === true }, deps.now?.() ?? new Date())) {
    return { ok: false, problems: [`A new account can hold ${NEW_ACCOUNT_DOMAINS} domains bought here in its first ${NEW_ACCOUNT_DAYS} days. Write to Kaizena Flow's support for more.`] };
  }
  if (!input.buyer) return { ok: false, problems: ["Say whether you buy as a private person or a business."] };
  const vat = vatFor(input.buyer);
  if (!vat.ok) return { ok: false, problems: [VAT_PROBLEM_TEXT[vat.problem]] };
  let review: "name" | "risk" | null = nameNeedsReview(input.domain) ? "name" : null;
  if (vat.vatKind === "reverse_charge" && vat.vatNumber) {
    const answer = await (deps.vies ?? checkVatNumber)(vat.vatNumber);
    if (answer.status === "invalid") return { ok: false, problems: ["The EU's VAT register (VIES) says that VAT number isn't valid."] };
    if (answer.status !== "valid") review ??= "risk";
  }
  const consumer = input.buyer.kind === "consumer";
  if (consumer && !input.consent?.given) return { ok: false, problems: ["Tick the box to ask for the registration to start once it is paid."] };
  return {
    ok: true,
    terms: {
      buyer: input.buyer.kind,
      vatKind: vat.vatKind,
      vatNumber: vat.vatNumber,
      consentAt: consumer,
      consentText: consumer ? CONSENT_TEXT[input.consent?.lang ?? "en"] : null,
    },
    review,
  };
}

export type GateDeps = { vies?: (number: string) => Promise<{ status: string }>; now?: () => Date };

/** Makes the registrant and the purchase in one transaction, held by `holder`. */
async function begin(
  account: Account,
  holder: HolderRef,
  kind: "register" | "transfer",
  quote: Quote,
  registrant: RegistrantInput,
  extra: { connect: boolean; terms: Terms; review: "name" | "risk" | null; authCodeBox?: string },
): Promise<DomainPurchase> {
  const who = await holderColumns(holder, account.id);
  const t = extra.terms;
  return db().transaction(async (tx) => {
    const r = registrant;
    const [made] = await tx.execute<Row>(sql`
      insert into commerce.domain_registrants (store_id, account_id, kind, first_name, last_name, company_name, org_number, email, phone, address1, address2, city, state, postal_code, country, created_by)
      values (${who.storeId}::uuid, ${who.accountId}::uuid, ${r.kind}, ${r.firstName}, ${r.lastName}, ${r.companyName ?? null}, ${r.orgNumber ?? null}, ${r.email}, ${r.phone},
        ${r.address1}, ${r.address2 ?? null}, ${r.city}, ${r.state}, ${r.postalCode}, ${r.country}, ${account.id}::uuid)
      returning id
    `);
    const [row] = await tx.execute<Row>(sql`
      insert into commerce.domain_purchases (store_id, account_id, registrant_id, apex, kind, years, currency, amount_minor, registrar, cost, cost_currency, connect,
        chosen_by, auth_code_box, buyer, vat_kind, vat_number, consent_at, consent_text, review)
      values (${who.storeId}::uuid, ${who.accountId}::uuid, ${String(made.id)}::uuid, ${quote.domain}, ${kind}, ${quote.years}, ${quote.currency}, ${quote.amountMinor},
        ${(await registrarFor(quote.domain))!.id}, ${quote.cost}, ${quote.costCurrency}, ${who.storeId ? extra.connect : false}, ${account.id}::uuid,
        ${extra.authCodeBox ?? null}, ${t.buyer}, ${t.vatKind}, ${t.vatNumber}, ${t.consentAt ? sql`now()` : sql`null`}, ${t.consentText}, ${extra.review})
      returning *
    `);
    return toPurchase(row);
  });
}

const duplicate = (error: unknown) => {
  const cause = (error as { cause?: { constraint?: string; constraint_name?: string } })?.cause;
  return [cause?.constraint, cause?.constraint_name].includes("domain_purchases_open_idx");
};

/**
 * Starts buying a name: the owner's or the holder's own (the caller checks), past `gate()`, the price the same as the one named, the
 * registrant complete. Makes the registrant and the purchase, then invoices it (`chargeDomainPurchases()`, run by the caller).
 */
export async function startDomainPurchase(account: Account, holder: HolderRef, input: BuyInput, deps: GateDeps = {}): Promise<Result<{ purchase: DomainPurchase; quote: Quote }>> {
  const registrant = registrantInput.safeParse(input.registrant);
  if (!registrant.success) return { ok: false, problems: [...new Set(registrant.error.issues.map((i) => i.message))] };
  const domain = input.domain.trim().toLowerCase().replace(/\.$/, "");
  const checked = await gate(account, holder, { connect: input.connect, domain, buyer: input.buyer, consent: input.consent }, deps);
  if (!checked.ok) return checked;
  const quoted = await quoteDomain(holder, domain, input.years, { country: input.buyer?.country });
  if (!quoted.ok) return quoted;
  const { quote } = quoted;
  if (input.agreed !== `${quote.currency}:${quote.amountMinor}`) {
    return { ok: false, problems: [`The price is now ${formatMoney(quote.amountMinor, quote.currency, "en-GB")}. Look at it again and confirm to buy.`] };
  }
  try {
    const purchase = await begin(account, holder, "register", quote, registrant.data as RegistrantInput, { connect: input.connect, terms: checked.terms, review: checked.review });
    await audit(account.id, storeOf(holder), "store.domain_purchase_started", { domain: quote.domain, years: quote.years, amount: `${quote.currency} ${quote.amountMinor}` });
    return { ok: true, purchase, quote };
  } catch (error) {
    if (duplicate(error)) return { ok: false, problems: [`${quote.domain} is already being bought.`] };
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Transferring in (docs/domains.md 8.5)
// ---------------------------------------------------------------------------

/** A transfer code as registrars give them: printable, no spaces, 4 to 64 characters. */
const AUTH_CODE = /^[\x21-\x7e]{4,64}$/;

/**
 * What moving a name here costs now: refused for a name nobody holds (buy it instead), one already registered here, an ending not sold, or a
 * currency that can't be priced. A transfer adds a year to the registration, so the price is the registrar's transfer price.
 */
export async function quoteTransfer(holder: HolderRef, domain: string, opts: { country?: string | null } = {}): Promise<Result<{ quote: Quote }>> {
  const name = domain.trim().toLowerCase().replace(/\.$/, "");
  const registrar = await registrarFor(name);
  if (!registrar) return { ok: false, problems: [`Kaizena Flow can't hold names ending in .${name.split(".").slice(1).join(".")} yet.`] };
  const [held] = await db().execute<Row>(sql`select 1 as held from commerce.domain_registrations where apex = ${name} and status <> 'transferred_out'`);
  if (held) return { ok: false, problems: [`${name} is registered through Kaizena Flow already.`] };
  let free: boolean;
  try {
    free = await registrar.available(name);
  } catch {
    return { ok: false, problems: ["The registrar can't be reached just now. Try again in a moment."] };
  }
  if (free) return { ok: false, problems: [`Nobody has registered ${name}: buy it instead.`] };
  const priced = (await domainPricingRows()).map((p) => p.currency);
  const currency = await holderCurrency(holder, priced, opts.country);
  const ctx = await priceContext(currency);
  if (!ctx || !currency) return { ok: false, problems: ["Domains can't be priced in your currency yet."] };
  let price;
  try {
    price = await registrar.price(name, 1);
  } catch (error) {
    return { ok: false, problems: [error instanceof RegistrarError ? error.message : "The registrar can't be reached just now."] };
  }
  if (price.transfer === null) return { ok: false, problems: [`${name} can't be moved to Kaizena Flow's registrar.`] };
  const amountMinor = priceIn(ctx, price.transfer, price.currency, 1);
  if (amountMinor === null) return { ok: false, problems: ["Domains can't be priced in your currency yet."] };
  return { ok: true, quote: { domain: name, years: 1, currency, amountMinor, renewalMinor: priceIn(ctx, price.renewal, price.currency, 1), cost: price.transfer, costCurrency: price.currency } };
}

export type TransferInput = { domain: string; authCode: string; agreed: string; connect: boolean; registrant: unknown; buyer?: BuyerInput; consent?: BuyInput["consent"] };

/**
 * Starts moving a name here (D315 8.5), as buying does, past `gate()`, the price the one named. The code from the current registrar is kept
 * encrypted only until the transfer is handed over, and nowhere else; nothing is asked of the registrar before the invoice is paid.
 */
export async function startDomainTransfer(account: Account, holder: HolderRef, input: TransferInput, deps: GateDeps = {}): Promise<Result<{ purchase: DomainPurchase; quote: Quote }>> {
  const code = input.authCode.trim();
  if (!AUTH_CODE.test(code)) return { ok: false, problems: ["Paste the transfer code exactly as your current registrar gave it."] };
  const key = parseKey(process.env.SETTINGS_ENCRYPTION_KEY);
  if (!key) return { ok: false, problems: ["Transfers can't be taken just now."] };
  const registrant = registrantInput.safeParse(input.registrant);
  if (!registrant.success) return { ok: false, problems: [...new Set(registrant.error.issues.map((i) => i.message))] };
  const domain = input.domain.trim().toLowerCase().replace(/\.$/, "");
  const checked = await gate(account, holder, { connect: input.connect, domain, buyer: input.buyer, consent: input.consent }, deps);
  if (!checked.ok) return checked;
  const quoted = await quoteTransfer(holder, domain, { country: input.buyer?.country });
  if (!quoted.ok) return quoted;
  const { quote } = quoted;
  if (input.agreed !== `${quote.currency}:${quote.amountMinor}`) {
    return { ok: false, problems: [`The price is now ${formatMoney(quote.amountMinor, quote.currency, "en-GB")}. Look at it again and confirm to move it.`] };
  }
  try {
    const purchase = await begin(account, holder, "transfer", quote, registrant.data as RegistrantInput, {
      connect: input.connect,
      terms: checked.terms,
      review: checked.review,
      authCodeBox: encryptSecret(code, key),
    });
    await audit(account.id, storeOf(holder), "store.domain_transfer_requested", { domain: quote.domain, amount: `${quote.currency} ${quote.amountMinor}` });
    return { ok: true, purchase, quote };
  } catch (error) {
    if (duplicate(error)) return { ok: false, problems: [`${quote.domain} is already on its way here.`] };
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
  /** An account's Stripe customer on Kaizena Flow's account, for a domain held without a store (D317), made when missing. */
  customer?: (accountId: string, mode: PaymentModeName) => Promise<string | null>;
  registrar?: (id: string) => DomainRegistrar | null;
  connect?: typeof connectOwnedDomain;
  now?: () => Date;
};

class BillingProblem extends Error {}

/** Takes one purchase in `status` no other run holds and that is due a try. */
async function claim(statuses: readonly PurchaseStatus[], storeId?: string, purchaseId?: string): Promise<Row | null> {
  const list = sql.join(statuses.map((s) => sql`${s}`), sql`, `);
  const [row] = await db().execute<Row>(sql`
    update commerce.domain_purchases set claimed_until = now() + interval '3 minutes', tries = tries + 1, updated_at = now()
     where id = (
       select p.id from commerce.domain_purchases p
        where p.status in (${list}) and (p.claimed_until is null or p.claimed_until < now()) and (p.next_try_at is null or p.next_try_at <= now())
          and (p.status <> 'paid' or p.review is null or p.review_outcome = 'approved')
          ${storeId && isUuid(storeId) ? sql`and p.store_id = ${storeId}::uuid` : sql``}
          ${purchaseId && isUuid(purchaseId) ? sql`and p.id = ${purchaseId}::uuid` : sql``}
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
export async function chargeDomainPurchases(scope: { storeId?: string; purchaseId?: string; limit?: number } = {}, deps: DomainBillingDeps = {}): Promise<{ invoiced: number; failed: number }> {
  const mode = deps.mode ?? billingMode();
  const stripe = deps.stripe ?? (mode ? (platformStripe(mode) as unknown as ThemeBillingStripe) : null);
  if (!mode || !stripe) return { invoiced: 0, failed: 0 };
  let invoiced = 0;
  let failed = 0;
  for (let n = 0; n < (scope.limit ?? 10); n++) {
    const row = await claim(["quoted"], scope.storeId, scope.purchaseId).catch(() => null);
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

/**
 * Who an invoice is to: a store's Stripe account (as its plan and themes are), or for a domain held without a store an account's own
 * customer on Kaizena Flow's account (D317 6), with the VAT the purchase was quoted with: Norwegian MVA, or none with the reverse-charge
 * words or as outside the scope of Norwegian VAT. A store pays by its plan's card when it has one; an account always pays by invoice.
 */
async function billTo(row: Row, mode: PaymentModeName, stripe: ThemeBillingStripe, deps: DomainBillingDeps) {
  if (row.store_id) {
    const storeId = String(row.store_id);
    const [facts] = await db().execute<Row>(sql`select s.name, s.country from commerce.stores s where s.id = ${storeId}::uuid`);
    if (!facts) throw new BillingProblem("The store no longer exists.");
    const account = await (deps.account ?? billedAccount)(storeId, mode);
    if (!account) throw new BillingProblem("The store has no Stripe account to bill yet, and one could not be made.");
    const { card } = await collectionFor(storeId, mode, stripe);
    const taxRates = await (deps.taxRates ?? ((country) => billingTaxRates(stripe as unknown as Stripe, mode, country)))(facts.country ? String(facts.country) : null);
    return { to: { customer_account: account }, card, taxRates, name: String(facts.name), fields: [] as { name: string; value: string }[] };
  }
  const accountId = String(row.account_id);
  const customer = await (deps.customer ?? ((id, m) => accountCustomer(id, m)))(accountId, mode);
  if (!customer) throw new BillingProblem("The account has no Stripe customer yet, and one could not be made.");
  const vatKind = row.vat_kind ? String(row.vat_kind) : null;
  if (!vatKind) throw new BillingProblem("The purchase doesn't say what VAT it carries.");
  const taxRates = vatKind === "mva" ? await (deps.taxRates ?? ((country) => billingTaxRates(stripe as unknown as Stripe, mode, country)))("NO") : [];
  const fields =
    vatKind === "reverse_charge"
      ? [
          { name: "VAT number", value: String(row.vat_number ?? "").slice(0, 140) },
          { name: "VAT", value: "Reverse charge" },
        ]
      : vatKind === "outside_scope"
        ? [{ name: "VAT", value: "Outside the scope of Norwegian VAT" }]
        : [];
  return { to: { customer }, card: null, taxRates, name: null, fields };
}

/** An account's customer on Kaizena Flow's Stripe account in `mode`, made once and kept on the account. */
export async function accountCustomer(accountId: string, mode: PaymentModeName): Promise<string | null> {
  const column = sql.raw(mode === "live" ? "stripe_customer_live" : "stripe_customer_test");
  const [row] = await db().execute<Row>(sql`select email, name, ${column} as customer from commerce.accounts where id = ${accountId}::uuid`);
  if (!row) return null;
  if (row.customer) return String(row.customer);
  const stripe = platformStripe(mode);
  if (!stripe) return null;
  const made = await stripe.customers.create(
    { email: String(row.email), ...(row.name ? { name: String(row.name) } : {}), metadata: { kaizen_account_id: accountId } },
    { idempotencyKey: `kaizen-account-customer-${mode}-${accountId}` },
  );
  await db().execute(sql`update commerce.accounts set ${column} = coalesce(${column}, ${made.id}) where id = ${accountId}::uuid`);
  const [kept] = await db().execute<Row>(sql`select ${column} as customer from commerce.accounts where id = ${accountId}::uuid`);
  return kept?.customer ? String(kept.customer) : made.id;
}

async function invoiceOne(row: Row, mode: PaymentModeName, stripe: ThemeBillingStripe, deps: DomainBillingDeps): Promise<void> {
  const id = String(row.id);
  const storeId = row.store_id ? String(row.store_id) : null;
  const bill = await billTo(row, mode, stripe, deps);
  const currency = String(row.currency).trim().toLowerCase();
  const amount = Number(row.amount_minor);
  const label = `${row.kind === "renew" ? "Renewal" : row.kind === "transfer" ? "Transfer of" : "Domain"} ${String(row.apex)}, ${Number(row.years)} ${Number(row.years) === 1 ? "year" : "years"}`;
  const metadata = { ...(storeId ? { kaizen_store_id: storeId } : { kaizen_account_id: String(row.account_id) }), kaizen_domain_purchase: id };
  let invoiceId = row.stripe_invoice_id ? String(row.stripe_invoice_id) : null;
  if (!invoiceId) {
    const { card, taxRates } = bill;
    const made = await stripe.invoices.create(
      {
        ...bill.to,
        currency,
        ...(card ? { collection_method: "charge_automatically", default_payment_method: card } : { collection_method: "send_invoice", days_until_due: 7 }),
        pending_invoice_items_behavior: "exclude",
        auto_advance: false,
        ...(taxRates.length > 0 && { default_tax_rates: taxRates }),
        ...(bill.fields.length > 0 && { custom_fields: bill.fields }),
        description: `Kaizena Flow: ${label}${bill.name ? ` for ${bill.name}` : ""}. The domain is registered once this is paid.`,
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
      await stripe.invoiceItems.create({ ...bill.to, invoice: invoiceId, amount, currency, description: label, metadata }, { idempotencyKey: `kaizen-domain-item-${id}` });
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
    update commerce.domain_purchases set status = 'void', auth_code_box = null, updated_at = now() where id = ${id}::uuid and status in ('quoted', 'invoiced') returning id
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
    update commerce.domain_purchases set status = 'failed', problem = ${problem.slice(0, 500)}, auth_code_box = null, claimed_until = null, next_try_at = null, updated_at = now()
     where id = ${id}::uuid and status in ('paid', 'registering')
  `);
  return "failed";
}

async function registerOne(row: Row, deps: DomainBillingDeps): Promise<"done" | "failed" | "waiting"> {
  const id = String(row.id);
  const storeId = row.store_id ? String(row.store_id) : null;
  const accountId = row.account_id ? String(row.account_id) : null;
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
         where id = ${String(row.registration_id)}::uuid
      `);
      await tx.execute(sql`
        update commerce.domain_purchases set status = 'done', done_at = now(), problem = null, claimed_until = null, next_try_at = null, updated_at = now()
         where id = ${id}::uuid and status = 'paid'
      `);
    });
    await audit(null, storeId, "store.domain_renewed", { domain: apex, years });
    return "done";
  }

  if (row.kind === "transfer") return transferOne(row, registrar, deps);

  if (row.status === "paid") {
    if (!(await registrar.available(apex))) return fail(id, `${apex} was taken before it could be registered, so the payment is refunded.`);
    const contact = await contactOf(row);
    if (!contact) return fail(id, "The registrant's details are missing.");
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
      insert into commerce.domain_registrations (store_id, account_id, apex, registrar, status, registrant_id, registered_at, expires_at, renew, registrar_renews, created_by)
      values (${storeId}::uuid, ${accountId}::uuid, ${apex}, ${registrar.id}, 'active', ${row.registrant_id ? String(row.registrant_id) : null}::uuid, now(),
        coalesce(${info?.expiresAt ?? null}::timestamptz, now() + make_interval(years => ${years})), true, true, ${row.chosen_by ? String(row.chosen_by) : null}::uuid)
      returning *
    `);
    // Bought through Vercel, the domain is on Vercel's nameservers in Kaizena Flow's team: its DNS is kept here.
    await tx.execute(sql`
      insert into commerce.dns_zones (store_id, account_id, apex, created_by, arrived_at)
      values (${storeId}::uuid, ${accountId}::uuid, ${apex}, ${row.chosen_by ? String(row.chosen_by) : null}::uuid, now())
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
  if (row.connect === true && storeId) {
    const connected = await (deps.connect ?? connectOwnedDomain)(null, storeId, apex);
    if (!connected.ok) await audit(null, storeId, "store.domain_connect_failed", { domain: apex, problem: connected.problems.join(" ").slice(0, 300) });
  }
  return "done";
}

/** The registrar's contact for a purchase's registrant, or null when its details are gone. */
async function contactOf(row: Row) {
  const [registrant] = await db().execute<Row>(sql`select * from commerce.domain_registrants where id = ${String(row.registrant_id)}::uuid`);
  if (!registrant) return null;
  return registrarContact(
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
}

/**
 * A paid transfer (D315 8.5): the code is handed to the registrar once and cleared in the same breath; then the transfer is followed (the
 * losing registrar and the registry can take days) until it is done, when the registration is kept and the store connected if asked, or
 * refused, when the payment is refunded. Its DNS stays where it is: moving it here is its own step (5.4).
 */
async function transferOne(row: Row, registrar: DomainRegistrar, deps: DomainBillingDeps): Promise<"done" | "failed" | "waiting"> {
  const id = String(row.id);
  const storeId = row.store_id ? String(row.store_id) : null;
  const accountId = row.account_id ? String(row.account_id) : null;
  const apex = String(row.apex);
  if (row.status === "paid") {
    const key = parseKey(process.env.SETTINGS_ENCRYPTION_KEY);
    if (!row.auth_code_box || !key) return fail(id, "The transfer code is no longer here, so the payment is refunded. Start the transfer again with a new code.");
    let authCode: string;
    try {
      authCode = decryptSecret(String(row.auth_code_box), key);
    } catch {
      return fail(id, "The transfer code could not be read, so the payment is refunded. Start the transfer again with a new code.");
    }
    const contact = await contactOf(row);
    if (!contact) return fail(id, "The registrant's details are missing.");
    let orderId: string;
    try {
      ({ orderId } = await registrar.transferIn(apex, { authCode, years: 1, expectedPrice: Number(row.cost), autoRenew: true, contact }));
    } catch (error) {
      if (error instanceof RegistrarError && error.status !== null && error.status >= 400 && error.status < 500 && error.status !== 429) {
        return fail(id, `The registrar refused the transfer: ${error.message}`);
      }
      throw error;
    }
    // The code has done its work: it is not kept a moment longer.
    await db().execute(sql`
      update commerce.domain_purchases set status = 'registering', registrar_order_id = ${orderId}, auth_code_box = null, claimed_until = null,
        next_try_at = now() + interval '10 minutes', updated_at = now()
       where id = ${id}::uuid and status = 'paid'
    `);
    await audit(null, storeId, "store.domain_transfer_started", { domain: apex });
    return "waiting";
  }
  const { state, status } = await registrar.transferStatus(apex);
  if (state === "new_code") return fail(id, `${apex}'s current registrar refused the transfer code, so the payment is refunded. Ask them for a new code and start again.`);
  if (state === "ended") return fail(id, `The transfer of ${apex} didn't go through (${status}), so the payment is refunded.`);
  if (state === "waiting") {
    await db().execute(sql`update commerce.domain_purchases set claimed_until = null, next_try_at = now() + interval '1 hour', updated_at = now() where id = ${id}::uuid`);
    return "waiting";
  }
  const info = await registrar.domain(apex).catch(() => null);
  const registration = await db().transaction(async (tx) => {
    const [reg] = await tx.execute<Row>(sql`
      insert into commerce.domain_registrations (store_id, account_id, apex, registrar, status, registrant_id, registered_at, expires_at, renew, registrar_renews, created_by)
      values (${storeId}::uuid, ${accountId}::uuid, ${apex}, ${registrar.id}, 'active', ${row.registrant_id ? String(row.registrant_id) : null}::uuid, now(),
        ${info?.expiresAt ?? null}::timestamptz, true, true, ${row.chosen_by ? String(row.chosen_by) : null}::uuid)
      returning *
    `);
    await tx.execute(sql`
      update commerce.domain_purchases set status = 'done', done_at = now(), registration_id = ${String(reg.id)}::uuid, problem = null,
        claimed_until = null, next_try_at = null, updated_at = now()
       where id = ${id}::uuid and status = 'registering'
    `);
    return toRegistration(reg);
  });
  await audit(null, storeId, "store.domain_transferred_in", { domain: apex, registration: registration.id });
  if (row.connect === true && storeId) {
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
      await audit(null, row.store_id ? String(row.store_id) : null, "store.domain_refunded", { purchase: String(row.id) });
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
    select r.*, g.country as registrant_country, last.buyer, last.vat_kind, last.vat_number
      from commerce.domain_registrations r
      left join commerce.domain_registrants g on g.id = r.registrant_id
      left join lateral (select p.buyer, p.vat_kind, p.vat_number from commerce.domain_purchases p
                          where p.apex = r.apex and p.status = 'done' and p.vat_kind is not null order by p.created_at desc limit 1) last on true
     where r.status = 'active' and r.renew and r.expires_at < now() + make_interval(days => ${RENEW_AHEAD_DAYS})
       and not exists (select 1 from commerce.domain_purchases p where p.apex = r.apex and p.kind = 'renew'
                        and p.created_at > r.expires_at - make_interval(days => ${RENEW_AHEAD_DAYS + 5}) and p.status not in ('void', 'failed', 'refunded'))
     limit 20
  `);
  for (const reg of due) {
    try {
      const registrar = (deps.registrar ?? registrarById)(String(reg.registrar));
      if (!registrar) continue;
      const q = await quoteWith(registrationHolder(reg), registrar, String(reg.apex), 1, reg.registrant_country ? String(reg.registrant_country) : null);
      if (!q.ok) continue;
      // A renewal is priced at the registrar's renewal price, which `price()` gives as `renewal` for one year.
      const price = await registrar.price(String(reg.apex), 1);
      const ctx = await priceContext(q.quote.currency);
      const amount = ctx ? priceIn(ctx, price.renewal, price.currency, 1) : null;
      if (!amount) continue;
      // Held without a store, the renewal is invoiced with the VAT its first purchase was (D317 6); one without it isn't renewed by itself.
      if (!reg.store_id && !reg.vat_kind) continue;
      await db().execute(sql`
        insert into commerce.domain_purchases (store_id, account_id, registration_id, registrant_id, apex, kind, years, currency, amount_minor, registrar, cost, cost_currency, connect,
          buyer, vat_kind, vat_number)
        values (${reg.store_id ? String(reg.store_id) : null}::uuid, ${reg.account_id ? String(reg.account_id) : null}::uuid, ${String(reg.id)}::uuid,
          ${reg.registrant_id ? String(reg.registrant_id) : null}::uuid, ${String(reg.apex)}, 'renew', 1,
          ${q.quote.currency}, ${amount}, ${registrar.id}, ${price.renewal}, ${price.currency}, false,
          ${reg.store_id ? null : (reg.buyer ?? null)}, ${reg.store_id ? null : (reg.vat_kind ?? null)}, ${reg.store_id ? null : (reg.vat_number ?? null)})
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
export async function setDomainRenewal(account: Account, holder: HolderRef, apex: string, renew: boolean, deps: DomainBillingDeps = {}): Promise<Result<{ registration: Registration }>> {
  const [row] = await db().execute<Row>(sql`
    update commerce.domain_registrations set renew = ${renew}, updated_at = now()
     where ${heldBy(holder)} and apex = ${apex.toLowerCase()} and status in ('active', 'expired')
    returning *
  `);
  if (!row) return { ok: false, problems: ["That domain isn't registered by you through Kaizena Flow."] };
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
  await audit(account.id, row.store_id ? String(row.store_id) : null, "store.domain_renewal_set", { domain: apex, renew });
  return { ok: true, registration: toRegistration({ ...row, renew }) };
}

/** Starts a renewal now for `years` at today's renewal price, which the owner was shown (`agreed`), then invoices it. */
export async function renewDomainNow(account: Account, holder: HolderRef, apex: string, years: number, agreed: string): Promise<Result<{ purchase: DomainPurchase }>> {
  const [reg] = await db().execute<Row>(sql`
    select r.*, last.buyer, last.vat_kind, last.vat_number from commerce.domain_registrations r
      left join lateral (select p.buyer, p.vat_kind, p.vat_number from commerce.domain_purchases p
                          where p.apex = r.apex and p.status = 'done' and p.vat_kind is not null order by p.created_at desc limit 1) last on true
     where ${heldBy(holder, "r")} and r.apex = ${apex.toLowerCase()} and r.status in ('active', 'expired')
  `);
  if (!reg) return { ok: false, problems: ["That domain isn't registered by you through Kaizena Flow."] };
  if (!reg.store_id && !reg.vat_kind) return { ok: false, problems: ["This domain can't be renewed from here. Write to Kaizena Flow's support."] };
  const offer = await renewalOffer(registrationHolder(reg), String(reg.apex), String(reg.registrar), years);
  if (!offer) return { ok: false, problems: ["The renewal can't be priced just now. Try again in a moment."] };
  if (agreed !== `${offer.currency}:${offer.amountMinor}`) return { ok: false, problems: [`The renewal is now ${formatMoney(offer.amountMinor, offer.currency, "en-GB")}. Look at it again to renew.`] };
  try {
    const [row] = await db().execute<Row>(sql`
      insert into commerce.domain_purchases (store_id, account_id, registration_id, registrant_id, apex, kind, years, currency, amount_minor, registrar, cost, cost_currency,
        connect, chosen_by, buyer, vat_kind, vat_number)
      values (${reg.store_id ? String(reg.store_id) : null}::uuid, ${reg.account_id ? String(reg.account_id) : null}::uuid, ${String(reg.id)}::uuid,
        ${reg.registrant_id ? String(reg.registrant_id) : null}::uuid, ${String(reg.apex)}, 'renew', ${years},
        ${offer.currency}, ${offer.amountMinor}, ${String(reg.registrar)}, ${offer.cost}, ${offer.costCurrency}, false, ${account.id}::uuid,
        ${reg.store_id ? null : (reg.buyer ?? null)}, ${reg.store_id ? null : (reg.vat_kind ?? null)}, ${reg.store_id ? null : (reg.vat_number ?? null)})
      returning *
    `);
    await audit(account.id, reg.store_id ? String(reg.store_id) : null, "store.domain_renewal_started", { domain: String(reg.apex), years });
    return { ok: true, purchase: toPurchase(row) };
  } catch {
    return { ok: false, problems: [`A renewal of ${String(reg.apex)} is already under way.`] };
  }
}

/** What renewing a registration for `years` costs now. */
export async function renewalOffer(holder: HolderRef, apex: string, registrarId: string, years: number) {
  const registrar = registrarById(registrarId);
  if (!registrar) return null;
  const country = storeOf(holder) ? null : await registrantCountry(apex);
  const currency = await holderCurrency(holder, (await domainPricingRows()).map((p) => p.currency), country);
  const ctx = await priceContext(currency);
  if (!ctx || !currency) return null;
  const price = await registrar.price(apex, 1).catch(() => null);
  if (!price) return null;
  const cost = Math.round(price.renewal * years * 100) / 100;
  const amountMinor = priceIn(ctx, cost, price.currency, years);
  return amountMinor === null ? null : { currency, amountMinor, cost, costCurrency: price.currency };
}

/** Who holds a registration row: its store while a store uses it, else its account. */
export const registrationHolder = (reg: Row): HolderRef => (reg.store_id ? String(reg.store_id) : accountHolder(String(reg.account_id)));

/** The registrant's country of a registration, which an account's currency follows. */
async function registrantCountry(apex: string): Promise<string | null> {
  const [row] = await db().execute<Row>(sql`
    select g.country from commerce.domain_registrations r join commerce.domain_registrants g on g.id = r.registrant_id
     where r.apex = ${apex} and r.status <> 'transferred_out' limit 1
  `);
  return row?.country ? String(row.country) : null;
}
