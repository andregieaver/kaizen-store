import { CookiePolicy } from "@/components/consent/cookie-policy";
import { liveCustomCode } from "@/lib/custom-code";
import type { Market } from "@/lib/markets";
import { siteCookies } from "@/server/site-cookies";
import type { Store } from "@/server/stores";

/** A store's cookie list (D58), in the market's language: the cookies page shows it, and so does a store's own page for it (D113). */
export async function CookiesSection({ store, market }: { store: Store; market: Market }) {
  const { cookies, categories } = await siteCookies(store.id, store.tracking, liveCustomCode(store.customCode), {
    buyers: store.audience === "both",
    colorMode: store.theme.settings.visitorSwitch,
  });
  return <CookiePolicy lang={market.lang} cookies={cookies} categories={categories} visitCounting={store.visitCounting} />;
}
