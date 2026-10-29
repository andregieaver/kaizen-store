import { AffiliateCapture } from "@/components/lazy/extras";
import { storeHome } from "@/lib/paths";
import { affiliateSite } from "@/server/affiliates";

/**
 * A store's referral link capture (D131), in its layouts, only while the program (or the creator programme, D386) is on: the browser reads `?ref=` (the
 * pages are prerendered, so the server cannot), keeps the code in memory and, once the visitor allows marketing cookies, in
 * a cookie. `base` is the market's own path, null on the front door's country chooser.
 */
export async function StoreAffiliate({ store, base }: { store: { id: string; slug: string }; base: string | null }) {
  const site = await affiliateSite(store.id);
  // A creator's link (D386) is captured the same way while the creator programme works.
  if (!site.capture) return null;
  return <AffiliateCapture storeId={store.id} storeSlug={store.slug} days={site.captureDays} base={base} scope={storeHome(store.slug)} />;
}
