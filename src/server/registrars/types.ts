import "server-only";

/**
 * What a registrar does for Kaizena Flow (D315, `docs/domains.md` 4.1): every registrar is one adapter of this shape, so the rest of the
 * code never knows which one sells a name. Amounts are the registrar's own, in its currency (Vercel's are US dollars), as decimals the
 * registrar wrote; they become minor units and the store's currency only in `src/lib/domain-prices.ts`.
 */

export type RegistrarId = "vercel";

export type SearchResult = {
  domain: string;
  available: boolean;
  /** A name the registry prices itself: not offered (decision 10). */
  premium: boolean;
  years: number | null;
  /** The registrar's price for the first term and for each renewal, in its currency. */
  price: number | null;
  renewalPrice: number | null;
};

export type PriceQuote = { years: number; purchase: number; renewal: number; transfer: number | null; currency: string };

/** The registrant (D315 decision 1: the store's owner or their company), in the registrar's fields. */
export type ContactInformation = {
  firstName: string;
  lastName: string;
  email: string;
  /** E.164, `+4722334455`. */
  phone: string;
  address1: string;
  address2?: string;
  city: string;
  state: string;
  zip: string;
  /** ISO 3166-1 alpha-2. */
  country: string;
  companyName?: string;
  /** Extra fields a TLD asks for (`contactSchema()`). */
  additional?: Record<string, string>;
};

export type OrderStatus = "draft" | "purchasing" | "completed" | "failed";
export type Order = { orderId: string; status: OrderStatus; error: string | null };

export type RegistrarDomain = {
  /** When the registration runs out, ISO. */
  expiresAt: string | null;
  boughtAt: string | null;
  renews: boolean | null;
  nameservers: string[];
};

export interface DomainRegistrar {
  id: RegistrarId;
  /** The registrar's currency. */
  currency: string;
  /** The TLDs it sells, as it lists them. */
  supportedTlds(): Promise<string[]>;
  search(domains: readonly string[]): Promise<SearchResult[]>;
  price(domain: string, years?: number): Promise<PriceQuote>;
  available(domain: string): Promise<boolean>;
  /** Extra registrant fields the TLD needs, as the registrar describes them (empty when none). */
  contactSchema(domain: string): Promise<Record<string, unknown>>;
  /** Registers; refused by the registrar when its price is above `expectedPrice`. */
  buy(domain: string, input: { years: number; expectedPrice: number; autoRenew: boolean; contact: ContactInformation }): Promise<{ orderId: string }>;
  order(orderId: string): Promise<Order>;
  renew(domain: string, input: { years: number; expectedPrice: number }): Promise<{ orderId: string | null }>;
  setAutoRenew(domain: string, autoRenew: boolean): Promise<void>;
  /** An empty list means the registrar's own (Vercel's) nameservers. */
  setNameservers(domain: string, nameservers: readonly string[]): Promise<void>;
  /** The code a holder gives another registrar to move the domain there. Read live, never stored (`docs/domains.md` 8.1). */
  authCode(domain: string): Promise<string>;
  /** Whether the registrant's email is confirmed (null: too soon after buying to say). */
  contactVerified(domain: string): Promise<boolean | null>;
  /** The registration as the registrar keeps it, or null when it holds no such domain. */
  domain(domain: string): Promise<RegistrarDomain | null>;
}

/** A registrar's refusal or failure, in words for the owner; `code` is the registrar's own when it gave one. */
export class RegistrarError extends Error {
  constructor(
    message: string,
    readonly code: string | null = null,
    readonly status: number | null = null,
  ) {
    super(message);
  }
}
