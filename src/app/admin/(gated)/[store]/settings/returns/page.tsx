import type { Metadata } from "next";

import { requireFeature } from "@/components/admin/feature-off";
import { ReturnSettingsForm } from "@/components/admin/returns/settings-form";
import { languageName } from "@/lib/localization";
import { featureOn } from "@/lib/store-features";
import { memberCan, requireOwnerRole } from "@/server/permissions";
import { getInstructionTranslations, getReturnSettings } from "@/server/return-settings";

import { saveReturnSettingsAction } from "./actions";

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
  const [settings, translations] = await Promise.all([getReturnSettings(store.id), getInstructionTranslations(store.id)]);
  const [main, ...others] = store.localization.locales;
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Returns</h1>
        <p className="text-sm text-muted">
          Customers in the EU can withdraw from most purchases within 14 days, without giving a reason. These are the store&apos;s rules around that:
          the days it offers on top, who pays to send goods back, and when the refund is made. The defaults are the law&apos;s. The texts
          customers read about their right are reviewed by a person: this is not legal advice.
        </p>
      </div>
      <ReturnSettingsForm
        settings={settings}
        translations={translations}
        main={{ locale: main, name: languageName(main) }}
        others={others.map((locale) => ({ locale, name: languageName(locale) }))}
        canEdit={memberCan(current, "owner")}
        action={saveReturnSettingsAction.bind(null, store.slug)}
        translateHref={`/admin/${store.slug}/translate`}
        sellsToBusinesses={featureOn(store, "business")}
      />
    </div>
  );
}
