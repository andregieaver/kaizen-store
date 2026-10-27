import { headers } from "next/headers";

import { hintCountry } from "@/lib/country-hint";
import { isBot } from "@/lib/experiments";
import { t } from "@/lib/i18n";
import type { Market } from "@/lib/markets";
import { marketLink, marketPath } from "@/lib/paths";
import type { Store } from "@/server/stores";

import { CountryHint } from "./lazy/extras";

/**
 * The country suggestion (D338, `docs/wave-7-storefront.md` D3): read per request in its own `<Suspense>` hole, so the pages around it stay
 * cached and the same for all. Nothing for a crawler, a visitor whose country the store does not sell to, or one already in their country;
 * the market layout draws it off the pay routes. The link is to the same page in that country's own view, in its language.
 */
export async function CountryHintSection({ store, market }: { store: Store; market: Market }) {
  const request = await headers();
  if (isBot(request.get("user-agent"))) return null;
  const country = hintCountry(request.get("x-vercel-ip-country"), market.code, store.markets.map((m) => m.code));
  const target = country ? store.markets.find((m) => m.code === country) : undefined;
  if (!target) return null;
  const name = new Intl.DisplayNames([market.locale, "en"], { type: "region" }).of(target.code) ?? target.name;
  const words = t(market.lang).countryHint;
  return (
    <CountryHint
      fromBase={marketPath(store.slug, market.slug)}
      toBase={marketLink(store.slug, market.slug, target.slug)}
      lang={market.lang}
      words={{ offer: words.offer(name), go: words.go(name), close: words.close, label: words.label }}
    />
  );
}
