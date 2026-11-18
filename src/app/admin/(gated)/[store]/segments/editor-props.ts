import "server-only";

import { ADMIN_LANG_FACTS, type AdminLang } from "@/lib/admin-lang";
import { mainCurrency } from "@/lib/markets";
import { minorUnitDigits } from "@/lib/money";
import type { ConditionOffer } from "@/lib/segments";
import { featureOn } from "@/lib/store-features";
import { listTiers } from "@/server/customer-tiers";
import { rfmGroups } from "@/server/analytics-customers-data";
import { boughtChoices, storeTags } from "@/server/segments";
import { smsOffered } from "@/server/sms";
import type { Store } from "@/server/stores";
import { dealsOn } from "@/lib/extensions";

/**
 * What the rule builder chooses from: the store's own groups, tags, countries and languages (named in the admin's language), its products and
 * product categories, and which conditions it offers: customer types once they are known, and deals, reviews, subscriptions and texts only
 * while the store has them on (ecosystem plan E3.6, D718).
 */
export async function editorChoices(store: Store, lang: AdminLang = "en") {
  const [tiers, tags, rfm, bought, sms] = await Promise.all([listTiers(store.id), storeTags(store.id), rfmGroups(store, new Date()), boughtChoices(store), smsOffered(store.id)]);
  const regions = new Intl.DisplayNames([ADMIN_LANG_FACTS[lang].locale], { type: "region" });
  const tongues = new Intl.DisplayNames([ADMIN_LANG_FACTS[lang].locale], { type: "language" });
  const currency = mainCurrency(store);
  const languages = [...new Set(store.localization.keptLocales.map((l) => l.slice(0, 2).toLowerCase()))];
  const offer: ConditionOffer = {
    rfmReady: rfm.ready,
    deals: dealsOn(store),
    reviews: featureOn(store, "reviews"),
    subscriptions: featureOn(store, "subscriptions") || featureOn(store, "boxes"),
    sms,
  };
  return {
    currency,
    digits: minorUnitDigits(currency),
    groups: tiers.map((t) => ({ id: t.id, name: t.name })),
    tags: tags.map((t) => ({ key: t.key, label: t.label })),
    countries: store.allMarkets.map((m) => ({ code: m.code.toLowerCase(), name: regions.of(m.code.toUpperCase()) ?? m.code })),
    languages: languages.map((code) => ({ code, name: tongues.of(code) ?? code })),
    products: bought.products,
    categories: bought.categories,
    rfmReady: rfm.ready,
    offer,
  };
}
