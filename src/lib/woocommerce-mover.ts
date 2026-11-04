/**
 * The mover (D446 step 2, `docs/moving-from-woocommerce.md` 3): our WordPress plugin's read-only routes on the owner's site, for what
 * WooCommerce's own key cannot reach: which plugins the shop runs, the redirects of the redirect plugins, the SEO plugins' titles and
 * descriptions, and MailPoet's subscribers. Pure: the signature each call carries, the sealed note of *Connect the plugin*, and the readers
 * of the plugin's answers (never trusted beyond the fields read here). Nothing here fetches.
 *
 * The signature: HMAC-SHA256 with the secret the plugin made when the owner allowed it, over `{time}\n{method}\n{route}\n{query}`, the
 * route as WordPress names it (`/kaizena-mover/v1/seo`) and the query's pairs sorted by name, each part percent-encoded as RFC 3986 says
 * (PHP's `rawurlencode()`). The plugin (`class-kaizen-store-mover.php`) refuses a call more than five minutes from its own clock.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

import type { ConsentLine } from "./shopify-copy";
import type { GiftCardLine } from "./shopify-settings";

export const MOVER_NAMESPACE = "kaizena-mover/v1";
export const MOVER_ROUTES = ["plugins", "redirects", "seo", "seo_terms", "subscribers", "gift_cards", "content", "menus"] as const;
export type MoverRoute = (typeof MOVER_ROUTES)[number];
/** How far apart Kaizena Flow's clock and the site's may be, in seconds. */
export const MOVER_SKEW_SECONDS = 300;
/** How many rows a page of the plugin's answers holds. */
export const MOVER_PAGE_SIZE = 500;

/** RFC 3986 percent-encoding, as PHP's `rawurlencode()`. */
const raw = (text: string): string => encodeURIComponent(text).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/** The query as both sides sign it: pairs sorted by name (then value), each part encoded, joined by `&`. */
export function canonicalQuery(query: Record<string, string | number>): string {
  return Object.entries(query)
    .map(([k, v]) => [k, String(v)] as const)
    .sort(([a, x], [b, y]) => (a < b ? -1 : a > b ? 1 : x < y ? -1 : x > y ? 1 : 0))
    .map(([k, v]) => `${raw(k)}=${raw(v)}`)
    .join("&");
}

/** A call's signature (hex). */
export function moverSignature(secret: string, time: number, method: string, route: string, query: Record<string, string | number>): string {
  return createHmac("sha256", secret).update(`${time}\n${method.toUpperCase()}\n${route}\n${canonicalQuery(query)}`).digest("hex");
}

/** The headers a call to the plugin carries. */
export function moverHeaders(secret: string, time: number, route: string, query: Record<string, string | number>): Record<string, string> {
  return { "X-Kaizena-Mover-Time": String(time), "X-Kaizena-Mover-Signature": moverSignature(secret, time, "GET", route, query) };
}

/** A secret as the plugin makes it: 64 hex characters (32 random bytes). */
export const isMoverSecret = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);

// ---------------------------------------------------------------------------
// The sealed note of *Connect the plugin*
// ---------------------------------------------------------------------------

export const MOVER_STATE_MINUTES = 60;
export type MoverState = { nonce: string; store: string; account: string; site: string; expires: number };

const NONCE = /^[A-Za-z0-9_-]{20,64}$/;
const SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SITE = /^[a-z0-9.-]{3,253}(\/[a-z0-9._~-]{1,80})?$/;

const sign = (secret: Buffer, body: string): string => createHmac("sha256", secret).update(`mover:${body}`).digest("base64url");
const sameText = (a: string, b: string): boolean => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/** The note the plugin's page carries and posts back with the secret: who asked, for which store and site, until when. Signed, not secret. */
export function sealMoverState(key: Buffer, value: Omit<MoverState, "expires">, now = Date.now()): string {
  const body = Buffer.from(JSON.stringify({ ...value, expires: now + MOVER_STATE_MINUTES * 60_000 })).toString("base64url");
  return `${body}.${sign(key, body)}`;
}

export function openMoverState(key: Buffer, sealed: unknown, now = Date.now()): MoverState | null {
  if (typeof sealed !== "string" || sealed.length > 1500) return null;
  const [body, given, ...rest] = sealed.split(".");
  if (!body || !given || rest.length > 0 || !sameText(sign(key, body), given)) return null;
  let value: Partial<MoverState>;
  try {
    value = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Partial<MoverState>;
  } catch {
    return null;
  }
  const { nonce, store, account, site, expires } = value;
  if (typeof nonce !== "string" || !NONCE.test(nonce) || typeof store !== "string" || !SLUG.test(store)) return null;
  if (typeof account !== "string" || !UUID.test(account) || typeof site !== "string" || !SITE.test(site)) return null;
  if (typeof expires !== "number" || expires <= now || expires - now > MOVER_STATE_MINUTES * 60_000) return null;
  return { nonce, store, account, site, expires };
}

// ---------------------------------------------------------------------------
// The plugin's answers
// ---------------------------------------------------------------------------

type Obj = Record<string, unknown>;
const o = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
const list = (v: unknown): Obj[] => (Array.isArray(v) ? v.map(o) : []);
const s = (v: unknown, max = 500): string => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, max) : "");

/** A plugin the shop runs: its folder's name (`woocommerce`, `mailpoet`) and the name it gives itself. */
export type ShopPlugin = { slug: string; name: string };

export function pluginsOf(answer: unknown): ShopPlugin[] {
  return list(o(answer).plugins)
    .map((p) => ({ slug: s(p.slug, 100).toLowerCase(), name: s(p.name, 120) }))
    .filter((p) => /^[a-z0-9][a-z0-9_.-]*$/.test(p.slug))
    .slice(0, 300);
}

/**
 * The plugins Kaizena Flow knows by name, and what becomes of each (D446 6.1): read by the mover, or listed with what to use here instead.
 * Never a guess: a plugin not listed here is shown by its own name only.
 */
export const KNOWN_PLUGINS: Record<string, "read" | "here" | "none"> = {
  mailpoet: "read",
  redirection: "read",
  "wordpress-seo": "read",
  "wordpress-seo-premium": "read",
  "seo-by-rank-math": "read",
  "seo-by-rank-math-pro": "read",
  "woocommerce-subscriptions": "here",
  "woocommerce-gift-cards": "here",
  "pw-woocommerce-gift-cards": "here",
  "yith-woocommerce-gift-cards": "here",
  "woocommerce-product-bundles": "here",
  "woocommerce-bookings": "here",
  "mailchimp-for-woocommerce": "none",
  "klaviyo": "none",
  "yith-woocommerce-wishlist": "none",
  "elementor": "none",
};

/** A redirect from one of the redirect plugins (Redirection, Yoast SEO Premium, Rank Math): an address on the site to where it leads. */
export type MoverRedirect = { from: string; to: string };

/**
 * A page of redirects as the redirect import's lines (`redirectsFile()`): a path on the site (with its query when it has one) to a path or a
 * whole address. A pattern (a regular expression) is left: the import takes exact addresses only.
 */
export function redirectLinesOf(answer: unknown): { lines: { id: string; path: string; target: string }[]; skipped: number; more: boolean } {
  const a = o(answer);
  const lines: { id: string; path: string; target: string }[] = [];
  let skipped = 0;
  list(a.redirects).forEach((r, n) => {
    const from = s(r.from, 500);
    const to = s(r.to, 2000);
    if (r.regex === true || !from.startsWith("/") || to === "" || from === to) {
      skipped += 1;
      return;
    }
    lines.push({ id: `woo-redirect-${s(r.source, 20)}-${n}`, path: from, target: to });
  });
  return { lines, skipped, more: a.more === true };
}

/**
 * Every Yoast and Rank Math field the mover reads (step 2a, kept since the owner asked that they all be preserved): our name, its label, and
 * whether it is long text. The title and description also become the product's or category's own SEO words here; every field, as the plugin
 * kept it, goes into the custom field group *SEO from Yoast / Rank Math* (`SEO_FIELD_GROUP`), private until the owner shows it.
 */
export const SEO_FIELDS = [
  { name: "title", label: "SEO title as written", long: false },
  { name: "description", label: "Meta description as written", long: true },
  { name: "focus_keyword", label: "Focus keyword", long: false },
  { name: "canonical", label: "Canonical address", long: false },
  { name: "robots", label: "Robots", long: false },
  { name: "og_title", label: "Social title (Facebook)", long: false },
  { name: "og_description", label: "Social description (Facebook)", long: true },
  { name: "og_image", label: "Social picture (Facebook)", long: false },
  { name: "twitter_title", label: "X (Twitter) title", long: false },
  { name: "twitter_description", label: "X (Twitter) description", long: true },
  { name: "twitter_image", label: "X (Twitter) picture", long: false },
  { name: "breadcrumb_title", label: "Breadcrumb title", long: false },
  { name: "primary_category", label: "Primary category", long: false },
  { name: "plugin", label: "From", long: false },
] as const;
export type SeoFieldName = (typeof SEO_FIELDS)[number]["name"];
export const SEO_FIELD_GROUP = { slug: "seo-from-wordpress", name: "SEO from Yoast / Rank Math" } as const;

/**
 * A product's or category's SEO from the plugin: the title and description as the plugin shows them (its variables replaced on the site;
 * one still holding a variable is left, since it is not the words), and every field as the plugin kept it.
 */
export type MoverSeo = { title: string; description: string; fields: Partial<Record<SeoFieldName, string>> };

const unresolved = (text: string) => /%%|%[a-z_]+%/i.test(text);

function moverSeoOf(r: Obj): MoverSeo | null {
  const raw = o(r.fields);
  const fields: Partial<Record<SeoFieldName, string>> = {};
  for (const f of SEO_FIELDS) {
    if (f.name === "plugin") continue;
    const value = s(raw[f.name], f.long ? 5000 : 500);
    if (value) fields[f.name] = value;
  }
  const plugin = s(r.plugin, 20);
  if (plugin === "yoast" || plugin === "rank-math") fields.plugin = plugin === "yoast" ? "Yoast SEO" : "Rank Math";
  const shown = (v: unknown, max: number) => {
    const text = s(v, max * 2);
    return unresolved(text) ? "" : text.slice(0, max);
  };
  const seo = { title: shown(r.title, 255), description: shown(r.description, 1000), fields };
  return seo.title || seo.description || Object.keys(fields).length > 0 ? seo : null;
}

/** A page of products' SEO, by WooCommerce's id. */
export function seoOf(answer: unknown): Map<number, MoverSeo> {
  const out = new Map<number, MoverSeo>();
  for (const r of list(o(answer).seo)) {
    const id = Number(r.id);
    const seo = Number.isSafeInteger(id) && id > 0 ? moverSeoOf(r) : null;
    if (seo) out.set(id, seo);
  }
  return out;
}

/** A page of product categories' SEO, by the category's name as the copy brings it (`categoryName()`). */
export function termSeoOf(answer: unknown): { terms: (MoverSeo & { name: string; slug: string })[]; more: boolean } {
  const a = o(answer);
  const terms = list(a.terms).flatMap((r) => {
    const name = s(r.name, 255);
    const seo = name ? moverSeoOf(r) : null;
    return seo ? [{ ...seo, name, slug: s(r.slug, 200) }] : [];
  });
  return { terms, more: a.more === true };
}

/**
 * MailPoet's subscribers as the email list's lines (`ConsentLine`, the same as Shopify's): only `subscribed`, with the day it happened
 * (MailPoet's `last_subscribed_at`, else when the subscriber was made); confirmed when MailPoet recorded a confirmation (double opt-in).
 * MailPoet's *unconfirmed* is not subscribed (D446 6.2), and is never sent.
 */
export function subscriberLinesOf(answer: unknown): { lines: ConsentLine[]; more: boolean } {
  const a = o(answer);
  const at = (v: unknown): string | null => {
    const text = s(v, 40);
    if (!/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}$/.test(text)) return null;
    const d = new Date(`${text.replace(" ", "T")}Z`);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  };
  const lines: ConsentLine[] = [];
  for (const r of list(a.subscribers)) {
    const email = s(r.email, 320).toLowerCase();
    if (s(r.status, 20) !== "subscribed" || !email.includes("@")) continue;
    const when = at(r.subscribed_at) ?? at(r.created_at);
    lines.push({
      email,
      name: [s(r.first_name, 100), s(r.last_name, 100)].filter(Boolean).join(" ").slice(0, 200),
      state: "SUBSCRIBED",
      level: at(r.confirmed_at) ? "CONFIRMED_OPT_IN" : "SINGLE_OPT_IN",
      updatedAt: when,
    });
  }
  return { lines, more: a.more === true };
}

/**
 * The gift card plugins' cards with money left (step 2b) as the gift cards' lines (`GiftCardLine`, the same as Shopify's): each made here on
 * move day with a new code emailed to its holder (the owner's answer, 4 November 2026), never with the old code, which the plugin does not
 * send. The card's id there names it (`woo:{plugin}:{id}`), so it is made once; an expired card, or one with nothing left, is left.
 */
export function giftCardLinesOf(answer: unknown, today: string): { lines: GiftCardLine[]; more: boolean } {
  const a = o(answer);
  const currency = s(a.currency, 3).toUpperCase();
  const lines: GiftCardLine[] = [];
  if (!/^[A-Z]{3}$/.test(currency)) return { lines, more: false };
  for (const c of list(a.cards)) {
    const source = s(c.source, 40);
    const id = Number(c.id);
    const amount = s(c.balance, 20);
    const expiresOn = /^\d{4}-\d{2}-\d{2}$/.test(s(c.expires, 10)) ? s(c.expires, 10) : null;
    if (!/^[a-z0-9-]+$/.test(source) || !Number.isSafeInteger(id) || id <= 0 || !/^\d+(\.\d{1,2})?$/.test(amount) || Number(amount) <= 0) continue;
    if (expiresOn && expiresOn < today) continue;
    const email = s(c.email, 254).toLowerCase();
    lines.push({ id: `woo:${source}:${id}`, last4: s(c.last4, 4).toUpperCase(), amount, currency, expiresOn, email: email.includes("@") ? email : null });
  }
  return { lines, more: a.more === true };
}

/**
 * A page of WordPress's pages or posts (step 3) as the page lines the Shopify copy reads (`directItems()`): its address, title, HTML (every
 * shortcode already taken out on the site), whether it is published, and its author. Posts go to the store's main blog. The shortcodes the
 * site's content used are named, so the owner is told what did not come over.
 */
export function contentLinesOf(answer: unknown): { lines: Obj[]; shortcodes: string[]; more: boolean } {
  const a = o(answer);
  const shortcodes = new Set<string>();
  const lines: Obj[] = [];
  for (const r of list(a.items)) {
    const handle = s(r.slug, 200).toLowerCase();
    const title = s(r.title, 200);
    if (!handle || !title) continue;
    for (const code of Array.isArray(r.shortcodes) ? r.shortcodes : []) if (typeof code === "string" && /^[a-z][a-z0-9_-]{0,60}$/.test(code)) shortcodes.add(code);
    const id = Number(r.id);
    lines.push({ id: `woo-content-${Number.isSafeInteger(id) && id > 0 ? id : handle}`, handle, title, body: typeof r.html === "string" ? r.html.slice(0, 400_000) : "", isPublished: r.published === true, author: { name: s(r.author, 100) }, blog: null });
  }
  return { lines, shortcodes: [...shortcodes].sort(), more: a.more === true };
}

/** WordPress's menus (step 3), already in the shape the Shopify copy's menus are read in (`menuInputOf()`): kept as given, at most 25. */
export function menusOf(answer: unknown): Obj[] {
  return list(o(answer).menus)
    .filter((m) => s(m.title, 80) !== "")
    .slice(0, 25);
}
