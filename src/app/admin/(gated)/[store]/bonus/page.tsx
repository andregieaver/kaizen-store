import type { Metadata } from "next";

import { requireFeature } from "@/components/admin/feature-off";
import { BonusOverviewCard } from "@/components/admin/bonus-overview";
import { BonusSettingsForm } from "@/components/admin/bonus-settings-form";
import { mainCurrency } from "@/lib/markets";
import { memberCan, requirePermission } from "@/server/permissions";
import { bonusOverview, getBonusSettings } from "@/server/bonus";

import { saveBonusAction } from "./actions";

export const metadata: Metadata = { title: "Bonus credits" };

/**
 * The store's bonus program (D130): signed-in customers earn credits on what they pay and use them on a later order.
 * Owners set the rules; staff see them and what the program owes.
 */
export default async function BonusPage({ params }: PageProps<"/admin/[store]/bonus">) {
  const current = await requirePermission((await params).store, "marketing:read");
  const off = requireFeature(current, "bonus");
  if (off) return off;
  const { store } = current;
  const [settings, overview] = await Promise.all([getBonusSettings(store.id), bonusOverview(store.id)]);
  const locale = store.markets[0]?.locale ?? "nb-NO";

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Bonus credits</h1>
        <p className="text-sm text-muted">
          {settings.enabled ? "The bonus program is on." : "The bonus program is off."} Signed-in customers earn credits
          on what they buy and use them as a price reduction on a later order.
        </p>
      </div>
      <BonusOverviewCard overview={overview} locale={locale} />
      <BonusSettingsForm
        initial={settings}
        currency={mainCurrency(store)}
        locale={locale}
        canEdit={memberCan(current, "owner")}
        save={saveBonusAction.bind(null, store.slug)}
      />
    </div>
  );
}
