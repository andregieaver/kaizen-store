import "server-only";

import { ADMIN_LANG_FACTS, type AdminLang } from "@/lib/admin-lang";
import { mainCurrency } from "@/lib/markets";
import { minorUnitDigits } from "@/lib/money";
import { listTiers } from "@/server/customer-tiers";
import { segmentPeople, storeTags } from "@/server/segments";
import type { Store } from "@/server/stores";

/**
 * What the rule builder chooses from: the store's own groups, tags, countries and languages (named in the admin's language), and whether customer
 * types are known yet.
 */
export async function editorChoices(store: Store, lang: AdminLang = "en") {
  const [tiers, tags, people] = await Promise.all([listTiers(store.id), storeTags(store.id), segmentPeople(store)]);
  const regions = new Intl.DisplayNames([ADMIN_LANG_FACTS[lang].locale], { type: "region" });
  const tongues = new Intl.DisplayNames([ADMIN_LANG_FACTS[lang].locale], { type: "language" });
  const currency = mainCurrency(store);
  const languages = [...new Set(store.localization.keptLocales.map((l) => l.slice(0, 2).toLowerCase()))];
  return {
    currency,
    digits: minorUnitDigits(currency),
    groups: tiers.map((t) => ({ id: t.id, name: t.name })),
    tags: tags.map((t) => ({ key: t.key, label: t.label })),
    countries: store.allMarkets.map((m) => ({ code: m.code.toLowerCase(), name: regions.of(m.code.toUpperCase()) ?? m.code })),
    languages: languages.map((code) => ({ code, name: tongues.of(code) ?? code })),
    rfmReady: people.rfmReady,
  };
}
