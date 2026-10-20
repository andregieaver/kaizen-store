import "server-only";

import { mainCurrency } from "@/lib/markets";
import { minorUnitDigits } from "@/lib/money";
import { listTiers } from "@/server/customer-tiers";
import { segmentPeople, storeTags } from "@/server/segments";
import type { Store } from "@/server/stores";

/** What the rule builder chooses from: the store's own groups, tags, countries and languages, and whether customer types are known yet. */
export async function editorChoices(store: Store) {
  const [tiers, tags, people] = await Promise.all([listTiers(store.id), storeTags(store.id), segmentPeople(store)]);
  const regions = new Intl.DisplayNames(["en"], { type: "region" });
  const tongues = new Intl.DisplayNames(["en"], { type: "language" });
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
