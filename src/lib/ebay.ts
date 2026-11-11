/**
 * eBay as a sales channel (D555), the pure parts: the marketplaces a store can list on, eBay's consent page, what is sent for a listing (an
 * inventory item and an offer, as eBay's Sell Inventory API v1 names them) and how an order from eBay's Sell Fulfillment API v1 is read. Built
 * from eBay's published OpenAPI documents (`sell_inventory_v1_oas3.json`, `sell_fulfillment_v1_oas3.json`, read 11 November 2026). Pure.
 */

import { z } from "zod";

export const EBAY_API = "https://api.ebay.com";
export const EBAY_AUTH = "https://auth.ebay.com/oauth2/authorize";
export const EBAY_TOKEN = "https://api.ebay.com/identity/v1/oauth2/token";
export const EBAY_SCOPES = ["https://api.ebay.com/oauth/api_scope/sell.inventory", "https://api.ebay.com/oauth/api_scope/sell.fulfillment"] as const;

/** The EU and EEA marketplaces (and the UK and Switzerland, which EU sellers reach), with the currency and listing language each takes. */
export const EBAY_MARKETPLACES = {
  EBAY_DE: { currency: "EUR", language: "de-DE", name: "eBay.de (Germany)" },
  EBAY_AT: { currency: "EUR", language: "de-AT", name: "eBay.at (Austria)" },
  EBAY_FR: { currency: "EUR", language: "fr-FR", name: "eBay.fr (France)" },
  EBAY_IT: { currency: "EUR", language: "it-IT", name: "eBay.it (Italy)" },
  EBAY_ES: { currency: "EUR", language: "es-ES", name: "eBay.es (Spain)" },
  EBAY_NL: { currency: "EUR", language: "nl-NL", name: "eBay.nl (Netherlands)" },
  EBAY_BE: { currency: "EUR", language: "nl-BE", name: "eBay.be (Belgium)" },
  EBAY_IE: { currency: "EUR", language: "en-IE", name: "eBay.ie (Ireland)" },
  EBAY_PL: { currency: "PLN", language: "pl-PL", name: "eBay.pl (Poland)" },
  EBAY_GB: { currency: "GBP", language: "en-GB", name: "eBay.co.uk (United Kingdom)" },
  EBAY_CH: { currency: "CHF", language: "de-CH", name: "eBay.ch (Switzerland)" },
} as const;
export type EbayMarketplace = keyof typeof EBAY_MARKETPLACES;
export const isEbayMarketplace = (v: unknown): v is EbayMarketplace => typeof v === "string" && Object.hasOwn(EBAY_MARKETPLACES, v);

/** What eBay asks every offer to name, set by the owner from their eBay seller account (Business policies, a location, a category). */
export const ebaySettingsInput = z.object({
  marketplace: z.string().refine(isEbayMarketplace, "Choose a marketplace."),
  fulfillmentPolicyId: z.string().trim().regex(/^\d{3,20}$/, "The shipping policy's number from eBay."),
  paymentPolicyId: z.string().trim().regex(/^\d{3,20}$/, "The payment policy's number from eBay."),
  returnPolicyId: z.string().trim().regex(/^\d{3,20}$/, "The return policy's number from eBay."),
  merchantLocationKey: z.string().trim().regex(/^[A-Za-z0-9_-]{1,36}$/, "The key of your location at eBay (letters, digits, - and _)."),
  categoryId: z.string().trim().regex(/^\d{1,10}$/, "An eBay category number."),
});
export type EbaySettings = z.infer<typeof ebaySettingsInput>;

/** eBay's consent page for Kaizena Flow's app: the RuName is eBay's name for the app's registered return address. */
export function ebayAuthorizeUrl(o: { clientId: string; ruName: string; state: string }): string {
  const query = new URLSearchParams({ client_id: o.clientId, redirect_uri: o.ruName, response_type: "code", scope: EBAY_SCOPES.join(" "), state: o.state });
  return `${EBAY_AUTH}?${query.toString()}`;
}

/** Minor units as eBay's decimal string ("12.34"). */
export function ebayAmount(minor: number, digits = 2): string {
  const sign = minor < 0 ? "-" : "";
  const abs = Math.abs(minor);
  const unit = 10 ** digits;
  return digits === 0 ? `${sign}${abs}` : `${sign}${Math.floor(abs / unit)}.${String(abs % unit).padStart(digits, "0")}`;
}

/** eBay's decimal string as minor units, without floating point. */
export function minorOfEbay(value: string | undefined, digits = 2): number {
  const m = /^(-)?(\d+)(?:\.(\d+))?$/.exec((value ?? "0").trim());
  if (!m) return 0;
  const frac = (m[3] ?? "").padEnd(digits, "0").slice(0, digits);
  const minor = Number(m[2]) * 10 ** digits + Number(frac || "0");
  return m[1] ? -minor : minor;
}

export type ListingSource = {
  sku: string;
  title: string;
  description: string;
  imageUrls: string[];
  gtin: string | null;
  quantity: number;
  priceMinor: number;
  currency: string;
};

/** `PUT /inventory_item/{sku}`: the product and how many are available, new. eBay's title is at most 80 characters, its pictures https. */
export function inventoryItemBody(source: ListingSource) {
  return {
    availability: { shipToLocationAvailability: { quantity: Math.max(0, Math.floor(source.quantity)) } },
    condition: "NEW",
    product: {
      title: source.title.slice(0, 80),
      description: source.description.slice(0, 4000) || source.title,
      imageUrls: source.imageUrls.filter((u) => u.startsWith("https://")).slice(0, 12),
      ...(source.gtin ? { ean: [source.gtin] } : {}),
    },
  };
}

/** `POST /offer` (or `PUT /offer/{offerId}`): a fixed price on one marketplace, under the seller's policies. */
export function offerBody(source: ListingSource, settings: EbaySettings) {
  return {
    sku: source.sku,
    marketplaceId: settings.marketplace,
    format: "FIXED_PRICE",
    availableQuantity: Math.max(0, Math.floor(source.quantity)),
    categoryId: settings.categoryId,
    listingDescription: source.description.slice(0, 4000) || source.title,
    listingPolicies: { fulfillmentPolicyId: settings.fulfillmentPolicyId, paymentPolicyId: settings.paymentPolicyId, returnPolicyId: settings.returnPolicyId },
    merchantLocationKey: settings.merchantLocationKey,
    pricingSummary: { price: { value: ebayAmount(source.priceMinor), currency: source.currency } },
  };
}

/** The filter of `GET /order` for orders placed since a moment that are not yet sent. */
export const ordersFilter = (since: Date): string => `creationdate:[${since.toISOString()}..],orderfulfillmentstatus:{NOT_STARTED|IN_PROGRESS}`;

const amount = z.object({ value: z.string().optional(), currency: z.string().optional() }).partial();

export const ebayOrderSchema = z.object({
  orderId: z.string().min(1).max(100),
  creationDate: z.string(),
  cancelStatus: z.object({ cancelState: z.string().optional() }).partial().optional(),
  pricingSummary: z.object({ total: amount.optional() }).partial().optional(),
  buyer: z.object({ username: z.string().optional(), buyerRegistrationAddress: z.object({ email: z.string().optional(), fullName: z.string().optional() }).partial().optional() }).partial().optional(),
  fulfillmentStartInstructions: z
    .array(
      z.object({
        shippingStep: z
          .object({
            shipTo: z
              .object({
                fullName: z.string().optional(),
                companyName: z.string().optional(),
                email: z.string().optional(),
                primaryPhone: z.object({ phoneNumber: z.string().optional() }).partial().optional(),
                contactAddress: z
                  .object({ addressLine1: z.string(), addressLine2: z.string(), city: z.string(), postalCode: z.string(), countryCode: z.string(), stateOrProvince: z.string() })
                  .partial()
                  .optional(),
              })
              .partial()
              .optional(),
          })
          .partial()
          .optional(),
      }).partial(),
    )
    .optional(),
  lineItems: z.array(z.object({ lineItemId: z.string(), sku: z.string().optional(), title: z.string().optional(), quantity: z.number().int().positive(), total: amount.optional() })).default([]),
});
export type EbayOrder = z.infer<typeof ebayOrderSchema>;

export type ReadOrder = {
  externalId: string;
  placedAt: string;
  totalMinor: number;
  currency: string;
  cancelled: boolean;
  buyerName: string;
  buyerEmail: string | null;
  shipTo: Record<string, string>;
  lines: { lineItemId: string; sku: string | null; title: string; quantity: number; totalMinor: number }[];
};

/** An eBay order as the store keeps it. Amounts in minor units of its currency (two decimals: every currency eBay's EU sites use). */
export function readEbayOrder(order: EbayOrder): ReadOrder {
  const ship = order.fulfillmentStartInstructions?.[0]?.shippingStep?.shipTo;
  const a = ship?.contactAddress ?? {};
  const shipTo = Object.fromEntries(
    Object.entries({
      name: ship?.fullName,
      company: ship?.companyName,
      line1: a.addressLine1,
      line2: a.addressLine2,
      postalCode: a.postalCode,
      city: a.city,
      region: a.stateOrProvince,
      country: a.countryCode,
      phone: ship?.primaryPhone?.phoneNumber,
    }).filter((e): e is [string, string] => typeof e[1] === "string" && e[1].trim() !== ""),
  );
  return {
    externalId: order.orderId,
    placedAt: new Date(order.creationDate).toISOString(),
    totalMinor: minorOfEbay(order.pricingSummary?.total?.value),
    currency: (order.pricingSummary?.total?.currency ?? "EUR").toUpperCase().slice(0, 3),
    cancelled: /CANCEL/i.test(order.cancelStatus?.cancelState ?? "") && !/NONE_REQUESTED/i.test(order.cancelStatus?.cancelState ?? ""),
    buyerName: (ship?.fullName ?? order.buyer?.buyerRegistrationAddress?.fullName ?? order.buyer?.username ?? "").slice(0, 200),
    buyerEmail: ship?.email ?? order.buyer?.buyerRegistrationAddress?.email ?? null,
    shipTo,
    lines: order.lineItems.map((l) => ({ lineItemId: l.lineItemId, sku: l.sku ?? null, title: (l.title ?? "").slice(0, 300), quantity: l.quantity, totalMinor: minorOfEbay(l.total?.value) })),
  };
}

/** `POST /order/{orderId}/shipping_fulfillment`: every line, the carrier and tracking number. */
export const shippingFulfillmentBody = (lines: readonly { lineItemId: string; quantity: number }[], carrier: string, trackingNumber: string, at: Date) => ({
  lineItems: lines.map((l) => ({ lineItemId: l.lineItemId, quantity: l.quantity })),
  shippedDate: at.toISOString(),
  shippingCarrierCode: carrier,
  trackingNumber,
});

/** The carriers offered when marking an eBay order sent, as eBay's carrier codes. */
export const EBAY_CARRIERS = ["DHL", "UPS", "PostNord", "Bring", "Posten", "DPD", "GLS", "Hermes", "FedEx", "Other"] as const;
