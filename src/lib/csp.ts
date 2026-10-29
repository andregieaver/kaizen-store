/**
 * The Content-Security-Policy of the pay routes (wave 1, 1e, `docs/wave-1-trust.md` 4.4, `docs/pci.md`): what a shopper's
 * browser may load on a store's cart, checkout and order. Card details go from the browser to Stripe's own form; the aim is
 * that no other site's script can run beside it (the revised SAQ A's criterion). Pure: `next.config.ts` sends the headers,
 * the tests read the policy.
 *
 * Stripe's origins are those its documentation lists for Stripe.js, Checkout and Link (read 2026-10-03,
 * https://docs.stripe.com/security/guide). A script origin is never added without a reason written in `docs/pci.md`.
 *
 * Strength, said plainly: `script-src` allows `'unsafe-inline'`, because the prerendered shell carries inline bootstrap
 * scripts that cannot hold a nonce, so the policy stops any script from another origin but not an injected inline one.
 * What stands against that is that these routes draw no owner code and no owner HTML, and that `frame-ancestors`,
 * `form-action` and `base-uri` are shut. There is no `'unsafe-eval'`.
 */
import { PAY_SOURCES } from "./pay-routes";

/**
 * `true`: the policy is enforced. `false` sends the same policy as `Content-Security-Policy-Report-Only`, the one-line
 * fallback if a live Stripe session turns out to need something the documentation did not list.
 */
export const CSP_ENFORCE = true;

export type CspEnv = {
  /** `NEXT_PUBLIC_SUPABASE_URL`: its host serves the store's pictures, logos and uploaded videos. */
  supabaseUrl?: string | null;
  /** Set on Vercel: `upgrade-insecure-requests` would break `http://localhost`, the end-to-end server. */
  vercel?: boolean;
  /**
   * The stricter form (`experimental.sri` in `next.config.ts`: the build puts an integrity hash on every script, so
   * `'unsafe-inline'` can go from `script-src`). Not switched on: it needs a build and the end-to-end load to pass first
   * (`docs/pci.md` says how it was left).
   */
  sri?: boolean;
};

/**
 * Stripe lists `https://maps.googleapis.com` in `script-src` and `connect-src` among the Stripe.js directives, and the checkout mounts the
 * Address Element (`ShippingAddressElement`), whose address autocomplete loads it. Without it autocomplete is blocked, silently
 * (`docs/pci.md`, "Address autocomplete"). It is the one origin on the pay routes that is neither Stripe's nor ours.
 */
const ADDRESS_AUTOCOMPLETE = "https://maps.googleapis.com";
const STRIPE_SCRIPT = ["https://js.stripe.com", "https://*.js.stripe.com", "https://checkout.stripe.com", ADDRESS_AUTOCOMPLETE];
const STRIPE_FRAME = ["https://js.stripe.com", "https://*.js.stripe.com", "https://hooks.stripe.com", "https://checkout.stripe.com", "https://link.com", "https://*.link.com"];
const STRIPE_CONNECT = ["https://api.stripe.com", "https://checkout.stripe.com", "https://link.com", "https://*.link.com", ADDRESS_AUTOCOMPLETE];
const STRIPE_IMG = ["https://*.stripe.com", "https://*.link.com"];

/** The origin of the storage host, or null when the address is not one the policy can name. */
export function storageOrigin(supabaseUrl: string | null | undefined): string | null {
  if (!supabaseUrl) return null;
  try {
    const url = new URL(supabaseUrl);
    return url.protocol === "https:" || url.protocol === "http:" ? url.origin : null;
  } catch {
    return null;
  }
}

/** The policy, one directive after another. */
export function checkoutCsp(env: CspEnv = {}): string {
  const storage = storageOrigin(env.supabaseUrl);
  const directives: [string, string[]][] = [
    ["default-src", ["'self'"]],
    ["script-src", ["'self'", ...(env.sri ? [] : ["'unsafe-inline'"]), ...STRIPE_SCRIPT]],
    ["style-src", ["'self'", "'unsafe-inline'"]],
    ["img-src", ["'self'", "data:", "blob:", ...STRIPE_IMG, ...(storage ? [storage] : [])]],
    ["font-src", ["'self'"]],
    ["connect-src", ["'self'", ...STRIPE_CONNECT]],
    ["frame-src", STRIPE_FRAME],
    ["media-src", ["'self'", ...(storage ? [storage] : [])]],
    ["object-src", ["'none'"]],
    ["base-uri", ["'self'"]],
    ["form-action", ["'self'"]],
    ["frame-ancestors", ["'none'"]],
  ];
  const text = directives.map(([name, values]) => `${name} ${values.join(" ")}`);
  if (env.vercel) text.push("upgrade-insecure-requests");
  return text.join("; ");
}

export type HeaderEntry = { key: string; value: string };

/** The headers of the pay routes: the policy (enforced or report-only) and two that cost nothing. */
export function payHeaders(env: CspEnv = {}, enforce: boolean = CSP_ENFORCE): HeaderEntry[] {
  return [
    { key: enforce ? "Content-Security-Policy" : "Content-Security-Policy-Report-Only", value: checkoutCsp(env) },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "X-Content-Type-Options", value: "nosniff" },
  ];
}

/** The entries `next.config.ts`'s `headers()` returns for the pay routes, one for each shape of address. */
export function payRouteHeaders(env: CspEnv = {}, enforce: boolean = CSP_ENFORCE): { source: string; headers: HeaderEntry[] }[] {
  return PAY_SOURCES.map((source) => ({ source, headers: payHeaders(env, enforce) }));
}

/**
 * What a page and the frames in it may ask the device for (PSI 2026-10-28, SEC-07): the microphone only for the site's own pages (the
 * chat's and the AI manager's voice, the page studio's interview), never a frame's; no camera, location, USB or interest topics, which
 * nothing here uses. Payment is left to the browsers' default, which Stripe's wallets in its own frames need.
 */
export const PERMISSIONS_POLICY = "camera=(), geolocation=(), microphone=(self), usb=(), browsing-topics=()";

/**
 * Sent with every response (PSI 2026-10-24, SEC-07): a file is only ever taken as the type it says it is, and `PERMISSIONS_POLICY`.
 * `Referrer-Policy` is left out on purpose: the browsers' default is already `strict-origin-when-cross-origin`, and routes that need
 * `no-referrer` set it themselves, which a site-wide entry could override.
 */
export const SITE_HEADERS: HeaderEntry[] = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Permissions-Policy", value: PERMISSIONS_POLICY },
];

/**
 * The admin may be framed only by Kaizena Flow itself and, when the theme store has a host of its own, by that host: its pages show
 * a theme's look in frames of the admin's public preview (`designPreviewPath(…, embed)`). Only `frame-ancestors`, so the admin's
 * scripts and styles are as they were; anyone else framing an admin page to trick a click is refused.
 */
export function adminFrameHeaders(themesOrigin: string | null): HeaderEntry[] {
  return [{ key: "Content-Security-Policy", value: `frame-ancestors 'self'${themesOrigin ? ` ${themesOrigin}` : ""}` }];
}

/** Where browsers send what the site-wide Report-Only policy would have blocked (D389), counted by the route as log lines. */
export const CSP_REPORT_PATH = "/api/csp-report";

/** The ad and statistics tags `ConsentManager` loads after consent (D303 I1): their scripts and the addresses they report to. */
const TAG_SCRIPT = ["https://www.googletagmanager.com", "https://connect.facebook.net", "https://analytics.tiktok.com", "https://s.pinimg.com"];
const TAG_CONNECT = [
  "https://*.google-analytics.com",
  "https://*.analytics.google.com",
  "https://www.googletagmanager.com",
  "https://www.facebook.com",
  "https://analytics.tiktok.com",
  "https://ct.pinterest.com",
];
/** The videos a page may embed (D209, D325): YouTube's privacy-enhanced player and Vimeo's. */
const VIDEO_FRAME = ["https://www.youtube-nocookie.com", "https://www.youtube.com", "https://player.vimeo.com"];
/** Stripe's embedded components on the Payments page (Connect, D17) beside its payment forms. */
const STRIPE_CONNECT_SCRIPT = ["https://connect-js.stripe.com"];

/**
 * The site-wide policy (wave 11 unit J, D389; PSI SEC-05), sent as `Content-Security-Policy-Report-Only` on the admin, the storefront
 * and Kaizena Flow's own pages, so the site learns what loads before any of it is enforced: what it would block is reported to
 * `CSP_REPORT_PATH`, nothing is blocked. Without a nonce, said plainly: a nonce needs every page rendered per request, which the
 * prerendered pages (cache components, D211) are not, so `script-src` keeps `'unsafe-inline'` as the pay routes' enforced policy does;
 * it names every origin a script may come from. A store's own code (D61) from elsewhere is reported, which is what it is for.
 * `frame-ancestors` is left to the enforced headers (browsers ignore it in a Report-Only policy).
 */
export function siteReportOnlyCsp(env: CspEnv = {}): string {
  const storage = storageOrigin(env.supabaseUrl);
  const realtime = storage ? storage.replace(/^http/, "ws") : null;
  const directives: [string, string[]][] = [
    ["default-src", ["'self'"]],
    ["script-src", ["'self'", "'unsafe-inline'", ...STRIPE_SCRIPT, ...STRIPE_CONNECT_SCRIPT, ...TAG_SCRIPT]],
    ["style-src", ["'self'", "'unsafe-inline'"]],
    ["img-src", ["'self'", "data:", "blob:", "https:"]],
    ["font-src", ["'self'", "data:"]],
    ["connect-src", ["'self'", ...(storage ? [storage] : []), ...(realtime ? [realtime] : []), ...STRIPE_CONNECT, ...TAG_CONNECT]],
    ["frame-src", ["'self'", ...STRIPE_FRAME, "https://connect-js.stripe.com", ...VIDEO_FRAME]],
    ["media-src", ["'self'", "blob:", ...(storage ? [storage] : [])]],
    ["worker-src", ["'self'", "blob:"]],
    ["object-src", ["'none'"]],
    ["base-uri", ["'self'"]],
    ["form-action", ["'self'"]],
    ["report-uri", [CSP_REPORT_PATH]],
    ["report-to", ["csp"]],
  ];
  return directives.map(([name, values]) => `${name} ${values.join(" ")}`).join("; ");
}

/** The Report-Only policy's headers: the policy and the reporting endpoint its `report-to` names. */
export function reportOnlyHeaders(env: CspEnv = {}): HeaderEntry[] {
  return [
    { key: "Content-Security-Policy-Report-Only", value: siteReportOnlyCsp(env) },
    { key: "Reporting-Endpoints", value: `csp="${CSP_REPORT_PATH}"` },
  ];
}

/** The entries `next.config.ts` returns before the pay routes', whose stricter set comes later and so wins where both match. */
export function baseRouteHeaders(themesOrigin: string | null, env: CspEnv = {}): { source: string; headers: HeaderEntry[] }[] {
  return [
    { source: "/:path*", headers: [...SITE_HEADERS, ...reportOnlyHeaders(env)] },
    { source: "/admin/:path*", headers: adminFrameHeaders(themesOrigin) },
  ];
}
