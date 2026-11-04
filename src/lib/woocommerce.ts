/**
 * Connecting a WooCommerce shop (D446 step 1, `docs/moving-from-woocommerce.md` 2.2 and 4.2), pure: the site's address as the owner typed
 * it, WordPress's own answer at its REST root, WooCommerce's *authorize* page (`wc-auth`, a read-only key the owner approves on his own
 * site), and the sealed note that travels through it so the key WooCommerce posts back is known to be the one this owner asked for.
 * Nothing here fetches. Read 3 November 2026 at <https://woocommerce.github.io/woocommerce-rest-api-docs/> (Authentication).
 */
import { createHmac, timingSafeEqual } from "node:crypto";

/** A WordPress site's address: its host and, when WordPress lives in a folder, that folder (`example.com/shop`). Always reached over HTTPS. */
export type WooSite = { host: string; path: string };

const LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
const FOLDER = /^[a-z0-9._~-]{1,80}$/i;

/** The site as `host` + `/folder` (no scheme, no trailing slash): how it is kept in `shop_moves.shop_domain`. */
export const siteKey = (site: WooSite): string => `${site.host}${site.path}`;

/** The site's address over HTTPS, without a trailing slash. */
export const siteBase = (site: WooSite): string => `https://${siteKey(site)}`;

/**
 * Whatever the owner typed (`myshop.com`, `https://www.myshop.com/`, `myshop.com/shop/`, a page of the shop) as the site, or null when it
 * is not an address. A page's own path is not the site's folder: only a first folder that is not one of WordPress's own words is kept, and
 * the REST root's answer settles it (`siteFromIndex()`).
 */
export function readSiteInput(raw: string): WooSite | null {
  const text = raw.trim();
  if (text === "" || text.length > 500 || /\s/.test(text)) return null;
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username || url.password || (url.port && url.port !== "443" && url.port !== "80")) return null;
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  const labels = host.split(".");
  if (labels.length < 2 || host.length > 253 || !labels.every((l) => LABEL.test(l)) || /^\d+$/.test(labels.at(-1)!)) return null;
  const first = url.pathname.split("/").filter(Boolean)[0] ?? "";
  const wordpress = /^(wp-|product|shop|cart|checkout|my-account|category|tag|\d{4}$)/i;
  const path = first && FOLDER.test(first) && !wordpress.test(first) && url.pathname.split("/").filter(Boolean).length === 1 && !first.includes(".") ? `/${first.toLowerCase()}` : "";
  return { host, path };
}

/** Where WordPress's REST routes are reached: `/wp-json/…` with pretty addresses, `/?rest_route=/…` without. */
export type RestRoot = "wp-json" | "rest_route";

/** A REST route's address on the site (`route` without its leading slash, such as `wc/v3/products`), with its query. */
export function restUrl(site: WooSite, root: RestRoot, route: string, query: Record<string, string | number> = {}): string {
  const params = new URLSearchParams(Object.entries(query).map(([k, v]) => [k, String(v)]));
  if (root === "wp-json") {
    const q = params.toString();
    return `${siteBase(site)}/wp-json/${route}${q ? `?${q}` : ""}`;
  }
  const q = params.toString();
  return `${siteBase(site)}/?rest_route=/${encodeURI(route)}${q ? `&${q}` : ""}`;
}

/** What the REST root says of the site: whether WooCommerce's routes are there, the site's name, and the address WordPress gives itself. */
export type WooIndex = { woo: boolean; name: string; site: WooSite | null };

/** The REST root's answer (`/wp-json/`), read: never trusted beyond these three facts. */
export function readIndex(body: string): WooIndex | null {
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  const namespaces = Array.isArray(v.namespaces) ? v.namespaces.filter((n): n is string => typeof n === "string") : null;
  if (!namespaces) return null;
  const name = typeof v.name === "string" ? v.name.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 200) : "";
  const address = typeof v.url === "string" ? readSiteInput(v.url) : null;
  // WordPress's own address names the folder exactly; a host it names that is not the one asked is not taken (it would be a different site).
  return { woo: namespaces.includes("wc/v3"), name, site: address };
}

/** The site as the owner gave it, with WordPress's own folder when WordPress names the same host. */
export function siteFromIndex(asked: WooSite, index: WooIndex): WooSite {
  const named = index.site;
  if (!named) return asked;
  const bare = (h: string) => h.replace(/^www\./, "");
  return bare(named.host) === bare(asked.host) ? named : asked;
}

// ---------------------------------------------------------------------------
// The sealed note (`user_id`)
// ---------------------------------------------------------------------------

/** How long the owner has to approve on his own site (he may first have to sign in to WordPress). */
export const WOO_STATE_MINUTES = 60;

export type WooState = { nonce: string; store: string; account: string; site: string; root: RestRoot; expires: number };

const NONCE = /^[A-Za-z0-9_-]{20,64}$/;
const SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SITE = /^[a-z0-9.-]{3,253}(\/[a-z0-9._~-]{1,80})?$/;

const sign = (secret: Buffer, body: string): string => createHmac("sha256", secret).update(`woocommerce:${body}`).digest("base64url");

const sameText = (a: string, b: string): boolean => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/** The note WooCommerce carries as `user_id` and posts back with the key: who asked, for which store and site, until when. Signed, not secret. */
export function sealWooState(secret: Buffer, value: Omit<WooState, "expires">, now = Date.now()): string {
  const body = Buffer.from(JSON.stringify({ ...value, expires: now + WOO_STATE_MINUTES * 60_000 })).toString("base64url");
  return `${body}.${sign(secret, body)}`;
}

/** The note's contents, or null when this server did not sign it, it was altered, is malformed or is over. */
export function openWooState(secret: Buffer, sealed: unknown, now = Date.now()): WooState | null {
  if (typeof sealed !== "string" || sealed.length > 1500) return null;
  const [body, given, ...rest] = sealed.split(".");
  if (!body || !given || rest.length > 0 || !sameText(sign(secret, body), given)) return null;
  let value: Partial<WooState>;
  try {
    value = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Partial<WooState>;
  } catch {
    return null;
  }
  const { nonce, store, account, site, root, expires } = value;
  if (typeof nonce !== "string" || !NONCE.test(nonce)) return null;
  if (typeof store !== "string" || !SLUG.test(store) || typeof account !== "string" || !UUID.test(account)) return null;
  if (typeof site !== "string" || !SITE.test(site) || (root !== "wp-json" && root !== "rest_route")) return null;
  if (typeof expires !== "number" || expires <= now || expires - now > WOO_STATE_MINUTES * 60_000) return null;
  return { nonce, store, account, site, root, expires };
}

/** A kept site key (`host/folder`) as a site, or null. */
export function siteOfKey(key: string): WooSite | null {
  if (!SITE.test(key)) return null;
  const at = key.indexOf("/");
  return at < 0 ? { host: key, path: "" } : { host: key.slice(0, at), path: key.slice(at) };
}

/**
 * WooCommerce's own *authorize* page on the owner's site: a read-only key for Kaizena Flow, posted to `callbackUrl` (HTTPS), the owner then
 * sent to `returnUrl`. On a site without pretty addresses the page is reached by its query (`wc-auth-version`, `wc-auth-route`).
 */
export function wooAuthorizeUrl(site: WooSite, root: RestRoot, input: { appName: string; userId: string; returnUrl: string; callbackUrl: string }): string {
  const params = new URLSearchParams({ app_name: input.appName, scope: "read", user_id: input.userId, return_url: input.returnUrl, callback_url: input.callbackUrl });
  return root === "wp-json" ? `${siteBase(site)}/wc-auth/v1/authorize?${params}` : `${siteBase(site)}/?wc-auth-version=1&wc-auth-route=authorize&${params}`;
}

/** The key WooCommerce posts back, checked: its two halves and that it is read-only. */
export type WooKey = { key: string; secret: string; userId: string };

export function readWooKey(body: unknown): WooKey | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const b = body as Record<string, unknown>;
  const key = typeof b.consumer_key === "string" ? b.consumer_key : "";
  const secret = typeof b.consumer_secret === "string" ? b.consumer_secret : "";
  const userId = typeof b.user_id === "string" ? b.user_id : typeof b.user_id === "number" ? String(b.user_id) : "";
  if (!/^ck_[a-f0-9]{40}$/.test(key) || !/^cs_[a-f0-9]{40}$/.test(secret) || userId === "") return null;
  // A key that can write is not what was asked for: the move only ever reads.
  if (b.key_permissions !== "read") return null;
  return { key, secret, userId };
}
