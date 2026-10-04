/**
 * The referral code's place in an address. Its own module, with no imports, because the cart, checkout and order pages carry it
 * to a reloaded page (`PayRouteGuard`) under a content security policy that allows no `eval`: zod, which `affiliates.ts` imports,
 * probes for it, so nothing the pay routes load may import `affiliates.ts` (`src/lib/pay-routes.test.ts`).
 */
export const AFFILIATE_PARAM = "ref";

/** The address with the code added. */
export function withAffiliate(href: string, origin: string, code: string): string {
  const url = new URL(href, origin);
  url.searchParams.set(AFFILIATE_PARAM, code);
  return url.origin === origin ? `${url.pathname}${url.search}${url.hash}` : url.toString();
}
