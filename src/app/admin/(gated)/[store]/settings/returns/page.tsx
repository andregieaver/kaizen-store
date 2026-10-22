import type { Metadata } from "next";

import { requireFeature } from "@/components/admin/feature-off";
import { ExchangeSettingsForm } from "@/components/admin/returns/exchange-settings-form";
import { ReturnSettingsForm } from "@/components/admin/returns/settings-form";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { carrierInfo } from "@/lib/shipping-carriers";
import { languageName } from "@/lib/localization";
import { featureOn } from "@/lib/store-features";
import { memberCan, requireOwnerRole } from "@/server/permissions";
import { getExchangeLabelSettings, getInstructionTranslations, getReturnSettings } from "@/server/return-settings";
import { listCarriers } from "@/server/shipping-carriers";
import { PageHeader } from "@/components/admin/ui";

import { saveExchangeLabelSettingsAction, saveReturnSettingsAction } from "./actions";

export const metadata: Metadata = { title: "Returns settings" };

/**
 * The store's rules for returns (D153): the return window, who pays return shipping, when refunds are made, what the law
 * excludes, where goods are sent and the instructions customers read. Owners change them; staff see them.
 */
export default async function ReturnSettingsPage({ params }: PageProps<"/admin/[store]/settings/returns">) {
  const current = await requireOwnerRole((await params).store);
  // Part of the online shop (D178 step 5): hidden while it is off, the store being a website.
  const shopOff = requireFeature(current, "shop");
  if (shopOff) return shopOff;
  const { store } = current;
  const [settings, translations, exchangeSettings, carriers] = await Promise.all([
    getReturnSettings(store.id),
    getInstructionTranslations(store.id),
    getExchangeLabelSettings(store.id),
    listCarriers(store.id),
  ]);
  // The store's connected carriers that book return labels (D239): `return_labels` among a carrier's built features.
  const labelCarriers = carriers.flatMap((c) => {
    const info = carrierInfo(c.carrier);
    return info?.available.includes("return_labels") ? [{ id: c.carrier, name: info.name, ready: c.complete && c.check?.ok === true }] : [];
  });
  const [main, ...others] = store.localization.locales;
  const words = adminText(adminLangOf(current.account.adminLocale), "returns");
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={words.settings.title}
        description={words.settings.description}
      />
      <ReturnSettingsForm
        settings={settings}
        translations={translations}
        main={{ locale: main, name: languageName(main) }}
        others={others.map((locale) => ({ locale, name: languageName(locale) }))}
        canEdit={memberCan(current, "owner")}
        action={saveReturnSettingsAction.bind(null, store.slug)}
        translateHref={`/admin/${store.slug}/translate`}
        sellsToBusinesses={featureOn(store, "business")}
        words={words}
      />
      <ExchangeSettingsForm
        values={exchangeSettings}
        carriers={labelCarriers}
        canEdit={memberCan(current, "owner")}
        action={saveExchangeLabelSettingsAction.bind(null, store.slug)}
        integrationsHref={`/admin/${store.slug}/integrations`}
        words={words}
      />
    </div>
  );
}
