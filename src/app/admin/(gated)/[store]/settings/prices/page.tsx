import type { Metadata } from "next";

import { AdminTextScope } from "@/components/admin/admin-text";
import { requireFeature } from "@/components/admin/feature-off";
import { PriceDisplayForm } from "@/components/admin/price-display-form";
import { PageHeader } from "@/components/admin/ui/page-header";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText, adminTexts } from "@/lib/admin-text";
import { countryName } from "@/lib/vat-text";
import { readPriceDisplay } from "@/server/price-display";
import { memberCan, requirePermission } from "@/server/permissions";

import { savePriceDisplayAction } from "./actions";

export const metadata: Metadata = { title: "Prices and quantity" };

/**
 * Prices and quantity (D429, D430): whether whole amounts show their decimals (the store's choice, each country's own in the Advanced fold),
 * the owner's words before and after a product's price by language, and how product pages offer a quantity. Everyone who may read settings
 * sees it; `settings:write` changes it. Part of the online shop (D178 step 5).
 */
export default async function PriceDisplayPage({ params }: PageProps<"/admin/[store]/settings/prices">) {
  const member = await requirePermission((await params).store, "settings:read");
  const shopOff = requireFeature(member, "shop");
  if (shopOff) return shopOff;
  const { store } = member;
  const lang = adminLangOf(member.account.adminLocale);
  const w = adminText(lang, "settings").prices;
  const display = await readPriceDisplay(store.id);
  // Names in the admin's language; the examples in the main country's currency and language.
  const names = lang === "nb" ? "nb-NO" : "en-GB";
  const languageNames = new Intl.DisplayNames([names], { type: "language" });
  const home = store.markets[0];
  return (
    <AdminTextScope texts={adminTexts(lang, ["settings"])}>
      <div className="flex flex-col gap-6">
        <PageHeader title={w.title} description={w.description} />
        <PriceDisplayForm
          display={display}
          places={{
            languages: store.localization.locales.map((locale) => ({ locale, name: languageNames.of(locale) ?? locale })),
            countries: Object.fromEntries(display.markets.map((market) => [market.code, countryName(market.code, names)])),
            currency: home?.nativeCurrency ?? "EUR",
            locale: home?.ownLocale ?? store.localization.locales[0] ?? "en-GB",
          }}
          canEdit={memberCan(member, "settings:write")}
          action={savePriceDisplayAction.bind(null, store.slug)}
        />
      </div>
    </AdminTextScope>
  );
}
