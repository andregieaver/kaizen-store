import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { signInRequired } from "@/lib/customer-accounts";
import { klarnaMessagingFits, registrableHost, walletDomainOf, type WalletDomain } from "@/lib/express-checkout";
import type { ExpressSetup } from "@/components/express-area";
import { checkoutAppearanceFor } from "@/lib/checkout-look";
import { termsTemplate } from "@/lib/checkout-terms";
import { fontStack } from "@/lib/fonts";
import type { Messages } from "@/lib/i18n";
import type { Market } from "@/lib/markets";
import { methodOn } from "@/lib/payment-methods";
import { storeOrigins } from "@/lib/paths";
import { siteUrl } from "@/lib/site";
import type { PaymentModeName } from "@/lib/stripe-account";
import type { Store } from "./stores";

import { audit } from "./auth";
import { paymentsOnOf, providerOf, refreshBuyFacts, type BuyFacts } from "./buy-facts";
import { getBuyer } from "./b2b";
import { listCheckoutFields } from "./checkout-rules";
import { ensurePaymentDomain, getCheckoutUi } from "./connect";
import { getCustomer } from "./customers";
import { termsDisplayFor } from "./checkout-terms";
import { findFont } from "./fonts";
import { log } from "./log";
import { getCheckoutInfo } from "./orders";
import { methodChoices, methodStates } from "./payment-methods";
import { getCheckoutAccount } from "./settings";
import { platformPublishableKey, platformStripe } from "./stripe";

type Row = Record<string, unknown>;

/**
 * Express checkout and wallets (wave 10 unit J, D373; the rules in `src/lib/express-checkout.ts`). The express area on a product page and in
 * the cart is drawn only where `expressOn()` says so, and pressing it goes through `startExpress()` (`src/server/express-start.ts`, which
 * only the press loads): the same `startCheckout()` the cart's button calls (the order placed, stock held, the Checkout Session made on the
 * store's account with the delivery the cart holds), and the
 * session's client secret handed to the browser that owns the cart, which then draws Stripe's Express Checkout Element over it. The wallet's
 * address and the delivery reach the order through `applySession()` as for any payment. The Payments page reads `walletDomains()`, kept by
 * `checkWalletDomains()`.
 */

/**
 * Whether the express area is offered to this shopper: Kaizena Flow's own checkout page (Stripe's form in it, not Stripe's hosted page),
 * Stripe as the store's checkout (not Mollie), payments on and not a store template, a signed-in shopper where the store requires accounts
 * (D365), a private buyer (a business's checkout asks its company), and no questions of the store's own to answer (D357). The store's part
 * comes from `buyFacts()` where the caller has it (the product page: cached, refreshed by its writers), else it is read; the shopper's
 * part is read per request.
 */
export async function expressOn(store: Store, market: Market, facts?: BuyFacts): Promise<boolean> {
  if (facts) {
    // The store's part is in the facts (cached, refreshed by its writers); only the shopper's part is read here.
    const [customer, buyer] = await Promise.all([getCustomer(store.id), getBuyer(store)]);
    return (
      facts.checkoutUi === "custom" &&
      paymentsOnOf(facts) &&
      providerOf(facts) === "stripe" &&
      !facts.starter &&
      !signInRequired(store, customer !== null) &&
      buyer === "private" &&
      !facts.checkoutFields
    );
  }
  const [ui, info, customer, buyer, fields] = await Promise.all([
    getCheckoutUi(),
    getCheckoutInfo(store.id, market.code),
    getCustomer(store.id),
    getBuyer(store),
    listCheckoutFields(db(), store.id, { onlyOn: true }),
  ]);
  return (
    ui === "custom" &&
    info.paymentsOn &&
    info.provider === "stripe" &&
    !info.starter &&
    !signInRequired(store, customer !== null) &&
    buyer === "private" &&
    fields.length === 0
  );
}

/** The express area's props for this shopper, or null where it is not offered (`expressOn()`). Per request. */
export async function expressAreaFor(store: Store, market: Market, m: Messages, facts?: BuyFacts): Promise<ExpressSetup | null> {
  if (!(await expressOn(store, market, facts))) return null;
  const display = await termsDisplayFor(store, market);
  const theme = store.theme.settings;
  const bodyFont = theme.fonts.body ? findFont(theme.fonts.body) : null;
  return {
    labels: {
      title: m.express.title,
      hint: m.express.hint,
      start: m.express.start,
      loading: m.express.loading,
      forCart: m.express.forCart("{n}"),
      noWallet: m.express.noWallet,
      toCart: m.express.toCart,
      delivery: {
        postal_code: m.deliveryOptions.priceInfo.needCode,
        changed: m.deliveryOptions.priceInfo.changed,
        no_shipping: m.deliveryOptions.noShippingAnywhere,
        checkFailed: m.deliveryOptions.checkFailed,
      },
      termsHint: m.terms.hint,
      termsFailed: m.terms.failed,
    },
    terms: display ? { display, template: termsTemplate(m.terms, display), newTab: m.terms.newTab } : null,
    look: checkoutAppearanceFor(theme, bodyFont ? fontStack(bodyFont.family, bodyFont.category) : null),
  };
}

/**
 * Klarna's line under a price (Stripe's messaging element), where Klarna is active on the store's account in the mode it takes payments in,
 * not switched off for the country (D291), and the market's currency and country are ones the element draws. Null otherwise. The keys are
 * the ones the checkout page hands the browser. The store's part comes from `buyFacts()` where the caller has it, else it is read.
 */
export async function klarnaMessaging(store: Store, market: Market, facts?: BuyFacts): Promise<{ publishableKey: string; stripeAccount: string } | null> {
  if (!klarnaMessagingFits(market.currency, market.code)) return null;
  if (facts) {
    if (facts.checkoutUi !== "custom" || !paymentsOnOf(facts) || providerOf(facts) !== "stripe" || !facts.accountId || !facts.activeMode) return null;
    if (facts.klarnaOff) return null;
    if (!facts.klarnaActive) return null;
    const key = platformPublishableKey(facts.activeMode);
    return key ? { publishableKey: key, stripeAccount: facts.accountId } : null;
  }
  const [ui, info, account, choices] = await Promise.all([getCheckoutUi(), getCheckoutInfo(store.id, market.code), getCheckoutAccount(store.id), methodChoices(store.id)]);
  if (ui !== "custom" || !info.paymentsOn || info.provider !== "stripe" || !account?.accountId) return null;
  if (!methodOn(choices, market.code, "klarna")) return null;
  const states = await methodStates(store.id, account.mode);
  if (states?.klarna_payments?.status !== "active") return null;
  const publishableKey = platformPublishableKey(account.mode);
  return publishableKey ? { publishableKey, stripeAccount: account.accountId } : null;
}

/** The web addresses the store's shoppers pay on, as Stripe registers them: its own hosts once it has them (P7, P8), else Kaizena Flow's. */
export function walletHosts(storeSlug: string): string[] {
  const origins = storeOrigins(storeSlug);
  const hosts = (origins.length > 0 ? origins : [siteUrl()]).map(registrableHost).filter((h): h is string => h !== null);
  return [...new Set(hosts)];
}

/** What was last read from Stripe of each address on the store's account in a mode, and when; null when it was never read (or there is no account). */
export async function walletDomains(storeId: string, mode: PaymentModeName): Promise<{ domains: Record<string, WalletDomain>; readAt: string } | null> {
  const [row] = await db().execute<Row>(sql`
    select wallet_domains, wallet_domains_at from commerce.stripe_accounts where store_id = ${storeId}::uuid and mode = ${mode}
  `);
  if (!row?.wallet_domains_at) return null;
  return { domains: (row.wallet_domains ?? {}) as Record<string, WalletDomain>, readAt: new Date(String(row.wallet_domains_at)).toISOString() };
}

export type WalletCheck = { ok: true; hosts: number } | { ok: false; problem: "no_account" | "stripe" };

/**
 * *Check again* on the Payments page (the owner's): every address the store's shoppers pay on is registered on the store's account in a
 * mode (`ensurePaymentDomain()`, which checkout does too as it goes), then Stripe's record of each is read and kept as it is, the four
 * wallets' states with their reasons. Audited with the count, never a reason. A failure keeps what was read before.
 */
export async function checkWalletDomains(storeId: string, storeSlug: string, mode: PaymentModeName, accountId: string | null): Promise<WalletCheck> {
  const [row] = await db().execute<Row>(sql`
    select account_id from commerce.stripe_accounts where store_id = ${storeId}::uuid and mode = ${mode}
  `);
  const stripe = platformStripe(mode);
  if (!row?.account_id || !stripe) return { ok: false, problem: "no_account" };
  const account = String(row.account_id);
  const hosts = walletHosts(storeSlug);
  for (const host of hosts) await ensurePaymentDomain(storeId, mode, account, host);
  const kept: Record<string, WalletDomain> = {};
  const at = new Date().toISOString();
  try {
    for (const host of hosts) {
      const found = await stripe.paymentMethodDomains.list({ domain_name: host, limit: 1 }, { stripeAccount: account });
      const domain = found.data[0];
      if (domain) kept[host] = walletDomainOf(domain as unknown as Parameters<typeof walletDomainOf>[0], at);
    }
  } catch (error) {
    log("warn", "wallets.read_failed", { store: storeId, mode }, error);
    return { ok: false, problem: "stripe" };
  }
  await db().execute(sql`
    update commerce.stripe_accounts set wallet_domains = ${JSON.stringify(kept)}::jsonb, wallet_domains_at = now()
    where store_id = ${storeId}::uuid and mode = ${mode}
  `);
  refreshBuyFacts(storeId);
  await audit(accountId, storeId, "payments.wallets_checked", { mode, hosts: hosts.length, registered: Object.keys(kept).length }, { area: "settings" });
  return { ok: true, hosts: hosts.length };
}
