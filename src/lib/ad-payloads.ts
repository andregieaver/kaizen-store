/**
 * Server-side conversion events as each platform takes them (wave 5 unit I2, D303, `docs/wave-5-marketing.md` 12.3): pure, so every payload
 * is tested. A conversion is the order's own facts (its value and currency as charged, its lines, the click ids its cart kept with consent)
 * and, only at the owner's *Enhanced* level, SHA-256 hashes made by the sender. No IP address or user agent is ever sent: Kaizena Flow keeps
 * neither. Each request carries its platform's secret, so a request is never logged.
 */

import type { AdSignals } from "./ad-signals";

export const AD_PLATFORMS = ["meta", "ga4", "tiktok", "pinterest"] as const;
export type AdPlatform = (typeof AD_PLATFORMS)[number];

export const AD_EVENTS = ["begin_checkout", "purchase"] as const;
export type AdEvent = (typeof AD_EVENTS)[number];

/** Kaizena Flow's own (C2, D523): a sign-up, and the first paid plan of the store it made. */
export const PLATFORM_AD_EVENTS = ["sign_up", "plan_paid"] as const;
export type PlatformAdEvent = (typeof PLATFORM_AD_EVENTS)[number];

/** The only hosts a conversion goes to, one a platform. */
export const AD_HOSTS: Record<AdPlatform, string> = {
  meta: "graph.facebook.com",
  ga4: "region1.google-analytics.com",
  tiktok: "business-api.tiktok.com",
  pinterest: "api.pinterest.com",
};

export type Conversion = {
  event: AdEvent | PlatformAdEvent;
  /** The order's id: the same event id for every platform, so a browser event and this one are counted once. */
  eventId: string;
  /** GA4's client id where one person's events belong together (a sign-up and its plan, D523); the event id when left out. */
  clientId?: string;
  /** Seconds since 1970. */
  time: number;
  currency: string;
  /** Major units, VAT included, as charged (a plan: net of VAT, what Kaizena Flow earns, D523; a sign-up: 0, and not sent). */
  value: number;
  lines: { id: string; quantity: number; price: number }[];
  signals: AdSignals;
  /** The store's order page without its key, or the store's address. */
  pageUrl: string;
  /** Present only at the *Enhanced* level: SHA-256 hex of the normalised email and phone. */
  hashes?: { email?: string; phone?: string };
};

export type Connection = { platform: AdPlatform; accountId: string; token: string; testCode?: string | null };

export type AdRequest = { url: string; headers: Record<string, string>; body: string };

type AnyEvent = AdEvent | PlatformAdEvent;
// Each platform's standard event: a sign-up is a registration, a paid plan a subscription (GA4's recommended `sign_up` and `purchase`).
const META_NAMES: Record<AnyEvent, string> = { begin_checkout: "InitiateCheckout", purchase: "Purchase", sign_up: "CompleteRegistration", plan_paid: "Subscribe" };
const TIKTOK_NAMES: Record<AnyEvent, string> = { begin_checkout: "InitiateCheckout", purchase: "CompletePayment", sign_up: "CompleteRegistration", plan_paid: "Subscribe" };
const GA4_NAMES: Record<AnyEvent, string> = { begin_checkout: "begin_checkout", purchase: "purchase", sign_up: "sign_up", plan_paid: "purchase" };
const PINTEREST_NAMES: Partial<Record<AnyEvent, string>> = { purchase: "checkout", sign_up: "signup", plan_paid: "checkout" };
/** A purchase of something, with an order id: an order's purchase or a paid plan. */
const paid = (event: AnyEvent) => event === "purchase" || event === "plan_paid";

/** An email as the platforms want it before hashing: trimmed and lower case. */
export { normaliseEmail } from "./email-address";

/** A phone as the platforms want it before hashing: digits only, with its country code (a leading `+` or `00` dropped). */
export function normalisePhone(phone: string): string | null {
  const digits = phone.replace(/[^\d+]/g, "").replace(/^\+/, "").replace(/^00/, "");
  return /^\d{8,15}$/.test(digits) ? digits : null;
}

const json = { "Content-Type": "application/json" };

/** The request that sends a conversion to a platform, or null when the platform has no such event or nothing to match it by. */
export function adRequest(connection: Connection, c: Conversion): AdRequest | null {
  const { hashes = {}, signals } = c;
  switch (connection.platform) {
    case "meta": {
      const user = {
        ...(signals.fbp ? { fbp: signals.fbp } : {}),
        ...(signals.fbc ? { fbc: signals.fbc } : {}),
        ...(hashes.email ? { em: [hashes.email] } : {}),
        ...(hashes.phone ? { ph: [hashes.phone] } : {}),
      };
      if (Object.keys(user).length === 0) return null;
      return {
        url: `https://${AD_HOSTS.meta}/v21.0/${encodeURIComponent(connection.accountId)}/events?access_token=${encodeURIComponent(connection.token)}`,
        headers: json,
        body: JSON.stringify({
          data: [
            {
              event_name: META_NAMES[c.event],
              event_time: c.time,
              event_id: c.eventId,
              action_source: "website",
              event_source_url: c.pageUrl,
              user_data: user,
              ...(c.event === "sign_up"
                ? {}
                : {
                    custom_data: {
                      currency: c.currency,
                      value: c.value,
                      content_type: "product",
                      contents: c.lines.map((l) => ({ id: l.id, quantity: l.quantity, item_price: l.price })),
                      ...(paid(c.event) ? { order_id: c.eventId } : {}),
                    },
                  }),
            },
          ],
          ...(connection.testCode ? { test_event_code: connection.testCode } : {}),
        }),
      };
    }
    case "ga4": {
      // GA4's Measurement Protocol needs a client id; without the visitor's own (_ga is never read), the order's id stands in.
      return {
        url: `https://${AD_HOSTS.ga4}/mp/collect?measurement_id=${encodeURIComponent(connection.accountId)}&api_secret=${encodeURIComponent(connection.token)}`,
        headers: json,
        body: JSON.stringify({
          client_id: c.clientId ?? c.eventId,
          timestamp_micros: c.time * 1_000_000,
          events: [
            {
              name: GA4_NAMES[c.event],
              params: {
                ...(paid(c.event) ? { transaction_id: c.eventId } : {}),
                ...(c.event === "sign_up"
                  ? { method: "email" }
                  : { currency: c.currency, value: c.value, items: c.lines.map((l) => ({ item_id: l.id, quantity: l.quantity, price: l.price })) }),
                ...(signals.gclid ? { gclid: signals.gclid } : {}),
              },
            },
          ],
        }),
      };
    }
    case "tiktok": {
      const user = {
        ...(signals.ttclid ? { ttclid: signals.ttclid } : {}),
        ...(signals.ttp ? { ttp: signals.ttp } : {}),
        ...(hashes.email ? { email: hashes.email } : {}),
        ...(hashes.phone ? { phone: hashes.phone } : {}),
      };
      if (Object.keys(user).length === 0) return null;
      return {
        url: `https://${AD_HOSTS.tiktok}/open_api/v1.3/event/track/`,
        headers: { ...json, "Access-Token": connection.token },
        body: JSON.stringify({
          event_source: "web",
          event_source_id: connection.accountId,
          ...(connection.testCode ? { test_event_code: connection.testCode } : {}),
          data: [
            {
              event: TIKTOK_NAMES[c.event],
              event_time: c.time,
              event_id: c.eventId,
              user,
              page: { url: c.pageUrl },
              ...(c.event === "sign_up"
                ? {}
                : {
                    properties: {
                      currency: c.currency,
                      value: c.value,
                      content_type: "product",
                      contents: c.lines.map((l) => ({ content_id: l.id, quantity: l.quantity, price: l.price })),
                      ...(paid(c.event) ? { order_id: c.eventId } : {}),
                    },
                  }),
            },
          ],
        }),
      };
    }
    case "pinterest": {
      // Pinterest has no standard event for a checkout started; its `checkout` is the purchase (and a paid plan), its `signup` a sign-up.
      const name = PINTEREST_NAMES[c.event];
      if (!name) return null;
      const user = {
        ...(signals.epik ? { click_id: signals.epik } : {}),
        ...(hashes.email ? { em: [hashes.email] } : {}),
        ...(hashes.phone ? { ph: [hashes.phone] } : {}),
      };
      if (Object.keys(user).length === 0) return null;
      return {
        url: `https://${AD_HOSTS.pinterest}/v5/ad_accounts/${encodeURIComponent(connection.accountId)}/events${connection.testCode ? "?test=true" : ""}`,
        headers: { ...json, Authorization: `Bearer ${connection.token}` },
        body: JSON.stringify({
          data: [
            {
              event_name: name,
              action_source: "web",
              event_time: c.time,
              event_id: c.eventId,
              event_source_url: c.pageUrl,
              user_data: user,
              ...(c.event === "sign_up"
                ? {}
                : {
                    custom_data: {
                      currency: c.currency,
                      value: String(c.value),
                      order_id: c.eventId,
                      content_ids: c.lines.map((l) => l.id),
                      contents: c.lines.map((l) => ({ id: l.id, quantity: l.quantity, item_price: String(l.price) })),
                      num_items: c.lines.reduce((n, l) => n + l.quantity, 0),
                    },
                  }),
            },
          ],
        }),
      };
    }
  }
}

/** The platform's id as the owner types it: a Meta pixel id, a GA4 measurement id, a TikTok pixel code, a Pinterest ad account id. */
export const ACCOUNT_SHAPES: Record<AdPlatform, RegExp> = {
  meta: /^\d{6,20}$/,
  ga4: /^G-[A-Z0-9]{4,15}$/,
  tiktok: /^[A-Z0-9]{15,25}$/,
  pinterest: /^\d{6,20}$/,
};
