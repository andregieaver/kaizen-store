import { AFFILIATE_PARAM } from "./affiliates";
import { storeHome, storeSiteUrl } from "./paths";

/**
 * A customer's link to share (D131): the store's front door with their code, `{store}/?ref={code}`, on the store's own host
 * once it has one. The front door keeps the code through its redirect or its country chooser, and every page of the store
 * reads it (`AffiliateCapture`).
 */
export function affiliateLink(storeSlug: string, code: string): string {
  const home = storeHome(storeSlug);
  return `${storeSiteUrl(storeSlug)}${home === "/" ? "/" : home}?${AFFILIATE_PARAM}=${code}`;
}
