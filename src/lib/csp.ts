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
