/**
 * Express checkout and wallets (wave 10 unit J, D373, `docs/wave-10-must-haves.md` J). Stripe's Express Checkout Element (Apple Pay, Google
 * Pay, Link, Klarna) on a product page and in the cart, drawn only once the shopper presses its area, over the same order and Checkout
 * Session the checkout page uses (`placeOrder()` through `startCheckout()`), so nothing about the price, VAT, stock or delivery is decided
 * a second time. Pure parts: which baskets an express payment can take, and what the Payments page says of each wallet on each address.
 * No zod: the cart is a pay route and the product page's scripts stay small (D211).
 */

/** What a cart line must be for an express payment: goods sent by post, bought once, with no time, plan, card or host. */
export type ExpressLine = {
  delivery: "physical" | "digital" | "service";
  plan: unknown | null;
  booking: unknown | null;
  giftCard: unknown | null;
  hostId: string | null;
};

/**
 * Whether an express payment can pay the whole basket: something is in it, and every line is goods that are sent (a download needs the
 * shopper's tick before it starts, a subscription its own consent, a booking its time and contact, a gift card who it is for, a host's
 * listing the host's account): the checkout page asks those, the wallet's sheet cannot.
 */
export function expressFits(lines: readonly ExpressLine[]): boolean {
  return lines.length > 0 && lines.every((l) => l.delivery === "physical" && !l.plan && !l.booking && !l.giftCard && !l.hostId);
}

/** Why an express payment did not start, in the shopper's words (`expressProblemText()` in the action): the checkout's own problems besides. */
export const EXPRESS_PROBLEMS = ["not_here", "delivery", "add"] as const;
export type ExpressProblem = (typeof EXPRESS_PROBLEMS)[number];

/** The wallets the Payments page lists, each with the capability on the store's account that carries it (D291). */
export const WALLETS = [
  { id: "apple_pay", label: "Apple Pay", capability: "card_payments" },
  { id: "google_pay", label: "Google Pay", capability: "card_payments" },
  { id: "link", label: "Link", capability: "link_payments" },
  { id: "klarna", label: "Klarna", capability: "klarna_payments" },
] as const;
export type WalletId = (typeof WALLETS)[number]["id"];

/** What Stripe says of one wallet on one registered address (`PaymentMethodDomain.{wallet}.status`), with its reason when inactive. */
export type WalletDomainState = { status: "active" | "inactive"; reason?: string | null };

/** One address as Stripe holds it for the store's account: whether it is on, each wallet's state, and when it was read. */
export type WalletDomain = { enabled: boolean; wallets: Partial<Record<WalletId, WalletDomainState>>; checkedAt: string };

type DomainLike = {
  domain_name?: string;
  enabled?: boolean;
} & Partial<Record<WalletId, { status?: string; status_details?: { error_message?: string } | null } | null>>;

/** A Stripe `PaymentMethodDomain` as the page keeps it: only the four wallets, a status Stripe did not give left out, the reason cut short. */
export function walletDomainOf(domain: DomainLike, checkedAt: string): WalletDomain {
  const wallets: Partial<Record<WalletId, WalletDomainState>> = {};
  for (const wallet of WALLETS) {
    const state = domain[wallet.id];
    if (state?.status !== "active" && state?.status !== "inactive") continue;
    wallets[wallet.id] = { status: state.status, reason: state.status_details?.error_message?.slice(0, 200) ?? null };
  }
  return { enabled: domain.enabled !== false, wallets, checkedAt };
}

/** What the owner reads for one wallet on one address. Not registered: Stripe has no record of the address for the account yet. */
export type WalletWord = "active" | "inactive" | "off" | "not_registered" | "not_read";

/** One wallet's word on one address, from what was kept (`stripe_accounts.wallet_domains`); null kept means it was never read. */
export function walletWordOf(kept: Record<string, WalletDomain> | null, host: string, wallet: WalletId): WalletWord {
  if (!kept) return "not_read";
  const domain = kept[host];
  if (!domain) return "not_registered";
  if (!domain.enabled) return "off";
  const state = domain.wallets[wallet];
  if (!state) return "not_read";
  return state.status;
}

/** A host name as Stripe registers it: lower case, no port, no scheme; null for localhost, an address or anything that is no public name. */
export function registrableHost(origin: string): string | null {
  let host: string;
  try {
    host = new URL(origin).hostname.toLowerCase();
  } catch {
    return null;
  }
  return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(host) && !/^\d+(\.\d+){3}$/.test(host) ? host : null;
}

/** The currencies Stripe's messaging element draws (`StripePaymentMethodMessagingElementOptions.currency`); another draws no Klarna line. */
const MESSAGING_CURRENCIES = new Set(["AUD", "CAD", "CHF", "CZK", "DKK", "EUR", "GBP", "NOK", "NZD", "PLN", "SEK", "USD"]);
/** The countries it takes (`countryCode`). */
const MESSAGING_COUNTRIES = new Set(["AT", "AU", "BE", "CA", "CH", "CZ", "DE", "DK", "ES", "FI", "FR", "GB", "GR", "IE", "IT", "NL", "NO", "NZ", "PL", "PT", "RO", "SE", "US"]);

/** Whether Klarna's line under a price can be drawn for this market at all (Stripe then says whether the amount suits Klarna). */
export function klarnaMessagingFits(currency: string, country: string): boolean {
  return MESSAGING_CURRENCIES.has(currency.toUpperCase()) && MESSAGING_COUNTRIES.has(country.toUpperCase());
}
