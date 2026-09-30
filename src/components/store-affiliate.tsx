import { AffiliateCapture } from "@/components/affiliate-capture";
import { storeHome } from "@/lib/paths";
import { affiliateSite } from "@/server/affiliates";

/**
 * A store's referral link capture (D131), in its layouts, only while the program is on: the browser reads `?ref=` (the
 * pages are prerendered, so the server cannot), keeps the code in memory and, once the visitor allows marketing cookies, in
 * a cookie. `base` is the market's own path, null on the front door's country chooser.
 */
export async function StoreAffiliate({ store, base }: { store: { id: string; slug: string }; base: string | null }) {
  const site = await affiliateSite(store.id);
  if (!site.on) return null;
  return <AffiliateCapture storeId={store.id} storeSlug={store.slug} days={site.cookieDays} base={base} scope={storeHome(store.slug)} />;
}
